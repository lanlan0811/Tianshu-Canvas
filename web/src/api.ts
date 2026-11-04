/**
 * 与本地画布服务通信：拉项目、提交视口、订阅 SSE。
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
}

export interface ApiProject {
  version: 1
  viewport: { x: number; y: number; zoom: number }
  nodes: ApiPageNode[]
  edges: unknown[]
}

export async function fetchProject(ws: string): Promise<ApiProject> {
  const res = await fetch(`/api/project?ws=${encodeURIComponent(ws)}`)
  if (!res.ok) throw new Error(`project ${res.status}`)
  return (await res.json()) as ApiProject
}

let viewportTimer: ReturnType<typeof setTimeout> | undefined

export function postViewport(ws: string, vp: { x: number; y: number; zoom: number }): void {
  clearTimeout(viewportTimer)
  viewportTimer = setTimeout(() => {
    void fetch('/api/viewport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
      body: JSON.stringify({ ws, ...vp }),
    }).catch(() => {
      /* ignore */
    })
  }, 500)
}

export function subscribeProject(ws: string, onEvent: () => void): () => void {
  const es = new EventSource(`/api/events?ws=${encodeURIComponent(ws)}`)
  es.addEventListener('project', onEvent)
  return () => es.close()
}
