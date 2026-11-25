/**
 * 工艺规则的 inline 豁免。
 *
 * 语法（写在页面 HTML 注释里，从**原始 HTML** 读取，因为注释在 lint 掩码时被抹掉）：
 *
 *   <!-- tianshu-lint-disable side-tab -->              文件级：该规则整页不报
 *   <!-- tianshu-lint-disable-next-line gradient-text --> 仅下一行
 *   <!-- tianshu-lint-disable all -->                    全部规则
 *
 * 支持逗号分隔多个规则 id。
 *
 * 未匹配到任何发现的豁免会在报告末尾点名（陈旧豁免不该长期留存）。
 */
import { lineIndex, lineOf } from '../cssParse.js'

export interface IgnoreDirective {
  rules: string[]
  line: number
  scope: 'file' | 'next-line'
  raw: string
}

export interface IgnoreSet {
  /** 文件级豁免的规则 id（`all` 表示全部）。 */
  fileWide: Set<string>
  /** 行号 → 该行豁免的规则 id（`all` 表示全部）。 */
  byLine: Map<number, Set<string>>
  directives: IgnoreDirective[]
}

const DIRECTIVE_RE = /<!--\s*tianshu-lint-disable(-next-line)?\s+([^>]*?)\s*-->/g

/** 解析原始 HTML 里的豁免指令。 */
export function parseIgnores(html: string): IgnoreSet {
  const index = lineIndex(html)
  const set: IgnoreSet = { fileWide: new Set(), byLine: new Map(), directives: [] }
  for (const m of html.matchAll(DIRECTIVE_RE)) {
    const nextLine = Boolean(m[1])
    const rules = (m[2] ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (rules.length === 0) continue
    const line = lineOf(index, m.index ?? 0)
    set.directives.push({ rules, line, scope: nextLine ? 'next-line' : 'file', raw: m[0] })
    if (nextLine) {
      // 指令所在行的下一行开始生效（指令常独占一行）。
      const target = line + 1
      const bucket = set.byLine.get(target) ?? new Set<string>()
      for (const rule of rules) bucket.add(rule)
      set.byLine.set(target, bucket)
    } else {
      for (const rule of rules) set.fileWide.add(rule)
    }
  }
  return set
}

/** 该行该规则是否被豁免。 */
export function isIgnored(set: IgnoreSet, rule: string, line: number): boolean {
  if (set.fileWide.has('all') || set.fileWide.has(rule)) return true
  const bucket = set.byLine.get(line)
  return Boolean(bucket && (bucket.has('all') || bucket.has(rule)))
}

/** 一条指令是否匹配到了任何发现（用于陈旧豁免检测）。 */
export function directiveUsed(set: IgnoreSet, directive: IgnoreDirective, findings: Array<{ rule: string; line: number }>): boolean {
  if (directive.scope === 'file') {
    return findings.some((f) => directive.rules.includes('all') || directive.rules.includes(f.rule))
  }
  const target = directive.line + 1
  return findings.some((f) => f.line === target && (directive.rules.includes('all') || directive.rules.includes(f.rule)))
}
