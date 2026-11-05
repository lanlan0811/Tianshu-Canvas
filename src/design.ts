/**
 * 设计系统运行时：加载构建产物 dist/design/，提供注入、剥离、模板读取。
 *
 * 关键约束：
 *  - 原型 iframe 的 CSP 是 default-src 'none'，不能外链任何资源，所以 token/组件样式
 *    只能内联成 <style>；图标在写入时展开成内联 <svg>。
 *  - 注入必须幂等：先剥离旧块再插入新块，同一页面无论写多少次都只有一块。
 *  - 本模块在加载期不做任何 IO，避免拖垮宿主；产物缺失时在调用点抛出可读错误。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterDoctype } from './html.js'

/** dist/index.js 与 dist/design/ 同级。 */
const DESIGN_DIR = fileURLToPath(new URL('./design/', import.meta.url))

const BLOCK_START = '<!--tianshu-ds:start'
const BLOCK_END = '<!--tianshu-ds:end-->'
// 只连带插入时加上的两个换行，保证剥离后能还原原始字节。
const START_RE = /\n?<!--tianshu-ds:start[^>]*-->[\s\S]*?<!--tianshu-ds:end-->\n?/g

export interface DesignTemplateSummary {
  id: string
  name: string
  device: string
}

export interface DesignStyleSummary {
  id: string
  name: string
  tagline: string
  description: string
  tags: string[]
  swatches: string[]
  fonts: Record<string, string>
  iconStyle: { strokeWidth: number; linecap?: string; linejoin?: string }
  counts: { icons: number; components: number; templates: number }
  templates: DesignTemplateSummary[]
}

export interface DesignCatalog {
  schemaVersion: 1
  notice: string
  styles: DesignStyleSummary[]
}

export interface SemanticEntry {
  value: string
  primitive: string | null
}

export interface DesignManifest {
  schema: string
  id: string
  version: number
  vars: string[]
  spacing: number[]
  radius: number[]
  fontFamilies: string[]
  iconNames: string[]
  componentClasses: string[]
  resolvedSemantic: Record<string, SemanticEntry>
}

export interface DesignIconSet {
  viewBox: string
  stroke: { strokeWidth: number; linecap?: string; linejoin?: string }
  icons: Record<string, string>
}

export interface DesignTemplate {
  name: string
  description: string
  device: string
  components: string[]
  icons: string[]
  html: string
}

export interface ResolvedStyle {
  summary: DesignStyleSummary
  tokensCss: string
  componentsCss: string
  manifest: DesignManifest
  icons: DesignIconSet
  templates: Record<string, DesignTemplate>
}

export interface InjectResult {
  html: string
  styleId: string | null
  injected: boolean
  usedIcons: string[]
  missingIcons: string[]
  /** 写在脚本里、因此没有展开的图标名。 */
  scriptIcons: string[]
}

let catalogCache: DesignCatalog | null = null
let catalogFailed: string | null = null
const styleCache = new Map<string, ResolvedStyle>()
const styleFailed = new Map<string, string>()

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

export function designDir(): string {
  return DESIGN_DIR
}

/** 读取风格清单；产物缺失时抛错（调用方决定如何提示）。 */
export function loadDesignCatalog(): DesignCatalog {
  if (catalogCache) return catalogCache
  if (catalogFailed) throw new Error(catalogFailed)
  const file = join(DESIGN_DIR, 'index.json')
  if (!existsSync(file)) {
    catalogFailed = '设计系统构建产物缺失（dist/design/index.json），请先运行 npm run build。'
    throw new Error(catalogFailed)
  }
  catalogCache = readJson<DesignCatalog>(file)
  return catalogCache
}

/** 用于生成工具参数 enum：读不到产物时返回空数组，绝不抛错。 */
export function designStyleIds(): string[] {
  try {
    return loadDesignCatalog().styles.map((s) => s.id)
  } catch {
    return []
  }
}

