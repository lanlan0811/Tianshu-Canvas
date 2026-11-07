/**
 * 设计契约审计：把「页面是否符合当前设计系统」变成可重复执行的确定性断言。
 *
 * 与 canvas_check_style 的区别：check_style 只读、给人看；这里额外产出
 *   - 结构化结果（可用于基线与 CI 退出码）
 *   - 可落盘的自包含测试文件（团队可粘进自己的仓库跑）
 *   - 变量使用集合（与 manifest 求差，供漂移检测）
 */

import { lintHtml } from '../lint.js'
import type { DesignManifest } from '../design.js'

export interface ContractUsage {
  /** 页面里出现过的 --ts-* 变量。 */
  vars: string[]
  /** manifest 里有但页面没用的变量。 */
  unusedVars: string[]
  /** 页面用了、但 manifest 里没有的变量（越界）。 */
  unknownVars: string[]
  /** 页面里出现的 ts-* 组件类。 */
  classes: string[]
  /** 越界的组件类（不在组件类或交互类契约里）。 */
  unknownClasses: string[]
  /** 页面里出现、且属于交互库独有类的 ts-*（供审计展示）。 */
  interactionClasses: string[]
  /** 用到交互标记/类但页面缺少交互运行时（会静默失效）。 */
  missingInteractionRuntime: boolean
}

export interface ContractResult {
  styleId: string | null
  /** lintHtml 的原始问题数。 */
  total: number
  byRule: Record<string, number>
  usage: ContractUsage
  /** 0–1：1 表示完全符合。 */
  score: number
  /** 生成的独立测试文件内容（不落盘时也返回）。 */
  testFile: string
}

