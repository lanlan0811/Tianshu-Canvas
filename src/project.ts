/**
 * 画布项目模型。
 *
 * 存储位置（工作区内，用户可见、可版本化）：
 *   <cwd>/.tianshu-canvas/project.json      画布模型
 *   <cwd>/.tianshu-canvas/pages/<id>.html   每个页面的原型 HTML
 *
 * 写入用「临时文件 + rename」保证原子性（同目录，NTFS/POSIX 均原子）。
 * 变更后 emit 事件，供本地服务广播 SSE。
 */
import { EventEmitter } from 'node:events'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { assertSafeId, InvalidInputError, isSafeId, newCommentId, newPageId } from './ids.js'
import { assertInsideWorkspace, assertReadableFile, prepareFileAtomic, readBytesInWorkspace, readTextInWorkspace, writeFileAtomic, type PreparedFileWrite } from './paths.js'
import { assertHtmlSize, assertPageCount } from './limits.js'
import { withWorkspaceLock } from './transaction.js'
import { warnUser } from './host.js'
import type { DeviceType } from './device.js'
import { normalizeStoredPageBrief, type PageBrief } from './brief.js'

export const PROJECT_DIR_NAME = '.tianshu-canvas'

export interface PageNode {
  id: string
  type: 'page'
  title: string
  x: number
  y: number
  width: number
  height: number
  deviceType: DeviceType
  /** 相对 cwd 的路径，如 `.tianshu-canvas/pages/page-3f2a91c4.html` */
  htmlPath: string
  /** 原型内容版本：AI 写入新 HTML 时更新，画布据此刷新 iframe。 */
  htmlRev?: number
  createdAt: number
  updatedAt: number
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** 画布上的连线（页面流程）。 */
export interface Edge {
  id: string
  source: string
  target: string
  label?: string
}

/** 画布上的选中项（回传给 AI 的上下文）。 */
export interface Selection {
  pageId: string
  kind: 'page' | 'element'
  element?: {
    xpath: string
    tagName: string
    textContent?: string
    computedStyles?: Record<string, string>
  }
  at: number
}

/** 项目级设计风格锁定；缺省表示「自由发挥」。 */
export interface ProjectDesign {
  styleId: string
  updatedAt: number
}

/**
 * 元素批注：用户在画布上给某个元素钉一句话，AI 批量读取后逐条修改。
 * `textContent` 与探针 payload 口径一致（trim、200 字），用于确认元素未被脚本改写。
 */
export interface Comment {
  id: string
  pageId: string
  xpath: string
  tagName: string
  textContent?: string
  note: string
  createdAt: number
  resolved: boolean
  resolvedAt?: number
}

export interface Project {
  version: 1
  viewport: Viewport
  nodes: PageNode[]
  edges: Edge[]
  design?: ProjectDesign
  comments?: Comment[]
  /** Optional page-local design intent, keyed only by existing page IDs. */
  pageBriefs?: Record<string, PageBrief>
}

/** 项目变更事件总线；服务端订阅后向浏览器广播。 */
export const projectEvents = new EventEmitter()
projectEvents.setMaxListeners(0)

export function projectDir(cwd: string): string {
  return join(cwd, PROJECT_DIR_NAME)
}

export function projectFile(cwd: string): string {
  return join(projectDir(cwd), 'project.json')
}

export function pagesDir(cwd: string): string {
  return join(projectDir(cwd), 'pages')
}

function emptyProject(): Project {
  return { version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] }
}

interface ProjectInspection {
  project: Project
  raw?: Buffer
  /** 整个文件不可用的原因（无法解析，或根上没有 nodes 数组）。 */
  problem?: string
  /** 读取时被过滤掉的无效节点与连线数量。 */
  dropped: number
  /** Invalid optional brief data must not be silently overwritten by routine writes. */
  briefProblem?: string
}

/**
 * 只读检查 project.json，绝不改动磁盘。
 * 文件可能正处于 git 冲突或编辑器保存的中间状态，读取时不能把它挪走；修好后画布应自动恢复。
 * 读文件本身失败（占用、权限、路径是目录）时直接抛出，不伪装成空项目。
 */
