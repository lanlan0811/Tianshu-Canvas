/**
 * 状态完整性审计（需要浏览器）：空 / 加载 / 大数据集 / 并发 / 权限。
 *
 * 与 quality 的分工：quality 判排版工艺，这里判**页面是否只画了「有数据的理想态」**。
 * 设计取舍沿用 a11y/quality 的约定：页面上下文只采集证据，判定在 Node 侧（纯函数）；
 * 静态渲染证明不了的（权限三态、真实并发竞态）写进 skipped 并说明需人工核实，绝不假装通过。
 *
 * 判据来源：impeccable skill/reference/harden.md 的 Edge Cases，
 * 空状态五型取自 onboard.md / clarify.md（已在 skills/reference/ux-rubric.md 落为文案要求）。
 */
import type { Browser, Page } from 'puppeteer-core'

export type StatesSeverity = 'warning' | 'advisory'

export interface StatesIssue {
  rule: string
  severity: StatesSeverity
  selector: string
  snippet: string
  message: string
}

export interface StatesReport {
  /** 参与判定的容器数（列表/表格/表单等）。 */
  containers: number
  /** 判定涉及的数据行总数（用于判断页面是否为空扫描）。 */
  rows: number
  issues: StatesIssue[]
  counts: Record<StatesSeverity, number>
  byRule: Record<string, number>
  /** 不能静态判定、必须人工核实的项与原因。 */
  skipped: string[]
}

export interface StatesOptions {
  /** 大数据集阈值（渲染行数），默认 1000。 */
  largeRows?: number
  /** 忽略的选择器。 */
  ignore?: string[]
}

interface RawContainer {
  /** list | table | form */
  kind: 'list' | 'table' | 'form'
  selector: string
  snippet: string
  /** 列表项/表格数据行数；表单为 0。 */
  items: number
  /** 容器内是否有空状态提示（.ts-empty / data-ts-empty / 含「暂无」等文案）。 */
  emptyHint: boolean
  /** 空状态提示里是否有下一步动作（链接/按钮）。 */
  emptyHasAction: boolean
  /** 是否有分页控件或固定高度滚动容器。 */
  paged: boolean
  /** 是否有提交按钮（form 用）。 */
  hasSubmit: boolean
  /** 页面是否有防重复提交痕迹（aria-busy / data-ts-form / 脚本里的 disabled）。 */
  submitGuarded: boolean
}

interface RawBusyRegion {
  selector: string
  snippet: string
  /** 是否在 aria-live / role=status 区域内。 */
  announced: boolean
  /** 是否有可访问的加载文案（aria-label / 文本）。 */
  labelled: boolean
}

interface RawStatesScan {
  containers: RawContainer[]
  busy: RawBusyRegion[]
  rows: number
  skipped: string[]
  hasScript: boolean
}

