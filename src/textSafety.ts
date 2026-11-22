/**
 * 文本安全：不可见字符与双向控制符。
 *
 * 托管 HTML 会直接进沙箱 iframe 并被导出，零宽字符与双向控制符可以隐藏链接与文案
 * （Trojan Source 类）。这里分两档：
 *   - 硬拒绝：双向覆盖 / 嵌入 / 隔离与 LTR/RTL 标记（U+202A–202E、U+2066–2069、U+200E/200F）。
 *   - 仅警告：零宽空格族、词连接符与文档中间的 BOM（U+200B–U+200D、U+2060、U+FEFF）——
 *     emoji ZWJ 序列与历史文件需要它们，不能静默剥离。
 *
 * 不提供绕过开关：报错给出字符名与行:列，删除或改用普通字符即可继续。
 */
import { lineIndex, lineOf } from './cssParse.js'

export interface InvisibleHit {
  code: number
  name: string
  index: number
  line: number
  column: number
}

export interface InvisibleScan {
  blocked: InvisibleHit[]
  warned: InvisibleHit[]
}

const NAMES = new Map<number, string>([
  [0x200b, '零宽空格 ZERO WIDTH SPACE'],
  [0x200c, '零宽非连接符 ZERO WIDTH NON-JOINER'],
  [0x200d, '零宽连接符 ZERO WIDTH JOINER'],
  [0x200e, '从左到右标记 LEFT-TO-RIGHT MARK'],
  [0x200f, '从右到左标记 RIGHT-TO-LEFT MARK'],
  [0x202a, '从左到右嵌入 LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, '从右到左嵌入 RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, '方向格式结束 POP DIRECTIONAL FORMATTING'],
  [0x202d, '从左到右覆盖 LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, '从右到左覆盖 RIGHT-TO-LEFT OVERRIDE'],
  [0x2060, '词连接符 WORD JOINER'],
  [0x2066, '从左到右隔离 LEFT-TO-RIGHT ISOLATE'],
  [0x2067, '从右到左隔离 RIGHT-TO-LEFT ISOLATE'],
  [0x2068, '首强隔离 FIRST STRONG ISOLATE'],
  [0x2069, '方向隔离结束 POP DIRECTIONAL ISOLATE'],
  [0xfeff, '零宽不换行空格 ZERO WIDTH NO-BREAK SPACE（BOM）'],
])

function classify(code: number): 'blocked' | 'warned' | null {
  if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return 'blocked'
  if (code === 0x200e || code === 0x200f) return 'blocked'
  if ((code >= 0x200b && code <= 0x200d) || code === 0x2060 || code === 0xfeff) return 'warned'
  return null
}

const unicodeName = (code: number): string => NAMES.get(code) ?? '不可见控制字符'

/** 扫描一段文本里的不可见字符，附带行:列（行号从 1 开始，列按 UTF-16 单元计）。 */
export function scanInvisibleControls(text: string): InvisibleScan {
  const blocked: InvisibleHit[] = []
  const warned: InvisibleHit[] = []
  if (!text) return { blocked, warned }
  const index = lineIndex(text)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    // 文档开头的 BOM 是常见编码产物，不算正文里的隐藏字符。
    if (code === 0xfeff && i === 0) continue
    const kind = classify(code)
    if (kind === null) continue
    const line = lineOf(index, i)
    const hit = { code, name: unicodeName(code), index: i, line, column: i - index[line - 1]! + 1 }
    ;(kind === 'blocked' ? blocked : warned).push(hit)
  }
  return { blocked, warned }
}

const codeTag = (code: number): string => 'U+' + code.toString(16).toUpperCase().padStart(4, '0')

function listHits(hits: InvisibleHit[], max = 5): string {
  return hits
    .slice(0, max)
    .map((hit) => `${codeTag(hit.code)}（${hit.name}）第 ${hit.line} 行第 ${hit.column} 列`)
    .join('；') + (hits.length > max ? `；等共 ${hits.length} 处` : '')
}

/** 硬拒绝时的完整报错文本；label 指明是页面 HTML 还是标题。 */
export function describeBlockedControls(hits: InvisibleHit[], label = '页面 HTML'): string {
  return (
    `已拒绝写入：${label} 含双向控制字符，可能被用来隐藏或反转可见文本。` +
    `\n位置：${listHits(hits)}。` +
    `\n请删除这些字符，或改用普通文本 / 显式 HTML 属性（如 dir="rtl"）后重试。`
  )
}

/** 软警告的追加行；没有命中时返回空串。 */
export function describeWarnedControls(hits: InvisibleHit[], label = '页面 HTML'): string {
  if (hits.length === 0) return ''
  return (
    `\n文本安全：${label}含 ${hits.length} 个零宽/不可见字符（${listHits(hits)}）。` +
    `emoji 组合与 BOM 可以保留；若并非有意使用，建议删除。`
  )
}
