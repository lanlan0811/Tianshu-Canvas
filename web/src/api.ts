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

export interface ApiComment {
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

export interface ApiProject {
  version: 1
  viewport: { x: number; y: number; zoom: number }
  nodes: ApiPageNode[]
  edges: ApiEdge[]
  /** 项目级设计风格锁定；缺省表示自由发挥。 */
  design?: { styleId: string; updatedAt: number }
  /** 元素批注；缺省表示没有。 */
  comments?: ApiComment[]
  /** 项目文件有问题时的提示。 */
  issue?: string
}

export interface ApiDesignTemplateSummary {
  id: string
  name: string
  device: string
}

export interface ApiDesignStyleSummary {
  id: string
  name: string
  tagline: string
  description: string
  tags: string[]
  swatches: string[]
  fonts: Record<string, string>
  iconStyle: { strokeWidth: number; linecap?: string; linejoin?: string }
  counts: { icons: number; components: number; templates: number }
  templates: ApiDesignTemplateSummary[]
}

export interface ApiDesignCatalog {
  schemaVersion: 1
  notice: string
  styles: ApiDesignStyleSummary[]
}

export interface ApiSelection {
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

const API_ROOT = location.pathname.replace(/\/$/, '')
const MUTATION_HEADERS = { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' }

export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

/** 服务端错误已经脱敏；此处再屏蔽旧服务可能返回的绝对路径。 */
function safeErrorText(text: string): string {
  return text
    .replace(/[A-Za-z]:[\\/][^\n\r"<>]*/g, '[本地路径]')
    .replace(/(?:\\\\[^\\\s]+\\|\/(?:Users|home|tmp|var|private|mnt)\/)[^\n\r"<>]*/g, '[本地路径]')
    .slice(0, 600)
}

async function checkResponse(res: Response): Promise<Response> {
  if (res.ok) return res
  let detail = ''
  try {
    const raw = await res.text()
    if (res.headers.get('content-type')?.includes('application/json')) {
      const body: unknown = JSON.parse(raw)
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') detail = body.error
    } else detail = raw
  } catch {
    // 响应可能断开；仍可用状态码给出恢复指引。
  }
  const fallback = res.status === 409
    ? '工作区正被其他进程写入，请稍后重试。'
    : res.status === 413
      ? '页面超过容量上限，请压缩或减少内联资源后重试。'
      : res.status >= 500
        ? '工作区操作失败，请检查文件状态后重试。'
        : '操作已被拒绝，请检查输入和工作区状态后重试。'
  throw new ApiRequestError(res.status, `操作失败（${res.status}）：${res.status >= 500 ? fallback : safeErrorText(detail.trim()) || fallback}`)
}

async function mutate(path: string, data: Record<string, unknown>): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${API_ROOT}/api/${path}`, {
      method: 'POST',
      headers: MUTATION_HEADERS,
      body: JSON.stringify(data),
    })
  } catch {
    throw new ApiRequestError(0, '无法连接画布服务，请检查服务是否仍在运行后重试。')
  }
  return checkResponse(res)
}

export async function fetchProject(ws: string): Promise<ApiProject> {
  const res = await fetch(`${API_ROOT}/api/project?ws=${encodeURIComponent(ws)}`)
  if (!res.ok) throw new Error(`project ${res.status}`)
  return (await res.json()) as ApiProject
}

export async function fetchDesignSystems(ws: string): Promise<ApiDesignCatalog | null> {
  try {
    const res = await fetch(`${API_ROOT}/api/design-systems?ws=${encodeURIComponent(ws)}`)
    if (!res.ok) return null
    return (await res.json()) as ApiDesignCatalog
  } catch {
    return null
  }
}

export async function fetchSelection(ws: string): Promise<ApiSelection | null> {
  const res = await fetch(`${API_ROOT}/api/selection?ws=${encodeURIComponent(ws)}`)
  if (!res.ok) return null
  const data = (await res.json()) as { selection: ApiSelection | null }
  return data.selection
}

const viewportSaves = new Map<string, { timer: ReturnType<typeof setTimeout>; cancel: () => void }>()

/** 只合并尚未发送的保存；取消正常结束，真实失败由调用方显示，不自动重试。 */
export function postViewport(ws: string, vp: { x: number; y: number; zoom: number }): Promise<void> {
  const previous = viewportSaves.get(ws)
  if (previous) {
    clearTimeout(previous.timer)
    previous.cancel()
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      viewportSaves.delete(ws)
      void mutate('viewport', { ws, ...vp }).then(() => resolve(), reject)
    }, 500)
    viewportSaves.set(ws, { timer, cancel: resolve })
  })
}

export async function postSelection(
  ws: string,
  pageId: string,
  kind: 'page' | 'element',
  payload?: Record<string, unknown>,
): Promise<void> {
  await mutate('selection', { ws, pageId, kind, payload })
}

export interface CommentInput {
  pageId: string
  xpath: string
  tagName: string
  textContent?: string
  note: string
}

/** 批注变更：add / resolve（含 reopen，resolved=false）/ remove（ids 省略即清空）。 */
export async function postCommentOp(
  ws: string,
  op: 'add' | 'resolve' | 'remove',
  data: CommentInput | { ids?: string[]; resolved?: boolean },
): Promise<boolean> {
  await mutate('comments', { ws, op, ...data })
  return true
}

export type NodeOp = 'remove' | 'rename' | 'duplicate' | 'move'

export async function postNodeOp(
  ws: string,
  op: NodeOp,
  data: { id: string; title?: string; x?: number; y?: number },
): Promise<ApiPageNode | null> {
  const res = await mutate('nodes', { ws, op, ...data })
  const body = (await res.json()) as { node?: ApiPageNode }
  return body.node ?? null
}

export async function postEdge(
  ws: string,
  op: 'add' | 'remove',
  source: string,
  target: string,
): Promise<void> {
  await mutate('edges', { ws, op, source, target })
}

export interface ExportResult {
  ok: boolean
  files: Array<{ name: string; path: string; bytes: number }>
  pngError?: string
  error?: string
}

export async function requestExport(ws: string, kind: 'png' | 'zip' | 'both'): Promise<ExportResult> {
  const res = await mutate('export', { ws, kind })
  return (await res.json()) as ExportResult
}

export function exportFileUrl(ws: string, name: string): string {
  return `${API_ROOT}/api/export-file?ws=${encodeURIComponent(ws)}&name=${encodeURIComponent(name)}`
}

export interface EventHandlers {
  onProject?: () => void
  onSelection?: () => void
}

/** 单一 EventSource，同时订阅 project / selection 两类事件。 */
export function subscribeEvents(ws: string, handlers: EventHandlers): () => void {
  const es = new EventSource(`${API_ROOT}/api/events?ws=${encodeURIComponent(ws)}`)
  if (handlers.onProject) es.addEventListener('project', handlers.onProject)
  if (handlers.onSelection) es.addEventListener('selection', handlers.onSelection)
  return () => es.close()
}
