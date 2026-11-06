/**
 * 轻量 HTML 解析：产出带原始偏移的节点树，供适配器（codegen）与审计使用。
 *
 * 为什么不用正则：适配器需要按结构选择组件（表格 → Table、按钮 → Button），
 * 纯字符串替换做不到；又因为发行包禁止依赖目录，不能引入 parse5 之类的库。
 *
 * 覆盖范围（足够处理画布原型这类自包含页面）：
 *  - doctype / 注释（丢弃）
 *  - 标签属性：双引号、单引号、无引号、布尔属性
 *  - void 标签（不出现在树里）、自闭合标签（`<path/>`）
 *  - `script` / `style` / `textarea` / `title` 内的原文
 *  - 文本节点与常见命名字符实体 / 数字实体
 * 未闭合标签在 EOF 时逐层收尾；无法识别的 `<` 按文本处理。
 *
 * 不做的：HTML 错误恢复的完整规范、CDATA、模板语法、命名空间。
 */

export interface HtmlAttr {
  name: string
  /** 原始值（已解码实体）；布尔属性为 ''。 */
  value: string
  /** 属性在源串中的起止偏移（含名字，不含引号）。 */
  start: number
  end: number
}

export interface HtmlNode {
  type: 'element' | 'text'
  /** 元素标签名（小写）；文本节点为 '#text'。 */
  tag: string
  attrs: HtmlAttr[]
  children: HtmlNode[]
  /** 源串中的起止偏移；文本节点为文本本身的范围。 */
  start: number
  end: number
  /** 文本节点内容（元素节点为 ''）。 */
  text: string
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const RAW_TAGS = new Set(['script', 'style', 'textarea', 'title'])

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '\u00a9',
  reg: '\u00ae',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  middot: '\u00b7',
  times: '\u00d7',
  laquo: '\u00ab',
  raquo: '\u00bb',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  bull: '\u2022',
  deg: '\u00b0',
  plusmn: '\u00b1',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  check: '\u2713',
  cross: '\u2717',
}

/** 解码 HTML 实体（命名 + 十进制 + 十六进制）。未知实体原样保留。 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      return String.fromCodePoint(code)
    }
    const named = NAMED_ENTITIES[body]
    return named ?? whole
  })
}

function isNameChar(ch: string): boolean {
  return /[A-Za-z0-9:_-]/.test(ch)
}

function readAttr(src: string, i: number): { attr: HtmlAttr; next: number } | null {
  while (i < src.length && /\s/.test(src[i]!)) i++
  const start = i
  while (i < src.length && isNameChar(src[i]!)) i++
  if (i === start) return null
  const name = src.slice(start, i).toLowerCase()
  while (i < src.length && /\s/.test(src[i]!)) i++
  if (src[i] !== '=') return { attr: { name, value: '', start, end: i }, next: i }
  i++
  while (i < src.length && /\s/.test(src[i]!)) i++
  const quote = src[i]
  if (quote === '"' || quote === "'") {
    const valueStart = i + 1
    const close = src.indexOf(quote, valueStart)
    const valueEnd = close < 0 ? src.length : close
    return {
      attr: { name, value: decodeEntities(src.slice(valueStart, valueEnd)), start, end: Math.min(valueEnd + 1, src.length) },
      next: valueEnd + 1,
    }
  }
  const valueStart = i
  while (i < src.length && !/[\s>]/.test(src[i]!)) i++
  return { attr: { name, value: decodeEntities(src.slice(valueStart, i)), start, end: i }, next: i }
}

/**
 * 解析 HTML 为节点树。
 * @param src 完整 HTML 文本
 * @param baseOffset 给偏移加一个基数（用于内联片段定位到整页）
 */
