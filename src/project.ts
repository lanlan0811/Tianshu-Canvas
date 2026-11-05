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
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertSafeId, InvalidInputError, isSafeId, newPageId } from './ids.js'
import type { DeviceType } from './device.js'

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

export interface Project {
  version: 1
  viewport: Viewport
  nodes: PageNode[]
  edges: Edge[]
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
  /** 整个文件不可用的原因（无法解析，或根上没有 nodes 数组）。 */
  problem?: string
  /** 读取时被过滤掉的无效节点与连线数量。 */
  dropped: number
}

/**
 * 只读检查 project.json，绝不改动磁盘。
 * 文件可能正处于 git 冲突或编辑器保存的中间状态，读取时不能把它挪走；修好后画布应自动恢复。
 * 读文件本身失败（占用、权限、路径是目录）时直接抛出，不伪装成空项目。
 */
function inspectProject(cwd: string): ProjectInspection {
  const file = projectFile(cwd)
  if (!existsSync(file)) return { project: emptyProject(), dropped: 0 }
  const raw = readFileSync(file, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { project: emptyProject(), problem: (err as Error).message, dropped: 0 }
  }
  const obj = parsed as Partial<Project> | null
  if (!obj || !Array.isArray(obj.nodes)) {
    return { project: emptyProject(), problem: '缺少 nodes 数组', dropped: 0 }
  }
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : []
  const nodes = obj.nodes.filter(isPageNode)
  const edges = rawEdges.filter(isEdge)
  return {
    project: { version: 1, viewport: normalizeViewport(obj.viewport), nodes, edges },
    dropped: obj.nodes.length - nodes.length + rawEdges.length - edges.length,
  }
}

export function readProject(cwd: string): Project {
  return inspectProject(cwd).project
}

/** 需要告知用户的项目文件问题；文件健康时返回 null。 */
export function projectIssue(cwd: string): string | null {
  const { problem, dropped } = inspectProject(cwd)
  if (problem) {
    return `project.json 已损坏（${problem}）。画布暂按空项目显示，原文件未改动，修复后会自动恢复；继续写入前会先备份为 project.json.corrupt-*。`
  }
  if (dropped > 0) {
    return `project.json 中有 ${dropped} 条无效的节点或连线，读取时已忽略。原文件未改动，下次写入前会先备份为 project.json.corrupt-*。`
  }
  return null
}

const pendingBackups = new Map<string, string>()

/** 取出尚未告知用户的备份路径（取后清除）。 */
export function takeProjectBackup(cwd: string): string | null {
  const path = pendingBackups.get(cwd) ?? null
  pendingBackups.delete(cwd)
  return path
}

