/** Synchronous workspace lock. A stale or replaced lock is never reclaimed. */
import { randomBytes } from 'node:crypto'
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, unlinkSync, writeFileSync, type BigIntStats } from 'node:fs'
import { join } from 'node:path'
import { assertInsideWorkspace } from './paths.js'

export class WorkspaceBusyError extends Error {
  readonly code = 'WORKSPACE_BUSY'
  constructor() {
    super('工作区正在执行其它写入，请稍后重试；若宿主异常退出，请关闭相关宿主后人工清理 .tianshu-canvas 中的 project.lock。')
    this.name = 'WorkspaceBusyError'
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
  let fd: number
  try {
    fd = openSync(lock, 'wx+', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WorkspaceBusyError()
    throw error
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