export function parseHtml(src: string, baseOffset = 0): HtmlNode[] {
  const root: HtmlNode[] = []
  const stack: HtmlNode[] = []
  const push = (node: HtmlNode): void => {
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else root.push(node)
  }
  const addText = (start: number, end: number, raw: string): void => {
    if (!raw) return
    push({ type: 'text', tag: '#text', attrs: [], children: [], start: start + baseOffset, end: end + baseOffset, text: decodeEntities(raw) })
  }

  let i = 0
  let textStart = 0
  const flushText = (end: number): void => {
    if (end > textStart) addText(textStart, end, src.slice(textStart, end))
    textStart = end
  }

  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) break
    if (src.startsWith('<!--', lt)) {
      flushText(lt)
      const close = src.indexOf('-->', lt + 4)
      i = close < 0 ? src.length : close + 3
      textStart = i
      continue
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      flushText(lt)
      const close = src.indexOf('>', lt + 2)
      i = close < 0 ? src.length : close + 1
      textStart = i
      continue
    }
    if (src[lt + 1] === '/') {
      const nameEnd = lt + 2
      let j = nameEnd
      while (j < src.length && isNameChar(src[j]!)) j++
      const name = src.slice(nameEnd, j).toLowerCase()
      flushText(lt)
      const close = src.indexOf('>', j)
      i = close < 0 ? src.length : close + 1
      textStart = i
      // 关闭最近的同名元素；中间未闭合的元素一并收尾。
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k]!.tag === name) {
          while (stack.length > k) {
            const done = stack.pop()!
            done.end = i + baseOffset
          }
          break
        }
      }
      continue
    }
    if (!/[A-Za-z]/.test(src[lt + 1] ?? '')) {
      // 不是标签，当文本。
      i = lt + 1
      continue
    }

    flushText(lt)
    let j = lt + 1
    while (j < src.length && isNameChar(src[j]!)) j++
    const tag = src.slice(lt + 1, j).toLowerCase()
    const attrs: HtmlAttr[] = []
    let selfClosing = false
    while (j < src.length) {
      const read = readAttr(src, j)
      if (!read) {
        if (src[j] === '/') {
          selfClosing = true
          j++
          continue
        }
        if (src[j] === '>') {
          j++
          break
        }
        j++
        continue
      }
      attrs.push(read.attr)
      j = read.next
      if (src[j] === '/') {
        selfClosing = true
        j++
      }
    }
    const openEnd = j

    if (RAW_TAGS.has(tag) && !selfClosing) {
      const closeRe = new RegExp(`</${tag}\\s*>`, 'ig')
      closeRe.lastIndex = openEnd
      const match = closeRe.exec(src)
      const innerEnd = match ? match.index : src.length
      const node: HtmlNode = {
        type: 'element',
        tag,
        attrs,
        children: [],
        start: lt + baseOffset,
        end: (match ? match.index + match[0].length : src.length) + baseOffset,
        text: '',
      }
      if (innerEnd > openEnd) {
        node.children.push({
          type: 'text',
          tag: '#text',
          attrs: [],
          children: [],
          start: openEnd + baseOffset,
          end: innerEnd + baseOffset,
          text: src.slice(openEnd, innerEnd),
        })
      }
      push(node)
      i = match ? match.index + match[0].length : src.length
      textStart = i
      continue
    }

    const node: HtmlNode = { type: 'element', tag, attrs, children: [], start: lt + baseOffset, end: openEnd + baseOffset, text: '' }
    push(node)
    i = openEnd
    textStart = i
    if (selfClosing || VOID_TAGS.has(tag)) {
      node.end = openEnd + baseOffset
      continue
    }
    stack.push(node)
  }

  flushText(src.length)
  while (stack.length) {
    const done = stack.pop()!
    done.end = src.length + baseOffset
  }
  return root
}

/** 元素的 class 列表。 */
export function classesOf(node: HtmlNode): string[] {
  const raw = node.attrs.find((a) => a.name === 'class')?.value ?? ''
  return raw.split(/\s+/).filter(Boolean)
}

export function attrOf(node: HtmlNode, name: string): string | undefined {
  return node.attrs.find((a) => a.name === name)?.value
}

/** 深度优先遍历元素节点（不含文本）。 */
export function walkElements(nodes: HtmlNode[], visit: (node: HtmlNode, parent: HtmlNode | null) => void, parent: HtmlNode | null = null): void {
  for (const node of nodes) {
    if (node.type !== 'element') continue
    visit(node, parent)
    walkElements(node.children, visit, node)
  }
}

/** 元素文本内容（拼接全部后代文本，压缩空白）。 */
export function textOf(node: HtmlNode): string {
  if (node.type === 'text') return node.text
  return node.children.map(textOf).join('').replace(/\s+/g, ' ').trim()
}

/** 第一个匹配的元素（深度优先）。 */
export function findElement(nodes: HtmlNode[], predicate: (node: HtmlNode) => boolean): HtmlNode | null {
  for (const node of nodes) {
    if (node.type !== 'element') continue
    if (predicate(node)) return node
    const hit = findElement(node.children, predicate)
    if (hit) return hit
  }
  return null
}

/** 序列化属性值（JSX 用双引号并转义）。 */
export function jsxAttr(name: string, value: string): string {
  return `${name}="${value.replace(/"/g, '&quot;')}"`
}
