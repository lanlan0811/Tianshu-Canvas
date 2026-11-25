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

/**
 * 一条 CSS 规则块（选择器 + 声明），保留原文下标。
 *
 * `declarations()` 会把选择器整段丢弃，只能得到扁平声明；需要「同一规则块内
 * 两个声明之间的关系」（例如 border-left 与 border-radius 同时出现）时用这个。
 */
export interface CssRuleBlock {
  /** 已 trim 的选择器文本（@media 等前导不包含在内）。 */
  selector: string
  /** 选择器在原文中的下标（用于报告行号）。 */
  selectorOffset: number
  /** 规则体（大括号内部）在原文中的起止下标。 */
  start: number
  end: number
  decls: CssDeclaration[]
  /** 最近的 @media / @supports 前导文本；没有则为 null。 */
  atRule: string | null
}

interface RuleFrame {
  kind: 'rule' | 'at' | 'keyframes' | 'rule-at' | 'opaque'
  selector: string
  selectorOffset: number
  bodyStart: number
  atRule: string | null
  /** 嵌套子规则的原文区间（关闭时用来把这些区域从父级声明里抹掉）。 */
  children: Array<[number, number]>
}

/**
 * 判断 at-rule 前导属于哪一类块。
 *
 * - `at`：容器型（内部是规则列表），透明包裹；
 * - `keyframes`：内部的 `0%{}` / `from{}` 帧不是选择器，整体跳过；
 * - `rule-at`：体内是声明列表（`@font-face` 等），当作一条规则块产出；
 * - `opaque`：其余，忽略其内部。
 */
function atRuleKind(preamble: string): 'at' | 'keyframes' | 'rule-at' | 'opaque' {
  const name = /^@([A-Za-z-]+)/.exec(preamble.trimStart())?.[1]?.toLowerCase() ?? ''
  if (name === 'media' || name === 'supports' || name === 'layer' || name === 'container' || name === 'scope') return 'at'
  if (name.endsWith('keyframes')) return 'keyframes'
  if (name === 'font-face' || name === 'page' || name === 'counter-style' || name === 'property' || name === 'font-feature-values') return 'rule-at'
  return 'opaque'
}

/**
 * 把 CSS 文本切成规则块，保留每个选择器与声明的原文下标。
 *
 * - `@media` / `@supports` / `@layer` / `@container` / `@scope` 透明包裹；
 * - `@keyframes` 内的帧整体跳过；
 * - `@font-face` 等声明型 at-rule 作为规则块产出，选择器即 at-rule 前导；
 * - 其它 at-rule 的内部忽略；
 * - 语句型 at-rule（@import ...;）自然被丢弃；
 * - CSS nesting 会把父选择器拼进子选择器（`&` 替换或后代组合），子规则内容从父级声明里抹掉。
 *
 * 与 `declarations()` 使用同一套引号/括号感知扫描，`start` 为偏移基准，
 * 因此可以直接与 `lineOf` / `snippetAt` 配合。结果按源文件顺序返回。
 */
