/**
 * 与本地画布服务通信：拉项目、提交视口、选中、节点/边编排、编辑回写、订阅 SSE。
 */
export interface ApiPageNode {
  id: string
  type: 'page'
  title: string
  x: number
  y: number
  width: number
  height: number
  deviceType: string
  htmlPath: string
  htmlRev?: number
}

export interface ApiEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface ApiProject {
  version: 1
  viewport: { x: number; y: number; zoom: number }
  nodes: ApiPageNode[]
  edges: ApiEdge[]
  /** 项目文件有问题时的提示。 */
  issue?: string
}

export interface ApiSelection {
  pageId: string
  kind: 'page' | 'element'
  element?: {
    xpath: string
    tagName: string
    textContent?: string
    editableText?: string | null
    computedStyles?: Record<string, string>
  }
  at: number
}

const MUTATION_HEADERS = { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' }

export async function fetchProject(ws: string): Promise<ApiProject> {
  const res = await fetch(`/api/project?ws=${encodeURIComponent(ws)}`)
  if (!res.ok) throw new Error(`project ${res.status}`)
  return (await res.json()) as ApiProject
}

export async function fetchSelection(ws: string): Promise<ApiSelection | null> {
  const res = await fetch(`/api/selection?ws=${encodeURIComponent(ws)}`)
  if (!res.ok) return null
  const data = (await res.json()) as { selection: ApiSelection | null }
  return data.selection
}

let viewportTimer: ReturnType<typeof setTimeout> | undefined

export function postViewport(ws: string, vp: { x: number; y: number; zoom: number }): void {
  clearTimeout(viewportTimer)
  viewportTimer = setTimeout(() => {
    void fetch('/api/viewport', {
      method: 'POST',
      headers: MUTATION_HEADERS,
      body: JSON.stringify({ ws, ...vp }),
    }).catch(() => {
      /* ignore */
    })
  }, 500)
}

export async function postSelection(
  ws: string,
  pageId: string,
  kind: 'page' | 'element',
  payload?: Record<string, unknown>,
): Promise<void> {
  await fetch('/api/selection', {
    method: 'POST',
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ ws, pageId, kind, payload }),
  }).catch(() => {
    /* ignore */
  })
}

export type NodeOp = 'remove' | 'rename' | 'duplicate' | 'move'

export async function postNodeOp(
  ws: string,
  op: NodeOp,
  data: { id: string; title?: string; x?: number; y?: number },
): Promise<ApiPageNode | null> {
  const res = await fetch('/api/nodes', {
    method: 'POST',
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ ws, op, ...data }),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { node?: ApiPageNode }
  return body.node ?? null
}

export async function postEdge(
  ws: string,
  op: 'add' | 'remove',
  source: string,
  target: string,
): Promise<void> {
  await fetch('/api/edges', {
    method: 'POST',
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ ws, op, source, target }),
  }).catch(() => {
    /* ignore */
  })
}

export async function fetchPageSource(ws: string, id: string): Promise<string> {
  const res = await fetch(`/api/page-html?ws=${encodeURIComponent(ws)}&id=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`读取页面失败（${res.status}）`)
  return res.text()
}

export async function postPageHtml(ws: string, id: string, html: string): Promise<boolean> {
  const res = await fetch('/api/page-html', {
    method: 'POST',
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ ws, id, html }),
  })
  return res.ok
}

export interface ExportResult {
  ok: boolean
  files: Array<{ name: string; path: string; bytes: number }>
  pngError?: string
  error?: string
}

export async function requestExport(ws: string, kind: 'png' | 'zip' | 'both'): Promise<ExportResult> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ ws, kind }),
  })
  return (await res.json()) as ExportResult
}

export function exportFileUrl(ws: string, name: string): string {
  return `/api/export-file?ws=${encodeURIComponent(ws)}&name=${encodeURIComponent(name)}`
}

export interface EventHandlers {
  onProject?: () => void
  onSelection?: () => void
}

/** 单一 EventSource，同时订阅 project / selection 两类事件。 */
export function subscribeEvents(ws: string, handlers: EventHandlers): () => void {
  const es = new EventSource(`/api/events?ws=${encodeURIComponent(ws)}`)
  if (handlers.onProject) es.addEventListener('project', handlers.onProject)
  if (handlers.onSelection) es.addEventListener('selection', handlers.onSelection)
  return () => es.close()
}
