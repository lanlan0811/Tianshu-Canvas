/**
 * 渲染级工艺审计（需要浏览器）。
 *
 * 与 a11y 的分工：a11y 判可达性（对比度、标签、焦点、目标尺寸），
 * 这里判**排版与工艺质量**，全部需要真实渲染后的几何：
 * 字号、行高、字距、行宽、全大写、字号层级、标题节奏。
 *
 * 设计取舍（沿用 a11y 的约定）：
 *  - 页面上下文只**采集证据**，判定放在 Node 侧（纯函数，易测）；
 *  - 无法判定的情况一律记入 skipped 并写明原因，绝不猜；
 *  - 每条规则只报最严重的一处或聚合一处，避免报告被同类问题淹没。
 */
import type { Browser, Page } from 'puppeteer-core'
import type { SurfaceMode } from '../modes.js'

export type QualitySeverity = 'warning' | 'advisory'

export interface QualityIssue {
  rule: string
  severity: QualitySeverity
  selector: string
  snippet: string
  message: string
}

export interface QualityReport {
  /** 参与判定的文字元素数。 */
  elements: number
  /** 渲染出多行的段落数（行宽/行高判定的基数）。 */
  multiLine: number
  issues: QualityIssue[]
  counts: Record<QualitySeverity, number>
  byRule: Record<string, number>
  /** 跳过的检查与原因（不能把「没检查」说成「通过」）。 */
  skipped: string[]
}

export interface QualityOptions {
  /** 正文最小字号（px），默认 12。 */
  minBodyPx?: number
  /** 功能性 UI 文本最小字号（px），默认 11。 */
  minUiPx?: number
  /** 行宽上限（字符数），默认 80。 */
  lineMax?: number
  /** 页面模式；read/operate 的判定更严格（见各规则）。 */
  mode?: SurfaceMode | null
  /** 忽略的选择器。 */
  ignore?: string[]
}