function inspectProject(cwd: string): ProjectInspection {
  const file = projectFile(cwd)
  if (!existsSync(file)) return { project: emptyProject(), dropped: 0 }
  // project.json 可能是指向工作区外的符号链接；读前按真实路径拒绝。
  const raw = readBytesInWorkspace(cwd, file, '项目文件')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch (err) {
    return { project: emptyProject(), raw, problem: (err as Error).message, dropped: 0 }
  }
  const obj = parsed as Partial<Project> | null
  if (!obj || !Array.isArray(obj.nodes)) {
    return { project: emptyProject(), raw, problem: '缺少 nodes 数组', dropped: 0 }
  }
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : []
  const nodes = obj.nodes.filter(isPageNode)
  const edges = rawEdges.filter(isEdge)
  const project: Project = { version: 1, viewport: normalizeViewport(obj.viewport), nodes, edges }
  const design = normalizeDesign(obj.design)
  if (design) project.design = design
  const rawComments = Array.isArray(obj.comments) ? obj.comments : []
  const comments = rawComments.map(normalizeComment).filter((c): c is Comment => c !== null)
  if (comments.length > 0) project.comments = comments
  let briefProblem: string | undefined
  if (Object.hasOwn(obj, 'pageBriefs')) {
    if (!obj.pageBriefs || typeof obj.pageBriefs !== 'object' || Array.isArray(obj.pageBriefs)) {
      briefProblem = 'pageBriefs 必须是普通对象'
    } else {
      const briefs: Record<string, PageBrief> = Object.create(null)
      const nodeIds = new Set(nodes.map((node) => node.id))
      for (const [id, value] of Object.entries(obj.pageBriefs)) {
        const brief = normalizeStoredPageBrief(value)
        if (!isSafeId(id) || !nodeIds.has(id) || !brief) {
          briefProblem = '存在无效、越界或无对应页面的简报条目'
          continue
        }
        briefs[id] = brief
      }
      if (Object.keys(briefs).length > 0) project.pageBriefs = briefs
    }
  }
  return {
    project,
    raw,
    ...(briefProblem ? { briefProblem } : {}),
    // 无效批注静默过滤（与 design 一致），不计入 dropped。
    dropped: obj.nodes.length - nodes.length + rawEdges.length - edges.length,
  }
}

export function readProject(cwd: string, tx?: ProjectTransaction): Project {
  if (tx) return checkedTransaction(cwd, tx).project
  return inspectProject(cwd).project
}

/** 需要告知用户的项目文件问题；文件健康时返回 null。 */
export function projectIssue(cwd: string, tx?: ProjectTransaction): string | null {
  if (tx) return checkedTransaction(cwd, tx).issue
  return inspectionIssue(inspectProject(cwd))
}

function inspectionIssue({ problem, dropped, briefProblem }: ProjectInspection): string | null {
  if (problem) {
    return `project.json 已损坏（${problem}）。画布暂按空项目显示，原文件未改动，修复后会自动恢复；继续写入前会先备份为 project.json.corrupt-*。`
  }
  if (dropped > 0) {
    return `project.json 中有 ${dropped} 条无效的节点或连线，读取时已忽略。原文件未改动，下次写入前会先备份为 project.json.corrupt-*。`
  }
  if (briefProblem) return `project.json 中有无效页面简报（${briefProblem}）。原文件未改动，修复前不应覆盖；显式其它写入前会先备份。`
  return null
}

const pendingBackups = new Map<string, string>()

/** 取出尚未告知用户的备份路径（取后清除）。 */
export function takeProjectBackup(cwd: string): string | null {
  const path = pendingBackups.get(cwd) ?? null
  pendingBackups.delete(cwd)
  return path
}

