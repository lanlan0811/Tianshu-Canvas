/**
 * 页面间跳转：把原型里的手写链接解析成目标页面 id，并在写入时统一改写为
 * `<id>.html`（写入时规范化），使画布点击跳转与导出多页站共用同一份确定性解析。
 *
 * 三种写法：
 *   ① 真实 id：`<a href="page-3f2a91c4.html">`（最稳）
 *   ② 标题 slug：`<a href="详情.html">`（按页面 title 的 slug 匹配；重名会歧义）
 *   ③ 显式声明：`<a data-nav="page-3f2a91c4">`（无 href 亦可）
 *
 * 纯函数、无 IO、无模块级状态；引用的页面集合由调用方传入。
 */

export interface PageRef {
  id: string
  title: string
}

export interface NavRef {
  dataNav: string | null
  href: string | null
}

export interface NavResolution {
  target: string | null
  /** 命中多个页面（slug 歧义）时列出候选 id。 */
  ambiguous: string[]
}

/** A single lookup is reused by every link in a write/backfill/export batch. */
export interface NavIndex {
  ids: ReadonlySet<string>
  slugs: ReadonlyMap<string, readonly string[]>
}

export function createNavIndex(pages: readonly PageRef[]): NavIndex {
  const ids = new Set<string>()
  const slugs = new Map<string, string[]>()
  for (const page of pages) {
    ids.add(page.id)
    const slug = titleSlug(page.title)
    if (!slug) continue
    const matches = slugs.get(slug) ?? []
    matches.push(page.id)
    slugs.set(slug, matches)
  }
  return { ids, slugs }
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** 标题 → slug（确定性；返回 '' 表示无可用 slug 别名）。 */
export function titleSlug(title: string): string {
  return String(title ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|#?&=%+]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
}

/**
 * 从 <a> 的 href / data-nav 提取导航引用。
 * 返回 null 表示「非页面内导航」，调用方必须原样放过：
 *   - 空 / 仅空白；带 scheme（http(s):、mailto:、tel:、javascript:、data:…）；
 *   - 协议相对 `//`；纯 `#` 锚点。
 */
export function parseNavRef(href: string | null, dataNav: string | null): NavRef | null {
  const nav = (dataNav ?? '').trim()
  const raw = (href ?? '').trim()
  if (!nav && !raw) return null
  if (nav) return { dataNav: nav, href: raw || null }
  if (raw.startsWith('#')) return null
  if (raw.startsWith('//')) return null
  if (SCHEME_RE.test(raw)) return null
  return { dataNav: null, href: raw }
}

/** 把 href 归一成可比对的名字：取 basename、去 query/hash、去 .html 后缀、NFC + 小写。 */
function hrefKey(href: string): string {
  let s = href.split(/[?#]/)[0] ?? ''
  s = s.split('/').pop() ?? s
  s = s.replace(/\.html?$/i, '')
  try {
    s = decodeURIComponent(s)
  } catch {
    /* 非法百分号编码时保持原样 */
  }
  return s.normalize('NFC').toLowerCase()
}

/**
 * 解析导航引用到目标页面 id。
 * 优先级：data-nav（精确 id）> href 精确 id > href 标题 slug。
 * 歧义（slug 命中 ≥2）时 target=null 并返回候选。
 */
export function resolveNavRef(ref: NavRef, pages: readonly PageRef[] | NavIndex): NavResolution {
  const index = Array.isArray(pages) ? createNavIndex(pages) : pages as NavIndex
  if (ref.dataNav) {
    return { target: index.ids.has(ref.dataNav) ? ref.dataNav : null, ambiguous: [] }
  }
  if (!ref.href) return { target: null, ambiguous: [] }
  const key = hrefKey(ref.href)
  if (!key) return { target: null, ambiguous: [] }
  // 精确 id（id 本身即小写安全字符，直接比对）。
  if (index.ids.has(key)) return { target: key, ambiguous: [] }
  const slugMatches = index.slugs.get(key) ?? []
  if (slugMatches.length === 1) return { target: slugMatches[0]!, ambiguous: [] }
  if (slugMatches.length > 1) return { target: null, ambiguous: [...slugMatches] }
  return { target: null, ambiguous: [] }
}

export interface NavRewriteResult {
  html: string
  /** 实际改写的 <a> 数量。 */
  rewritten: number
  /** 未解析的引用原文（不报错，仅提示）。 */
  unresolved: string[]
  /** 命中的歧义引用。 */
  ambiguous: { ref: string; ids: string[] }[]
}

const ANCHOR_RE = /<a\b([^>]*)>/gi
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

export interface ParsedNavAnchor {
  start: number
  end: number
  text: string
  href: string | null
  ref: NavRef
}

/** Parsed offsets remain valid until the HTML bytes change. */
export interface ParsedNavDocument {
  html: string
  anchors: readonly ParsedNavAnchor[]
}

/** Distinct namespaces stop an explicit ID from being rebound to a title slug. */
export function navReferenceKeys(ref: NavRef): string[] {
  if (ref.dataNav) return [`id:${ref.dataNav}`]
  const key = ref.href ? hrefKey(ref.href) : ''
  return key ? [`id:${key}`, `slug:${key}`] : []
}

function maskSegments(html: string): string {
  const mask = (text: string): string => text.replace(/[^\n]/g, ' ')
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, mask)
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, mask)
    .replace(/<!--[\s\S]*?-->/g, mask)
}

function readAttr(attrs: string, name: string): string | null {
  for (const m of attrs.matchAll(ATTR_RE)) {
    if (m[1]!.toLowerCase() === name) return (m[2] ?? m[3] ?? '').trim()
  }
  return null
}

/**
 * 扫描 HTML 中 <a>（跳过 script/style/注释），把可解析引用改写为 `<id>.html`。
 * hrefPrefix='' 用于 pages/*.html；'pages/' 用于根 index.html。
 * data-nav 存在时保留其属性，并补/正 href。
 */
export function parseNavDocument(html: string): ParsedNavDocument {
  const anchors: ParsedNavAnchor[] = []
  for (const m of maskSegments(html).matchAll(ANCHOR_RE)) {
    const attrs = m[1] ?? ''
    const href = readAttr(attrs, 'href')
    const ref = parseNavRef(href, readAttr(attrs, 'data-nav'))
    if (!ref) continue
    const start = m.index ?? 0
    anchors.push({ start, end: start + m[0]!.length, text: m[0]!, href, ref })
  }
  return { html, anchors }
}

export function rewriteParsedNavLinks(document: ParsedNavDocument, index: NavIndex, hrefPrefix: string): NavRewriteResult {
  const { html } = document
  const unresolved: string[] = []
  const ambiguous: { ref: string; ids: string[] }[] = []
  let rewritten = 0

  // 掩码保证下标与原文一致：只在掩码里定位 <a>，再到原文里替换。
  const edits: { start: number; end: number; text: string }[] = []

  for (const anchor of document.anchors) {
    const { start, end, href, ref } = anchor
    const res = resolveNavRef(ref, index)
    if (res.ambiguous.length) {
      ambiguous.push({ ref: ref.dataNav ?? ref.href ?? '', ids: res.ambiguous })
      continue
    }
    if (!res.target) {
      unresolved.push(ref.dataNav ?? ref.href ?? '')
      continue
    }
    const wanted = `${hrefPrefix}${res.target}.html`
    let next: string
    if (href !== null) {
      if (href === wanted) continue // 已是目标形式
      next = anchor.text.replace(/(\bhref\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${wanted}"`)
    } else {
      // 仅 data-nav：补一个 href。
      next = anchor.text.replace(/\s*(\/?>)$/, ` href="${wanted}"$1`)
    }
    edits.push({ start, end, text: next })
    rewritten++
  }

  if (!edits.length) return { html, rewritten: 0, unresolved, ambiguous }
  let out = ''
  let cursor = 0
  for (const edit of edits) {
    out += html.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  out += html.slice(cursor)
  return { html: out, rewritten, unresolved, ambiguous }
}

export function rewriteNavLinks(html: string, pages: readonly PageRef[] | NavIndex, hrefPrefix: string): NavRewriteResult {
  const index = Array.isArray(pages) ? createNavIndex(pages) : pages as NavIndex
  return rewriteParsedNavLinks(parseNavDocument(html), index, hrefPrefix)
}

/** 页面里是否可能存在需要解析的导航链接（供写入后补齐 pass 做廉价预筛）。 */
export function mayHaveNavLinks(html: string): boolean {
  return /<a\b[^>]*(?:href|data-nav)\s*=/i.test(html)
}