/** 页面上下文采集：只返回证据，判定在 Node 侧。 */
const COLLECT_SCRIPT = `(() => {
  const out = { elements: 0, multiLine: 0, items: [], skipped: [], fontStatus: '' }
  const css = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim()
  const hidden = (el) => {
    let n = el
    while (n && n.nodeType === 1) {
      const s = getComputedStyle(n)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return true
      n = n.parentElement
    }
    return false
  }
  const path = (el) => {
    const parts = []
    let n = el
    while (n && n.nodeType === 1 && parts.length < 5) {
      let s = n.tagName.toLowerCase()
      if (n.id) { s += '#' + n.id; parts.unshift(s); break }
      const cls = (n.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0, 2).join('.')
      if (cls) s += '.' + cls
      parts.unshift(s)
      n = n.parentElement
    }
    return parts.join(' > ')
  }
  /** 元素自有文本（不含子元素），用于「这段文字本身多长」。 */
  const ownText = (el) => {
    let t = ''
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue || ''
    return t.replace(/\\s+/g, ' ').trim()
  }
  /** 用 Range 量每行矩形：返回 [{width, chars}]，chars 为该行的字符数（按节点均分）。 */
  const lineRects = (el) => {
    const range = document.createRange()
    const rects = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const text = node.nodeValue || ''
      if (!text.trim()) continue
      range.selectNodeContents(node)
      for (const r of range.getClientRects()) {
        if (r.width <= 0 || r.height <= 0) continue
        rects.push({ width: r.width, top: r.top, height: r.height, len: text.length })
      }
    }
    if (!rects.length) return []
    // 按 top 聚合成行（同一行的矩形 top 接近）
    const lines = []
    for (const r of rects.sort((a, b) => a.top - b.top)) {
      const last = lines[lines.length - 1]
      if (last && Math.abs(last.top - r.top) < Math.max(2, last.height * 0.5)) {
        last.width += r.width
        last.len += r.len
        last.height = Math.max(last.height, r.height)
      } else lines.push({ ...r })
    }
    return lines
  }
  const CJK = /[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uac00-\\ud7af]/
  const texts = Array.from(document.body ? document.body.querySelectorAll('*') : [])
  for (const el of texts) {
    const own = ownText(el)
    if (!own) continue
    if (hidden(el)) continue
    const tag = el.tagName.toLowerCase()
    if (['script', 'style', 'svg', 'path', 'pre', 'code', 'kbd', 'samp', 'textarea'].includes(tag)) continue
    if (el.closest('pre, code, kbd, samp')) continue
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    out.elements++
    const fontSize = parseFloat(css(el, 'font-size')) || 16
    const lineHeightRaw = css(el, 'line-height')
    const lineHeight = lineHeightRaw === 'normal' ? fontSize * 1.2 : parseFloat(lineHeightRaw) || fontSize * 1.2
    const letterSpacingRaw = css(el, 'letter-spacing')
    const letterSpacing = letterSpacingRaw === 'normal' ? 0 : parseFloat(letterSpacingRaw) || 0
    const lines = lineRects(el)
    if (lines.length > 1) out.multiLine++
    // 平均每行字符数：按行宽 / 平均字宽估算（拉丁用 0.5em，CJK 用 1em）
    const isCjk = CJK.test(own)
    let charsPerLine = 0
    if (lines.length) {
      const avgCharWidth = isCjk ? fontSize : fontSize * 0.5
      const widths = lines.map((l) => l.width)
      charsPerLine = Math.round(Math.max(...widths) / Math.max(1, avgCharWidth))
    }
    const cls = (el.getAttribute('class') || '').toLowerCase()
    const role = (el.getAttribute('role') || '').toLowerCase()
    const interactive = ['a', 'button', 'summary'].includes(tag) || /^(button|link|tab|menuitem|option)$/.test(role)
    const uiText = interactive || ['label', 'th', 'td', 'time', 'small', 'figcaption', 'dt', 'dd'].includes(tag) || /(label|caption|meta|badge|tag|chip|hint|helper)/.test(cls)
    out.items.push({
      tag,
      selector: path(el),
      snippet: (el.outerHTML || '').slice(0, 160),
      text: own.slice(0, 160),
      textChars: own.length,
      fontSize,
      fontWeight: Number(css(el, 'font-weight')) || 400,
      lineHeight,
      letterSpacing,
      textTransform: css(el, 'text-transform'),
      isHeading: /^h[1-6]$/.test(tag),
      headingLevel: /^h[1-6]$/.test(tag) ? Number(tag[1]) : 0,
      interactive,
      uiText,
      isCjk,
      lines: lines.length,
      charsPerLine,
      // 下方间距：到下一个兄弟文字块的顶部距离；没有兄弟时为 -1
      gapBelow: (() => {
        let sib = el.nextElementSibling
        while (sib && !(sib.textContent || '').trim()) sib = sib.nextElementSibling
        if (!sib) return -1
        const r = sib.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return -1
        return Math.round(r.top - rect.bottom)
      })(),
      // 上方间距：到上一个兄弟文字块的底部距离
      gapAbove: (() => {
        let sib = el.previousElementSibling
        while (sib && !(sib.textContent || '').trim()) sib = sib.previousElementSibling
        if (!sib) return -1
        const r = sib.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return -1
        return Math.round(rect.top - r.bottom)
      })(),
      // 是否在卡片内（高度 < 200 的容器）
      inSmallCard: (() => {
        let n = el.parentElement
        let depth = 0
        while (n && n !== document.body && depth < 6) {
          const r = n.getBoundingClientRect()
          if (r.height > 0 && r.height < 200 && r.width < 480) return true
          n = n.parentElement
          depth++
        }
        return false
      })(),
      inBlockquote: Boolean(el.closest('blockquote, q')),
      hasTextWrapBalance: /balance/.test(css(el, 'text-wrap')),
      hasTextWrapPretty: /pretty/.test(css(el, 'text-wrap')),
      displayInline: css(el, 'display') === 'inline',
    })
  }
  return out
})()`

interface RawQualityItem {
  tag: string
  selector: string
  snippet: string
  text: string
  textChars: number
  fontSize: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  textTransform: string
  isHeading: boolean
  headingLevel: number
  interactive: boolean
  uiText: boolean
  isCjk: boolean
  lines: number
  charsPerLine: number
  gapBelow: number
  gapAbove: number
  inSmallCard: boolean
  inBlockquote: boolean
  hasTextWrapBalance: boolean
  hasTextWrapPretty: boolean
  displayInline: boolean
}

interface RawQualityScan {
  elements: number
  multiLine: number
  items: RawQualityItem[]
  skipped: string[]
  fontStatus: string
}