/** 写入会丢弃无法识别的内容，因此覆盖前先备份一份；备份是工作区内数据，同样走边界校验。 */
function backupDamagedProject(cwd: string, inspection: ProjectInspection): void {
  const { problem, dropped, briefProblem } = inspection
  if (!problem && dropped === 0 && !briefProblem) return
  const file = projectFile(cwd)
  const data = inspection.raw
  if (!data) return
  const stamp = Date.now()
  for (let n = 0; n < 1000; n++) {
    const dest = n === 0 ? `${file}.corrupt-${stamp}` : `${file}.corrupt-${stamp}-${n}`
    if (existsSync(dest)) continue
    // Preserve this transaction's inspected bytes, including invalid UTF-8.
    try {
      assertInsideWorkspace(cwd, dest, '项目备份')
      const fd = openSync(dest, 'wx', 0o600)
      try { writeFileSync(fd, data) } finally { closeSync(fd) }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
    pendingBackups.set(cwd, dest)
    warnUser(`project.json 已损坏或含无效条目，覆盖前已备份到 ${dest}`)
    return
  }
  throw new Error(`无法备份损坏的项目文件：${file}`)
}

/** One lock, one inspection, and at most one project.json publication. */
export class ProjectTransaction {
  project: Project
  readonly originalProject: Project
  readonly issue: string | null
  private readonly staged = new Map<string, { path: string; data: string | Buffer }>()
  private readonly deleted = new Map<string, { path: string; recursive: boolean }>()
  private readonly pageIds = new Set<string>()
  private readonly callbacks: Array<() => void> = []
  private dirty = false
  private notify = false
  private active = true

  constructor(readonly cwd: string, private readonly inspection: ProjectInspection, private readonly assertOwnership: () => void) {
    this.project = inspection.project
    this.originalProject = structuredClone(inspection.project)
    this.issue = inspectionIssue(inspection)
  }

  private key(path: string): string {
    const absolute = resolve(path)
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute
  }

  private assertActive(): void {
    if (!this.active) throw new Error('项目事务已结束')
  }

  private htmlPageId(path: string): string | null {
    if (this.key(dirname(path)) !== this.key(pagesDir(this.cwd)) || !/\.html$/i.test(path)) return null
    return basename(path).slice(0, -5)
  }

  get stagedPageIds(): ReadonlySet<string> { return this.pageIds }

  assertHealthy(): void {
    this.assertActive()
    if (this.issue) throw new InvalidInputError('project.json 已损坏或含无效条目，请先修复后重试。')
  }

  markProjectChanged(notify = true): void {
    this.assertActive()
    this.dirty = true
    this.notify ||= notify
  }

  stageFile(abs: string, data: string | Buffer): void {
    this.assertActive()
    const path = assertInsideWorkspace(this.cwd, resolve(abs), '事务写入目标')
    if (this.key(path) === this.key(projectFile(this.cwd))) throw new InvalidInputError('项目文件必须通过 writeProject 更新')
    if (this.key(path) === this.key(join(projectDir(this.cwd), 'project.lock'))) throw new InvalidInputError('事务不能修改工作区锁')
    const pageId = this.htmlPageId(path)
    if (pageId !== null) {
      assertSafeId(pageId)
      assertHtmlSize(data)
      this.pageIds.add(pageId)
    }
    this.deleted.delete(this.key(path))
    this.staged.set(this.key(path), { path, data: typeof data === 'string' ? data : Buffer.from(data) })
  }

  stagePageHtml(id: string, html: string): string {
    assertSafeId(id)
    assertHtmlSize(html)
    const rel = join(PROJECT_DIR_NAME, 'pages', `${id}.html`)
    this.stageFile(join(this.cwd, rel), html)
    this.pageIds.add(id)
    return rel
  }

  stageDelete(abs: string, recursive = false): void {
    this.assertActive()
    const path = assertInsideWorkspace(this.cwd, resolve(abs), '事务删除目标')
    const key = this.key(path)
    const root = this.key(projectDir(this.cwd))
    if (key === this.key(this.cwd) || key === root || key === this.key(projectFile(this.cwd)) || key === this.key(join(projectDir(this.cwd), 'project.lock'))) {
      throw new InvalidInputError('事务不能删除工作区根目录、项目文件或工作区锁')
    }
    this.staged.delete(key)
    this.deleted.set(key, { path, recursive })
  }

  readFile(abs: string): string | null {
    this.assertActive()
    const path = assertInsideWorkspace(this.cwd, resolve(abs), '事务读取目标')
    const key = this.key(path)
    const staged = this.staged.get(key)
    if (staged) return typeof staged.data === 'string' ? staged.data : staged.data.toString('utf8')
    for (const removed of this.deleted.values()) {
      const removedKey = this.key(removed.path)
      if (key === removedKey || (removed.recursive && key.startsWith(removedKey + (process.platform === 'win32' ? '\\' : '/')))) return null
    }
    if (!existsSync(path)) return null
    return readTextInWorkspace(this.cwd, path, '事务文件')
  }

  readPageHtml(id: string): string | null {
    if (!isSafeId(id)) return null
    return this.readFile(join(pagesDir(this.cwd), `${id}.html`))
  }

  afterCommit(callback: () => void): void {
    this.assertActive()
    this.callbacks.push(callback)
  }

  /** Called only by withProjectTransaction, while its exclusive lock is held. */
  commit(): void {
    this.assertActive()
    this.assertOwnership()
    if (this.dirty) {
      if (!this.project || !Array.isArray(this.project.nodes) || !Array.isArray(this.project.edges) || !this.project.nodes.every(isPageNode) || !this.project.edges.every(isEdge)) {
        throw new InvalidInputError('项目包含无效的节点或连线')
      }
      assertPageCount(this.project.nodes.length, this.originalProject.nodes.length)
      if (this.project.nodes.length > 1000) {
        const previousIds = new Set(this.originalProject.nodes.map((node) => node.id))
        if (this.project.nodes.some((node) => !previousIds.has(node.id))) assertPageCount(this.project.nodes.length)
      }
    }
    const projectData = this.dirty ? JSON.stringify(this.project, null, 2) + '\n' : undefined
    // Complete every validation before creating directories, backups or files.
    for (const id of this.pageIds) {
      const item = this.staged.get(this.key(join(pagesDir(this.cwd), `${id}.html`)))
      if (item) assertHtmlSize(item.data)
    }
    const targets = [...this.staged.values(), ...(projectData === undefined ? [] : [{ path: projectFile(this.cwd), data: projectData }])]
    if (this.dirty) assertInsideWorkspace(this.cwd, pagesDir(this.cwd), '页面目录')
    for (const item of targets) {
      assertInsideWorkspace(this.cwd, item.path, '事务写入目标')
      assertInsideWorkspace(this.cwd, resolve(item.path, '..'), '事务写入目录')
      if (existsSync(item.path) && !lstatSync(item.path).isFile()) throw new Error('事务写入目标不是普通文件')
    }
    for (const item of this.deleted.values()) {
      assertInsideWorkspace(this.cwd, item.path, '事务删除目标')
      if (existsSync(item.path) && lstatSync(item.path).isDirectory() && !item.recursive) throw new InvalidInputError('删除目录需要显式 recursive')
    }
    const operations = [
      ...targets.map((item) => ({ key: this.key(item.path), write: true })),
      ...[...this.deleted.values()].map((item) => ({ key: this.key(item.path), write: false })),
    ]
    const writePaths = new Set(operations.filter((item) => item.write).map((item) => item.key))
    const deletePaths = new Set(operations.filter((item) => !item.write).map((item) => item.key))
    // Walk actual path components. Whole-string lexical sorting does not keep
    // a subtree contiguous (style-alt sorts before style/meta on Windows).
    for (const operation of operations) {
      if (writePaths.has(operation.key) && deletePaths.has(operation.key)) throw new InvalidInputError('事务不能写入或删除重叠路径')
      let ancestor = dirname(operation.key)
      while (ancestor !== operation.key) {
        if (writePaths.has(ancestor) || (operation.write && deletePaths.has(ancestor))) throw new InvalidInputError('事务不能写入或删除重叠路径')
        const parent = dirname(ancestor)
        if (parent === ancestor) break
        ancestor = parent
      }
    }
    const prepared: PreparedFileWrite[] = []
    try {
      if (this.dirty) mkdirSync(pagesDir(this.cwd), { recursive: true })
      for (const item of targets) {
        mkdirSync(resolve(item.path, '..'), { recursive: true })
        prepared.push(prepareFileAtomic(this.cwd, item.path, item.data))
      }
      this.assertOwnership()
      if (this.dirty) backupDamagedProject(this.cwd, this.inspection)
      for (const item of prepared) item.commit()
      for (const item of this.deleted.values()) {
        assertInsideWorkspace(this.cwd, item.path, '事务删除目标')
        rmSync(item.path, { force: true, recursive: item.recursive })
      }
      this.active = false
      // Observers run after publication; their failures cannot undo the commit
      // or tell callers that a successful mutation should be retried.
      const observe = (callback: () => void): void => {
        try { callback() } catch (error) {
          try { warnUser(`项目已提交，但变更监听器执行失败：${error instanceof Error ? error.message : String(error)}`) } catch { /* Logger failures do not invalidate commits. */ }
        }
      }
      for (const callback of this.callbacks) observe(callback)
      if (this.notify) observe(() => { projectEvents.emit('change', { cwd: this.cwd }) })
    } finally {
      for (const item of prepared) item.discard()
    }
  }

  close(): void { this.active = false }
}

function checkedTransaction(cwd: string, tx: ProjectTransaction): ProjectTransaction {
  const normalize = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
  if (normalize(cwd) !== normalize(tx.cwd)) throw new InvalidInputError('项目事务不属于当前工作区')
  return tx
}

export function withProjectTransaction<T>(cwd: string, action: (tx: ProjectTransaction) => T): T {
  return withWorkspaceLock(cwd, (assertOwnership) => {
    const tx = new ProjectTransaction(cwd, inspectProject(cwd), assertOwnership)
    try {
      const result = action(tx)
      if (result && (typeof result === 'object' || typeof result === 'function') && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch(() => { /* Rejected asynchronous callbacks are invalid, already reported below. */ })
        throw new InvalidInputError('项目事务回调必须同步执行，网络请求和资源内联请在事务外完成')
      }
      tx.commit()
      return result
    } finally { tx.close() }
  })
}

function normalizeViewport(v: unknown): Viewport {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const x = typeof o.x === 'number' && Number.isFinite(o.x) ? o.x : 0
    const y = typeof o.y === 'number' && Number.isFinite(o.y) ? o.y : 0
    const zoom = typeof o.zoom === 'number' && Number.isFinite(o.zoom) && o.zoom > 0 ? o.zoom : 1
    return { x, y, zoom }
  }
  return { x: 0, y: 0, zoom: 1 }
}

