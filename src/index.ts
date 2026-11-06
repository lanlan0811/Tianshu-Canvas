/**
 * TPI 入口。用 defineTianshuPlugin 描述插件并握手。
 *
 * 契约（见 .claude/reversed-src/tpi-loader/TPI-CONTRACT.md）：
 *  - defineTianshuPlugin 只接受 { id, activate }；其它键被丢弃。
 *  - activate(host) 返回 { tools, lifecycle?, dispose? }。
 *  - activate 返回的 tools 名称集合必须与 manifest.contributes.tools[].name 完全一致，
 *    否则 loader 报 rejected_handshake。
 *  - tool 对象字段：name / description / inputSchema / pathParams /
 *    requiresApproval / concurrencySafe / timeoutMs / execute(call)。
 *  - execute 收到 { args, cwd, sessionId }；返回值只取 content / isError。
 *
 * 注意：本地画布服务是模块级单例，dispose 时**不关闭**（浏览器标签可能仍开着）。
 */
import { defineTianshuPlugin } from './tpi.js'
import { tools as implTools } from './tools.js'

const PLUGIN_ID = 'tianshu-canvas'

export default defineTianshuPlugin({
  id: PLUGIN_ID,
  activate() {
    return {
      tools: implTools.map((tool) => ({
        name: tool.definition.name,
        description: tool.definition.description,
        inputSchema: tool.definition.input_schema,
        concurrencySafe: tool.isConcurrencySafe?.() === true,
        requiresApproval: tool.requiresApproval?.() === true,
        pathParams: tool.pathParams ?? {},
        execute: (call: { args: Record<string, unknown>; cwd: string; sessionId?: string }) =>
          tool.execute({ args: call.args, cwd: call.cwd, sessionId: call.sessionId ?? 'default' }),
      })),
    }
  },
})

// 供测试直接使用（loader 只读 .default，忽略这些命名导出）。
export { tools } from './tools.js'
export { resolveBrowser } from './export.js'
export { assertUrlAllowed, isBlockedIp, fetchUrl } from './netFetch.js'
export { inlineAssets, toDataUri } from './inlineAssets.js'
export { extractTokens } from './extract.js'
