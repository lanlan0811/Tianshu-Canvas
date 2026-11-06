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
  /** 扫描的元素数（用于判断页面是否为空扫描）。 */
  elements: number
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
}

/** 在页面上下文执行：返回原始证据，判定逻辑放在 Node 侧（易测）。 */
const COLLECT_SCRIPT = `(() => {
  const out = { elements: 0, items: [], skipped: [] }
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
  out.elements = all.length
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
      rect: { width: rect.width, height: rect.height },
      color: css(el, 'color'),
      fontSize: parseFloat(css(el, 'font-size')) || 16,
      fontWeight: Number(css(el, 'font-weight')) || 400,
      background: bg(el),
      outlineStyle: css(el, 'outline-style'),
      outlineWidth: css(el, 'outline-width'),
      boxShadow: css(el, 'box-shadow'),
      level: /^h[1-6]$/.test(tag) ? Number(tag[1]) : 0,
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
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
  rect: { width: number; height: number }
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

/** 纯判定：把页面扫描结果转成问题列表（不碰浏览器，便于单测）。 */
export function analyze(raw: RawScan, options: A11yOptions = {}): A11yReport {
  const minContrast = options.minContrast ?? 4.5
  const minTarget = options.minTargetSize ?? 24
  const ignore = (options.ignore ?? []).map((s) => s.trim()).filter(Boolean)
  const issues: A11yIssue[] = []
  const skipped: string[] = [...(raw.skipped ?? [])]
  let lastLevel = 0

  const push = (rule: string, severity: Severity, item: RawItem, message: string): void => {
    if (ignore.some((sel) => item.selector.includes(sel))) return
    issues.push({ rule, severity, selector: item.selector, snippet: item.snippet, message })
  }

  for (const item of raw.items) {
    const focusable = ['a', 'button', 'input', 'select', 'textarea'].includes(item.tag) || item.tabindex !== null || /^(button|link|checkbox|tab)$/.test(item.role)
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
      if (item.rect.width < minTarget || item.rect.height < minTarget) {
        push('target-size', 'warning', item, `点击目标 ${Math.round(item.rect.width)}×${Math.round(item.rect.height)}px 小于 ${minTarget}px`)
      }
    }

    if (targetable) {
      const hasFocusStyle = (item.outlineStyle !== 'none' && parseFloat(item.outlineWidth) > 0) || (item.boxShadow && item.boxShadow !== 'none')
      const skip = item.ariaLabel || item.role === 'tab'
      if (!hasFocusStyle && !skip) {
        push('focus-visible', 'info', item, '未检测到可见焦点样式（outline 或 box-shadow）；如由 :focus-visible 规则提供可忽略')
      }
    }

    if (item.name || item.tag === 'img') {
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
    issues.push({ rule: 'html-lang', severity: 'warning', selector: 'html', snippet: '<html>', message: '根元素缺少 lang 属性' })
  }

  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  const byRule: Record<string, number> = {}
  for (const issue of issues) {
    counts[issue.severity]++
    byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1
  }
  return { elements: raw.elements, issues, counts, byRule, skipped: [...new Set(skipped)] }
}

/** 在真实页面上跑审计（puppeteer 注入，绕过 iframe CSP）。 */
export async function auditPage(browser: Browser, url: string, options: A11yOptions = {}): Promise<A11yReport> {
  const page: Page = await browser.newPage()
  try {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
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
    `扫描 ${report.elements} 个元素 · error ${report.counts.error} / warning ${report.counts.warning} / info ${report.counts.info}`,
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