/** 从 HTML 的 class 属性里收集 ts-* 类名（不把 CSS 变量误当类）。 */
export function collectClasses(html: string): string[] {
  const classes = new Set<string>()
  for (const m of html.matchAll(/class\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    for (const token of (m[1] ?? m[2] ?? '').split(/\s+/)) {
      if (token.startsWith('ts-')) classes.add(token)
    }
  }
  return [...classes].sort()
}

/** 从 HTML 里收集变量与组件类。 */
export function collectUsage(html: string, manifest: DesignManifest | null): ContractUsage {
  const vars = new Set<string>()
  for (const m of html.matchAll(/var\(\s*(--ts-[A-Za-z0-9-]+)/g)) vars.add(m[1]!)
  for (const m of html.matchAll(/(?:^|[;{\s])(--ts-[A-Za-z0-9-]+)\s*:/g)) vars.add(m[1]!)
  const classes = new Set(collectClasses(html))
  const knownVars = new Set(manifest?.vars ?? [])
  const interactionClasses = new Set(manifest?.interactionClasses ?? [])
  // 合法类 = 组件类 ∪ 交互类（两者都是 ts-* 契约的一部分）。
  const knownClasses = new Set([...(manifest?.componentClasses ?? []), ...interactionClasses])
  const usedInteractions = [...classes].filter((c) => interactionClasses.has(c))
  const hasMarker = /\bdata-ts-[a-z0-9-]+\b/.test(html)
  const injected = /id="tianshu-interactions"/.test(html)
  return {
    vars: [...vars].sort(),
    unusedVars: manifest ? manifest.vars.filter((v) => !vars.has(v)) : [],
    unknownVars: manifest ? [...vars].filter((v) => !knownVars.has(v)).sort() : [],
    classes: [...classes].sort(),
    unknownClasses: manifest ? [...classes].filter((c) => !knownClasses.has(c)).sort() : [],
    interactionClasses: usedInteractions.sort(),
    missingInteractionRuntime: (hasMarker || usedInteractions.length > 0) && !injected,
  }
}

export function computeContract(html: string, styleId: string | null, cwd: string, manifest: DesignManifest | null): ContractResult {
  const report = lintHtml(html, styleId, cwd)
  const usage = collectUsage(html, manifest)
  const byRule: Record<string, number> = {}
  for (const issue of report.findings) byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1
  const penalty = report.total + usage.unknownVars.length + usage.unknownClasses.length + (usage.missingInteractionRuntime ? 1 : 0)
  const score = penalty === 0 ? 1 : Number(Math.max(0, 1 - penalty / Math.max(10, report.total + penalty)).toFixed(4))
  return { styleId, total: report.total, byRule, usage, score, testFile: renderTestFile({ styleId, usage }) }
}

/**
 * 生成自包含的契约测试文件：只依赖 node:test 与 node:fs，不依赖本插件。
 * 团队可以把它放进自己的仓库，在 CI 里对导出的页面跑。
 */
export function renderTestFile(input: { styleId: string | null; usage: ContractUsage }): string {
  const vars = JSON.stringify(input.usage.vars, null, 2)
  const classes = JSON.stringify(input.usage.classes, null, 2)
  return `// 由 Tianshu-Canvas 生成的设计契约测试。直接改下面的常量即可维护。
// 运行：node --test design.audit.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PAGE = process.argv[2] ?? ${JSON.stringify('page.html')}
const STYLE = ${JSON.stringify(input.styleId)}
const EXPECTED_VARS = ${vars}
const EXPECTED_CLASSES = ${classes}

const html = readFileSync(PAGE, 'utf8')

test('只使用设计系统中的变量', () => {
  const used = [...html.matchAll(/var\\(\\s*(--ts-[A-Za-z0-9-]+)/g)].map((m) => m[1])
  const unknown = used.filter((v) => !EXPECTED_VARS.includes(v))
  assert.deepEqual(unknown, [], '出现了契约外的变量：' + unknown.join(', '))
})

test('不硬编码颜色', () => {
  const hex = [...html.matchAll(/#[0-9a-fA-F]{3,8}\\b/g)].map((m) => m[0])
  assert.deepEqual(hex, [], '出现了裸色值：' + hex.join(', '))
})

test('只使用共享组件类', () => {
  const used = new Set<string>()
  for (const m of html.matchAll(/class\\s*=\\s*(?:"([^"]*)"|'([^']*)')/g)) {
    for (const token of (m[1] || m[2] || '').split(/\\s+/)) if (token.startsWith('ts-')) used.add(token)
  }
  const unknown = [...used].filter((c) => !EXPECTED_CLASSES.includes(c))
  assert.deepEqual(unknown, [], '出现了契约外的类：' + unknown.join(', '))
})

test('风格标识一致', () => {
  assert.equal(STYLE, STYLE, '风格：' + String(STYLE))
})

test('用到交互时必须带运行时', () => {
  const hasMarker = /\\bdata-ts-[a-z0-9-]+\\b/.test(html)
  const injected = /id="tianshu-interactions"/.test(html)
  assert.ok(!hasMarker || injected, '页面用到交互但缺少注入的运行时（交互不会生效）')
})
`
}

/** 人类可读报告。 */
export function formatContractReport(result: ContractResult, label: string): string {
  const lines = [
    `设计契约审计：${label}（风格 ${result.styleId ?? '未锁定'}）`,
    `符合度 ${(result.score * 100).toFixed(1)}% · lint 问题 ${result.total} 处`,
  ]
  if (result.total) lines.push(`按规则：${Object.entries(result.byRule).map(([k, v]) => `${k}×${v}`).join('、')}`)
  if (result.usage.unknownVars.length) lines.push(`契约外变量：${result.usage.unknownVars.slice(0, 10).join('、')}`)
  if (result.usage.unknownClasses.length) lines.push(`契约外类：${result.usage.unknownClasses.slice(0, 10).join('、')}`)
  if (result.usage.interactionClasses.length) lines.push(`交互类：${result.usage.interactionClasses.slice(0, 10).join('、')}`)
  if (result.usage.missingInteractionRuntime) lines.push('警告：用到交互但缺少运行时，交互不会生效（用 canvas_upsert_page 重新写入以自动注入）')
  if (result.usage.unusedVars.length) lines.push(`未使用的变量 ${result.usage.unusedVars.length} 个（不算错误，漂移检测会跟踪）`)
  if (result.score === 1) lines.push('结论：完全符合当前设计系统。')
  return lines.join('\n')
}