export function ruleBlocks(text: string, start = 0): CssRuleBlock[] {
  const out: CssRuleBlock[] = []
  const stack: RuleFrame[] = []
  let depth = 0
  let quote = ''
  let preambleStart = 0

  const atRuleOf = (): string | null => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const frame = stack[i]!
      if (frame.kind === 'at') return frame.selector
    }
    return null
  }

  const inSkipped = (): boolean => stack.some((f) => f.kind === 'keyframes' || f.kind === 'opaque')

  /** 把一段文本按给定区间抹成空白（保留换行），保证下标不变。 */
  const blankRanges = (body: string, ranges: Array<[number, number]>): string => {
    if (ranges.length === 0) return body
    const chars = body.split('')
    for (const [from, to] of ranges) {
      for (let i = Math.max(0, from); i < Math.min(chars.length, to); i++) {
        if (chars[i] !== '\n') chars[i] = ' '
      }
    }
    return chars.join('')
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
    if (ch === '(') {
      depth++
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth > 0) continue

    if (ch === '{') {
      const preamble = text.slice(preambleStart, i)
      const raw = preamble.trim()
      const isAt = raw.startsWith('@')
      // CSS nesting：`&:hover` 或裸嵌套选择器都要带上父选择器，规则才能匹配到 base 类。
      const parentRule = [...stack].reverse().find((f) => f.kind === 'rule' || f.kind === 'rule-at') ?? null
      const selector = !isAt && parentRule
        ? raw.includes('&')
          ? raw.split('&').join(parentRule.selector)
          : `${parentRule.selector} ${raw}`
        : raw
      const frame: RuleFrame = {
        kind: isAt ? atRuleKind(preamble) : 'rule',
        selector,
        selectorOffset: start + preambleStart + (preamble.length - preamble.trimStart().length),
        bodyStart: i + 1,
        atRule: atRuleOf(),
        children: [],
      }
      stack.push(frame)
      preambleStart = i + 1
      continue
    }

    if (ch === ';') {
      // 语句型 at-rule 结束（@import / @charset / @layer a, b;），丢弃前导。
      preambleStart = i + 1
      continue
    }

    if (ch === '}') {
      const frame = stack.pop()
      const parent = stack.length > 0 ? stack[stack.length - 1]! : null
      if (frame && parent) parent.children.push([frame.bodyStart, i])
      if (frame && (frame.kind === 'rule' || frame.kind === 'rule-at') && !inSkipped()) {
        // 嵌套子规则的内容不属于父级声明，抹成空白后再解析。
        const body = blankRanges(
          text.slice(frame.bodyStart, i),
          frame.children.map(([from, to]) => [from - frame.bodyStart, to - frame.bodyStart] as [number, number]),
        )
        const decls = declarations(body).map((d) => ({ ...d, offset: d.offset + start + frame.bodyStart }))
        if (decls.length) {
          out.push({
            selector: frame.selector,
            selectorOffset: frame.selectorOffset,
            start: start + frame.bodyStart,
            end: start + i,
            decls,
            atRule: frame.atRule,
          })
        }
      }
      preambleStart = i + 1
      continue
    }
  }

  // 顶层未闭合的尾段（例如残缺 CSS）按最后一段尝试解析，避免丢掉证据。
  if (stack.length === 0) {
    const tail = text.slice(preambleStart)
    if (tail.includes(':') && !tail.trimStart().startsWith('@')) {
      const decls = declarations(tail).map((d) => ({ ...d, offset: d.offset + start + preambleStart }))
      if (decls.length) {
        out.push({
          selector: '',
          selectorOffset: start + preambleStart,
          start: start + preambleStart,
          end: start + text.length,
          decls,
          atRule: null,
        })
      }
    }
  }

  // 按文档顺序返回（嵌套子规则先于父级闭合，需要重新排序）。
  out.sort((a, b) => a.selectorOffset - b.selectorOffset)
  return out
}

/** 内联 `style="..."` 的元素上下文。 */
export interface InlineStyleBlock {
  /** 小写标签名。 */
  tag: string
  classes: string[]
  /** 原始属性串（用于判定 role / aria-* / data-icon）。 */
  attrs: string
  decls: CssDeclaration[]
  /** style 值在原文中的下标。 */
  offset: number
}

const TAG_WITH_ATTRS = /<([A-Za-z][A-Za-z0-9-]*)\b([^>]*)>/g
const STYLE_ATTR = /(?<![\w-])style\s*=\s*(?:"([^"]*)"|'([^']*)')/i

/**
 * 抽取所有带 `style` 属性的元素，返回标签、类名、属性串与声明。
 *
 * `maskedHtml` 必须已经过 `mask`（脚本/注释/注入块被抹成空白），
 * 这样 `<` 与 `>` 不会被脚本内容干扰。
 */
export function inlineStyleBlocks(maskedHtml: string): InlineStyleBlock[] {
  const out: InlineStyleBlock[] = []
  for (const tagMatch of maskedHtml.matchAll(TAG_WITH_ATTRS)) {
    const attrs = tagMatch[2] ?? ''
    const styleMatch = STYLE_ATTR.exec(attrs)
    if (!styleMatch) continue
    const value = styleMatch[1] ?? styleMatch[2] ?? ''
    const tagStart = tagMatch.index ?? 0
    const attrOffset = tagStart + '<'.length + (tagMatch[1] ?? '').length + attrs.indexOf(styleMatch[0])
    const valueOffset = attrOffset + styleMatch[0].indexOf(value)
    const classMatch = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
    const classes = (classMatch?.[1] ?? classMatch?.[2] ?? '').split(/\s+/).filter(Boolean)
    out.push({
      tag: (tagMatch[1] ?? '').toLowerCase(),
      classes,
      attrs,
      decls: declarations(value).map((d) => ({ ...d, offset: d.offset + valueOffset })),
      offset: valueOffset,
    })
  }
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