/** 页面上下文采集：只返回证据，判定在 Node 侧。 */
const COLLECT_SCRIPT = `(() => {
  const out = { containers: [], busy: [], rows: 0, skipped: [], hasScript: false }
  const css = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim()
  const visible = (el) => {
    let n = el
    while (n && n.nodeType === 1) {
      const s = getComputedStyle(n)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
      n = n.parentElement
    }
    return true
  }
  const path = (e) => {
    const parts = []
    let n = e
    for (let i = 0; n && n.nodeType === 1 && i < 5; i++) {
      let s = n.tagName.toLowerCase()
      if (n.id) s += '#' + String(n.id).slice(0, 70)
      else if (n.classList && n.classList.length) s += '.' + Array.from(n.classList).slice(0, 2).join('.')
      parts.unshift(s)
      n = n.parentElement
    }
    return parts.join(' > ')
  }
  const snippet = (e) => (e.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 160)
  const EMPTY_TEXT = /暂无|没有|没有任何|还没有|空空|无结果|未找到|无数据|nothing|no results|no items|empty/i
  const hintIn = (root) => {
    const explicit = root.querySelector('.ts-empty, [data-ts-empty]') || root.closest('.ts-empty, [data-ts-empty]')
    if (explicit) return explicit
    for (const el of root.querySelectorAll('p, span, div, td, li')) {
      if (el.children.length) continue
      const text = (el.textContent || '').trim()
      if (text && text.length <= 120 && EMPTY_TEXT.test(text)) return el
    }
    return null
  }
  const pagedIn = (root) => {
    if (root.closest('[data-ts-pagination]')) return true
    if (document.querySelector('[data-ts-pagination], nav[aria-label*="页"], nav[aria-label*="page" i], [data-ts-page]')) return true
    const scroller = root.closest('[style*="overflow"], .ts-scroll')
    if (scroller) {
      const s = getComputedStyle(scroller)
      if (['auto', 'scroll'].includes(s.overflowY) && scroller.scrollHeight > scroller.clientHeight + 2) return true
    }
    return false
  }
  out.hasScript = !!document.querySelector('script:not([src])')

  /* 列表：ul/ol/[role=list]，只取可见且至少有 1 个 li 或无 li 的显式列表容器。 */
  for (const el of document.querySelectorAll('ul, ol, [role="list"]')) {
    if (!visible(el)) continue
    const items = el.matches('ul, ol') ? el.querySelectorAll(':scope > li').length : el.querySelectorAll('[role="listitem"]').length
    const hint = hintIn(el)
    const parent = el.parentElement
    const hintNearby = hint || (parent ? hintIn(parent) : null)
    out.rows += items
    out.containers.push({
      kind: 'list',
      selector: path(el),
      snippet: snippet(el),
      items,
      emptyHint: !!hintNearby,
      emptyHasAction: !!(hintNearby && hintNearby.querySelector('a[href], button, [role=button]')),
      paged: pagedIn(el),
      hasSubmit: false,
      submitGuarded: false,
    })
  }

  /* 表格：table，只数 tbody 的可见数据行。 */
  for (const el of document.querySelectorAll('table')) {
    if (!visible(el)) continue
    const body = el.tBodies && el.tBodies[0]
    const items = body ? Array.from(body.rows).filter(visible).length : 0
    const hint = hintIn(el.closest('section, div') || el)
    out.rows += items
    out.containers.push({
      kind: 'table',
      selector: path(el),
      snippet: snippet(el),
      items,
      emptyHint: !!hint,
      emptyHasAction: !!(hint && hint.querySelector('a[href], button, [role=button]')),
      paged: pagedIn(el),
      hasSubmit: false,
      submitGuarded: false,
    })
  }

  /* 表单：只关心有没有提交按钮，以及**该表单自己**有没有防重复提交痕迹。
     判定必须限定在表单内，页面别处的 aria-busy（例如骨架屏）不算这个表单的防护。 */
  const pageDisabledInScript = Array.from(document.querySelectorAll('script:not([src])')).some((s) => /disabled/.test(s.textContent || ''))
  for (const el of document.querySelectorAll('form')) {
    if (!visible(el)) continue
    const submit = el.querySelector('button[type="submit"], input[type="submit"], button:not([type])')
    if (!submit) continue
    const guarded = el.hasAttribute('data-ts-form') ||
      !!el.querySelector('[aria-busy="true"]') ||
      submit.hasAttribute('aria-busy') ||
      submit.hasAttribute('aria-disabled') ||
      pageDisabledInScript
    out.containers.push({
      kind: 'form',
      selector: path(el),
      snippet: snippet(el),
      items: 0,
      emptyHint: false,
      emptyHasAction: false,
      paged: false,
      hasSubmit: true,
      submitGuarded: guarded,
    })
  }

  /* 加载态：aria-busy 元素是否被播报。 */
  for (const el of document.querySelectorAll('[aria-busy="true"]')) {
    const live = el.closest('[aria-live], [role="status"], [role="alert"]')
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim()
    out.busy.push({
      selector: path(el),
      snippet: snippet(el),
      announced: !!live,
      labelled: text.length > 0,
    })
  }

  out.skipped.push('权限三态（无权限 / 只读 / 编辑受限）无法从静态渲染判定，需人工核实')
  out.skipped.push('并发竞态（双提交、乐观更新回滚）无法从静态渲染判定，需人工核实')
  if (!out.hasScript) out.skipped.push('页面没有内联脚本，并发/防重复提交只能按标记判断')
  return out
})()`

