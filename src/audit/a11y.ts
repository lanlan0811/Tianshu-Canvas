/**
 * 自研可访问性规则集（零依赖）。
 *
 * 设计取舍：
 *  - 规则在页面上下文执行，只输出**可复核的证据**（选择器 + 片段 + 数值），不做修复；
 *  - 误报一律降级为 warning 并写明原因（例如背景为图片/渐变时不做对比度判定）；
 *  - 每条规则有稳定 id，便于团队按 PT 卡规则、也便于基线 diff。
 *
 * 覆盖（WCAG 2.2 AA 的核心可测项）：
 *  img-alt、button-name、link-name、label、tabindex-positive、heading-h1、
 *  heading-order、html-lang、contrast、focus-visible、target-size、aria-hidden-focus。
 */

import type { Browser, Page } from 'puppeteer-core'

export type Severity = 'error' | 'warning' | 'info'

export interface A11yIssue {
  rule: string
  severity: Severity
  selector: string
  snippet: string
  message: string
}

export interface A11yReport {
  /** 扫描的元素数（交互/标题/图片等主要元素，用于判断页面是否为空扫描）。 */
  elements: number
  /** 额外采集的普通文字元素数（用于对比度判定）。 */
  textElements: number
  issues: A11yIssue[]
  counts: Record<Severity, number>
  /** 按规则计数，便于基线 diff。 */
  byRule: Record<string, number>
  /** 跳过的检查（例如背景是渐变）。 */
  skipped: string[]
}

export interface A11yOptions {
  /** 正文对比度下限，默认 4.5。 */
  minContrast?: number
  /** 目标尺寸下限（CSS px），默认 24（WCAG 2.2 AA）。 */
  minTargetSize?: number
  /** 忽略的选择器（逗号分隔的 CSS）。 */
  ignore?: string[]
  /** 视口；默认桌面 1440×900。移动轮次用 375×812。 */
  viewport?: { width: number; height: number }
  /** 只跑这些规则（其余跳过）；省略表示全部。 */
  only?: string[]
  /** 是否套用 24px 圆间距豁免；桌面为 true，移动 44px 设计地板为 false。 */
  spacingExemption?: boolean
  /** 报告里的视口标签，用于区分两轮结果。 */
  viewportLabel?: string
}

