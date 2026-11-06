/**
 * 适配器注册表：探测、导入、导出三条入口。
 * 新栈只需实现 {@link Adapter} 并在此登记。
 */

import { designDir } from '../design.js'
import type { ResolvedStyle } from '../design.js'
import { parseCssVars } from '../codegen/platforms.js'
import { parseHtml } from '../htmlTree.js'
import { antdAdapter } from './antd.js'
import { shadcnAdapter } from './tailwind-shadcn.js'
import type { Adapter, AdapterContext, AdapterId, Detection } from './types.js'

const ADAPTERS: Record<AdapterId, Adapter> = {
  shadcn: shadcnAdapter,
  antd: antdAdapter,
}

/** 给适配器注入构建目录（dist/design/），供模板读取。 */
export function getAdapter(id: string): Adapter | null {
  if (!(id in ADAPTERS)) return null
  const adapter = ADAPTERS[id as AdapterId]
  adapter.builtinDir = designDir()
  return adapter
}

/** 探测工作区适合哪些技术栈（按证据数量降序）。 */
export function detectAdapters(cwd: string): Detection[] {
  const out: Detection[] = []
  for (const adapter of Object.values(ADAPTERS)) {
    try {
      const hit = adapter.detect(cwd)
      if (hit) out.push(hit)
    } catch {
      /* 探测失败视为不匹配 */
    }
  }
  return out.sort((a, b) => b.evidence.length - a.evidence.length)
}

/** 从运行时风格构造适配器上下文。 */
export function adapterContext(cwd: string, style: ResolvedStyle): AdapterContext {
  const semantic: Record<string, string> = {}
  for (const [path, entry] of Object.entries(style.manifest.resolvedSemantic)) {
    semantic[path] = entry.value
  }
  const vars = parseCssVars(style.tokensCss)
  // 深色：tokens.css 的 .dark 块里同名变量的覆盖值。
  const darkBlock = /\.dark\s*\{([\s\S]*?)\}/.exec(style.tokensCss)
  const darkVars = darkBlock ? parseCssVars(darkBlock[1]!) : {}
  const darkSemantic: Record<string, string> = {}
  let hasDark = false
  for (const [path, entry] of Object.entries(style.manifest.resolvedSemantic)) {
    const varName = `--ts-${path.replace(/^color\./, '').replace(/\./g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`
    if (darkVars[varName] !== undefined) {
      darkSemantic[path] = darkVars[varName]!
      hasDark = true
    } else if (entry.value) {
      darkSemantic[path] = entry.value
    }
  }
  const radius: Record<string, number> = {}
  for (const [name, value] of Object.entries(vars)) {
    const m = /^--ts-radius-(.+)$/.exec(name)
    if (m) radius[m[1]!] = parseFloat(value)
  }
  return { cwd, styleName: style.summary.name, semantic, darkSemantic: hasDark ? darkSemantic : null, vars, radius }
}

/** 原型 HTML → 适配器产物。 */
export function generateWithAdapter(id: AdapterId, html: string, ctx: AdapterContext) {
  const adapter = getAdapter(id)
  if (!adapter) throw new Error(`未知的适配器：${id}。可选：${Object.keys(ADAPTERS).join(' / ')}。`)
  return adapter.mapHtml(parseHtml(html), ctx)
}