/** 纯判定：把采集证据转成问题列表（不碰浏览器，便于单测）。 */
export function analyzeStates(raw: RawStatesScan, options: StatesOptions = {}): StatesReport {
  const largeRows = options.largeRows ?? 1000
  const ignore = (options.ignore ?? []).map((s) => s.trim()).filter(Boolean)
  const issues: StatesIssue[] = []
  const skipped = [...(raw.skipped ?? [])]
  const push = (rule: string, severity: StatesSeverity, selector: string, snippet: string, message: string): void => {
    if (ignore.some((sel) => selector.includes(sel))) return
    issues.push({ rule, severity, selector, snippet, message })
  }

  for (const container of raw.containers) {
    if (container.kind === 'form') {
      if (container.hasSubmit && !container.submitGuarded) {
        push('submit-unguarded', 'advisory', container.selector, container.snippet,
          '表单有提交按钮，但页面没有 aria-busy、data-ts-form 或脚本里的 disabled——疑似没有防重复提交')
      }
      continue
    }
    /* 空态：没有条目时必须给提示与下一步。 */
    if (container.items === 0) {
      if (!container.emptyHint) {
        push('empty-list-no-hint', 'warning', container.selector, container.snippet,
          '列表/表格没有数据，也没有空状态提示；用户会以为页面坏了（用 .ts-empty 并写清这里会出现什么）')
      } else if (!container.emptyHasAction) {
        push('empty-hint-no-action', 'advisory', container.selector, container.snippet,
          '空状态提示里没有下一步动作；无结果的空态至少要给一条出路（清筛选 / 新建 / 返回）')
      }
    }
    /* 大数据集：渲染行数超阈值且没有分页/滚动容器。 */
    if (container.items >= largeRows && !container.paged) {
      push('large-dataset-unpaged', 'warning', container.selector, container.snippet,
        `渲染了 ${container.items} 行且没有分页或固定高度滚动容器；1000+ 行需要分页或虚拟滚动`)
    }
  }

  for (const region of raw.busy) {
    if (!region.announced && !region.labelled) {
      push('loading-unannounced', 'advisory', region.selector, region.snippet,
        '元素标记了 aria-busy="true"，但既不在 aria-live/role=status 区域内，也没有加载文案；读屏用户不知道正在加载')
    }
  }

  const counts: Record<StatesSeverity, number> = { warning: 0, advisory: 0 }
  const byRule: Record<string, number> = {}
  for (const issue of issues) {
    counts[issue.severity]++
    byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1
  }
  return {
    containers: raw.containers.length,
    rows: raw.rows,
    issues,
    counts,
    byRule,
    skipped: [...new Set(skipped)],
  }
}

/** 在真实页面上跑状态审计（puppeteer 注入，绕过 iframe CSP）。 */
export async function auditStates(browser: Browser, url: string, options: StatesOptions = {}): Promise<StatesReport> {
  const page: Page = await browser.newPage()
  try {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('body', { timeout: 10000 })
    await new Promise((r) => setTimeout(r, 200))
    const raw = (await page.evaluate(COLLECT_SCRIPT)) as RawStatesScan
    return analyzeStates(raw, options)
  } finally {
    await page.close().catch(() => {})
  }
}

/** 人类可读报告。 */
export function formatStatesReport(report: StatesReport, label: string): string {
  const lines = [
    `状态完整性审计：${label}`,
    `扫描 ${report.containers} 个容器 / ${report.rows} 行数据 · warning ${report.counts.warning} / advisory ${report.counts.advisory}`,
  ]
  if (report.issues.length === 0) lines.push('未发现状态完整性问题。')
  for (const issue of report.issues) {
    lines.push(`- [${issue.severity}] ${issue.rule} · ${issue.message}`)
    lines.push(`    选择器：${issue.selector}`)
    lines.push(`    片段：${issue.snippet.replace(/\s+/g, ' ').slice(0, 120)}`)
  }
  if (report.skipped.length) {
    lines.push(`未判定 ${report.skipped.length} 项（不得当成通过）：${report.skipped.join('；')}`)
  }
  return lines.join('\n')
}
