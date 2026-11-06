/**
 * 工作区文件边界。
 *
 * 插件写的是用户工作区内的 `.tianshu-canvas/`，但「路径拼出来在 cwd 里」并不等于
 * 「实际落到 cwd 里」：任一级父目录或叶子都可能是符号链接 / Windows 目录联接，
 * 指向工作区之外。两处真实危害：
 *   - 读：把工作区外的文件当页面内容返回（`/api/page-html`、导出）；
 *   - 写：`writeFileSync(tmp, …)` 会**跟随**叶子符号链接，把内容写进目标文件，
 *     随后 rename 只换掉了链接本身，外部文件已被改写。
 *
 * 因此约定：
 *   1. 任何读/写/导出前都调 `assertInsideWorkspace`：先按真实路径校验包含关系，
 *      再逐级拒绝符号链接与目录联接；
 *   2. 写入一律用**独占创建的随机临时文件**（`wx`，落在同一目录），
 *      预置的符号链接会让 open 直接 EEXIST 失败，且随机名让替换点不可预测；
 *   3. `writeFileAtomic` 在 rename 前再拒一次叶子链接，堵住「校验后被替换」。
 */
import { closeSync, existsSync, lstatSync, openSync, realpathSync, renameSync, rmSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'

/** 路径越界 / 符号链接越界 / 边界被替换：属于调用方输入问题。 */
export class PathBoundaryError extends Error {}

function caseFold(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/** 目标（或其父目录）是否落在根目录内。两侧都应是绝对路径。 */
function isInside(rootAbs: string, targetAbs: string): boolean {
  const rel = relative(caseFold(rootAbs), caseFold(targetAbs))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** 路径本身是否是符号链接（Windows 的目录联接同样 lstat 为符号链接）。 */
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/** 取根目录的真实路径；根目录自身不存在时退回词法绝对路径。 */
function realRoot(cwd: string): string {
  const abs = resolve(cwd)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}

/**
 * 校验 `abs` 允许在工作区 `cwd` 内读写；不允许则抛 PathBoundaryError。
 *
 * 校验三件事：
 *   - 词法上必须在 cwd 内（挡住 `..` 拼接）；
 *   - 已存在的**最深祖先**的真实路径必须在 cwd 真实路径内（挡住指向外部的链接父目录）；
 *   - 叶子若已存在，其真实路径也必须在 cwd 内（挡住叶子本身是链接）。
 * 叶子不存在时（新建文件）不报错，交给调用方以独占创建兜底。
 */
export function assertInsideWorkspace(cwd: string, abs: string, label = '路径'): string {
  const root = realRoot(cwd)
  const target = resolve(abs)
  if (!isInside(root, target)) {
    throw new PathBoundaryError(`${label}越出工作区：${target}`)
  }
  // 最深已存在祖先：链接父目录会让它的真实路径落在工作区外。
  let probe = target
  while (!existsSync(probe)) {
    const parent = resolve(probe, '..')
    if (parent === probe) break
    probe = parent
  }
  let probeReal: string
  try {
    probeReal = realpathSync(probe)
  } catch {
    throw new PathBoundaryError(`${label}无法解析真实路径：${probe}`)
  }
  if (!isInside(root, probeReal)) {
    throw new PathBoundaryError(`${label}经符号链接指向工作区外：${probe} -> ${probeReal}`)
  }
  // 叶子已是链接（这时 existsSync 为真，probeReal 即其真实目标）——上面已拦；
  // 这里再做一次显式判断，给出更准确的原因。
  if (isLink(target)) {
    throw new PathBoundaryError(`${label}是符号链接，已拒绝：${target}`)
  }
  return target
}

/**
 * 读取前校验。
 * 只有「越界 / 符号链接」才是边界问题（对应 403）；路径被替换成目录等
 * 非普通文件属于工作区被破坏的意外状态，仍按 500 处理，保持既有语义。
 */
export function assertReadableFile(cwd: string, abs: string, label = '文件'): string {
  assertInsideWorkspace(cwd, abs, label)
  let info
  try {
    info = lstatSync(abs)
  } catch {
    throw new Error(`${label}不存在：${abs}`)
  }
  if (info.isSymbolicLink()) throw new PathBoundaryError(`${label}是符号链接，已拒绝：${abs}`)
  if (!info.isFile()) throw new Error(`${label}不是普通文件：${abs}`)
  return abs
}

function tempSibling(dir: string, base: string): { path: string; fd: number } {
  for (let attempt = 0; attempt < 64; attempt++) {
    const candidate = join(dir, `.${base}.tmp-${randomBytes(6).toString('hex')}`)
    try {
      // 'wx'：已存在（含被预置成符号链接的情形）直接 EEXIST，绝不跟随。
      return { path: candidate, fd: openSync(candidate, 'wx', 0o600) }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
  }
  throw new PathBoundaryError(`无法在工作区创建临时文件：${dir}`)
}

/**
 * 原子写入工作区内的文件：独占创建随机临时文件 → 写入 → rename 覆盖。
 * `dir` 已存在（调用方负责 mkdir）；`dest` 的最终位置在 rename 前会再校验一次。
 */
export function writeFileAtomic(cwd: string, dest: string, data: string | Buffer): string {
  const target = resolve(dest)
  const dir = resolve(target, '..')
  assertInsideWorkspace(cwd, target, '写入目标')
  const { path: tmp, fd } = tempSibling(dir, target.slice(dir.length + 1))
  try {
    writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
  } finally {
    closeSync(fd)
  }
  try {
    // rename 会把叶子处的链接整体替换成普通文件；但若它是指向目录的联接，
    // rename 会失败。这里显式拒绝，避免出现半成品。
    if (isLink(target)) throw new PathBoundaryError(`写入目标已被替换为符号链接，已拒绝：${target}`)
    assertInsideWorkspace(cwd, target, '写入目标')
    renameSync(tmp, target)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
  return target
}
