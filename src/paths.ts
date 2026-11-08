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
 *
 * 覆盖范围（技术反馈 0.8.1 阻断项一）：**全部隐式读写入口**都走这里——
 * 项目文件 / 页面文件 / 选中项 / url.txt、品牌记忆与品牌包、自定义设计系统（library/）、
 * 代码生成与审计落盘、导出（PNG/ZIP）、漂移快照与视觉基线。
 *
 * 「工作区内」的判定是**词法**的：调用方写下的路径若落在 cwd 内，就必须经得起真实路径校验；
 * 落在 cwd 外的路径视为用户显式指定（宿主 pathParams 守卫已核验），本模块不额外拒绝，
 * 但**仍然**用独占随机临时文件 + rename，避免跟随被预置的叶子链接。
 *
 * 另外（技术反馈 0.8.2）：**自动发现**的文件（`package.json` / `components.json` /
 * `tailwind.config.*` / `app/globals.css` / `src/**` 等）属于**可被工作区内容改写**的输入，
 * 不是用户显式指定，因此一律经 {@link confineToWorkspace} 收敛后再读——
 * 配置里写成 `../outside/x.css`、或候选文件本身是指向工作区外的符号链接，都会被拒绝。
 */
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

/** `O_NOFOLLOW` 只在部分平台存在；缺失时按 0（退化为「打开后复检」）。 */
const O_NOFOLLOW: number | undefined = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW
const O_RDONLY: number = constants.O_RDONLY

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
 * 校验 `abs` 允许在工作区 `cwd` 内读写；越界/链接越界一律抛 PathBoundaryError。
 *
 * 判定口径：**路径是否落在工作区内**完全由真实路径决定（`realpath` 后比较包含关系）。
 * 已存在的**最深祖先**的真实路径必须在 cwd 真实路径内——这一条同时挡住三类越界：
 *   - 叶子是符号链接 / Windows 目录联接，指向工作区外；
 *   - 中间某级父目录是这种链接（真实路径会跳到工作区外）；
 *   - `..` 拼接（拼接结果本身就在 cwd 外，词法上也是）。
 * 叶子不存在时（新建文件）不报错：交给调用方以**独占创建**兜底，避免 TOCTOU。
 *
 * 调用方若**刻意**写下工作区外的绝对路径（`out_dir` / `pack_path` 等用户显式指定的落点），
 * 走 {@link assertWritableTarget} / {@link assertReadablePath}，不按工作区边界拒绝，
 * 但仍拒绝「同名叶子是链接」这种可被预置的替换点。
 */
export function assertInsideWorkspace(cwd: string, abs: string, label = '路径'): string {
  const root = realRoot(cwd)
  const target = resolve(abs)
  // 词法上就不在 cwd 内：直接按越界处理（`..` 拼接在这里被挡）。
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

/**
 * 把「自动发现」的候选路径收敛到工作区内；越界或不安全时返回 null（调用方跳过）。
 *
 * 与 {@link assertInsideWorkspace} 的区别：这是**尽力而为**的过滤——
 * 配置里写了工作区外的路径、或候选文件是指向工作区外的链接，都不应让整个导入失败，
 * 而是当作「该候选不存在」。因此不抛错，只返回 null。
 *
 * 校验三件事：
 *   1. 词法上必须在 cwd 内（挡住 `../outside/x.css` 这类配置写法）；
 *   2. 已存在的最深祖先的真实路径必须在 cwd 真实路径内（挡住链接父目录）；
 *   3. 叶子若已存在，按**真实路径**必须在 cwd 内（挡住叶子是指向工作区外的链接）。
 */
export function confineToWorkspace(cwd: string, abs: string): string | null {
  const target = resolve(abs)
  if (!insideLexically(cwd, target)) return null
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
    return null
  }
  if (!isInside(realRoot(cwd), probeReal)) return null
  if (existsSync(target)) {
    if (isLink(target)) return null
    try {
      if (!isInside(realRoot(cwd), realpathSync(target))) return null
    } catch {
      return null
    }
  }
  return target
}

/**
 * 「自动发现」文件的读取入口：收敛到工作区内后再读。
 * 路径越界、叶子是链接、或文件不存在/不可读时返回 null（调用方按「未找到」处理）。
 * 这是 package.json / components.json / tailwind.config.* / globals.css / src 扫描等
 * 一切**由工作区内容决定**的读取的唯一入口，避免配置或链接把工作区外的文件读进来。
 *
 * 竞态处理（反馈点名的「检查后替换」）：先**打开**再校验——
 *   - `O_NOFOLLOW`（支持的平台）让叶子是链接时 open 直接失败，不存在检查与打开的窗口；
 *   - 打开后 `fstat(fd)` 必须是普通文件，且对**打开后的路径**再 realpath 一次仍在工作区内
 *     （若在 open 之后被换成指向外部的链接，这次复检会发现）；
 *   - 内容从 **fd** 读取，不再按路径二次解析，因此读到的一定是被校验的那个文件。
 */