/** 在页面上下文执行：返回原始证据，判定逻辑放在 Node 侧（易测）。 */
const COLLECT_SCRIPT = `(() => {
  const out = { elements: 0, textElements: 0, items: [], skipped: [] }
  const css = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim()
  const isHidden = (el) => {
    let n = el
    while (n && n.nodeType === 1) {
      const s = getComputedStyle(n)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return true
      n = n.parentElement
    }
    return false
  }
  const name = (el) => {
    const aria = el.getAttribute('aria-label')
    if (aria && aria.trim()) return aria.trim()
    const labelledby = el.getAttribute('aria-labelledby')
    if (labelledby) {
      const text = labelledby.split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.textContent || '').join(' ').trim()
      if (text) return text
    }
    const imgAlt = el.tagName === 'IMG' ? (el.getAttribute('alt') || '').trim() : ''
    if (imgAlt) return imgAlt
    const title = el.getAttribute('title')
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim()
    return text || (title || '').trim()
  }
  const path = (el) => {
    const parts = []
    let n = el
    while (n && n.nodeType === 1 && parts.length < 5) {
      let s = n.tagName.toLowerCase()
      if (n.id) { s += '#' + n.id; parts.unshift(s); break }
      const cls = (n.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0, 2).join('.')
      if (cls) s += '.' + cls
      const parent = n.parentElement
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === n.tagName)
        if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(n) + 1) + ')'
      }
      parts.unshift(s)
      n = parent
    }
    return parts.join(' > ')
  }
  const bg = (el) => {
    let n = el
    while (n && n.nodeType === 1) {
      const s = getComputedStyle(n)
      if (s.backgroundImage && s.backgroundImage !== 'none') return { kind: 'image', color: '' }
      const c = s.backgroundColor
      if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return { kind: 'color', color: c }
      if (Number(s.opacity) > 0 && Number(s.opacity) < 1) return { kind: 'opacity', color: '' }
      n = n.parentElement
    }
    return { kind: 'color', color: 'rgb(255, 255, 255)' }
  }
  const selectors = 'a[href], button, input, select, textarea, [tabindex], [role=button], [role=link], [role=checkbox], [role=tab], h1, h2, h3, h4, h5, h6, img'
  const all = Array.from(document.querySelectorAll(selectors))
  const seen = new Set(all)
  out.elements = all.length
  // 正文与普通文字元素（p/span/div/li/td…）不在上面的选择器内，单独采集一次，
  // 否则 1.6:1 的正文对比度永远不会被判定。
  const textLimit = 800
  const candidates = Array.from(document.body ? document.body.querySelectorAll('*') : [])
  for (const el of candidates) {
    if (out.textElements >= textLimit) {
      out.skipped.push('文字元素超过 ' + textLimit + ' 个，其余未做对比度判定')
      break
    }
    if (seen.has(el)) continue
    let direct = ''
    for (const node of el.childNodes) {
      if (node.nodeType === 3) direct += node.nodeValue || ''
    }
    if (!direct.trim()) continue
    if (isHidden(el)) continue
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path') continue
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    out.textElements++
    out.items.push({
      textOnly: true,
      tag,
      selector: path(el),
      snippet: (el.outerHTML || '').slice(0, 160),
      name: direct.replace(/\\s+/g, ' ').trim().slice(0, 120),
      ariaLabel: el.getAttribute('aria-label') || '',
      ariaHidden: el.getAttribute('aria-hidden'),
      tabindex: el.getAttribute('tabindex'),
      role: el.getAttribute('role') || '',
      type: el.getAttribute('type') || '',
      alt: el.getAttribute('alt'),
      id: el.id || '',
      htmlFor: el.getAttribute('for') || '',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      color: css(el, 'color'),
      fontSize: parseFloat(css(el, 'font-size')) || 16,
      fontWeight: Number(css(el, 'font-weight')) || 400,
      background: bg(el),
      outlineStyle: css(el, 'outline-style'),
      outlineWidth: css(el, 'outline-width'),
      boxShadow: css(el, 'box-shadow'),
      level: 0,
      disabled: false,
      contentEditable: el.getAttribute('contenteditable'),
      hasLabel: true,
    })
  }
  for (const el of all) {
    if (isHidden(el)) continue
    const tag = el.tagName.toLowerCase()
    const rect = el.getBoundingClientRect()
    const base = {
      tag,
      selector: path(el),
      snippet: (el.outerHTML || '').slice(0, 160),
      name: name(el),
      ariaLabel: el.getAttribute('aria-label') || '',
      ariaHidden: el.getAttribute('aria-hidden'),
      tabindex: el.getAttribute('tabindex'),
      role: el.getAttribute('role') || '',
      type: el.getAttribute('type') || '',
      alt: el.getAttribute('alt'),
      id: el.id || '',
      htmlFor: el.getAttribute('for') || '',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      color: css(el, 'color'),
      fontSize: parseFloat(css(el, 'font-size')) || 16,
      fontWeight: Number(css(el, 'font-weight')) || 400,
      background: bg(el),
      outlineStyle: css(el, 'outline-style'),
      outlineWidth: css(el, 'outline-width'),
      boxShadow: css(el, 'box-shadow'),
      level: /^h[1-6]$/.test(tag) ? Number(tag[1]) : 0,
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
      /* WCAG 2.5.8 的 inline 例外：句子/段落里的链接不算独立点击目标。 */
      inlineText: (() => {
        const parent = el.parentElement
        if (!parent) return false
        const display = getComputedStyle(parent).display
        return ['p', 'li', 'td', 'dd', 'blockquote', 'figcaption', 'span', 'label'].includes(parent.tagName.toLowerCase()) &&
          display !== 'flex' && display !== 'grid' && display !== 'inline-flex' && display !== 'inline-grid'
      })(),
      contentEditable: el.getAttribute('contenteditable'),
      hasLabel: (() => {
        if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return true }
        return Boolean(el.closest('label')) || Boolean(el.getAttribute('aria-label')) || Boolean(el.getAttribute('aria-labelledby'))
      })(),
    }
    out.items.push(base)
  }
  const htmlLang = document.documentElement.getAttribute('lang') || ''
  return { ...out, htmlLang }
})()`

interface RawItem {
  /** 仅采集来判定对比度的普通文字元素；不参与可访问名/焦点类规则。 */
  textOnly?: boolean
  tag: string
  selector: string
  snippet: string
  name: string
  ariaLabel: string
  ariaHidden: string | null
  tabindex: string | null
  role: string
  type: string
  alt: string | null
  id: string
  htmlFor: string
  /** 包围盒的视口坐标；间距豁免要靠它算 24px 圆是否相交。 */
  rect: { x: number; y: number; width: number; height: number }
  /** 祖先是否为行内文字容器（p/li/td 等）——WCAG 2.5.8 的 inline 例外。 */
  inlineText?: boolean
  color: string
  fontSize: number
  fontWeight: number
  background: { kind: 'color' | 'image' | 'opacity'; color: string }
  outlineStyle: string
  outlineWidth: string
  boxShadow: string
  level: number
  disabled: boolean
  contentEditable: string | null
  hasLabel: boolean
}

