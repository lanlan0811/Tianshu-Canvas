/**
 * 本地画布服务（127.0.0.1 单例）。
 *
 * 为什么是本地服务：天枢 TPI 插件是 headless 的，无法内嵌窗口，因此画布前端以
 * 「本地 HTTP 服务 + 浏览器打开」的方式呈现（方案 A）。
 *
 * 生命周期：模块级单例，跨工具调用存活；`unref()` 使其不阻塞宿主退出；
 * dispose 时**不关闭**服务（浏览器标签可能仍开着）。
 *
 * 安全：
 *  - 只绑定 127.0.0.1；校验 Host 头。
 *  - 静态资源白名单（非目录遍历）。
 *  - 原型 HTML 视为不可信：iframe 无 allow-same-origin + `/page/:id` 严格 CSP + nosniff。
 *  - 变更路由要求自定义头 `X-Tianshu-Canvas: 1`（跨源无法带自定义头 → 天然防 CSRF）。
 */
import http from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSafeId, InvalidInputError } from './ids.js'
import { injectProbe } from './probe.js'
import { exportsDir, runExport, type ExportKind } from './export.js'
import {
  addEdge,
  moveNode,
  projectEvents,
  projectIssue,
  readPageHtml,
  readProject,
  readSelection,
  removeEdge,
  removeNode,
  renameNode,
  duplicateNode,
  setViewport,
  writePageHtml,
  writeSelection,
  type Selection,
} from './project.js'

const WEB_DIR = fileURLToPath(new URL('./web/', import.meta.url))

const DEFAULT_PORT = 43117
const MUTATION_HEADER = 'x-tianshu-canvas'
const MAX_BODY = 4 * 1024 * 1024
/** 视口请求体很小，沿用比通用 JSON 更紧的上限。 */
const MAX_VIEWPORT_BODY = 4096
/** 超限响应发出后，最多再等这么久让客户端发完请求体。 */
const BODY_DRAIN_MS = 2000

interface ServerState {
  server: http.Server
  port: number
  tokens: Map<string, string>
  sse: Map<string, Set<http.ServerResponse>>
}

let state: ServerState | null = null

export function tokenFor(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16)
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

async function listenWithFallback(server: http.Server, preferred: number): Promise<number> {
  if (preferred === 0) return listen(server, 0)
  for (let i = 0; i < 21; i++) {
    try {
      return await listen(server, preferred + i)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
    }
  }
  return listen(server, 0)
}

export interface ServerHandle {
  token: string
  port: number
  url: string
}

export async function ensureServer(cwd: string, preferredPort = DEFAULT_PORT): Promise<ServerHandle> {
  if (!state) {
    const server = http.createServer(handleRequest)
    server.on('clientError', (_err, socket) => socket.destroy())
    const port = await listenWithFallback(server, preferredPort)
    server.unref()
    const created: ServerState = { server, port, tokens: new Map(), sse: new Map() }
    state = created
    projectEvents.on('change', ({ cwd: changed }: { cwd: string }) => {
      broadcast(created, tokenFor(changed), 'project')
    })
    projectEvents.on('selection', ({ cwd: changed }: { cwd: string }) => {
      broadcast(created, tokenFor(changed), 'selection')
    })
  }
  const token = tokenFor(cwd)
  state.tokens.set(token, cwd)
  return { token, port: state.port, url: `http://127.0.0.1:${state.port}/?ws=${token}` }
}

export function currentUrl(cwd: string): string | null {
  if (!state) return null
  const token = tokenFor(cwd)
  if (!state.tokens.has(token)) return null
  return `http://127.0.0.1:${state.port}/?ws=${token}`
}

/** 仅供测试：关闭服务并复位单例。 */
export async function shutdownForTests(): Promise<void> {
  if (!state) return
  const s = state
  state = null
  for (const set of s.sse.values()) {
    for (const res of set) {
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }
  }
  await new Promise<void>((resolve) => s.server.close(() => resolve()))
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

const ASSET_TYPES: Record<string, string> = {
  'canvas.js': 'application/javascript; charset=utf-8',
  'canvas.css': 'text/css; charset=utf-8',
  'canvas.js.map': 'application/json; charset=utf-8',
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    routeRequest(req, res)
  } catch (err) {
    // 同步异常（例如读页面文件失败）不能打垮进程。
    console.error('[tianshu-canvas] 请求处理失败：', err)
    // 响应头已发出时无法再改状态码，只能断开，否则客户端会一直挂起。
    if (res.headersSent) res.destroy()
    else send(res, 500, 'text/plain; charset=utf-8', 'internal error')
  }
}

function routeRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const host = req.headers.host
  if (!host || !isLocalHost(host)) {
    return send(res, 403, 'text/plain; charset=utf-8', 'forbidden host')
  }
  // 基址只用于解析路径和查询串。'//' 这样的请求路径会让 new URL 抛错。
  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://127.0.0.1')
  } catch {
    return send(res, 400, 'text/plain; charset=utf-8', 'bad request')
  }
  const path = url.pathname

  if (req.method === 'GET' && path === '/healthz') {
    return send(res, 200, 'text/plain; charset=utf-8', 'ok')
  }

  if (req.method === 'GET' && path === '/') {
    return serveStatic(res, 'index.html')
  }

  if (req.method === 'GET' && path.startsWith('/assets/')) {
    const name = path.slice('/assets/'.length)
    if (name in ASSET_TYPES) return serveStatic(res, name, ASSET_TYPES[name])
    return send(res, 404, 'text/plain; charset=utf-8', 'not found')
  }

  if (req.method === 'GET' && path === '/api/project') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'unknown workspace' }))
    const issue = projectIssue(cwd)
    return sendJson(res, { ...readProject(cwd), ...(issue ? { issue } : {}) })
  }

  if (req.method === 'GET' && path === '/api/events') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'text/plain; charset=utf-8', 'unknown workspace')
    return handleSse(res, tokenFor(cwd))
  }

  if (req.method === 'GET' && path.startsWith('/page/')) {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'text/plain; charset=utf-8', 'unknown workspace')
    let id: string
    try {
      id = decodeURIComponent(path.slice('/page/'.length))
    } catch (err) {
      // 畸形百分号编码会抛 URIError；不能让它变成未捕获异常。
      if (err instanceof URIError) return send(res, 400, 'text/plain; charset=utf-8', 'bad page id')
      throw err
    }
    const html = readPageHtml(cwd, id)
    if (html === null) return send(res, 404, 'text/plain; charset=utf-8', 'page not found')
    // 注入探针：iframe 内做元素命中/选择/编辑（CSP 已允许内联脚本）
    return sendUntrustedHtml(res, injectProbe(html))
  }

  if (req.method === 'GET' && path === '/api/selection') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'unknown workspace' }))
    return sendJson(res, { selection: readSelection(cwd) })
  }

  if (req.method === 'GET' && path === '/api/page-html') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'text/plain; charset=utf-8', 'unknown workspace')
    const html = readPageHtml(cwd, url.searchParams.get('id') ?? '')
    if (html === null) return send(res, 404, 'text/plain; charset=utf-8', 'page not found')
    return send(res, 200, 'text/plain; charset=utf-8', html)
  }

  if (req.method === 'GET' && path === '/api/export-file') {
    const cwd = resolveCwd(url.searchParams.get('ws'))
    if (!cwd) return send(res, 404, 'text/plain; charset=utf-8', 'unknown workspace')
    const name = url.searchParams.get('name') ?? ''
    // 只允许文件名（无路径分隔符、无 ..）
    if (!name || /[\\/]/.test(name) || name.includes('..')) {
      return send(res, 400, 'text/plain; charset=utf-8', 'bad name')
    }
    const file = join(exportsDir(cwd), name)
    // name='.' 能通过上面的过滤并指向 exports 目录本身。
    if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'text/plain; charset=utf-8', 'not found')
    const type = name.endsWith('.png') ? 'image/png' : 'application/zip'
    const data = readFileSync(file)
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' })
    res.end(data)
    return
  }

  if (req.method === 'POST') {
    if (String(req.headers[MUTATION_HEADER] ?? '') !== '1') {
      return send(res, 403, 'text/plain; charset=utf-8', 'missing header')
    }
    if (path === '/api/viewport') return handleViewport(req, res)
    if (path === '/api/selection') return handleSelection(req, res)
    if (path === '/api/page-html') return handlePageHtml(req, res)
    if (path === '/api/nodes') return handleNodes(req, res)
    if (path === '/api/edges') return handleEdges(req, res)
    if (path === '/api/export') return handleExport(req, res)
  }

  return send(res, 404, 'text/plain; charset=utf-8', 'not found')
}

