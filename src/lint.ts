/**
 * 风格一致性检查（只报告，不阻塞写入）。
 *
 * 服务端没有 DOM，因此用「等长掩码 + 正则」做轻量解析：把脚本、注释、注入块、
 * url(...) 与 data: 值替换成等长空白，保证报告里的行号与原文件一致。
 */
import { findBlockedResources } from './resources.js'
import { designStyleSummary, resolveDesignStyle, type DesignManifest } from './design.js'

export type LintRule = 'color' | 'font' | 'spacing' | 'radius' | 'icon' | 'component' | 'token' | 'resource'

export interface LintFinding {
  rule: LintRule
  line: number
  message: string
  snippet: string
}

export interface LintReport {
  styleId: string | null
  findings: LintFinding[]
  counts: Record<LintRule, number>
  truncated: boolean
  total: number
}

const MAX_FINDINGS = 40

const RULES: LintRule[] = ['color', 'font', 'spacing', 'radius', 'icon', 'component', 'token', 'resource']

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g
const FUNC_COLOR = /\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/gi
const VAR_REF = /var\(\s*(--ts-[A-Za-z0-9-]+)\s*\)/g
const CLASS_ATTR = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const DATA_ICON = /data-icon\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const EMPTY_SVG = /<svg\b([^>]*)>\s*<\/svg>/gi

const SPACING_PROPS = /^(?:padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(?:-(?:top|right|bottom|left))?$/
const RADIUS_PROP = /^border(?:-[a-z]+)*-radius$/
const FONT_PROP = /^font-family$/

function mask(text: string): string {
  return text.replace(/[^\n]/g, ' ')
}

function maskBalanced(text: string, pattern: RegExp): string {
  const out = [...text]
  pattern.lastIndex = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    for (let i = start; i < start + match[0].length; i++) if (out[i] !== '\n') out[i] = ' '
  }
  return out.join('')
}

