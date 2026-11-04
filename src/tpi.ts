/**
 * TPI SDK 入口（随插件分发）。只在天枢宿主内可用：宿主加载插件前安装全局 SDK，
 * 宿主之外 import 本插件会直接抛错——TPI 插件不能脱离天枢运行。
 *
 * 逐字照抄自 .claude/reversed-src/plugin-template/tpi.js，不要修改。
 * 宿主在 import 入口前会调用 installTpiGlobalSdk()，
 * 把 { version, defineTianshuPlugin } 冻结安装到 globalThis.__tianshuTPI。
 */

export interface TpiBrand {
  tpi: string
}

export interface TpiDefinition {
  id: string
  activate: (host: unknown) => unknown
  [brand: symbol]: TpiBrand
}

export interface TpiSdk {
  version: string
  defineTianshuPlugin: (spec: { id: string; activate: (host: unknown) => unknown }) => TpiDefinition
}

declare global {
  // eslint-disable-next-line no-var
  var __tianshuTPI: TpiSdk | undefined
}

export function defineTianshuPlugin(spec: { id: string; activate: (host: unknown) => unknown }): TpiDefinition {
  const sdk = globalThis.__tianshuTPI
  if (!sdk) throw new Error('not running inside Tianshu: TPI plugins load only through the Tianshu host')
  return sdk.defineTianshuPlugin(spec)
}