/** 写入会丢弃无法识别的内容，因此覆盖前先复制一份；用复制而非改名，原文件直到原子替换前都在。 */
function backupDamagedProject(cwd: string): void {
  const { problem, dropped } = inspectProject(cwd)
  if (!problem && dropped === 0) return
  const file = projectFile(cwd)
  const stamp = Date.now()
  for (let n = 0; n < 1000; n++) {
    const dest = n === 0 ? `${file}.corrupt-${stamp}` : `${file}.corrupt-${stamp}-${n}`
    try {
      copyFileSync(file, dest, constants.COPYFILE_EXCL)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
    pendingBackups.set(cwd, dest)
    console.error(`[tianshu-canvas] project.json 已损坏或含无效条目，覆盖前已备份到 ${dest}`)
    return
  }
  throw new Error(`无法备份损坏的项目文件：${file}`)
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

function writeProjectAtomic(cwd: string, project: Project): void {
  mkdirSync(pagesDir(cwd), { recursive: true })
  backupDamagedProject(cwd)
  const file = projectFile(cwd)
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(project, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  projectEvents.emit('change', { cwd })
}

export function writePageHtml(cwd: string, id: string, html: string): string {
  assertSafeId(id)
  mkdirSync(pagesDir(cwd), { recursive: true })
  const rel = join(PROJECT_DIR_NAME, 'pages', `${id}.html`)
  const abs = join(cwd, rel)
  const tmp = abs + '.tmp'
  writeFileSync(tmp, html, 'utf8')
  renameSync(tmp, abs)
  return rel
}

export function readPageHtml(cwd: string, id: string): string | null {
  if (!isSafeId(id)) return null
  const abs = join(pagesDir(cwd), `${id}.html`)
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null
}

/**
 * 插入或更新一个页面节点。
 * 若同 id 已存在则更新（保留 createdAt），否则追加。
 */
export function upsertNode(cwd: string, node: PageNode): Project {
  const project = readProject(cwd)
  const idx = project.nodes.findIndex((n) => n.id === node.id)
  if (idx >= 0) {
    const prev = project.nodes[idx]!
    project.nodes[idx] = { ...prev, ...node, createdAt: prev.createdAt, updatedAt: Date.now() }
  } else {
    project.nodes.push(node)
  }
  writeProjectAtomic(cwd, project)
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

export function setViewport(cwd: string, viewport: Viewport): Project {
  const { project, problem, dropped } = inspectProject(cwd)
  // 平移画布不是用户的写入意图，不能因此备份并改写有问题的项目文件。
  if (problem || dropped > 0) return project
  project.viewport = normalizeViewport(viewport)
  writeProjectAtomic(cwd, project)
  return project
}

/** 下一个自动排布用的索引（= 现有节点数）。 */
export function nextLayoutIndex(cwd: string): number {
  return readProject(cwd).nodes.length
}

// ---------------------------------------------------------------------------
// 节点 / 边 编排
// ---------------------------------------------------------------------------

/** 删除节点（连带删除与其相连的边与页面文件）。 */
export function removeNode(cwd: string, id: string): Project {
  assertSafeId(id)
  const project = readProject(cwd)
  project.nodes = project.nodes.filter((n) => n.id !== id)
  project.edges = project.edges.filter((e) => e.source !== id && e.target !== id)
  writeProjectAtomic(cwd, project)
  try {
    rmSync(join(pagesDir(cwd), `${id}.html`), { force: true })
  } catch {
    /* 忽略 */
  }
  return project
}

export function renameNode(cwd: string, id: string, title: string): Project {
  assertSafeId(id)
  const project = readProject(cwd)
  const node = project.nodes.find((n) => n.id === id)
  if (!node) throw new InvalidInputError(`节点不存在：${id}`)
  node.title = title
  node.updatedAt = Date.now()
  writeProjectAtomic(cwd, project)
  return project
}

export function moveNode(cwd: string, id: string, x: number, y: number): Project {
  assertSafeId(id)
  const project = readProject(cwd)
  const node = project.nodes.find((n) => n.id === id)
  if (!node) throw new InvalidInputError(`节点不存在：${id}`)
  node.x = x
  node.y = y
  node.updatedAt = Date.now()
  writeProjectAtomic(cwd, project)
  return project
}

/** 复制节点（新 id、复制页面 HTML、偏移 40px、标题加「副本」）。返回新节点。 */
export function duplicateNode(cwd: string, id: string, title?: string): PageNode {
  assertSafeId(id)
  const project = readProject(cwd)
  const src = project.nodes.find((n) => n.id === id)
  if (!src) throw new InvalidInputError(`节点不存在：${id}`)
  const newId = newPageId()
  const html = readPageHtml(cwd, id) ?? ''
  const rel = writePageHtml(cwd, newId, html)
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
  writeProjectAtomic(cwd, project)
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
export function addEdge(cwd: string, source: string, target: string, label?: string): Edge {
  assertEdgeEnds(source, target)
  const project = readProject(cwd)
  assertEdgeNodes(project, source, target)
  const exists = project.edges.find((e) => e.source === source && e.target === target)
  if (exists) {
    if (label !== undefined && exists.label !== label) {
      exists.label = label
      writeProjectAtomic(cwd, project)
    }
    return exists
  }
  const edge: Edge = { id: `edge-${source}-${target}`, source, target, ...(label ? { label } : {}) }
  project.edges.push(edge)
  writeProjectAtomic(cwd, project)
  return edge
}

/**
 * 删除连线；没有匹配的连线时不写盘。
 * 不校验端点：旧版本可能写入过悬空连线或自环，校验会让这些数据再也删不掉。
 */
export function removeEdge(cwd: string, source: string, target: string): Project {
  const project = readProject(cwd)
  const edges = project.edges.filter((e) => !(e.source === source && e.target === target))
  if (edges.length === project.edges.length) return project
  project.edges = edges
  writeProjectAtomic(cwd, project)
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
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Selection
    if (!parsed || typeof parsed.pageId !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function writeSelection(cwd: string, selection: Selection): void {
  mkdirSync(projectDir(cwd), { recursive: true })
  const file = selectionFile(cwd)
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(selection, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  projectEvents.emit('selection', { cwd })
}