export function designStyleExists(id: unknown): id is string {
  return typeof id === 'string' && designStyleIds().includes(id)
}

export function designStyleSummary(id: string): DesignStyleSummary | null {
  try {
    return loadDesignCatalog().styles.find((s) => s.id === id) ?? null
  } catch {
    return null
  }
}

export function resolveDesignStyle(id: string): ResolvedStyle | null {
  if (!designStyleExists(id)) return null
  const cached = styleCache.get(id)
  if (cached) return cached
  const failed = styleFailed.get(id)
  if (failed) throw new Error(failed)
  const dir = join(DESIGN_DIR, 'styles', id)
  try {
    const resolved: ResolvedStyle = {
      summary: designStyleSummary(id)!,
      tokensCss: readFileSync(join(dir, 'tokens.css'), 'utf8'),
      componentsCss: readFileSync(join(dir, 'components.css'), 'utf8'),
      manifest: readJson<DesignManifest>(join(dir, 'tokens.manifest.json')),
      icons: readJson<DesignIconSet>(join(dir, 'icons.json')),
      templates: readJson<Record<string, DesignTemplate>>(join(dir, 'templates.json')),
    }
    styleCache.set(id, resolved)
    return resolved
  } catch (err) {
    const message = `设计风格「${id}」的构建产物不完整：${(err as Error).message}`
    styleFailed.set(id, message)
    throw new Error(message)
  }
}

/** 只用于测试：清空缓存。 */
export function resetDesignCache(): void {
  catalogCache = null
  catalogFailed = null
  styleCache.clear()
  styleFailed.clear()
}

export function getDesignTemplate(styleId: string, templateId: string): { summary: DesignStyleSummary; meta: DesignTemplate } | null {
  const style = resolveDesignStyle(styleId)
  if (!style) return null
  const meta = style.templates[templateId]
  if (!meta) return null
  return { summary: style.summary, meta }
}

/** 读取页面里已经注入的风格标记。 */
export function readDesignMarker(html: string): { styleId: string; version: string } | null {
  const match = /<!--tianshu-ds:start\s+style=([A-Za-z0-9._-]+)\s+version=([^>\s]+)\s*-->/.exec(html)
  if (!match) return null
  return { styleId: match[1]!, version: match[2]! }
}

/** 删除所有已注入块，用于重写与幂等注入。 */
export function stripDesign(html: string): string {
  return html.replace(START_RE, '')
}

/** 把脚本与注释替换成等长空白，保证下标与原文一一对应。 */
function maskSegments(html: string): string {
  const mask = (text: string): string => text.replace(/[^\n]/g, ' ')
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, mask)
    .replace(/<!--[\s\S]*?-->/g, mask)
}

function findInsertOffset(html: string): number {
  const masked = maskSegments(html)
  const head = /<head\b[^>]*>/i.exec(masked)
  if (head) return head.index + head[0].length
  const htmlTag = /<html\b[^>]*>/i.exec(masked)
  if (htmlTag) return htmlTag.index + htmlTag[0].length
  return afterDoctype(html)
}

function escapeStyleText(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style')
}

/**
 * 图标的描边外观归当前风格所有。再次注入时必须先移除旧值：
 * HTML 解析器遇到重复属性只认第一个，直接追加会让切换后的风格不生效。
 */
const STYLE_OWNED_ICON_ATTRS = /\s(?:fill|stroke|stroke-width|stroke-linecap|stroke-linejoin)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi

/** 生成标准 SVG 属性串：保留调用方已有属性（含 data-icon），补齐当前风格所需。 */
function buildIconSvg(attrs: string, body: string, set: DesignIconSet, viewBox: string): string {
  const kept = attrs
    .replace(STYLE_OWNED_ICON_ATTRS, '')
    .replace(/\s*\/\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const hasViewBox = /\bviewBox\s*=/.test(kept)
  const stroke = `fill="none" stroke="currentColor" stroke-width="${set.stroke.strokeWidth}"` +
    (set.stroke.linecap ? ` stroke-linecap="${set.stroke.linecap}"` : '') +
    (set.stroke.linejoin ? ` stroke-linejoin="${set.stroke.linejoin}"` : '')
  const parts = [kept, hasViewBox ? '' : `viewBox="${viewBox}"`, stroke].filter(Boolean)
  return `<svg ${parts.join(' ')}>${body}</svg>`
}

/**
 * 依次匹配脚本、样式、注释和 svg 元素。前三者整段跳过：
 * 其中的 data-icon 只是文本，展开时插入的引号可能截断 JS 字符串，让整段脚本失效。
 */
const ICON_SCAN =
  /<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->|<svg\b([^>]*?)(?:\/>|>[\s\S]*?<\/svg\s*>)/gi
const ICON_ATTR = /\bdata-icon\s*=\s*(?:"([^"]*)"|'([^']*)')/i
const SCRIPT_ICON = /\bdata-icon\s*=\s*\\?["']([^"'\\]*)/gi

/** 展开页面里的 <svg data-icon="x"></svg>（含自闭合写法）。data-icon 原样保留，便于再次注入与 lint。 */
function expandIcons(
  html: string,
  set: DesignIconSet,
): { html: string; usedIcons: string[]; missingIcons: string[]; scriptIcons: string[] } {
  const used = new Set<string>()
  const missing = new Set<string>()
  const inScripts = new Set<string>()
  const viewBox = set.viewBox || '0 0 24 24'
  const expanded = html.replace(ICON_SCAN, (whole, attrs: string | undefined) => {
    if (attrs === undefined) {
      if (/^<script/i.test(whole)) {
        for (const match of whole.matchAll(SCRIPT_ICON)) if (match[1]) inScripts.add(match[1])
      }
      return whole
    }
    const iconMatch = ICON_ATTR.exec(attrs)
    if (!iconMatch) return whole
    const name = (iconMatch[1] ?? iconMatch[2] ?? '').trim()
    const body = set.icons[name]
    if (!body) {
      missing.add(name)
      return whole
    }
    used.add(name)
    return buildIconSvg(attrs, body, set, viewBox)
  })
  return { html: expanded, usedIcons: [...used], missingIcons: [...missing], scriptIcons: [...inScripts] }
}

/**
 * 注入（或移除）设计系统样式块。
 * styleId 为 null 表示自由发挥：只剥离旧块，不注入。
 */
export function injectDesign(html: string, styleId: string | null): InjectResult {
  const stripped = stripDesign(html)
  if (styleId === null) {
    return { html: stripped, styleId: null, injected: false, usedIcons: [], missingIcons: [], scriptIcons: [] }
  }
  const style = resolveDesignStyle(styleId)
  if (!style) {
    return { html: stripped, styleId: null, injected: false, usedIcons: [], missingIcons: [], scriptIcons: [] }
  }

  const icons = expandIcons(stripped, style.icons)
  const block =
    `${BLOCK_START} style=${style.summary.id} version=${style.manifest.version}-->\n` +
    `<style id="tianshu-tokens" data-tianshu-ds="tokens" data-style="${style.summary.id}" data-version="${style.manifest.version}">${escapeStyleText(style.tokensCss)}</style>\n` +
    `<style id="tianshu-components" data-tianshu-ds="components">${escapeStyleText(style.componentsCss)}</style>\n` +
    `${BLOCK_END}\n`

  const offset = findInsertOffset(icons.html)
  const result = icons.html.slice(0, offset) + '\n' + block + icons.html.slice(offset)
  return {
    html: result,
    styleId: style.summary.id,
    injected: true,
    usedIcons: icons.usedIcons,
    missingIcons: icons.missingIcons,
    scriptIcons: icons.scriptIcons,
  }
}

/** 判断页面当前注入的是哪个风格（无标记返回 null）。 */
export function pageStyleId(html: string): string | null {
  return readDesignMarker(html)?.styleId ?? null
}
