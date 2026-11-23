/** Synchronous workspace lock. A live owner's lock is never reclaimed; a lock whose recorded pid is gone is. */
import { randomBytes } from 'node:crypto'
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, unlinkSync, writeFileSync, type BigIntStats } from 'node:fs'
import { join } from 'node:path'
import { assertInsideWorkspace } from './paths.js'
import { warnUser } from './host.js'

export class WorkspaceBusyError extends Error {
  readonly code = 'WORKSPACE_BUSY'
  constructor() {
    super(
      '工作区正在执行其它写入，请稍后重试。若持锁进程已退出，重新执行即可自动回收；仍被占用时，关闭相关宿主后人工删除 .tianshu-canvas/project.lock。',
    )
    this.name = 'WorkspaceBusyError'
  }
}

const MAX_LOCK_BYTES = 512
const MAX_RECLAIM_ATTEMPTS = 2
const TOKEN_RE = /^[0-9a-f]{16,}$/i

interface LockRecord {
  pid: number
}

/** Read and validate an existing lock file. Any doubt means "not reclaimable". */
function readStaleCandidate(cwd: string, lock: string): { record: LockRecord; identity: BigIntStats } | null {
  let fd: number | undefined
  try {
    assertInsideWorkspace(cwd, lock, '工作区锁')
    const before = lstatSync(lock, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink() || before.size <= 0n || before.size > BigInt(MAX_LOCK_BYTES)) return null
    fd = openSync(lock, 'r')
    const opened = fstatSync(fd, { bigint: true })
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) return null
    const bytes = Buffer.alloc(Number(opened.size))
    const read = readSync(fd, bytes, 0, bytes.length, 0)
    const after = lstatSync(lock, { bigint: true })
    if (read !== bytes.length) return null
    if (!after.isFile() || after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) return null
    const parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
    if (parsed === null || typeof parsed !== 'object') return null
    const pid = parsed.pid
    // pid must be a positive integer: process.kill(0) would signal the whole
    // process group and negative pids address groups too.
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null
    if (parsed.version !== 1) return null
    if (typeof parsed.token !== 'string' || !TOKEN_RE.test(parsed.token)) return null
    if (pid === process.pid) return null
    return { record: { pid }, identity: opened }
  } catch {
    return null
  } finally {
    if (fd !== undefined) { try { closeSync(fd) } catch { /* ignore */ } }
  }
}

/** True only when the OS says the pid does not exist. EPERM and unknown errors count as alive. */
function isPidGone(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

/** Remove a dead owner's lock only if its identity and bytes still match what we examined. */
function reclaimDeadLock(cwd: string, lock: string, candidate: { record: LockRecord; identity: BigIntStats }): boolean {
  try {
    assertInsideWorkspace(cwd, lock, '工作区锁')
    const current = lstatSync(lock, { bigint: true })
    if (!current.isFile() || current.isSymbolicLink()) return false
    if (current.dev !== candidate.identity.dev || current.ino !== candidate.identity.ino || current.size !== candidate.identity.size) return false
    unlinkSync(lock)
    warnUser(`已回收遗留的工作区锁（持锁进程 ${candidate.record.pid} 已退出）：${lock}`)
    return true
  } catch (error) {
    // Another process may have reclaimed it first; the caller retries creation.
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

export function withWorkspaceLock<T>(cwd: string, action: (assertOwnership: () => void) => T): T {
  const dir = join(cwd, '.tianshu-canvas')
  assertInsideWorkspace(cwd, dir, '项目目录')
  mkdirSync(dir, { recursive: true })
  assertInsideWorkspace(cwd, dir, '项目目录')
  const lock = join(dir, 'project.lock')
  // Create entropy before owning a file: an RNG failure must not leave a lock.
  const record = Buffer.from(JSON.stringify({ version: 1, pid: process.pid, startedAt: Date.now(), token: randomBytes(24).toString('hex') }) + '\n')
  let fd: number | undefined
  for (let attempt = 0; fd === undefined; attempt++) {
    try {
      fd = openSync(lock, 'wx+', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (attempt >= MAX_RECLAIM_ATTEMPTS) throw new WorkspaceBusyError()
      const candidate = readStaleCandidate(cwd, lock)
      // Malformed, symlinked, replaced, self-owned or alive: never touch it.
      if (candidate === null || !isPidGone(candidate.record.pid) || !reclaimDeadLock(cwd, lock, candidate)) {
        throw new WorkspaceBusyError()
      }
    }
  }
  let identity: BigIntStats | undefined
  let recordWritten = false
  const ownsLock = (): boolean => {
    if (!identity || !recordWritten) return false
    try {
      assertInsideWorkspace(cwd, lock, '工作区锁')
      const current = lstatSync(lock, { bigint: true })
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || current.size !== BigInt(record.length)) return false
      const bytes = Buffer.alloc(record.length)
      const read = readSync(fd, bytes, 0, bytes.length, 0)
      const after = lstatSync(lock, { bigint: true })
      return read === record.length && bytes.equals(record) && after.isFile() && !after.isSymbolicLink() && after.dev === identity.dev && after.ino === identity.ino && after.size === BigInt(record.length)
    } catch { return false }
  }
  try {
    identity = fstatSync(fd, { bigint: true })
    writeFileSync(fd, record)
    recordWritten = true
    return action(() => { if (!ownsLock()) throw new WorkspaceBusyError() })
  } finally {
    // Both inode identity and exact holder bytes must still match. In particular,
    // never unlink a symlink, malformed lock, or another process's replacement.
    try {
      if (ownsLock()) unlinkSync(lock)
      // A creation-time failure may leave our exclusive, still-empty file. Only
      // unlink it after both fd and pathname identities have been established.
      // If identity verification itself fails, preserve the uncertain lock.
      else if (!recordWritten) {
        const opened = identity ?? fstatSync(fd, { bigint: true })
        assertInsideWorkspace(cwd, lock, '工作区锁')
        const current = lstatSync(lock, { bigint: true })
        if (opened.isFile() && current.isFile() && !current.isSymbolicLink() && current.dev === opened.dev && current.ino === opened.ino && current.size === 0n && opened.size === 0n) unlinkSync(lock)
      }
    } catch { /* Preserve changed locks and the original operation's result. */ }
    closeSync(fd)
  }
}
