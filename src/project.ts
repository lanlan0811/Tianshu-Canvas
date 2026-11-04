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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertSafeId, isSafeId } from './ids.js'
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

export interface Project {
  version: 1
  viewport: Viewport
  nodes: PageNode[]
  edges: unknown[]
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
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
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