/** 只掩码 CSS 里 url(...) 与 data: 值，保留其它文本。 */
function maskUrls(segment: string): string {
  let out = maskBalanced(segment, /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi)
  out = maskBalanced(out, /\bdata:[^"')\s]+/gi)
  return out
}

interface Segment {
  start: number
  text: string
}

/** 抽取所有 <style> 内容与 style="..." 属性；返回在原文中的起止。 */
function styleSegments(maskedHtml: string): Segment[] {
  const segments: Segment[] = []
  for (const match of maskedHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const inner = match[1] ?? ''
    const start = (match.index ?? 0) + match[0].indexOf(inner)
    segments.push({ start, text: inner })
  }
  for (const match of maskedHtml.matchAll(/style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const inner = match[1] ?? match[2] ?? ''
    const start = (match.index ?? 0) + match[0].indexOf(inner)
    segments.push({ start, text: inner })
  }
  return segments
}

/** 把 CSS 文本按 ; 切成声明，跳过括号与引号内部的 ;；遇到 { 进入规则体、遇到 } 结束当前声明。 */
function declarations(text: string): Array<{ prop: string; value: string; offset: number }> {
  const out: Array<{ prop: string; value: string; offset: number }> = []
  let depth = 0
  let quote = ''
  let start = 0
  const flush = (end: number): void => {
    const body = text.slice(start, end)
    const colon = body.indexOf(':')
    if (colon > 0) {
      const prop = body.slice(0, colon).trim().toLowerCase()
      const value = body.slice(colon + 1).replace(/\}+\s*$/, '').trim()
      if (prop && value) out.push({ prop, value, offset: start + colon + 1 })
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

function lineIndex(html: string): number[] {
  const index: number[] = [0]
  for (let i = 0; i < html.length; i++) if (html[i] === '\n') index.push(i + 1)
  return index
}

function lineOf(index: number[], offset: number): number {
  let lo = 0
  let hi = index.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (index[mid]! <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

function snippetAt(html: string, offset: number, length = 80): string {
  const start = Math.max(0, offset)
  const lineEnd = html.indexOf('\n', start)
  const end = lineEnd === -1 ? Math.min(html.length, start + length) : Math.min(lineEnd, start + length)
  return html.slice(start, end).trim()
}

function nearest<T extends number>(values: T[], target: number): T[] {
  const sorted = [...values].sort((a, b) => Math.abs(a - target) - Math.abs(b - target))
  return sorted.slice(0, 2)
}

export function nearestTokenHint(kind: 'space' | 'radius', value: number, manifest: DesignManifest): string {
  const pool = kind === 'space' ? manifest.spacing : manifest.radius
  const close = nearest(pool, value)
  return close.map((v) => `--ts-${kind === 'space' ? 'space' : 'radius'}-${keyFor(pool, v, kind)}`).join(' / ')
}

function keyFor(pool: number[], value: number, kind: 'space' | 'radius'): string {
  const names = kind === 'radius'
    ? { 0: 'none', 4: 'sm', 6: 'sm', 8: 'md', 10: 'md', 12: 'lg', 14: 'lg', 16: 'xl', 18: 'xl', 20: 'xl', 9999: 'full' }
    : {}
  return names[value as keyof typeof names] ?? String(value)
}

/**
 * 检查一段页面 HTML。
 * styleId 为 null 时只检查资源引用（自由发挥模式）。
 */
export function lintHtml(html: string, styleId: string | null): LintReport {
  const counts = Object.fromEntries(RULES.map((r) => [r, 0])) as Record<LintRule, number>
  const findings: LintFinding[] = []
  const index = lineIndex(html)

  const add = (rule: LintRule, offset: number, message: string): void => {
    counts[rule]++
    if (findings.length < MAX_FINDINGS) {
      findings.push({ rule, line: lineOf(index, offset), message, snippet: snippetAt(html, offset) })
    }
  }

  const blocked = findBlockedResources(html)
  if (blocked.length) {
    const first = blocked[0]!
    const at = Math.max(0, html.indexOf(first))
    add('resource', at, `将被画布 CSP 拦截：${blocked.slice(0, 3).join('、')}${blocked.length > 3 ? ` 等 ${blocked.length} 处` : ''}`)
  }

  const style = styleId ? resolveDesignStyle(styleId) : null
  if (!style) {
    return { styleId, findings, counts, truncated: counts.resource > MAX_FINDINGS, total: counts.resource }
  }

  const manifest = style.manifest
  const varSet = new Set(manifest.vars)
  const iconSet = new Set(manifest.iconNames)
  const classSet = new Set(manifest.componentClasses)
  const familySet = new Set(manifest.fontFamilies.map((f) => f.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '').toLowerCase()))
  const spacing = new Set(manifest.spacing)
  const radius = new Set(manifest.radius)

  // 掩码：注入块、脚本、注释、url()、data:
  let masked = html
    .replace(/<!--tianshu-ds:start[^>]*-->[\s\S]*?<!--tianshu-ds:end-->/g, mask)
    .replace(/<script\b[\s\S]*?<\/script>/gi, mask)
    .replace(/<!--[\s\S]*?-->/g, mask)
  masked = maskUrls(masked)

  // 1) 变量引用（整份 HTML，排除已掩码区域）
  for (const match of masked.matchAll(VAR_REF)) {
    const name = match[1]!
    if (!varSet.has(name)) add('token', match.index ?? 0, `未知 token：${name}`)
  }

  // 2) CSS 声明
  for (const segment of styleSegments(masked)) {
    for (const decl of declarations(segment.text)) {
      const offset = segment.start + decl.offset
      if (FONT_PROP.test(decl.prop)) {
        const first = decl.value.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
        if (first && !first.startsWith('var(') && first !== 'inherit' && !familySet.has(first)) {
          add('font', offset, `字体 ${first} 不在当前风格字体栈内，改用 var(--ts-font-sans)`)
        }
        continue
      }
      if (RADIUS_PROP.test(decl.prop)) {
        const px = pxValue(decl.value)
        if (px !== null && !radius.has(px) && px !== 0 && !/calc\(|var\(|%/.test(decl.value)) {
          add('radius', offset, `圆角 ${px}px 不在尺度上，最近：${nearestTokenHint('radius', px, manifest)}`)
        }
        continue
      }
      if (SPACING_PROPS.test(decl.prop)) {
        const px = pxValue(decl.value)
        if (px !== null && !spacing.has(px) && px !== 0 && px !== 1 && !/calc\(|var\(|%|em\b|rem\b|auto/.test(decl.value)) {
          add('spacing', offset, `间距 ${px}px 不在尺度上，最近：${nearestTokenHint('space', px, manifest)}`)
        }
      }
    }
  }

  // 3) 裸色值（只查 CSS 片段，避免误报 SVG 属性里的 brand 色）
  for (const segment of styleSegments(masked)) {
    for (const match of segment.text.matchAll(HEX_COLOR)) {
      add('color', segment.start + (match.index ?? 0), `裸色值 ${match[0]}，改用 var(--ts-color-*)`)
    }
    for (const match of segment.text.matchAll(FUNC_COLOR)) {
      add('color', segment.start + (match.index ?? 0), `裸色值 ${match[0]}，改用 var(--ts-color-*)`)
    }
  }

  // 4) 图标
  for (const match of masked.matchAll(DATA_ICON)) {
    const name = (match[1] ?? match[2] ?? '').trim()
    if (name && !iconSet.has(name)) add('icon', match.index ?? 0, `图标目录无此名：${name}`)
  }
  for (const match of masked.matchAll(EMPTY_SVG)) {
    if (!/data-icon/.test(match[1] ?? '')) add('icon', match.index ?? 0, '空 <svg> 缺少 data-icon 名称')
  }

  // 5) 组件类（只查 ts- 前缀，避免误报页面自有布局类）
  for (const match of masked.matchAll(CLASS_ATTR)) {
    const value = match[1] ?? match[2] ?? ''
    for (const cls of value.split(/\s+/).filter(Boolean)) {
      if (cls.startsWith('ts-') && !classSet.has(cls)) {
        add('component', match.index ?? 0, `组件目录无此类：${cls}`)
      }
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  findings.sort((a, b) => a.line - b.line)
  return { styleId, findings, counts, truncated: total > MAX_FINDINGS, total }
}

function pxValue(value: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim())
  return match ? Number(match[1]) : null
}

export function formatLintReport(report: LintReport, label: string): string {
  const styleName = report.styleId ? (designStyleSummary(report.styleId)?.name ?? report.styleId) : null
  const head = styleName
    ? `风格检查：${styleName}（${report.styleId}）· ${label}`
    : `风格检查：未锁定风格 · ${label}（仅检查资源引用）`

  if (report.total === 0) {
    return `${head}\n未发现不符合项（0 处）。`
  }

  const lines = report.findings.map((f, i) => `${i + 1}. [${f.rule}] 第 ${f.line} 行 ${f.message}\n   ${f.snippet}`)
  const summary = RULES.filter((r) => report.counts[r] > 0)
    .map((r) => `${r} ${report.counts[r]}`)
    .join('、')
  const tail = report.truncated ? `\n…另有 ${report.total - report.findings.length} 处未显示。` : ''
  return `${head}\n发现 ${report.total} 处（仅报告，未修改文件）：\n${lines.join('\n')}\n汇总：${summary}${tail}`
}