/** 归一化 design 字段：样式 id 必须是非空字符串，时间戳必须是有限数；否则丢弃。 */
function normalizeDesign(v: unknown): ProjectDesign | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.styleId !== 'string' || o.styleId.trim() === '') return null
  const updatedAt = typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : 0
  return { styleId: o.styleId.trim(), updatedAt }
}

/** 归一化单条批注；字段缺失或不合法时返回 null（整条丢弃）。 */
function normalizeComment(v: unknown): Comment | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id.trim() === '') return null
  if (!isSafeId(o.pageId)) return null
  if (typeof o.xpath !== 'string' || o.xpath.trim() === '') return null
  if (typeof o.note !== 'string' || o.note.trim() === '') return null
  const createdAt = typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : 0
  const resolved = o.resolved === true
  const comment: Comment = {
    id: o.id.trim(),
    pageId: o.pageId,
    xpath: o.xpath,
    tagName: typeof o.tagName === 'string' ? o.tagName : '',
    note: o.note.trim(),
    createdAt,
    resolved,
  }
  if (typeof o.textContent === 'string') comment.textContent = o.textContent
  if (resolved && typeof o.resolvedAt === 'number' && Number.isFinite(o.resolvedAt)) comment.resolvedAt = o.resolvedAt
  return comment
}

