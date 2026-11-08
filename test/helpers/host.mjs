/**
 * 复刻天枢 loader 语义的最小宿主，用于端到端验证插件。
 * 复刻点（取自 .claude/reversed-src/tpi-loader/*.reconstructed.js）：
 *   - installTpiGlobalSdk / defineTianshuPlugin 的品牌与冻结
 *   - wrapTpiTool 的 call.input→args、pathParams 改写、返回值只取 content/isError
 */
import { isAbsolute, relative, resolve } from 'node:path'

export const TPI_BRAND = Symbol.for('tianshu.tpi.plugin/v1')
// 旧接口测试用模拟客户端显式持有工具返回的凭证；安全专项可用 rawFetch 测试无凭证请求。
const credentials = new Map()
export const rawFetch = globalThis.fetch.bind(globalThis)
export function testCredential(ws) { return credentials.get(ws) }
let fetchInstalled = false
function installTestClient() {
  if (fetchInstalled) return
  fetchInstalled = true
  globalThis.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    let ws = url.searchParams.get('ws')
    if (!ws && typeof init.body === 'string') {
      try { ws = JSON.parse(init.body)?.ws } catch {}
    }
    const secret = credentials.get(ws)
    if (secret && url.hostname === '127.0.0.1') {
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${secret}`)
      return rawFetch(input, { ...init, headers })
    }
    return rawFetch(input, init)
  }
}

export function installFakeSdk() {
  function defineTianshuPlugin(spec) {
    if (!spec || typeof spec !== 'object') throw new TypeError('defineTianshuPlugin: spec must be an object')
    if (typeof spec.id !== 'string' || spec.id.length === 0) throw new TypeError('defineTianshuPlugin: id is required')
    if (typeof spec.activate !== 'function') throw new TypeError('defineTianshuPlugin: activate(host) is required')
    return Object.freeze({ id: spec.id, activate: spec.activate, [TPI_BRAND]: Object.freeze({ tpi: '1.0' }) })
  }
  globalThis.__tianshuTPI = Object.freeze({ version: '1.0', defineTianshuPlugin })
  return TPI_BRAND
}

// 简化版路径守卫：仅根限定 + 存在性（不含敏感文件黑名单/软硬链接检查）。
export function validatePathSafe(root, candidate) {
  const realRoot = resolve(root)
  const target = resolve(realRoot, candidate)
  const rel = relative(realRoot, target)
  if (rel.startsWith('..') || isAbsolute(rel)) return { ok: false, error: 'Path outside project directory: ' + candidate }
  return { ok: true, path: target }
}

export function wrapTool(pluginId, tool, defaultSessionId = 'sess-1') {
  const pathParams = Object.entries(tool.pathParams ?? {})
  return {
    name: tool.name,
    definition: { name: tool.name, description: tool.description, input_schema: tool.inputSchema },
    async execute(call) {
      const args = call?.input && typeof call.input === 'object' ? { ...call.input } : {}
      for (const [param, mode] of pathParams) {
        const value = args[param]
        if (typeof value !== 'string' || value.length === 0) continue
        const g = validatePathSafe(call.cwd, value, mode)
        if (!g.ok) return { content: 'Path rejected: ' + g.error, isError: true }
        args[param] = g.path
      }
      try {
        const result = await tool.execute({ args, cwd: call.cwd, sessionId: call.sessionId ?? defaultSessionId })
        const content = String(result?.content ?? '')
        for (const match of content.matchAll(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=([0-9a-f]{32})#([0-9a-f]{64})/g)) credentials.set(match[1], match[2])
        return { content, ...(result?.isError ? { isError: true } : {}) }
      } catch (err) {
        return {
          content: '[' + pluginId + '] ' + tool.name + ' failed: ' + (err?.message ?? String(err)),
          isError: true,
        }
      }
    },
  }
}

/** 用假宿主加载构建产物，返回 { def, api, tools }。 */
export async function loadPlugin(entryUrl) {
  installTestClient()
  const brand = installFakeSdk()
  const mod = await import(entryUrl)
  const def = mod.default
  if (!def || !def[brand]) throw new Error('入口未通过 TPI 品牌校验')
  const api = await def.activate({ log: { debug() {}, warn() {} } })
  const tools = Object.fromEntries((api.tools ?? []).map((t) => [t.name, wrapTool(def.id, t)]))
  return { def, api, tools }
}
