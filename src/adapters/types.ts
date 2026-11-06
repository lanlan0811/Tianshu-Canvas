/**
 * 真实代码库适配器接口。
 *
 * 每个适配器回答两件事：
 *  1. 把仓库里已有的主题「读成」token 契约（{@link importTokens}）；
 *  2. 把画布原型「翻成」该技术栈的页面代码（{@link mapHtml}）。
 *
 * 约束：实现必须确定性（同输入同输出、无时间戳）、零新增运行时依赖，
 * 且导入结果区分「从仓库观测到」与「按默认值推断」——不允许把默认值说成项目主题。
 */

import type { CodeFile } from '../codegen.js'
import type { HtmlNode } from '../htmlTree.js'

export type AdapterId = 'shadcn' | 'antd'

export interface Detection {
  id: AdapterId
  /** 命中的依据（供返回文案展示）。 */
  evidence: string[]
}

export interface ImportResult {
  /** 完整 token 契约（颜色已归一化为 #hex）。调用方仍会过 validateTokens。 */
  tokens: Record<string, unknown>
  iconStyle: { strokeWidth: number; linecap?: string; linejoin?: string }
  name: string
  tagline: string
  /** 从仓库读到的项（键路径 → 值）。 */
  observed: string[]
  /** 按规则推断/补默认值的项。 */
  inferred: string[]
  warnings: string[]
}

export interface AdapterContext {
  cwd: string
  /** 当前风格名（写进产物注释）。 */
  styleName: string
  /** 语义色：`color.bg.canvas` → 已解析值（含深色模式的同名键 `color.semanticDark.*` 时用 {@link darkSemantic}）。 */
  semantic: Record<string, string>
  darkSemantic: Record<string, string> | null
  /** tokens.css 里的原始 `--ts-*` 变量。 */
  vars: Record<string, string>
  /** 圆角（px）。 */
  radius: Record<string, number>
}

export interface Adapter {
  id: AdapterId
  /** 构建目录 dist/design/（由注册表注入），导入时需要读内置模板。 */
  builtinDir?: string
  /** 探测仓库是否是本技术栈；不是返回 null。 */
  detect(cwd: string): Detection | null
  /** 读取仓库主题并归一化为 token 契约。 */
  importTokens(cwd: string, sourcePath?: string): ImportResult
  /** 原型 HTML 树 → 该技术栈的代码文件。 */
  mapHtml(nodes: HtmlNode[], ctx: AdapterContext): CodeFile[]
}

/** 便捷：给子目录拼路径时保证分隔符一致。 */
export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/')
}
