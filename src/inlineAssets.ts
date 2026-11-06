/**
 * 资源内联：把原型里会被画布 CSP 拦截的外链/相对路径资源抓下来转成 data: URI。
 *
 * 背景：`/page/:id` 的 CSP 是 `default-src 'none'; img-src data: blob:; font-src data:`
 * 且服务端没有相对路径静态路由，因此外链图片/字体/CSS/脚本一律加载不到。
 * 本模块把「提示」变成「修复」——默认不启用，只有显式传参才触发（见 tools.ts）。
 *
 * 安全：所有抓取走 netFetch（SSRF 防护，禁内网/回环）。相对路径需要 `origin`
 * 才能解析；没有 origin 时保留原引用并给出警告，不做猜测。
 */
import { findBlockedResources } from './resources.js'
import { fetchUrl, type FetchOptions } from './netFetch.js'

export interface InlineOptions {
  /** 相对路径资源所需的基准地址（如 `https://example.com/page`）。 */
  origin?: string
  /** 单个资源体积上限（字节）。 */
  maxBytesPer?: number
  /** 全部资源累计上限（字节）；超限后剩余资源跳过。 */
  maxTotalBytes?: number
  /** 测试注入。 */
  fetchImpl?: FetchOptions['fetchImpl']
}

export interface InlineResult {
  html: string
  /** 成功内联的资源数。 */
  inlined: number
  /** 跳过的资源及原因。 */
  skipped: Array<{ ref: string; reason: string }>
}

const DEFAULT_MAX_PER = 2 * 1024 * 1024
const DEFAULT_MAX_TOTAL = 8 * 1024 * 1024

/** 文本型 MIME 用 utf-8 内联（更小更可读）；其余走 base64。 */
const TEXT_TYPES = new Set(['text/css', 'text/javascript', 'application/javascript', 'image/svg+xml'])

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
}

function mimeFor(ref: string, contentType: string | null): string {
  const fromHeader = contentType?.split(';')[0]?.trim().toLowerCase()
  const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(ref)?.[1]?.toLowerCase()
  return (fromHeader && fromHeader !== 'application/octet-stream' ? fromHeader : undefined) ?? (ext && EXT_MIME[ext]) ?? 'application/octet-stream'
}

/** 转 data: URI。文本型用 encodeURIComponent，其它用 base64。 */
export function toDataUri(body: Buffer, mime: string): string {
  if (TEXT_TYPES.has(mime)) {
    return `data:${mime};charset=utf-8,${encodeURIComponent(body.toString('utf8'))}`
  }
  return `data:${mime};base64,${body.toString('base64')}`
}

/** 内联脚本/样式时必须转义结束标签，否则会提前终止宿主标签。 */
function escapeScript(text: string): string {
  return text.replace(/<\/script/gi, '<\\/script')
}
function escapeStyle(text: string): string {
  return text.replace(/<\/style/gi, '<\\/style')
}

/** 只把 CSS 里会被拦的 url()（绝对或相对）替换成内联后的 data URI。 */
async function inlineCssUrls(css: string, ctx: Ctx): Promise<string> {
  const refs = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi)]
  let out = css
  for (const match of refs) {
    const ref = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (!ref || /^(?:data:|blob:|about:|#)/i.test(ref)) continue
    const uri = await inlineOne(ref, ctx)
    if (uri) out = out.replaceAll(match[0], `url("${uri}")`)
  }
  return out
}

interface Ctx {
  origin?: string
  maxBytesPer: number
  maxTotalBytes: number
  used: { total: number }
  fetchImpl?: FetchOptions['fetchImpl']
  inlined: number
  skipped: Array<{ ref: string; reason: string }>
}

/** 解析引用为绝对 URL：绝对 URL 直接用；相对路径需 origin。 */
function resolveRef(ref: string, ctx: Ctx): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
    return /^https?:/i.test(ref) ? ref : null // 其它协议（ftp/data 已完成）不处理
  }
  if (!ctx.origin) return null
  try {
    return new URL(ref, ctx.origin).toString()
  } catch {
    return null
  }
}

/** 抓取单个资源并转 data URI；失败时记入 skipped 并返回 null。 */
async function inlineOne(ref: string, ctx: Ctx): Promise<string | null> {
  const abs = resolveRef(ref, ctx)
  if (!abs) {
    ctx.skipped.push({ ref, reason: ctx.origin ? '不支持的资源类型' : '相对路径但未提供 origin' })
    return null
  }
  const remaining = ctx.maxTotalBytes - ctx.used.total
  if (remaining <= 0) {
    ctx.skipped.push({ ref, reason: '已达累计体积上限' })
    return null
  }
  try {
    const result = await fetchUrl(abs, {
      maxBytes: Math.min(ctx.maxBytesPer, remaining),
      fetchImpl: ctx.fetchImpl,
    })
    ctx.used.total += result.body.length
    ctx.inlined++
    return toDataUri(result.body, mimeFor(abs, result.contentType))
  } catch (err) {
    ctx.skipped.push({ ref, reason: (err as Error).message })
    return null
  }
}

