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
import {
  compileCustomStyle,
  customStyleExists,
  loadCustomSummaries,
  resetSharedContractCache,
  stampLibrary,
} from './designCustom.js'

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

/**
 * 缓存策略：
 *  - 内置风格只读 dist，进程内不会变 → 全局缓存一次。
 *  - 自定义风格是工作区可写的，必须能热更新 → 按 cwd 缓存 catalog 摘要并带内容指纹；
 *    指纹变化即重算。**不保留「永久失败位」**：一次读取失败下次会重试，
 *    否则用户新写的风格一旦读失败就永久不可用。
 */
let builtinCatalogCache: DesignCatalog | null = null
const customCatalogCache = new Map<string, { stamp: string; styles: DesignStyleSummary[] }>()
const styleCache = new Map<string, ResolvedStyle>()

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

export function designDir(): string {
  return DESIGN_DIR
}

/** 只读内置清单；产物缺失时抛错（调用方决定如何提示）。 */
function loadBuiltinCatalog(): DesignCatalog {
  if (builtinCatalogCache) return builtinCatalogCache
  const file = join(DESIGN_DIR, 'index.json')
  if (!existsSync(file)) {
    throw new Error('设计系统构建产物缺失（dist/design/index.json），请先运行 npm run build。')
  }
  builtinCatalogCache = readJson<DesignCatalog>(file)
  return builtinCatalogCache
}

function customStylesFor(cwd: string | undefined): DesignStyleSummary[] {
  if (!cwd) return []
  const stamp = stampLibrary(cwd)
  const cached = customCatalogCache.get(cwd)
  if (cached && cached.stamp === stamp) return cached.styles
  let styles: DesignStyleSummary[] = []
  try {
    styles = loadCustomSummaries(cwd, DESIGN_DIR)
  } catch {
    styles = []
  }
  customCatalogCache.set(cwd, { stamp, styles })
  return styles
}

/** 设计系统变更后主动失效该工作区的缓存（创建/删除自定义风格时调用）。 */
export function invalidateDesignCache(cwd: string): void {
  customCatalogCache.delete(cwd)
  const prefix = `${cwd}\u0000`
  for (const key of [...styleCache.keys()]) if (key.startsWith(prefix)) styleCache.delete(key)
}

/**
 * 读取风格清单：内置 + 当前工作区的自定义风格。
 * 不传 cwd 时只返回内置（web 端与旧调用兼容）。
 */
export function loadDesignCatalog(cwd?: string): DesignCatalog {
  const builtin = loadBuiltinCatalog()
  const custom = customStylesFor(cwd)
  if (custom.length === 0) return builtin
  return { schemaVersion: builtin.schemaVersion, notice: builtin.notice, styles: [...builtin.styles, ...custom] }
}

/** 用于生成工具参数 enum：读不到产物时返回空数组，绝不抛错。 */
export function designStyleIds(cwd?: string): string[] {
  try {
    return loadDesignCatalog(cwd).styles.map((s) => s.id)
  } catch {
    return []
  }
}

export function designStyleExists(cwd: string | undefined, id: unknown): id is string {
  return typeof id === 'string' && designStyleIds(cwd).includes(id)
}

export function designStyleSummary(cwd: string | undefined, id: string): DesignStyleSummary | null {
  try {
    return loadDesignCatalog(cwd).styles.find((s) => s.id === id) ?? null
  } catch {
    return null
  }
}

/** 是否内置风格（用于区分来源与禁止覆盖）。 */
export function isBuiltinStyle(id: unknown): id is string {
  return typeof id === 'string' && designStyleIds().includes(id)
}

export function resolveDesignStyle(cwd: string | undefined, id: string): ResolvedStyle | null {
  if (!designStyleExists(cwd, id)) return null
  const key = `${cwd ?? '\u0000builtin'}\u0000${id}`
  const cached = styleCache.get(key)
  if (cached) return cached

  const summary = designStyleSummary(cwd, id)
  if (!summary) return null

  let resolved: ResolvedStyle
  if (cwd && customStyleExists(cwd, id)) {
    // 自定义风格：运行时从 tokens.json + meta.json 编译（失败不写永久失败位）。
    resolved = compileCustomStyle(cwd, id, DESIGN_DIR)
  } else {
    const dir = join(DESIGN_DIR, 'styles', id)
    try {
      resolved = {
        summary,
        tokensCss: readFileSync(join(dir, 'tokens.css'), 'utf8'),
        componentsCss: readFileSync(join(dir, 'components.css'), 'utf8'),
        manifest: readJson<DesignManifest>(join(dir, 'tokens.manifest.json')),
        icons: readJson<DesignIconSet>(join(dir, 'icons.json')),
        templates: readJson<Record<string, DesignTemplate>>(join(dir, 'templates.json')),
      }
    } catch (err) {
      throw new Error(`设计风格「${id}」的构建产物不完整：${(err as Error).message}`)
    }
  }
  styleCache.set(key, resolved)
  return resolved
}

/** 只用于测试：清空缓存。 */
export function resetDesignCache(): void {
  builtinCatalogCache = null
  customCatalogCache.clear()
  styleCache.clear()
  resetSharedContractCache()
}

export function getDesignTemplate(cwd: string | undefined, styleId: string, templateId: string): { summary: DesignStyleSummary; meta: DesignTemplate } | null {
  const style = resolveDesignStyle(cwd, styleId)
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
export function injectDesign(html: string, styleId: string | null, cwd?: string): InjectResult {
  const stripped = stripDesign(html)
  if (styleId === null) {
    return { html: stripped, styleId: null, injected: false, usedIcons: [], missingIcons: [], scriptIcons: [] }
  }
  const style = resolveDesignStyle(cwd, styleId)
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