export function readConfined(cwd: string, abs: string): string | null {
  const target = confineToWorkspace(cwd, abs)
  if (target === null) return null
  // O_NOFOLLOW 在 Windows 上不存在；存在时用它把「叶子是链接」变成 open 失败（无窗口）。
  const noFollow = O_NOFOLLOW ?? 0
  let fd: number
  try {
    fd = openSync(target, O_RDONLY | noFollow)
  } catch {
    return null
  }
  try {
    const info = fstatSync(fd)
    if (!info.isFile()) return null
    // open 之后路径被替换成指向工作区外的链接时，这里复检会失败。
    try {
      if (!isInside(realRoot(cwd), realpathSync(target))) return null
    } catch {
      return null
    }
    return readFileSync(fd, 'utf8')
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}

/** 路径是否在工作区内、已存在且为普通文件（不解码内容）。 */
export function existsConfinedPath(cwd: string, abs: string): boolean {
  const safe = confineToWorkspace(cwd, abs)
  if (safe === null) return false
  try {
    return lstatSync(safe).isFile()
  } catch {
    return false
  }
}

/**
 * 读取文本文件：工作区内的路径按边界拒绝越界；工作区外的（用户显式指定的
 * `pack_path` 等）不按边界拒绝。两种情况都拒绝**叶子符号链接**——
 * 读链接会把工作区外的文件内容带进来。
 */
export function readTextInWorkspace(cwd: string, abs: string, label = '文件'): string {
  const target = resolve(abs)
  if (insideLexically(cwd, target)) assertInsideWorkspace(cwd, target, label)
  let info
  try {
    info = lstatSync(target)
  } catch {
    throw new Error(`${label}不存在：${target}`)
  }
  if (info.isSymbolicLink()) throw new PathBoundaryError(`${label}是符号链接，已拒绝：${target}`)
  if (!info.isFile()) throw new Error(`${label}不是普通文件：${target}`)
  return readFileSync(target, 'utf8')
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
  throw new PathBoundaryError(`无法在目录内创建临时文件：${dir}`)
}

/** 写目标的统一校验：工作区内的按边界拒绝越界，工作区外的按用户显式指定放行。 */
export function assertWritableTarget(cwd: string, abs: string, label = '写入目标'): string {
  const target = resolve(abs)
  if (insideLexically(cwd, target)) assertInsideWorkspace(cwd, target, label)
  return target
}

/**
 * 原子写入：独占创建随机临时文件 → 写入 → rename 覆盖。
 *
 * 与旧实现的关键差别：
 *   - 工作区内的目标按真实路径校验包含关系（含各级父目录的链接）；
 *   - 工作区外的目标（用户显式指定）不按边界拒绝，但**仍然**用独占随机临时文件，
 *     预置的固定 `.tmp` 链接不再可用；
 *   - rename 之前再拒一次叶子链接，堵住「校验后被替换」的竞态。
 */
export function writeFileAtomic(cwd: string, dest: string, data: string | Buffer): string {
  const target = assertWritableTarget(cwd, dest, '写入目标')
  const dir = resolve(target, '..')
  // 工作区内时，落盘目录（含其各级父目录）也必须经得起边界校验。
  if (insideLexically(cwd, target)) {
    assertInsideWorkspace(cwd, dir, '写入目录')
  }
  const { path: tmp, fd } = tempSibling(dir, basename(target))
  try {
    writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
  } finally {
    closeSync(fd)
  }
  try {
    // rename 会把叶子处的链接整体替换成普通文件；但若它是指向目录的联接，
    // rename 会失败。这里显式拒绝，避免出现半成品。
    if (isLink(target)) throw new PathBoundaryError(`写入目标已被替换为符号链接，已拒绝：${target}`)
    assertWritableTarget(cwd, target, '写入目标')
    renameSync(tmp, target)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
  return target
}

/**
 * 建目录 + 原子写入（统一落盘入口）。
 * 目录在建之前先校验边界：`pages/`、`exports/`、`library/` 这类目录本身
 * 可能被预置成指向工作区外的目录联接。工作区外的目标（用户显式指定）只建目录，
 * 写入仍由 {@link writeFileAtomic} 以独占随机临时文件完成。
 */
export function writeFileInWorkspace(cwd: string, dest: string, data: string | Buffer, label = '写入目标'): string {
  const target = resolve(dest)
  assertWritableTarget(cwd, target, label)
  mkdirSync(resolve(target, '..'), { recursive: true })
  return writeFileAtomic(cwd, target, data)
}

/**
 * 目标（词法上）是否落在工作区内——用于决定「按工作区边界严格拒绝」还是
 * 「按用户显式指定的落点放行」。这里用**未解析**的 cwd，避免 tmpdir 本身是
 * 符号链接（macOS `/var` → `/private/var`）时把工作区内的路径误判成工作区外。
 */
function insideLexically(cwd: string, targetAbs: string): boolean {
  return isInside(resolve(cwd), resolve(targetAbs))
}