function handleExport(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const kindRaw = String(body.kind ?? 'both')
    const kind: ExportKind = kindRaw === 'png' || kindRaw === 'zip' ? kindRaw : 'both'
    void runExport(cwd, kind)
      .then((result) => sendJson(res, { ok: true, ...result }))
      .catch((err) => send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: (err as Error).message })))
  })
}

// ---------------------------------------------------------------------------
// 变更路由（body 读取 + 分发）
// ---------------------------------------------------------------------------

function readJsonBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  onBody: (body: Record<string, unknown>) => void,
  maxBytes = MAX_BODY,
): void {
  let raw = ''
  let rejected = false
  req.setEncoding('utf8')
  req.on('error', () => {
    /* 客户端断开，或超限后 destroy */
  })
  req.on('data', (chunk: string) => {
    if (rejected) return
    raw += chunk
    if (raw.length > maxBytes) {
      rejected = true
      raw = ''
      // 带着未读数据断开时系统会发 RST，客户端读不到 413（Windows 上必现）。
      // 所以继续读取并丢弃剩余数据；对方迟迟发不完才断开，避免连接被无限占用。
      const drain = setTimeout(() => req.destroy(), BODY_DRAIN_MS)
      drain.unref()
      req.once('close', () => clearTimeout(drain))
      send(res, 413, 'application/json; charset=utf-8', JSON.stringify({ error: 'body too large' }))
    }
  })
  req.on('end', () => {
    if (rejected || res.writableEnded || res.headersSent) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw || '{}')
    } catch {
      return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'bad json' }))
    }
    // JSON 合法不代表是对象：字面量 null 会让后面的属性读取抛错。
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'bad json' }))
    }
    const body = parsed as Record<string, unknown>
    // 这里运行在 end 事件回调内，handleRequest 的 try/catch 接不住，所有变更路由在此统一兜底。
    try {
      const cwd = resolveCwd(typeof body.ws === 'string' ? body.ws : null)
      if (!cwd) return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'unknown workspace' }))
      onBody({ ...body, __cwd: cwd })
    } catch (err) {
      if (err instanceof InvalidInputError) {
        return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: err.message }))
      }
      console.error('[tianshu-canvas] 请求处理失败：', err)
      if (res.headersSent) res.destroy()
      else send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'internal error' }))
    }
  })
}

function handleSelection(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const pageId = typeof body.pageId === 'string' ? body.pageId : ''
    const kind = body.kind === 'page' ? 'page' : 'element'
    if (!pageId) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'missing pageId' }))
    assertSafeId(pageId)
    const raw = body.payload as Record<string, unknown> | undefined
    const selection: Selection = {
      pageId,
      kind,
      at: Date.now(),
      ...(kind === 'element' && raw
        ? {
            element: {
              xpath: String(raw.xpath ?? ''),
              tagName: String(raw.tagName ?? ''),
              textContent: typeof raw.textContent === 'string' ? raw.textContent : undefined,
              editableText: typeof raw.editableText === 'string' ? raw.editableText : null,
              computedStyles:
                raw.computedStyles && typeof raw.computedStyles === 'object'
                  ? (raw.computedStyles as Record<string, string>)
                  : undefined,
            },
          }
        : {}),
    }
    writeSelection(cwd, selection)
    return sendJson(res, { ok: true })
  })
}

function handlePageHtml(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const id = typeof body.id === 'string' ? body.id : ''
    const html = typeof body.html === 'string' ? body.html : ''
    if (!id || !html) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'missing id or html' }))
    if (html.length > 2 * 1024 * 1024) return send(res, 413, 'application/json; charset=utf-8', JSON.stringify({ error: 'html too large' }))
    writePageHtml(cwd, id, html)
    projectEvents.emit('change', { cwd })
    return sendJson(res, { ok: true })
  })
}