function isPageNode(n: unknown): n is PageNode {
  if (!n || typeof n !== 'object') return false
  const o = n as Record<string, unknown>
  return typeof o.id === 'string' && isSafeId(o.id) && o.type === 'page'
}

function isEdge(e: unknown): e is Edge {
  if (!e || typeof e !== 'object') return false
  const o = e as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.source === 'string' && typeof o.target === 'string'
}

function writeProjectAtomic(cwd: string, project: Project, notify = true, tx?: ProjectTransaction): void {
  if (!tx) return withProjectTransaction(cwd, (current) => writeProjectAtomic(cwd, project, notify, current))
  checkedTransaction(cwd, tx).project = project
  tx.markProjectChanged(notify)
}

export function writeProject(cwd: string, project: Project, tx?: ProjectTransaction): void {
  writeProjectAtomic(cwd, project, true, tx)
}

export function writePageHtml(cwd: string, id: string, html: string, tx?: ProjectTransaction): string {
  assertSafeId(id)
  assertHtmlSize(html)
  if (!tx) return withProjectTransaction(cwd, (current) => writePageHtml(cwd, id, html, current))
  return checkedTransaction(cwd, tx).stagePageHtml(id, html)
}

export function readPageHtml(cwd: string, id: string, tx?: ProjectTransaction): string | null {
  if (!isSafeId(id)) return null
  if (tx) return checkedTransaction(cwd, tx).readPageHtml(id)
  const abs = join(pagesDir(cwd), `${id}.html`)
  if (!existsSync(abs)) return null
  // 页面文件可能是指向工作区外的符号链接；读取前按真实路径拒绝。
  return readTextInWorkspace(cwd, abs, '页面文件')
}

