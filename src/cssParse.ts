/**
 * 轻量 CSS 解析（无 DOM，服务端可用）。
 *
 * 从 lint.ts 抽出：把 `<style>` 内容与 `style="..."` 属性切成声明列表，并把
 * 脚本 / 注释 / url() / data: 掩码成等长空白，保证报告里的行号与原文件一致。
 *
 * 被 lint.ts（风格一致性检查）与 extract.ts（设计系统反抽取）共用。
 * 已知限制：font 简写里的字体族不单独拆解；@media/@supports 等嵌套规则的
 * 声明按扁平处理（选择器被跳过，只取声明）。
 */

/** 单条 CSS 声明；`offset` 是值在原文中的下标（用于定位报告行号）。 */
export interface CssDeclaration {
  prop: string
  value: string
  raw: string
  offset: number
}

/** 一段待解析的 CSS 文本及其在原文中的起止。 */
export interface CssSegment {
  start: number
  text: string
}

export const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g
export const FUNC_COLOR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/gi

/** 颜色相关属性（用于限定命名色的检查范围）。 */
export const COLOR_PROP =
  /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline))*(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|text-decoration(?:-color)?|caret-color|accent-color|column-rule(?:-color)?)$/

/** CSS 命名色（不含 transparent、currentColor 这类关键字）。 */
export const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue ' +
    'chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey ' +
    'darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray ' +
    'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen ' +
    'fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender ' +
    'lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey ' +
    'lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen ' +
    'mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange ' +
    'orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray ' +
    'slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
)

export const CSS_WORD = /(?<![\w-])[a-z]+(?![\w-])/gi
export const VAR_REF = /var\(\s*(--ts-[A-Za-z0-9-]+)\s*\)/g
export const CLASS_ATTR_RE = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/g
export const DATA_ICON = /data-icon\s*=\s*(?:"([^"]*)"|'([^']*)')/g
export const EMPTY_SVG = /<svg\b([^>]*)>\s*<\/svg>/gi

export const SPACING_PROPS =
  /^(?:padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$/
export const RADIUS_PROP = /^border(?:-[a-z]+)*-radius$/
export const FONT_PROP = /^font-family$/

/** 把整段文本替换成等长空白（保留换行），用于掩码不应被检查的区域。 */
export function mask(text: string): string {
  return text.replace(/[^\n]/g, ' ')
}

/** 把与 pattern 匹配的区域替换成等长空白。 */
export function maskBalanced(text: string, pattern: RegExp): string {
  // 按 UTF-16 单元拆分，才能和 matchAll 的下标对应；展开运算符按码点拆，遇到 emoji 会错位。
  const out = text.split('')
  pattern.lastIndex = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    for (let i = start; i < start + match[0].length; i++) if (out[i] !== '\n') out[i] = ' '
  }
  return out.join('')
}

/** 只掩码 CSS 里 url(...) 与 data: 值，保留其它文本。 */
export function maskUrls(segment: string): string {
  let out = maskBalanced(segment, /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi)
  out = maskBalanced(out, /\bdata:[^"')\s]+/gi)
  return out
}

/** 抽取所有 <style> 内容与 style="..." 属性；返回在原文中的起止。 */
export function styleSegments(maskedHtml: string): CssSegment[] {
  const segments: CssSegment[] = []
  for (const match of maskedHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const inner = match[1] ?? ''
    const start = (match.index ?? 0) + match[0].indexOf(inner)
    segments.push({ start, text: inner.replace(/\/\*[\s\S]*?\*\//g, mask) })
  }
  // 前面不能紧贴单词字符或连字符，否则 data-style 也会被当成样式。
  for (const match of maskedHtml.matchAll(/(?<![\w-])style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const inner = match[1] ?? match[2] ?? ''
    const start = (match.index ?? 0) + match[0].indexOf(inner)
    segments.push({ start, text: inner })
  }
  return segments
}

/** 把 CSS 文本按 ; 切成声明，跳过括号与引号内部的 ;；遇到 { 进入规则体、遇到 } 结束当前声明。 */
export function declarations(text: string): CssDeclaration[] {
  const out: CssDeclaration[] = []
  let depth = 0
  let quote = ''
  let start = 0
  const flush = (end: number): void => {
    const body = text.slice(start, end)
    const colon = body.indexOf(':')
    if (colon > 0) {
      const prop = body.slice(0, colon).trim().toLowerCase()
      const raw = body.slice(colon + 1)
      const value = raw.replace(/\}+\s*$/, '').trim()
      if (prop && value) out.push({ prop, value, raw, offset: start + colon + 1 })
    }
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && (ch === ';' || ch === '}')) {
      flush(i)
      start = i + 1
    } else if (depth === 0 && ch === '{') {
      // 选择器结束，后面的内容才是声明。
      start = i + 1
    }
  }
  if (start < text.length) flush(text.length)
  return out
}

/** 行首下标表，用于 offset -> 行号。 */
export function lineIndex(html: string): number[] {
  const index: number[] = [0]
  for (let i = 0; i < html.length; i++) if (html[i] === '\n') index.push(i + 1)
  return index
}

export function lineOf(index: number[], offset: number): number {
  let lo = 0
  let hi = index.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (index[mid]! <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/** 取 offset 所在行的片段（最多 length 字符）。 */
export function snippetAt(html: string, offset: number, length = 80): string {
  const start = Math.max(0, offset)
  const lineEnd = html.indexOf('\n', start)
  const end = lineEnd === -1 ? Math.min(html.length, start + length) : Math.min(lineEnd, start + length)
  return html.slice(start, end).trim()
}

/** 取出值里的每个像素长度（负值取绝对值）；calc() 无法静态判断，var() 不属于字面量。 */
export function pxValues(value: string): number[] {
  if (/calc\(/i.test(value)) return []
  const literal = value.replace(/var\([^)]*\)/gi, ' ')
  const found = new Set<number>()
  for (const match of literal.matchAll(/(?<![\w.-])-?(\d+(?:\.\d+)?)px\b/g)) found.add(Number(match[1]))
  return [...found]
}
