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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertSafeId, isSafeId, newPageId } from './ids.js'
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

export function readProject(cwd: string): Project {
  const file = projectFile(cwd)
  if (!existsSync(file)) return emptyProject()
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Project>
    if (!parsed || !Array.isArray(parsed.nodes)) return emptyProject()
    return {
      version: 1,
      viewport: normalizeViewport(parsed.viewport),
      nodes: parsed.nodes.filter(isPageNode),
      edges: Array.isArray(parsed.edges) ? parsed.edges.filter(isEdge) : [],
    }
  } catch {
    return emptyProject()
  }
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
  const project = readProject(cwd)
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
  if (!node) throw new Error(`节点不存在：${id}`)
  node.title = title
  node.updatedAt = Date.now()
  writeProjectAtomic(cwd, project)
  return project
}

export function moveNode(cwd: string, id: string, x: number, y: number): Project {
  assertSafeId(id)
  const project = readProject(cwd)
  const node = project.nodes.find((n) => n.id === id)
  if (!node) throw new Error(`节点不存在：${id}`)
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
  if (!src) throw new Error(`节点不存在：${id}`)
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

/** 新增连线（按 source→target 去重）。 */
export function addEdge(cwd: string, source: string, target: string, label?: string): Edge {
  const project = readProject(cwd)
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

/** 删除连线。 */
export function removeEdge(cwd: string, source: string, target: string): Project {
  const project = readProject(cwd)
  project.edges = project.edges.filter((e) => !(e.source === source && e.target === target))
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