/** 删除页面文件；越界/符号链接的路径拒绝删除，返回是否真的删掉了。 */
function removePageHtml(cwd: string, id: string, tx: ProjectTransaction): void {
  const abs = join(pagesDir(cwd), `${id}.html`)
  if (!existsSync(abs)) return
  try {
    // 只按真实路径校验后删除链接本身；指向外部时拒绝（避免误删外部文件）。
    assertInsideWorkspace(cwd, abs, '页面文件')
  } catch {
    return
  }
  tx.stageDelete(abs)
}

/**
 * 插入或更新一个页面节点。
 * 若同 id 已存在则更新（保留 createdAt），否则追加。
 */
export function upsertNode(cwd: string, node: PageNode, tx?: ProjectTransaction): Project {
  if (!tx) return withProjectTransaction(cwd, (current) => upsertNode(cwd, node, current))
  if (!isPageNode(node)) throw new InvalidInputError('页面节点无效')
  const project = readProject(cwd, tx)
  const idx = project.nodes.findIndex((n) => n.id === node.id)
  if (idx >= 0) {
    const prev = project.nodes[idx]!
    project.nodes[idx] = { ...prev, ...node, createdAt: prev.createdAt, updatedAt: Date.now() }
  } else {
    assertPageCount(project.nodes.length + 1)
    project.nodes.push(node)
  }
  writeProjectAtomic(cwd, project, true, tx)
  return project
}

/** 省略坐标时按 3 列网格自动排布，避免节点重叠。 */
export function autoLayoutPosition(cwd: string, index: number, size: { width: number; height: number }): { x: number; y: number } {
  const gapX = 120
  const gapY = 140
  const cols = 3
  const col = index % cols
  const row = Math.floor(index / cols)
  return {
    x: col * (size.width + gapX),
    y: row * (size.height + gapY),
  }
}

export function setViewport(cwd: string, viewport: Viewport, tx?: ProjectTransaction): Project {
  if (!tx) return withProjectTransaction(cwd, (current) => setViewport(cwd, viewport, current))
  const project = readProject(cwd, tx)
  // 平移画布不是用户的写入意图，不能因此备份并改写有问题的项目文件。
  if (tx.issue) return project
  project.viewport = normalizeViewport(viewport)
  // 视口就来自浏览器本身，不需要广播；广播会让画布全量重载节点。
  writeProjectAtomic(cwd, project, false, tx)
  return project
}

/** 下一个自动排布用的索引（= 现有节点数）。 */
export function nextLayoutIndex(cwd: string, tx?: ProjectTransaction): number {
  return readProject(cwd, tx).nodes.length
}

// ---------------------------------------------------------------------------
// 节点 / 边 编排
// ---------------------------------------------------------------------------

/** 删除节点（连带删除与其相连的边、该页批注与页面文件）。 */
export function removeNode(cwd: string, id: string, tx?: ProjectTransaction): Project {
  assertSafeId(id)
  if (!tx) return withProjectTransaction(cwd, (current) => removeNode(cwd, id, current))
  const project = readProject(cwd, tx)
  project.nodes = project.nodes.filter((n) => n.id !== id)
  project.edges = project.edges.filter((e) => e.source !== id && e.target !== id)
  if (project.comments) {
    const keep = project.comments.filter((c) => c.pageId !== id)
    if (keep.length > 0) project.comments = keep
    else delete project.comments
  }
  if (project.pageBriefs) {
    delete project.pageBriefs[id]
    if (Object.keys(project.pageBriefs).length === 0) delete project.pageBriefs
  }
  writeProjectAtomic(cwd, project, true, tx)
  try {
    removePageHtml(cwd, id, tx)
  } catch {
    /* 忽略 */
  }
  return project
}