/** 纯判定：把渲染证据转成问题列表（不碰浏览器，便于单测）。 */
export function analyzeQuality(raw: RawQualityScan, options: QualityOptions = {}): QualityReport {
  const minBodyPx = options.minBodyPx ?? 12
  const minUiPx = options.minUiPx ?? 11
  const lineMax = options.lineMax ?? 80
  const ignore = (options.ignore ?? []).map((s) => s.trim()).filter(Boolean)
  const issues: QualityIssue[] = []
  const skipped: string[] = [...(raw.skipped ?? [])]

  const push = (rule: string, severity: QualitySeverity, item: RawQualityItem, message: string): void => {
    if (ignore.some((sel) => item.selector.includes(sel))) return
    issues.push({ rule, severity, selector: item.selector, snippet: item.snippet, message })
  }

  if (raw.elements === 0) {
    skipped.push('页面没有可测的文字元素，所有排版规则未判定')
  }

  for (const item of raw.items) {
    // 1) 正文字号过小
    if (!item.isHeading && item.textChars >= 8 && item.fontSize < minBodyPx) {
      push('tiny-text', 'warning', item, `正文字号 ${item.fontSize}px 低于 ${minBodyPx}px 下限，高 DPI 与小屏上难以阅读`)
    }
    // 2) 功能性 UI 文本过小
    if (item.uiText && item.textChars > 0 && item.fontSize > 0 && item.fontSize < minUiPx) {
      push('undersized-ui-text', 'warning', item, `功能性文字 ${item.fontSize}px 低于 ${minUiPx}px；按钮、标签、表格与元信息都应可读`)
    }
    // 3) 全大写长段落
    if (!item.isHeading && item.textTransform === 'uppercase' && item.textChars >= 80) {
      push('all-caps-body', 'warning', item, `全大写长段落（${item.textChars} 字符）：大写会让词形失去辨识度，只用于短标签与标题`)
    }
    // 4) 字距过宽
    const tracking = item.fontSize > 0 ? item.letterSpacing / item.fontSize : 0
    if (tracking > 0.05 && item.textChars > 20 && !item.isCjk && item.textTransform !== 'lowercase') {
      const capsLabel = item.textTransform === 'uppercase' && item.lines <= 1
      if (!capsLabel) push('wide-tracking', 'warning', item, `字距 ${tracking.toFixed(3)}em 超过 0.05em：宽字距只留给短的大写标签`)
    }
    // 5) 行高过紧
    const leading = item.fontSize > 0 ? item.lineHeight / item.fontSize : 0
    if (
      leading > 0 &&
      leading < 1.3 &&
      item.textChars > 50 &&
      !item.isHeading &&
      item.fontSize < 24 &&
      item.lines > 1
    ) {
      const lead = item.fontSize >= 20 && item.lines <= 3 && leading >= 1.15
      const boldTitle = item.fontWeight >= 600 && item.lines <= 2
      const capsLabel = item.textTransform === 'uppercase' && item.lines <= 3
      if (!lead && !boldTitle && !capsLabel) {
        push('tight-leading', 'warning', item, `行高 ${leading.toFixed(2)} 低于 1.3：多行正文需要 1.5–1.7`)
      }
    }
    // 6) 行宽过长
    if (item.lines >= 2 && item.charsPerLine > lineMax + 5 && !item.isCjk) {
      push('line-length', 'warning', item, `单行约 ${item.charsPerLine} 字符，超过 ${lineMax}：给文本容器加 max-width（65–75ch）`)
    }
    // 7) 标题节奏：上方间距应大于下方
    if (
      item.headingLevel >= 2 &&
      item.headingLevel <= 4 &&
      item.textChars >= 3 &&
      item.gapBelow >= 6 &&
      item.gapBelow <= 160 &&
      item.gapAbove >= 0 &&
      !item.inSmallCard &&
      !item.inBlockquote &&
      !item.displayInline
    ) {
      const crowded = item.gapAbove < item.gapBelow * 0.75 && item.gapBelow - item.gapAbove >= 12
      if (crowded) {
        push('heading-rhythm', 'warning', item, `标题上方 ${item.gapAbove}px、下方 ${item.gapBelow}px：标题属于它下面的内容，上方间距应更大`)
      }
    }
  }

  // 8) 字号层级扁平：按角色取主导字号，相邻步进需 ≥1.25
  const hierarchy = analyzeHierarchy(raw.items)
  if (hierarchy.kind === 'flat') {
    issues.push({
      rule: 'flat-type-hierarchy',
      severity: hierarchy.advisory ? 'advisory' : 'warning',
      selector: hierarchy.selector,
      snippet: hierarchy.snippet,
      message: `标题与正文的字号步进只有 ${hierarchy.ratio.toFixed(2)}×（要求 ≥1.25×）：层级靠字号拉开，或明确用字重承担区分`,
    })
  } else if (hierarchy.kind === 'skipped') {
    skipped.push(hierarchy.reason)
  }

  const counts: Record<QualitySeverity, number> = { warning: 0, advisory: 0 }
  const byRule: Record<string, number> = {}
  for (const issue of issues) {
    counts[issue.severity]++
    byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1
  }
  return { elements: raw.elements, multiLine: raw.multiLine, issues, counts, byRule, skipped: [...new Set(skipped)] }
}

