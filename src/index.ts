/**
 * TPI 入口。用 defineTianshuPlugin 描述插件并握手。
 *
 * 契约（见 .claude/reversed-src/tpi-loader/TPI-CONTRACT.md）：
 *  - defineTianshuPlugin 只接受 { id, activate }；其它键被丢弃。
 *  - activate(host) 返回 { tools, lifecycle?, dispose? }。
 *  - activate 返回的 tools 名称集合必须与 manifest.contributes.tools[].name 完全一致，
 *    否则 loader 报 rejected_handshake；描述也必须与清单逐字一致（官方套件按
 *    { name, description } 深比较）。工具描述上限 200 字，细节写进 inputSchema。
 *  - tool 对象字段：name / description / inputSchema / pathParams /
 *    requiresApproval / concurrencySafe / timeoutMs / execute(call)。
 *  - execute 收到 { args, cwd, sessionId }；返回值只取 content / isError。
 *  - host 提供 log / isWorker；日志走 host.log，worker 会话不写用户数据。
 *
 * 多个激活实例共享服务；最后一个实例 dispose 时关闭服务并撤销工作区访问。
 */
import { defineTianshuPlugin } from './tpi.js'
import { setHostServices } from './host.js'
import { tools as implTools } from './tools.js'
import { shutdownForTests } from './server.js'

const PLUGIN_ID = 'tianshu-canvas'
let activeInstances = 0

interface HostLike {
  log?: { debug(message: string): void; warn(message: string): void }
  isWorker?: boolean
}

export default defineTianshuPlugin({
  id: PLUGIN_ID,
  activate(host: unknown) {
    activeInstances++
    let disposed = false
    const h = (host ?? {}) as HostLike
    setHostServices({
      log: h.log ?? { debug() {}, warn: (message) => console.error(message) },
      isWorker: h.isWorker === true,
    })
    return {
      async dispose() {
        if (disposed) return
        disposed = true
        if (--activeInstances === 0) await shutdownForTests()
      },
      tools: implTools.map((tool) => ({
        name: tool.definition.name,
        description: tool.definition.description,
        inputSchema: tool.definition.input_schema,
        concurrencySafe: tool.isConcurrencySafe?.() === true,
        requiresApproval: tool.requiresApproval?.() === true,
        pathParams: tool.pathParams ?? {},
        ...(tool.timeoutMs !== undefined ? { timeoutMs: tool.timeoutMs } : {}),
        execute: (call: { args: Record<string, unknown>; cwd: string; sessionId?: string }) =>
          tool.execute({ args: call.args, cwd: call.cwd, sessionId: call.sessionId ?? 'default' }),
      })),
    }
  },
})

// 供测试直接使用（loader 只读 .default，忽略这些命名导出）。
export { tools } from './tools.js'
export { titleSlug, parseNavRef, resolveNavRef, rewriteNavLinks, mayHaveNavLinks } from './nav.js'
export { resolveBrowser } from './export.js'
export { assertUrlAllowed, isBlockedIp, fetchUrl } from './netFetch.js'
export { inlineAssets, toDataUri } from './inlineAssets.js'
export { extractTokens } from './extract.js'