/**
 * 把 HTML 里会被 CSP 拦截的资源内联为 data: URI。
 * 只处理 img / 脚本 / 样式 / CSS url()；iframe/video/audio 等保留原引用并警告。
 */
export async function inlineAssets(html: string, options: InlineOptions = {}): Promise<InlineResult> {
  const ctx: Ctx = {
    origin: options.origin,
    maxBytesPer: options.maxBytesPer ?? DEFAULT_MAX_PER,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL,
    used: { total: 0 },
    fetchImpl: options.fetchImpl,
    inlined: 0,
    skipped: [],
  }

  // 先记录最初会被拦的资源，用于把「未处理」的也如实报出来。
  const blockedAtStart = findBlockedResources(html)
  let out = html

  // 1) <img src="...">
  for (const match of [...out.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]) {
    const ref = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (!ref || /^(?:data:|blob:|about:|#)/i.test(ref)) continue
    const uri = await inlineOne(ref, ctx)
    if (uri) out = out.replace(match[0], match[0].replace(ref, uri))
  }

  // 2) <link rel="stylesheet" href="..."> → 抓 CSS，递归内联其 url()，包成 <style>
  for (const match of [...out.matchAll(/<link\b[^>]*>/gi)]) {
    const tag = match[0]
    if (!/\brel\s*=\s*(?:"[^"]*stylesheet[^"]*"|'[^']*stylesheet[^']*'|stylesheet)/i.test(tag)) continue
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    const ref = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? '').trim()
    if (!ref || /^(?:data:|blob:|about:|#)/i.test(ref)) continue
    const abs = resolveRef(ref, ctx)
    if (!abs) {
      ctx.skipped.push({ ref, reason: ctx.origin ? '不支持的资源类型' : '相对路径但未提供 origin' })
      continue
    }
    try {
      const result = await fetchUrl(abs, { maxBytes: ctx.maxBytesPer, fetchImpl: ctx.fetchImpl })
      ctx.used.total += result.body.length
      const css = await inlineCssUrls(result.body.toString('utf8'), ctx)
      out = out.replace(tag, `<style>${escapeStyle(css)}</style>`)
      ctx.inlined++
    } catch (err) {
      ctx.skipped.push({ ref, reason: (err as Error).message })
    }
  }

  // 3) <script src="..."> → 内联为 <script>（转义 </script）
  for (const match of [...out.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>\s*<\/script>/gi)]) {
    const ref = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (!ref || /^(?:data:|blob:|about:|#)/i.test(ref)) continue
    const abs = resolveRef(ref, ctx)
    if (!abs) {
      ctx.skipped.push({ ref, reason: ctx.origin ? '不支持的资源类型' : '相对路径但未提供 origin' })
      continue
    }
    try {
      const result = await fetchUrl(abs, { maxBytes: ctx.maxBytesPer, fetchImpl: ctx.fetchImpl })
      ctx.used.total += result.body.length
      out = out.replace(match[0], `<script>${escapeScript(result.body.toString('utf8'))}</script>`)
      ctx.inlined++
    } catch (err) {
      ctx.skipped.push({ ref, reason: (err as Error).message })
    }
  }

  // 4) <style> 内与 style="..." 里的 url()
  out = await replaceStyleBlocks(out, ctx)

  // 5) 把仍然残留的（未处理的 iframe/video 等）如实报出。
  const handledRefs = new Set([...ctx.skipped.map((s) => s.ref)])
  for (const ref of blockedAtStart) {
    if (handledRefs.has(ref)) continue
    if (out.includes(ref)) {
      ctx.skipped.push({ ref, reason: '不支持的资源类型（未内联）' })
    }
  }

  return { html: out, inlined: ctx.inlined, skipped: ctx.skipped }
}

/** 处理 <style> 块与 style="..." 属性里的 url()。 */
async function replaceStyleBlocks(html: string, ctx: Ctx): Promise<string> {
  let out = html
  const styleBlocks = [...out.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  for (const match of styleBlocks) {
    const inner = match[1] ?? ''
    const replaced = await inlineCssUrls(inner, ctx)
    if (replaced !== inner) {
      out = out.replace(match[0], match[0].replace(inner, escapeStyle(replaced)))
    }
  }
  const styleAttrs = [...out.matchAll(/(?<![\w-])style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)]
  for (const match of styleAttrs) {
    const inner = match[1] ?? match[2] ?? ''
    const replaced = await inlineCssUrls(inner, ctx)
    if (replaced !== inner) out = out.replace(match[0], match[0].replace(inner, replaced))
  }
  return out
}