type HierarchyResult =
  | { kind: 'ok' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'flat'; ratio: number; advisory: boolean; selector: string; snippet: string }

/**
 * 字号层级：取「正文」与「最大标题」两个主导字号，步进 <1.25 判扁平。
 * 角色不足或数据不可信时返回 skipped 并写明原因（不猜）。
 */
export function analyzeHierarchy(items: RawQualityItem[]): HierarchyResult {
  const body = items.filter((i) => !i.isHeading && i.textChars >= 20 && i.lines > 0)
  const headings = items.filter((i) => i.isHeading && i.textChars >= 2)
  if (body.length < 2) return { kind: 'skipped', reason: '可测的正文字块不足 2 个，字号层级未判定' }
  if (headings.length < 1) return { kind: 'skipped', reason: '页面没有标题，字号层级未判定' }

  const dominant = (list: RawQualityItem[]): { size: number; item: RawQualityItem } | null => {
    const tally = new Map<number, { count: number; item: RawQualityItem }>()
    for (const item of list) {
      const size = Math.round(item.fontSize)
      const entry = tally.get(size)
      if (entry) entry.count++
      else tally.set(size, { count: 1, item })
    }
    const sorted = [...tally.entries()].sort((a, b) => b[1].count - a[1].count || b[0] - a[0])
    const top = sorted[0]
    if (!top) return null
    // 并列第一：无法确定主导字号 → 弃权
    if (sorted[1] && sorted[1][1].count === top[1].count) return null
    return { size: top[0], item: top[1].item }
  }

  const bodyRole = dominant(body)
  const headingRole = dominant(headings)
  if (!bodyRole || !headingRole) {
    return { kind: 'skipped', reason: '正文或标题的主导字号并列，无法确定层级，未判定' }
  }
  if (headingRole.size < bodyRole.size) {
    return { kind: 'skipped', reason: '标题字号小于正文，页面无有效层级，未判定' }
  }
  const ratio = bodyRole.size > 0 ? headingRole.size / bodyRole.size : 0
  if (ratio >= 1.25) return { kind: 'ok' }

  // 字重能承担区分时降级为 advisory（≥200 的字重差占多数）
  const headingWeight = headingRole.item.fontWeight
  const bodyWeight = bodyRole.item.fontWeight
  const weightSeparates = headingWeight - bodyWeight >= 200
  const weightShare =
    headings.filter((h) => h.fontWeight - bodyWeight >= 200).length / Math.max(1, headings.length)
  return {
    kind: 'flat',
    ratio,
    advisory: weightSeparates && weightShare >= 0.8,
    selector: headingRole.item.selector,
    snippet: headingRole.item.snippet,
  }
}

/** 在真实页面上跑工艺审计（puppeteer 注入，绕过 iframe CSP）。 */
export async function auditQuality(browser: Browser, url: string, options: QualityOptions = {}): Promise<QualityReport> {
  const page: Page = await browser.newPage()
  try {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('body', { timeout: 10000 })
    await new Promise((r) => setTimeout(r, 200))
    const raw = (await page.evaluate(COLLECT_SCRIPT)) as RawQualityScan
    return analyzeQuality(raw, options)
  } finally {
    await page.close().catch(() => {})
  }
}

/** 人类可读报告。 */
export function formatQualityReport(report: QualityReport, label: string): string {
  const lines = [
    `渲染工艺审计：${label}`,
    `扫描 ${report.elements} 个文字元素（其中 ${report.multiLine} 个多行） · warning ${report.counts.warning} / advisory ${report.counts.advisory}`,
  ]
  if (report.issues.length === 0) lines.push('未发现工艺问题。')
  for (const issue of report.issues) {
    lines.push(`- [${issue.severity}] ${issue.rule} · ${issue.message}`)
    lines.push(`    选择器：${issue.selector}`)
    lines.push(`    片段：${issue.snippet.replace(/\s+/g, ' ').slice(0, 120)}`)
  }
  if (report.skipped.length) {
    lines.push(`跳过 ${report.skipped.length} 项：${report.skipped.slice(0, 6).join('；')}${report.skipped.length > 6 ? ' …' : ''}`)
  }
  return lines.join('\n')
}
