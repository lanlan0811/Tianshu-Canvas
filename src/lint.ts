/**
 * 风格一致性检查（只报告，不阻塞写入）。
 *
 * 服务端没有 DOM，因此用「等长掩码 + 正则」做轻量解析：把脚本、注释、注入块、
 * url(...) 与 data: 值替换成等长空白，保证报告里的行号与原文件一致。
 *
 * 已知限制：font 简写里的字体族不检查；颜色只在声明的值里查，
 * 其中命名色只查 color/background/border 等颜色相关属性。
 */
import { findBlockedResources } from './resources.js'
import { resolveDesignStyle, type DesignManifest } from './design.js'
import { prototypeClasses } from './prototypes.js'
import {
  CLASS_ATTR_RE as CLASS_ATTR,
  COLOR_PROP,
  CSS_WORD,
  declarations,
  DATA_ICON,
  EMPTY_SVG,
  FONT_PROP,
  FUNC_COLOR,
  HEX_COLOR,
  lineIndex,
  lineOf,
  mask,
  NAMED_COLORS,
  pxValues,
  RADIUS_PROP,
  snippetAt,
  SPACING_PROPS,
  styleSegments,
  VAR_REF,
  maskUrls,
} from './cssParse.js'

export type LintRule = 'color' | 'font' | 'spacing' | 'radius' | 'icon' | 'component' | 'interaction' | 'token' | 'resource'

export interface LintFinding {
  rule: LintRule
  line: number
  message: string
  snippet: string
}

export interface LintReport {
  styleId: string | null
  /** 风格名（用于报告标题）；由 lintHtml 解析后写入，避免格式化层再触磁盘。 */
  styleName?: string | null
  findings: LintFinding[]
  counts: Record<LintRule, number>
  truncated: boolean
  total: number
}

const MAX_FINDINGS = 40

const RULES: LintRule[] = ['color', 'font', 'spacing', 'radius', 'icon', 'component', 'interaction', 'token', 'resource']

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
export function lintHtml(html: string, styleId: string | null, cwd?: string): LintReport {
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

  const style = styleId ? resolveDesignStyle(cwd, styleId) : null
  if (!style) {
    // 风格不可用时只查了资源，报告里不能显示成按某个风格检查过。
    return { styleId: null, findings, counts, truncated: counts.resource > MAX_FINDINGS, total: counts.resource }
  }

  const manifest = style.manifest
  const varSet = new Set(manifest.vars)
  const iconSet = new Set(manifest.iconNames)
  // 交互库独有类也是合法 ts-* 类，与组件类合并，避免误报「组件目录无此类」。
  const classSet = new Set([...manifest.componentClasses, ...(manifest.interactionClasses ?? [])])
  const compositionClasses = new Set(prototypeClasses())
  const interactionClassSet = new Set(manifest.interactionClasses ?? [])
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
        for (const px of pxValues(decl.value)) {
          if (px !== 0 && !radius.has(px)) {
            add('radius', offset, `圆角 ${px}px 不在尺度上，最近：${nearestTokenHint('radius', px, manifest)}`)
          }
        }
        continue
      }
      if (SPACING_PROPS.test(decl.prop)) {
        for (const px of pxValues(decl.value)) {
          if (px !== 0 && px !== 1 && !spacing.has(px)) {
            add('spacing', offset, `间距 ${px}px 不在尺度上，最近：${nearestTokenHint('space', px, manifest)}`)
          }
        }
      }
    }
  }

  // 3) 裸色值：只查声明的值。整段匹配会把 #face 这样的 id 选择器也当成颜色。
  for (const segment of styleSegments(masked)) {
    for (const decl of declarations(segment.text)) {
      const offset = segment.start + decl.offset
      const reportColor = (index: number, color: string): void =>
        add('color', offset + index, `裸色值 ${color}，改用 var(--ts-color-*)`)
      for (const match of decl.raw.matchAll(HEX_COLOR)) reportColor(match.index ?? 0, match[0])
      for (const match of decl.raw.matchAll(FUNC_COLOR)) {
        if (!match[0].includes('var(')) reportColor(match.index ?? 0, match[0])
      }
      if (COLOR_PROP.test(decl.prop)) {
        // var() 里的名字（如 --ts-color-red）不是颜色；等长替换以保持下标。
        const words = decl.raw.replace(/var\([^)]*\)/gi, mask)
        for (const match of words.matchAll(CSS_WORD)) {
          if (NAMED_COLORS.has(match[0].toLowerCase())) reportColor(match.index ?? 0, match[0])
        }
      }
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
      if (cls.startsWith('tp-') && !compositionClasses.has(cls)) {
        add('component', match.index ?? 0, `原型目录未登记此类：${cls}`)
      }
    }
  }

  // 6) 交互：用到交互标记/类，但注入块里没有交互运行时 → 交互不会生效。
  //    注入的运行时在被掩码的 ds 块里，所以「是否已注入」要用原始 html 判断。
  if (!hasRuntimeInjection(html)) {
    const used = usedInteractions(masked, interactionClassSet, [...style.interactions.rootAttrs, ...(style.interactions.bindings ?? []).map(b => b.rootAttr)])
    if (used.length) {
      add('interaction', 0, `用到交互（${used.slice(0, 6).join('、')}${used.length > 6 ? ' 等' : ''}）但缺少交互运行时；请用 canvas_upsert_page 重新写入以自动注入`)
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  findings.sort((a, b) => a.line - b.line)
  return { styleId, styleName: style.summary.name, findings, counts, truncated: total > MAX_FINDINGS, total }
}

/** 原始 HTML 里是否存在注入的交互运行时（style/script）。 */
function hasRuntimeInjection(html: string): boolean {
  return /id="tianshu-interactions"/.test(html)
}

/** 掩码后的页面正文里用到了哪些交互（命中 data-ts-* 根属性或交互独有类）。 */
function usedInteractions(masked: string, interactionClasses: Set<string>, roots: string[]): string[] {
  const out = new Set<string>()
  for (const root of roots) if (new RegExp('\\b' + root + '(?=[\\s=>])').test(masked)) out.add(root)
  for (const match of masked.matchAll(CLASS_ATTR)) {
    const value = match[1] ?? match[2] ?? ''
    for (const cls of value.split(/\s+/).filter(Boolean)) {
      if (interactionClasses.has(cls)) out.add(cls)
    }
  }
  return [...out]
}

export function formatLintReport(report: LintReport, label: string): string {
  const styleName = report.styleId ? (report.styleName ?? report.styleId) : null
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