interface RawScan {
  elements: number
  textElements?: number
  items: RawItem[]
  skipped: string[]
  htmlLang: string
}

/** 解析 `rgb()` / `rgba()` 为 RGB 三元组。 */
export function parseRgb(value: string): [number, number, number] | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 对比度（传入两个 RGB 三元组）；无法解析返回 0。 */
export function contrastRgb(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** 判断两个包围盒是否相交（含接触）。 */
function boxesIntersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** 圆（中心 + 半径）与包围盒是否相交。 */
function circleIntersectsBox(cx: number, cy: number, radius: number, box: { x: number; y: number; width: number; height: number }): boolean {
  const nearestX = Math.max(box.x, Math.min(cx, box.x + box.width))
  const nearestY = Math.max(box.y, Math.min(cy, box.y + box.height))
  const dx = cx - nearestX
  const dy = cy - nearestY
  return dx * dx + dy * dy <= radius * radius
}

/** 两圆是否相交（含相切）。 */
function circlesIntersect(ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy <= (radius * 2) * (radius * 2)
}

/**
 * WCAG 2.5.8 间距豁免：以目标包围盒中心画直径 `minTarget` 的圆，
 * 圆不与任何其他目标的包围盒相交、也不与其他欠尺寸目标的圆相交，即通过。
 * 自身不计；欠尺寸目标之间要互相排斥（密集图标栏正因如此不通过）。
 */
function passesSpacingExemption(item: RawItem, targets: RawItem[], minTarget: number): boolean {
  const radius = minTarget / 2
  const cx = item.rect.x + item.rect.width / 2
  const cy = item.rect.y + item.rect.height / 2
  for (const other of targets) {
    if (other === item) continue
    if (circleIntersectsBox(cx, cy, radius, other.rect)) return false
    const otherUndersized = other.rect.width < minTarget || other.rect.height < minTarget
    if (otherUndersized) {
      const ox = other.rect.x + other.rect.width / 2
      const oy = other.rect.y + other.rect.height / 2
      if (circlesIntersect(cx, cy, ox, oy, radius)) return false
    }
  }
  return true
}

/** 纯判定：把页面扫描结果转成问题列表（不碰浏览器，便于单测）。 */
export function analyze(raw: RawScan, options: A11yOptions = {}): A11yReport {
  const minContrast = options.minContrast ?? 4.5
  const minTarget = options.minTargetSize ?? 24
  const ignore = (options.ignore ?? []).map((s) => s.trim()).filter(Boolean)
  const only = options.only ? new Set(options.only) : null
  /* 间距豁免只对 WCAG 24px 档有意义；44px 设计地板是底线，不套用例外。 */
  const spacingExemption = options.spacingExemption ?? minTarget <= 24
  const issues: A11yIssue[] = []
  const skipped: string[] = [...(raw.skipped ?? [])]
  let lastLevel = 0

  const push = (rule: string, severity: Severity, item: RawItem, message: string): void => {
    if (only && !only.has(rule)) return
    if (ignore.some((sel) => item.selector.includes(sel))) return
    issues.push({ rule, severity, selector: item.selector, snippet: item.snippet, message })
  }

  /* 先收集所有参与点击目标判定的项，间距豁免需要互相比较。 */
  const targetItems = raw.items.filter((item) =>
    !item.textOnly &&
    ['a', 'button', 'input', 'select', 'textarea'].includes(item.tag) &&
    !item.disabled &&
    (item.rect.width > 0 || item.rect.height > 0),
  )

  for (const item of raw.items) {
    const focusable = ['a', 'button', 'input', 'select', 'textarea'].includes(item.tag) || item.tabindex !== null || /^(button|link|checkbox|tab)$/.test(item.role)
    // textOnly 条目只用于对比度，不参与可访问名、焦点、标题、点击目标等规则。
    if (!item.textOnly) {
      if (focusable && item.ariaHidden === 'true') {
        push('aria-hidden-focus', 'error', item, '可聚焦元素被 aria-hidden="true" 隐藏，屏幕阅读器用户无法感知')
      }

      if (item.tag === 'img' && item.alt === null) {
        push('img-alt', 'error', item, '图片缺少 alt（装饰性图片请写 alt=""）')
      }

      if ((item.tag === 'button' || item.role === 'button') && !item.disabled && !item.name && !item.contentEditable) {
        push('button-name', 'error', item, '按钮没有可访问名称（补文本、aria-label 或 aria-labelledby）')
      }

      if (item.tag === 'a' && !item.name && !item.ariaLabel) {
        push('link-name', 'error', item, '链接没有可访问名称')
      }

      if (['input', 'select', 'textarea'].includes(item.tag) && !['hidden', 'submit', 'button', 'reset', 'image'].includes(item.type)) {
        if (!item.hasLabel && !item.name && !item.ariaLabel) {
          push('label', 'error', item, '表单控件没有关联标签（label / aria-label / aria-labelledby）')
        }
      }

      if (item.tabindex !== null && Number(item.tabindex) > 0) {
        push('tabindex-positive', 'warning', item, `tabindex="${item.tabindex}" 会打乱键盘顺序，建议改为 0 并调整 DOM 顺序`)
      }

      if (item.level > 0) {
        if (item.level === 1 && raw.items.filter((i) => i.level === 1).length > 1 && item === raw.items.find((i) => i.level === 1)) {
          push('heading-h1', 'warning', item, '页面有多个 h1，建议只保留一个')
        }
        if (lastLevel > 0 && item.level > lastLevel + 1) {
          push('heading-order', 'warning', item, `标题层级跳跃：h${lastLevel} → h${item.level}`)
        }
        lastLevel = item.level
      }

      const targetable = ['a', 'button', 'input', 'select', 'textarea'].includes(item.tag) && !item.disabled
      if (targetable && (item.rect.width > 0 || item.rect.height > 0)) {
        const undersized = item.rect.width < minTarget || item.rect.height < minTarget
        if (undersized) {
          /* 行内文字里的链接属 WCAG 2.5.8 例外，不单列。 */
          if (item.inlineText) {
            skipped.push(`${item.selector}: 行内文字中的目标，按 WCAG 2.5.8 inline 例外跳过尺寸判定`)
          } else if (spacingExemption && passesSpacingExemption(item, targetItems, minTarget)) {
            /* 间距豁免通过：24px 圆不与其他目标重叠，读屏/触控仍可分辨。 */
          } else {
            const label = options.viewportLabel ? `（${options.viewportLabel}）` : ''
            push('target-size', 'warning', item, `点击目标 ${Math.round(item.rect.width)}×${Math.round(item.rect.height)}px 小于 ${minTarget}px${label}`)
          }
        }
      }

      if (targetable) {
        const hasFocusStyle = (item.outlineStyle !== 'none' && parseFloat(item.outlineWidth) > 0) || (item.boxShadow && item.boxShadow !== 'none')
        const skip = item.ariaLabel || item.role === 'tab'
        if (!hasFocusStyle && !skip) {
          push('focus-visible', 'info', item, '未检测到可见焦点样式（outline 或 box-shadow）；如由 :focus-visible 规则提供可忽略')
        }
      }
    }

    if (item.textOnly || item.name || item.tag === 'img') {
      if (item.background.kind !== 'color') {
        skipped.push(`${item.selector}: 背景为${item.background.kind === 'image' ? '图片/渐变' : '半透明层'}，跳过对比度判定`)
        continue
      }
      const fg = parseRgb(item.color)
      const bgc = parseRgb(item.background.color)
      if (!fg || !bgc) continue
      const large = item.fontSize >= 24 || (item.fontSize >= 18.66 && item.fontWeight >= 700)
      const need = large ? 3 : minContrast
      const ratio = contrastRgb(fg, bgc)
      if (ratio < need) {
        push('contrast', 'error', item, `对比度 ${ratio.toFixed(2)} 低于 ${need}（文字 ${item.fontSize}px / ${item.fontWeight}）`)
      }
    }
  }

  if (!raw.htmlLang) {
    if (!only || only.has('html-lang')) issues.push({ rule: 'html-lang', severity: 'warning', selector: 'html', snippet: '<html>', message: '根元素缺少 lang 属性' })
  }
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  const byRule: Record<string, number> = {}
  for (const issue of issues) {
    counts[issue.severity]++
    byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1
  }
  return { elements: raw.elements, textElements: raw.textElements ?? 0, issues, counts, byRule, skipped: [...new Set(skipped)] }
}

/** 在真实页面上跑审计（puppeteer 注入，绕过 iframe CSP）。 */
export async function auditPage(browser: Browser, url: string, options: A11yOptions = {}): Promise<A11yReport> {
  const page: Page = await browser.newPage()
  try {
    const viewport = options.viewport ?? { width: 1440, height: 900 }
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('body', { timeout: 10000 })
    await new Promise((r) => setTimeout(r, 200))
    const raw = (await page.evaluate(COLLECT_SCRIPT)) as RawScan
    return analyze(raw, options)
  } finally {
    await page.close().catch(() => {})
  }
}

/** 人类可读报告。 */
export function formatA11yReport(report: A11yReport, label: string): string {
  const lines = [
    `可访问性审计：${label}`,
    `扫描 ${report.elements} 个元素 + ${report.textElements} 个文字元素 · error ${report.counts.error} / warning ${report.counts.warning} / info ${report.counts.info}`,
  ]
  if (report.issues.length === 0) lines.push('未发现问题。')
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