export function renameNode(cwd: string, id: string, title: string, tx?: ProjectTransaction): Project {
  assertSafeId(id)
  if (!tx) return withProjectTransaction(cwd, (current) => renameNode(cwd, id, title, current))
  if (typeof title !== 'string' || !title.trim()) throw new InvalidInputError('页面标题不能为空')
  const project = readProject(cwd, tx)
  const node = project.nodes.find((n) => n.id === id)
  if (!node) throw new InvalidInputError(`节点不存在：${id}`)
  node.title = title
  node.updatedAt = Date.now()
  writeProjectAtomic(cwd, project, true, tx)
  return project
}

export function moveNode(cwd: string, id: string, x: number, y: number, tx?: ProjectTransaction): Project {
  assertSafeId(id)
  if (!tx) return withProjectTransaction(cwd, (current) => moveNode(cwd, id, x, y, current))
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new InvalidInputError('页面坐标必须是有限数值')
  const project = readProject(cwd, tx)
  const node = project.nodes.find((n) => n.id === id)
  if (!node) throw new InvalidInputError(`节点不存在：${id}`)
  node.x = x
  node.y = y
  node.updatedAt = Date.now()
  writeProjectAtomic(cwd, project, true, tx)
  return project
}

/** 复制节点（新 id、复制页面 HTML、偏移 40px、标题加「副本」）。返回新节点。 */
export function duplicateNode(cwd: string, id: string, title?: string, tx?: ProjectTransaction): PageNode {
  assertSafeId(id)
  if (!tx) return withProjectTransaction(cwd, (current) => duplicateNode(cwd, id, title, current))
  const project = readProject(cwd, tx)
  const src = project.nodes.find((n) => n.id === id)
  if (!src) throw new InvalidInputError(`节点不存在：${id}`)
  assertPageCount(project.nodes.length + 1)
  if (title !== undefined && (typeof title !== 'string' || !title.trim())) throw new InvalidInputError('页面标题不能为空')
  const newId = newPageId()
  const html = readPageHtml(cwd, id, tx) ?? ''
  const rel = writePageHtml(cwd, newId, html, tx)
  const now = Date.now()
  const node: PageNode = {
    ...src,
    id: newId,
    title: title ?? `${src.title} 副本`,
    x: src.x + 40,
    y: src.y + 40,
    htmlPath: rel,
    createdAt: now,
    updatedAt: now,
  }
  project.nodes.push(node)
  if (project.pageBriefs && Object.hasOwn(project.pageBriefs, id)) {
    // A copy inherits the original decision and its timestamp; it is not new approval.
    project.pageBriefs[newId] = structuredClone(project.pageBriefs[id]!)
  }
  writeProjectAtomic(cwd, project, true, tx)
  return node
}

function assertEdgeEnds(source: string, target: string): void {
  assertSafeId(source)
  assertSafeId(target)
  if (source === target) throw new InvalidInputError(`不能将节点连接到自身：${source}`)
}

function assertEdgeNodes(project: Project, source: string, target: string): void {
  if (!project.nodes.some((n) => n.id === source)) throw new InvalidInputError(`节点不存在：${source}`)
  if (!project.nodes.some((n) => n.id === target)) throw new InvalidInputError(`节点不存在：${target}`)
}

/** 新增连线（按 source→target 去重）。两端必须是已存在的节点，且不能自环。 */
export function addEdge(cwd: string, source: string, target: string, label?: string, tx?: ProjectTransaction): Edge {
  assertEdgeEnds(source, target)
  if (!tx) return withProjectTransaction(cwd, (current) => addEdge(cwd, source, target, label, current))
  const project = readProject(cwd, tx)
  assertEdgeNodes(project, source, target)
  const exists = project.edges.find((e) => e.source === source && e.target === target)
  if (exists) {
    if (label !== undefined && exists.label !== label) {
      exists.label = label
      writeProjectAtomic(cwd, project, true, tx)
    }
    return exists
  }
  const edge: Edge = { id: `edge-${source}-${target}`, source, target, ...(label ? { label } : {}) }
  project.edges.push(edge)
  writeProjectAtomic(cwd, project, true, tx)
  return edge
}

/**
 * 删除连线；没有匹配的连线时不写盘。
 * 不校验端点：旧版本可能写入过悬空连线或自环，校验会让这些数据再也删不掉。
 */
