/**
 * 文本分析：从掩码后的 HTML 里抽纯文本（保留偏移）、判 CJK/拉丁占比、找 emoji。
 */
import { mask } from '../cssParse.js'

/** 一段文本及其在原 HTML 中的起点。 */
export interface TextRun {
  text: string
  offset: number
  tag: string
}

const HIDDEN_TAGS = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'pre', 'code', 'kbd', 'samp'])
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'aside', 'main', 'header', 'footer', 'li', 'td', 'th',
  'dd', 'dt', 'blockquote', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'a',
  'label', 'span', 'small', 'strong', 'em', 'b', 'i', 'time', 'summary', 'caption',
])

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g
const LATIN_RE = /[A-Za-z]/g

/** CJK 字符占"有意义的字母类字符"的比例。 */
export function cjkRatio(text: string): number {
  const cjk = text.match(CJK_RE)?.length ?? 0
  const latin = text.match(LATIN_RE)?.length ?? 0
  const total = cjk + latin
  return total === 0 ? 0 : cjk / total
}

export function latinRatio(text: string): number {
  return 1 - cjkRatio(text)
}

/**
 * 抽取页面可见文本（按块级/内联标签切段），保留每段在原文中的起点。
 *
 * `maskedHtml` 必须是 lint 层已掩码的 HTML（脚本/注释/注入块为空白），
 * 这样 `<` `>` 不会被脚本内容干扰。
 */
export function textRuns(maskedHtml: string): TextRun[] {
  const out: TextRun[] = []
  const tagRe = /<\/?([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g
  let cursor = 0
  let currentTag = ''
  let skipDepth = 0

  const push = (from: number, to: number): void => {
    if (to <= from) return
    const raw = maskedHtml.slice(from, to)
    if (!raw.trim()) return
    out.push({ text: raw, offset: from, tag: currentTag })
  }

  for (const m of maskedHtml.matchAll(tagRe)) {
    const index = m.index ?? 0
    if (skipDepth === 0) push(cursor, index)
    const name = (m[1] ?? '').toLowerCase()
    const closing = maskedHtml[index + 1] === '/'
    if (HIDDEN_TAGS.has(name)) {
      skipDepth = Math.max(0, skipDepth + (closing ? -1 : 1))
    } else if (!closing && BLOCK_TAGS.has(name)) {
      currentTag = name
    }
    cursor = index + m[0].length
  }
  if (skipDepth === 0) push(cursor, maskedHtml.length)
  return out
}

/** 把一段 HTML 里的可见文本拼成纯字符串（用于整体占比统计）。 */
export function plainText(maskedHtml: string): string {
  return textRuns(maskedHtml)
    .map((r) => r.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 把文本里的 HTML 实体解成字符（仅常用几个，规则判定用）。 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** 用于 emoji 图标判定：带 Emoji_Presentation 的常见区段。 */
export function findEmoji(text: string): Array<{ char: string; index: number }> {
  const out: Array<{ char: string; index: number }> = []
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)
    if (code === undefined) continue
    const inEmoji =
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x1f000 && code <= 0x1f2ff) ||
      (code >= 0x2600 && code <= 0x27bf) ||
      (code >= 0x1f900 && code <= 0x1f9ff)
    if (inEmoji) {
      const char = String.fromCodePoint(code)
      out.push({ char, index: i })
      i += char.length - 1
    }
  }
  return out
}

/** 把一段 HTML 的非文本区域抹掉，只留文本（保留偏移）。 */
export function maskMarkupOnly(maskedHtml: string): string {
  return maskedHtml.replace(/<[^>]*>/g, mask)
}

/**
 * 按段落切分文本（用于格言腔等句式判定）。
 * 返回每段末句及其在原 HTML 中的起点。
 */
export function sentenceEndings(maskedHtml: string): Array<{ text: string; offset: number }> {
  const out: Array<{ text: string; offset: number }> = []
  for (const run of textRuns(maskedHtml)) {
    const decoded = decodeEntities(run.text).replace(/\s+/g, ' ').trim()
    if (!decoded) continue
    out.push({ text: decoded, offset: run.offset })
  }
  return out
}