function handleNodes(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const op = String(body.op ?? '')
    const id = typeof body.id === 'string' ? body.id : ''
    if (op === 'remove') {
      if (!id) throw new InvalidInputError('missing id')
      removeNode(cwd, id)
      return sendJson(res, { ok: true, id })
    }
    if (op === 'rename') {
      if (!id || typeof body.title !== 'string') throw new InvalidInputError('missing id or title')
      renameNode(cwd, id, body.title)
      return sendJson(res, { ok: true, id, title: body.title })
    }
    if (op === 'move') {
      if (!id) throw new InvalidInputError('missing id')
      moveNode(cwd, id, Number(body.x) || 0, Number(body.y) || 0)
      return sendJson(res, { ok: true, id })
    }
    if (op === 'duplicate') {
      if (!id) throw new InvalidInputError('missing id')
      const node = duplicateNode(cwd, id, typeof body.title === 'string' ? body.title : undefined)
      return sendJson(res, { ok: true, node })
    }
    return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: `unknown op: ${op}` }))
  })
}

function handleEdges(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd)
    const op = String(body.op ?? '')
    const source = typeof body.source === 'string' ? body.source : ''
    const target = typeof body.target === 'string' ? body.target : ''
    if (!source || !target) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'missing source or target' }))
    if (op === 'add') {
      const edge = addEdge(cwd, source, target, typeof body.label === 'string' ? body.label : undefined)
      return sendJson(res, { ok: true, edge })
    }
    if (op === 'remove') {
      removeEdge(cwd, source, target)
      return sendJson(res, { ok: true })
    }
    return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: `unknown op: ${op}` }))
  })
}

function handleViewport(req: http.IncomingMessage, res: http.ServerResponse): void {
  readJsonBody(
    req,
    res,
    (body) => {
      const cwd = String(body.__cwd)
      const x = Number(body.x)
      const y = Number(body.y)
      const zoom = Number(body.zoom)
      setViewport(cwd, {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
      })
      return sendJson(res, { ok: true })
    },
    MAX_VIEWPORT_BODY,
  )
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

function handleSse(res: http.ServerResponse, token: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write('retry: 2000\n\n')
  const s = state
  if (!s) {
    res.end()
    return
  }
  const set = s.sse.get(token) ?? new Set<http.ServerResponse>()
  set.add(res)
  s.sse.set(token, set)
  const keepAlive = setInterval(() => {
    try {
      res.write(': ka\n\n')
    } catch {
      /* ignore */
    }
  }, 25000)
  keepAlive.unref()
  res.on('close', () => {
    clearInterval(keepAlive)
    set.delete(res)
  })
}

function broadcast(s: ServerState, token: string, event = 'project'): void {
  const set = s.sse.get(token)
  if (!set) return
  const frame = `event: ${event}\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`
  for (const res of set) {
    try {
      res.write(frame)
    } catch {
      /* client gone */
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function resolveCwd(token: string | null): string | null {
  if (!token || !state) return null
  return state.tokens.get(token) ?? null
}

function isLocalHost(host: string): boolean {
  const name = host.split(':')[0]?.toLowerCase()
  return name === '127.0.0.1' || name === 'localhost'
}

function serveStatic(res: http.ServerResponse, name: string, type = 'text/html; charset=utf-8'): void {
  const file = join(WEB_DIR, name)
  if (!existsSync(file)) return send(res, 404, 'text/plain; charset=utf-8', 'asset not built')
  const headers: Record<string, string> = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' }
  if (name === 'index.html') {
    headers['Content-Security-Policy'] =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'"
  }
  res.writeHead(200, headers)
  res.end(readFileSync(file))
}

function sendUntrustedHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; " +
      "script-src 'unsafe-inline' 'unsafe-eval'; font-src data:; connect-src 'none'; form-action 'none'",
  })
  res.end(html)
}

function sendJson(res: http.ServerResponse, body: unknown): void {
  send(res, 200, 'application/json; charset=utf-8', JSON.stringify(body))
}

function send(res: http.ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' })
  res.end(body)
}