export function removeEdge(cwd: string, source: string, target: string, tx?: ProjectTransaction): Project {
  if (!tx) return withProjectTransaction(cwd, (current) => removeEdge(cwd, source, target, current))
  const project = readProject(cwd, tx)
  const edges = project.edges.filter((e) => !(e.source === source && e.target === target))
  if (edges.length === project.edges.length) return project
  project.edges = edges
  writeProjectAtomic(cwd, project, true, tx)
  return project
}

// ---------------------------------------------------------------------------
// 选中项（回传给 AI）
// ---------------------------------------------------------------------------

export function selectionFile(cwd: string): string {
  return join(projectDir(cwd), 'selection.json')
}

export function readSelection(cwd: string): Selection | null {
  const file = selectionFile(cwd)
  if (!existsSync(file)) return null
  try {
    // 选中项是工作区数据；指向外部的链接不做读取（读会泄露外部文件内容）。
    assertReadableFile(cwd, file, '选中项')
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Selection
    if (!parsed || typeof parsed.pageId !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function writeSelection(cwd: string, selection: Selection): void {
  assertInsideWorkspace(cwd, projectDir(cwd), '项目目录')
  mkdirSync(projectDir(cwd), { recursive: true })
  writeFileAtomic(cwd, selectionFile(cwd), JSON.stringify(selection, null, 2) + '\n')
  projectEvents.emit('selection', { cwd })
}

// ---------------------------------------------------------------------------
// 元素批注
// ---------------------------------------------------------------------------

export function readComments(cwd: string, tx?: ProjectTransaction): Comment[] {
  return readProject(cwd, tx).comments ?? []
}

/** 给某个页面元素添加一条批注。pageId 必须对应已存在的节点。 */
export function addComment(
  cwd: string,
  input: { pageId: string; xpath: string; tagName?: string; textContent?: string; note: string },
  tx?: ProjectTransaction,
): Comment {
  assertSafeId(input.pageId)
  if (!input.xpath || input.xpath.trim() === '') throw new InvalidInputError('批注缺少 xpath')
  if (!input.note || input.note.trim() === '') throw new InvalidInputError('批注内容不能为空')
  if (!tx) return withProjectTransaction(cwd, (current) => addComment(cwd, input, current))
  const project = readProject(cwd, tx)
  if (!project.nodes.some((n) => n.id === input.pageId)) {
    throw new InvalidInputError(`节点不存在：${input.pageId}`)
  }
  const comment: Comment = {
    id: newCommentId(),
    pageId: input.pageId,
    xpath: input.xpath,
    tagName: input.tagName ?? '',
    note: input.note.trim(),
    createdAt: Date.now(),
    resolved: false,
  }
  if (input.textContent !== undefined) comment.textContent = input.textContent
  project.comments = [...(project.comments ?? []), comment]
  writeProjectAtomic(cwd, project, true, tx)
  return comment
}

/** 批量标记批注为已解决 / 重新打开。返回命中的条数。 */
export function setCommentsResolved(cwd: string, ids: string[], resolved: boolean, tx?: ProjectTransaction): number {
  if (!tx) return withProjectTransaction(cwd, (current) => setCommentsResolved(cwd, ids, resolved, current))
  const project = readProject(cwd, tx)
  const comments = project.comments ?? []
  if (comments.length === 0) return 0
  const wanted = new Set(ids)
  let changed = 0
  for (const c of comments) {
    if (!wanted.has(c.id) || c.resolved === resolved) continue
    c.resolved = resolved
    if (resolved) c.resolvedAt = Date.now()
    else delete c.resolvedAt
    changed++
  }
  if (changed > 0) writeProjectAtomic(cwd, project, true, tx)
  return changed
}

/** 删除批注；不传 ids 时清空全部。返回删除条数。 */
export function removeComments(cwd: string, ids?: string[], tx?: ProjectTransaction): number {
  if (!tx) return withProjectTransaction(cwd, (current) => removeComments(cwd, ids, current))
  const project = readProject(cwd, tx)
  const comments = project.comments ?? []
  if (comments.length === 0) return 0
  const keep = ids ? comments.filter((c) => !ids.includes(c.id)) : []
  const removed = comments.length - keep.length
  if (removed === 0) return 0
  if (keep.length > 0) project.comments = keep
  else delete project.comments
  writeProjectAtomic(cwd, project, true, tx)
  return removed
}
