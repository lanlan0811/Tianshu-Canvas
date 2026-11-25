/**
 * UX 评审体系：三段式隔离（A 设计评审 → B 确定性检测 → synthesize 算分）。
 *
 * 为什么分三段：插件工具跑在宿主代理的回合里，自己 spawn 不了子代理，
 * 所以「设计判断」与「检测器证据」的隔离只能靠调用协议强制。
 * A 阶段的返回里**物理上不含**任何 lint / a11y / quality 发现，
 * 代理想被锚定也抄不到；B 阶段读不到 a.json 就直接报错。
 *
 * 分工：
 *  - A 由代理读截图与源码完成，工具只给中性事实、量表与空模板；
 *  - B 由工具跑 contract / a11y / quality，并取回 A 阶段寄存的 review 发现；
 *  - synthesize 只做算术、结构校验与报告骨架，不写任何审美判语。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { designDir } from '../design.js'
import { assertSafeId, InvalidInputError } from '../ids.js'
import { assertInsideWorkspace, writeFileInWorkspace } from '../paths.js'
import { projectDir, readPageHtml, readProject } from '../project.js'
import { auditPage } from './a11y.js'
import { computeContract } from './contract.js'
import { auditQuality } from './quality.js'
import { formatReviewReport, reviewPage, type PageReviewResult } from './review.js'
import type { Browser } from 'puppeteer-core'

// ---------------------------------------------------------------------------
// 量表
// ---------------------------------------------------------------------------

export interface RubricHeuristic {
  id: string
  name: string
  ask: string
  checkFor: string[]
  levels: string[]
}

export interface RubricBand {
  min: number
  label: string
  meaning: string
}

export interface RubricPersona {
  id: string
  name: string
  profile: string
  questions: string[]
  redFlags: string[]
}

export interface Rubric {
  schema: number
  name: string
  benchmark: string
  heuristics: RubricHeuristic[]
  interpretive: number[]
  bands: RubricBand[]
  cognitiveLoad: {
    items: Array<{ id: string; name: string; ask: string; failure: string }>
    bands: Array<{ max: number; label: string; advice: string }>
    workingMemoryRule: string
  }
  personas: RubricPersona[]
  personaMap: Array<{ type: string; personas: string[]; why: string }>
  severity: Array<{ id: string; name: string; desc: string; action: string }>
  severityTip: string
  specificityQuestions: string[]
  craftFloor: Array<{ id: string; check: string }>
  refuse: {
    hardBans: Array<{ id: string; text: string }>
    defaults: string[]
  }
}

let cachedRubric: Rubric | null = null

/** 读构建产物里的量表；缺失时给出可执行的提示，不静默降级。 */
export function loadRubric(): Rubric {
  if (cachedRubric) return cachedRubric
  const file = join(designDir(), 'rubrics', 'ux-review.json')
  if (!existsSync(file)) {
    throw new Error('评审量表缺失（dist/design/rubrics/ux-review.json），请先运行 npm run build。')
  }
  cachedRubric = JSON.parse(readFileSync(file, 'utf8')) as Rubric
  return cachedRubric
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type SeverityId = 'P0' | 'P1' | 'P2' | 'P3'

export interface UxHeuristicScore {
  id: string
  score: number | 'n/a'
  /** score 为 'n/a' 时必须写明理由。 */
  reason?: string
  keyIssue: string
}

export interface UxAssessment {
  /** 设计特异性判词：必须是第一输出项。 */
  specificity: { verdict: string; evidence: string[] }
  heuristics: UxHeuristicScore[]
  cognitiveLoad: { failed: string[] }
  personas: Array<{ id: string; redFlags: string[] }>
  priorityIssues: Array<{ severity: SeverityId; what: string; why: string; fix: string }>
  strengths: string[]
  minorObservations?: string[]
}

export interface UxFacts {
  viewport: string
  content: string
  elements: number
  headings: number
  controls: number
  fontStatus: string
  reducedMotion: boolean
  internalScrollRegions: number
}

export interface UxShot {
  width: number
  height: number
  path: string
  bytes: number
}

export interface UxSession {
  schema: 1
  reviewId: string
  pageId: string
  title: string
  mode: string | null
  outputDir: string
  shots: UxShot[]
  facts: UxFacts
  createdAt: string
}

export interface UxFindings {
  contract: { score: number; total: number; byRule: Record<string, number>; unknownVars: string[]; unknownClasses: string[]; missingInteractionRuntime: boolean }
  a11y: { counts: { error: number; warning: number; info: number }; byRule: Record<string, number>; skipped: string[] }
  quality: { counts: { warning: number; advisory: number }; byRule: Record<string, number>; skipped: string[] }
  review: { issues: Array<{ rule: string; severity: string; message: string; selectors?: string[]; width: number }>; limitations: string[] }
  ranAt: string
}

export interface UxScore {
  total: number
  max: number
  percent: number
  band: string
  bandMeaning: string
  naHeuristics: string[]
  scored: number
  p0: number
  p1: number
  p2: number
  p3: number
}

// ---------------------------------------------------------------------------
// 目录与读写
// ---------------------------------------------------------------------------

function uxRoot(cwd: string): string {
  return join(projectDir(cwd), 'audit', 'ux')
}

function sessionDir(cwd: string, reviewId: string): string {
  const dir = join(uxRoot(cwd), reviewId)
  assertInsideWorkspace(cwd, dir, '评审目录')
  return dir
}

function sessionFile(cwd: string, reviewId: string): string {
  return join(sessionDir(cwd, reviewId), 'session.json')
}

function assessmentFile(cwd: string, reviewId: string): string {
  return join(sessionDir(cwd, reviewId), 'a.json')
}

function findingsFile(cwd: string, reviewId: string): string {
  return join(sessionDir(cwd, reviewId), 'b.json')
}

function evidenceFile(cwd: string, reviewId: string): string {
  return join(sessionDir(cwd, reviewId), 'evidence.json')
}

/** 读 session；不存在或损坏时报可执行的错误。 */
export function readSession(cwd: string, reviewId: string): UxSession {
  assertSafeId(reviewId)
  const file = sessionFile(cwd, reviewId)
  if (!existsSync(file)) throw new InvalidInputError(`评审会话不存在：${reviewId}。先用 canvas_audit（action=ux, phase=a, page_id=<id>）开始一轮评审。`)
  return JSON.parse(readFileSync(file, 'utf8')) as UxSession
}

// ---------------------------------------------------------------------------
// A 阶段
// ---------------------------------------------------------------------------

function factsOf(result: PageReviewResult): UxFacts {
  const first = result.captures[0]
  if (!first) {
    return { viewport: '—', content: '—', elements: 0, headings: 0, controls: 0, fontStatus: '未知', reducedMotion: false, internalScrollRegions: 0 }
  }
  const m = first.metrics
  return {
    viewport: `${m.viewportWidth}×${m.viewportHeight}`,
    content: `${m.contentWidth}×${m.contentHeight}`,
    elements: m.elements,
    headings: m.headings,
    controls: m.controls,
    fontStatus: m.fontStatus,
    reducedMotion: m.reducedMotion,
    internalScrollRegions: m.internalScrollRegions,
  }
}

/** A 阶段模板：只给中性事实 + 量表 + 空结构，不含任何检测器发现。 */
function renderTemplate(session: UxSession, rubric: Rubric): string {
  const lines: string[] = []
  lines.push(`UX 评审 A 阶段：页面「${session.title}」（${session.pageId}）`)
  lines.push(`评审 ID：${session.reviewId}`)
  lines.push('')
  lines.push('方法：三段式隔离。你现在做的是 A（设计评审），**不要**在此之前运行 canvas_check_style / a11y / quality —— 那些属于 B，先跑会锚定判断。')
  lines.push('')
  lines.push('## 截图（先读图，再评分）')
  for (const shot of session.shots) lines.push(`- ${shot.width}×${shot.height}：${shot.path}`)
  if (!session.shots.length) lines.push('- （本轮没有截图；只能基于源码判断，并在 keyIssue 里说明证据受限）')
  lines.push('')
  lines.push('## 中性事实（不含任何检测结论）')
  const f = session.facts
  lines.push(`- 视口 ${f.viewport}；内容 ${f.content}；元素 ${f.elements}、标题 ${f.headings}、控件 ${f.controls}`)
  lines.push(`- 字体 ${f.fontStatus}；减少动效 ${f.reducedMotion ? '已模拟' : '未模拟'}；内部滚动区 ${f.internalScrollRegions}`)
  lines.push('')
  lines.push('## 第一步：设计特异性（先于一切其他判断）')
  for (const q of rubric.specificityQuestions) lines.push(`- ${q}`)
  lines.push('')
  lines.push('## 评分表（每条 0–4，或用 n/a 并写理由）')
  lines.push(`校准基准：${rubric.benchmark}`)
  lines.push('')
  lines.push('| # | 启发式 | 判据 | 0–4 分档 |')
  lines.push('|---|---|---|---|')
  rubric.heuristics.forEach((h, i) => {
    const na = rubric.interpretive.includes(i + 1) ? '（可 n/a）' : ''
    lines.push(`| ${i + 1} | ${h.name}${na} | ${h.ask} | ${h.levels.join(' / ')} |`)
  })
  lines.push('')
  lines.push('## 认知负荷（8 项清单，记录失败项）')
  for (const item of rubric.cognitiveLoad.items) lines.push(`- ${item.name}：${item.ask}（失败表现为：${item.failure}）`)
  lines.push(`- 工作记忆法则：${rubric.cognitiveLoad.workingMemoryRule}`)
  lines.push('')
  lines.push('## persona 走查（选 2–3 个，逐个走主操作）')
  lines.push('')
  lines.push('| 界面类型 | 建议 persona | 原因 |')
  lines.push('|---|---|---|')
  for (const row of rubric.personaMap) lines.push(`| ${row.type} | ${row.personas.join('、')} | ${row.why} |`)
  lines.push('')
  for (const persona of rubric.personas) {
    lines.push(`**${persona.name}（${persona.id}）** ${persona.profile}`)
    lines.push(`- 红旗：${persona.redFlags.join('；')}`)
    lines.push('')
  }
  lines.push('## 严重度（每个优先级问题必须挂一个）')
  for (const item of rubric.severity) lines.push(`- ${item.id} ${item.name}：${item.desc} → ${item.action}`)
  lines.push(`- 提示：${rubric.severityTip}`)
  lines.push('')
  lines.push('## 审美下限（判断时对照，不要逐条填表）')
  for (const item of rubric.craftFloor) lines.push(`- ${item.check}`)
  lines.push('')
  lines.push('## 硬禁令 vs 默认值')
  for (const ban of rubric.refuse.hardBans) lines.push(`- **硬禁令**：${ban.text}`)
  lines.push('- 以上之外的都是「默认值」，简报的明确文字可以换回来。')
  lines.push('')
  lines.push('## 回填方式')
  lines.push('把结论按下面的 JSON 结构写进 `canvas_audit`（action=ux, phase=a, review_id=' + session.reviewId + ', a_assessment={...}）：')
  lines.push('')
  lines.push('```json')
  lines.push(
    JSON.stringify(
      {
        specificity: { verdict: '一句话判词', evidence: ['证据 1', '证据 2'] },
        heuristics: rubric.heuristics.map((h) => ({ id: h.id, score: 2, keyIssue: '这一项的主要问题' })),
        cognitiveLoad: { failed: ['chunking'] },
        personas: [{ id: 'jordan', redFlags: ['具体哪一处对这个人失效'] }],
        priorityIssues: [{ severity: 'P1', what: '问题', why: '为什么伤害用户', fix: '怎么改' }],
        strengths: ['做得好的地方'],
      },
      null,
      2,
    ),
  )
  lines.push('```')
  lines.push('')
  lines.push('规则：10 条启发式必须全覆盖（0–4 或 n/a+理由）；n/a 只允许第 ' + rubric.interpretive.join(' / ') + ' 条；persona 2–3 个；priorityIssues 3–5 条。')
  return lines.join('\n')
}

export interface UxStartResult {
  session: UxSession
  template: string
}

/** A 阶段第一步：截图 + 中性事实 + 空模板。检测器发现寄存到 evidence.json，不在本阶段返回。 */
export async function uxStart(cwd: string, pageId: string, options: { outputDir?: string } = {}): Promise<UxStartResult> {
  assertSafeId(pageId)
  const node = readProject(cwd).nodes.find((item) => item.id === pageId)
  if (!node) throw new InvalidInputError(`页面不存在：${pageId}`)
  const reviewId = `${pageId}-${Date.now()}-${randomBytes(3).toString('hex')}`
  const base = options.outputDir ? resolve(cwd, options.outputDir) : uxRoot(cwd)
  assertInsideWorkspace(cwd, base, '评审输出目录')

  const result = await reviewPage(cwd, pageId, { outputDir: base })
  const dir = sessionDir(cwd, reviewId)
  const session: UxSession = {
    schema: 1,
    reviewId,
    pageId,
    title: node.title,
    mode: node.mode ?? null,
    outputDir: dir,
    shots: result.captures.map((c) => ({ width: c.width, height: c.height, path: c.path, bytes: c.bytes })),
    facts: factsOf(result),
    createdAt: new Date().toISOString(),
  }
  writeFileInWorkspace(cwd, sessionFile(cwd, reviewId), JSON.stringify(session, null, 2) + '\n')
  // 检测器发现单独寄存；A 阶段的返回里不出现，B 阶段才读。
  const evidence = {
    pageId,
    issues: result.captures.flatMap((c) => c.issues.map((issue) => ({ ...issue, width: c.width }))),
    limitations: result.limitations,
  }
  writeFileInWorkspace(cwd, evidenceFile(cwd, reviewId), JSON.stringify(evidence, null, 2) + '\n')
  return { session, template: renderTemplate(session, loadRubric()) }
}

/** 校验 A 的结论；返回人类可读的错误列表（空表示通过）。 */
export function validateAssessment(assessment: UxAssessment, rubric: Rubric): string[] {
  const errors: string[] = []
  const heuristicIds = rubric.heuristics.map((h) => h.id)
  const seen = new Map<string, UxHeuristicScore>()
  for (const item of assessment.heuristics ?? []) {
    if (!heuristicIds.includes(item.id)) {
      errors.push(`未知启发式 id：${item.id}；可选：${heuristicIds.join('、')}`)
      continue
    }
    if (seen.has(item.id)) errors.push(`启发式重复打分：${item.id}`)
    seen.set(item.id, item)
  }
  for (const id of heuristicIds) if (!seen.has(id)) errors.push(`缺少启发式评分：${id}`)

  rubric.heuristics.forEach((h, index) => {
    const item = seen.get(h.id)
    if (!item) return
    if (item.score === 'n/a') {
      const position = index + 1
      if (!rubric.interpretive.includes(position)) {
        errors.push(`${h.name}（第 ${position} 条）不允许标记 n/a，请给 0–4 分`)
      }
      if (typeof item.reason !== 'string' || !item.reason.trim()) errors.push(`${h.name} 标记 n/a 时必须写明理由`)
    } else if (!Number.isInteger(item.score) || item.score < 0 || item.score > 4) {
      errors.push(`${h.name} 的分数必须是 0–4 的整数或 'n/a'，当前 ${String(item.score)}`)
    }
    if (typeof item.keyIssue !== 'string') errors.push(`${h.name} 缺少 keyIssue`)
  })

  if (!assessment.specificity || typeof assessment.specificity.verdict !== 'string' || !assessment.specificity.verdict.trim()) {
    errors.push('缺少设计特异性判词（specificity.verdict），它必须是第一输出项')
  }
  if (!Array.isArray(assessment.specificity?.evidence) || assessment.specificity.evidence.length === 0) {
    errors.push('设计特异性必须有至少一条证据（specificity.evidence）')
  }

  const loadIds = new Set(rubric.cognitiveLoad.items.map((i) => i.id))
  for (const id of assessment.cognitiveLoad?.failed ?? []) {
    if (!loadIds.has(id)) errors.push(`未知认知负荷项：${id}；可选：${[...loadIds].join('、')}`)
  }

  const personaIds = new Set(rubric.personas.map((p) => p.id))
  const personas = assessment.personas ?? []
  if (personas.length < 2 || personas.length > 3) errors.push(`persona 必须选 2–3 个，当前 ${personas.length}`)
  for (const persona of personas) {
    if (!personaIds.has(persona.id)) errors.push(`未知 persona：${persona.id}；可选：${[...personaIds].join('、')}`)
    if (!Array.isArray(persona.redFlags) || persona.redFlags.length === 0) errors.push(`persona ${persona.id} 必须写出具体红旗`)
  }

  const severityIds = new Set(rubric.severity.map((s) => s.id))
  const issues = assessment.priorityIssues ?? []
  if (issues.length < 3 || issues.length > 5) errors.push(`priorityIssues 必须 3–5 条，当前 ${issues.length}`)
  for (const issue of issues) {
    if (!severityIds.has(issue.severity)) errors.push(`未知严重度：${issue.severity}`)
    for (const key of ['what', 'why', 'fix'] as const) {
      if (typeof issue[key] !== 'string' || !issue[key].trim()) errors.push(`优先级问题缺少 ${key}：${issue.what ?? '(无标题)'}`)
    }
  }

  if (!Array.isArray(assessment.strengths) || assessment.strengths.length < 1) errors.push('至少写 1 条做得好的地方（strengths）')
  return errors
}

/** A 阶段第二步：把结论落盘。必须先有 session。 */
export function uxRecordA(cwd: string, reviewId: string, assessment: UxAssessment): { file: string; naCount: number } {
  const session = readSession(cwd, reviewId)
  const rubric = loadRubric()
  const errors = validateAssessment(assessment, rubric)
  if (errors.length) throw new InvalidInputError(`A 阶段结论不合格：\n- ${errors.join('\n- ')}`)
  const file = assessmentFile(cwd, reviewId)
  writeFileInWorkspace(cwd, file, JSON.stringify({ ...assessment, recordedAt: new Date().toISOString() }, null, 2) + '\n')
  const naCount = assessment.heuristics.filter((h) => h.score === 'n/a').length
  return { file, naCount }
}

/** 读 A 的结论；不存在时报错（B 的门禁）。 */
export function readAssessment(cwd: string, reviewId: string): UxAssessment & { recordedAt?: string } {
  const file = assessmentFile(cwd, reviewId)
  if (!existsSync(file)) {
    throw new InvalidInputError(
      `进行 B 阶段之前必须先完成 A：${reviewId} 还没有 a.json。先 phase=a 拿模板与截图，读图后再用 phase=a 回填 a_assessment。`,
    )
  }
  return JSON.parse(readFileSync(file, 'utf8')) as UxAssessment & { recordedAt?: string }
}

// ---------------------------------------------------------------------------
// B 阶段
// ---------------------------------------------------------------------------

/** B 阶段：仅当 A 已落盘才运行。合并 contract / a11y / quality / review 的确定性发现。 */
export async function uxRunB(
  cwd: string,
  reviewId: string,
  deps: { browser: Browser; urlFor: (pageId: string) => string },
): Promise<UxFindings> {
  const session = readSession(cwd, reviewId)
  readAssessment(cwd, reviewId) // 门禁：没有 A 就在这里抛错
  const html = readPageHtml(cwd, session.pageId)
  if (html === null) throw new InvalidInputError(`页面 HTML 不存在：${session.pageId}`)
  const styleId = readProject(cwd).design?.styleId ?? null

  const contract = computeContract(html, styleId, cwd, null)
  const url = deps.urlFor(session.pageId)
  const [a11y, quality] = await Promise.all([
    auditPage(deps.browser, url, {}),
    auditQuality(deps.browser, url, { mode: (session.mode as never) ?? null }),
  ])
  const evidenceFileAbs = evidenceFile(cwd, reviewId)
  const evidence = existsSync(evidenceFileAbs)
    ? (JSON.parse(readFileSync(evidenceFileAbs, 'utf8')) as { issues: UxFindings['review']['issues']; limitations: string[] })
    : { issues: [], limitations: [] }

  const findings: UxFindings = {
    contract: {
      score: contract.score,
      total: contract.total,
      byRule: contract.byRule,
      unknownVars: contract.usage.unknownVars,
      unknownClasses: contract.usage.unknownClasses,
      missingInteractionRuntime: contract.usage.missingInteractionRuntime,
    },
    a11y: { counts: a11y.counts, byRule: a11y.byRule, skipped: a11y.skipped },
    quality: { counts: quality.counts, byRule: quality.byRule, skipped: quality.skipped },
    review: { issues: evidence.issues, limitations: evidence.limitations },
    ranAt: new Date().toISOString(),
  }
  writeFileInWorkspace(cwd, findingsFile(cwd, reviewId), JSON.stringify(findings, null, 2) + '\n')
  return findings
}

// ---------------------------------------------------------------------------
// synthesize
// ---------------------------------------------------------------------------

/** 算分：n/a 会缩小分母，档位按百分比判，绝不写 /40 覆盖部分集合。 */
export function scoreAssessment(assessment: UxAssessment, rubric: Rubric): UxScore {
  let total = 0
  let scored = 0
  const naHeuristics: string[] = []
  for (const item of assessment.heuristics) {
    if (item.score === 'n/a') naHeuristics.push(item.id)
    else {
      total += item.score
      scored++
    }
  }
  const max = scored * 4
  const percent = max > 0 ? Math.round((total / max) * 1000) / 10 : 0
  const band = rubric.bands.find((b) => percent >= b.min) ?? rubric.bands[rubric.bands.length - 1]!
  const count = (id: SeverityId): number => assessment.priorityIssues.filter((i) => i.severity === id).length
  return {
    total,
    max,
    percent,
    band: band.label,
    bandMeaning: band.meaning,
    naHeuristics,
    scored,
    p0: count('P0'),
    p1: count('P1'),
    p2: count('P2'),
    p3: count('P3'),
  }
}

function formatByRule(byRule: Record<string, number>): string {
  const entries = Object.entries(byRule).sort((a, b) => b[1] - a[1])
  return entries.length ? entries.map(([rule, n]) => `${rule}×${n}`).join('、') : '无'
}

/** 生成报告骨架与落盘 ux.json；不写任何审美判语。 */
export function uxSynthesize(cwd: string, reviewId: string): { score: UxScore; report: string; file: string; warnings: string[] } {
  const session = readSession(cwd, reviewId)
  const rubric = loadRubric()
  const assessment = readAssessment(cwd, reviewId)
  const bFile = findingsFile(cwd, reviewId)
  if (!existsSync(bFile)) throw new InvalidInputError(`缺少 b.json：先运行 phase=b（${reviewId}）。`)
  const findings = JSON.parse(readFileSync(bFile, 'utf8')) as UxFindings
  const score = scoreAssessment(assessment, rubric)
  const warnings: string[] = []
  if (score.max < 24) warnings.push(`有效分母只有 ${score.max} 分（n/a 过多），评分代表性不足，请在报告中说明为什么这些项不适用。`)
  if (score.naHeuristics.length > 0) warnings.push(`标记 n/a 的启发式：${score.naHeuristics.join('、')}；分母按实际计分项计算。`)

  const lines: string[] = []
  lines.push(`方法：三段式隔离（A 设计评审先行完成，${assessment.recordedAt ?? '时间未知'}；B 确定性检测 ${findings.ranAt}）`)
  lines.push(`UX 评审：页面「${session.title}」（${session.pageId}）· 评审 ID ${reviewId}`)
  lines.push('')
  lines.push('## 设计健康度')
  lines.push('')
  lines.push('| # | 启发式 | 分数 | 主要问题 |')
  lines.push('|---|---|---|---|')
  rubric.heuristics.forEach((h, index) => {
    const item = assessment.heuristics.find((s) => s.id === h.id)
    const value = item?.score === 'n/a' ? 'n/a' : String(item?.score ?? '?')
    lines.push(`| ${index + 1} | ${h.name} | ${value} | ${item?.keyIssue ?? '—'} |`)
  })
  const naNote = score.naHeuristics.length ? `（n/a：${score.naHeuristics.join('、')}）` : ''
  lines.push(`| **合计** |  | **${score.total}/${score.max}** · ${score.percent}% | **${score.band}**：${score.bandMeaning} ${naNote}|`)
  lines.push('')
  lines.push('## 设计特异性（A 的第一输出项）')
  lines.push(`判词：${assessment.specificity.verdict}`)
  for (const item of assessment.specificity.evidence) lines.push(`- 证据：${item}`)
  lines.push('')
  lines.push('## 认知负荷')
  const failedLoad = assessment.cognitiveLoad.failed
  const loadBand = rubric.cognitiveLoad.bands.find((b) => failedLoad.length <= b.max) ?? rubric.cognitiveLoad.bands[rubric.cognitiveLoad.bands.length - 1]!
  lines.push(`失败 ${failedLoad.length} 项 → ${loadBand.label}：${loadBand.advice}`)
  if (failedLoad.length) lines.push(`- 失败项：${failedLoad.join('、')}`)
  lines.push('')
  lines.push('## A 与 B 的交叉核对（这一段由你填）')
  lines.push('- A 与 B 都指出的问题：')
  lines.push('- B 抓到、A 漏掉的：')
  lines.push('- B 的误报（写明为什么）：')
  lines.push('')
  lines.push('## 确定性检测（B）')
  lines.push(`- 设计契约：符合度 ${(findings.contract.score * 100).toFixed(1)}% · lint ${findings.contract.total} 处 · ${formatByRule(findings.contract.byRule)}`)
  if (findings.contract.unknownVars.length) lines.push(`  - 契约外变量：${findings.contract.unknownVars.join('、')}`)
  if (findings.contract.unknownClasses.length) lines.push(`  - 契约外类：${findings.contract.unknownClasses.join('、')}`)
  if (findings.contract.missingInteractionRuntime) lines.push('  - 用了交互标记但缺少运行时')
  lines.push(`- 可访问性：error ${findings.a11y.counts.error} / warning ${findings.a11y.counts.warning} · ${formatByRule(findings.a11y.byRule)}`)
  lines.push(`- 渲染工艺：warning ${findings.quality.counts.warning} / advisory ${findings.quality.counts.advisory} · ${formatByRule(findings.quality.byRule)}`)
  lines.push(`- 渲染审阅：${findings.review.issues.length} 条客观发现 · ${formatByRule(
    findings.review.issues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.rule] = (acc[issue.rule] ?? 0) + 1
      return acc
    }, {}),
  )}`)
  if (findings.a11y.skipped.length) lines.push(`- a11y 跳过：${findings.a11y.skipped.slice(0, 4).join('；')}`)
  if (findings.quality.skipped.length) lines.push(`- 工艺跳过：${findings.quality.skipped.slice(0, 4).join('；')}`)
  lines.push('')
  lines.push('## 优先级问题（按 P0–P3 排序，已计分）')
  for (const issue of [...assessment.priorityIssues].sort((a, b) => a.severity.localeCompare(b.severity))) {
    lines.push(`- **[${issue.severity}] ${issue.what}**`)
    lines.push(`  - 为什么重要：${issue.why}`)
    lines.push(`  - 怎么改：${issue.fix}`)
  }
  lines.push(`严重度计数：P0 ${score.p0} / P1 ${score.p1} / P2 ${score.p2} / P3 ${score.p3}`)
  lines.push('')
  lines.push('## persona 红旗')
  for (const entry of assessment.personas) {
    const persona = rubric.personas.find((p) => p.id === entry.id)
    lines.push(`**${persona?.name ?? entry.id}**：`)
    for (const flag of entry.redFlags) lines.push(`- ${flag}`)
  }
  lines.push('')
  if (assessment.strengths.length) {
    lines.push('## 做得好的地方')
    for (const item of assessment.strengths) lines.push(`- ${item}`)
  }
  if (assessment.minorObservations?.length) {
    lines.push('')
    lines.push('## 次要观察')
    for (const item of assessment.minorObservations) lines.push(`- ${item}`)
  }
  lines.push('')
  lines.push('## 未测项与限制')
  lines.push('- 评分来自代理的设计判断；工具只做算术与结构校验，不能替代项目所有者的评审。')
  lines.push('- A/B 隔离由调用协议保证时序，工具无法验证代理是否在此之前私自运行过检测器。')
  lines.push(`- 截图与客观指标覆盖 ${session.shots.length} 个视口；交互状态、键盘路径、真实设备未覆盖。`)
  for (const item of findings.review.limitations) lines.push(`- ${item}`)
  lines.push('')
  const report = lines.join('\n')

  const file = join(sessionDir(cwd, reviewId), 'ux.json')
  const payload = {
    schema: 1,
    reviewId,
    pageId: session.pageId,
    mode: session.mode,
    a: assessment,
    b: findings,
    score,
    warnings,
    limitations: [
      '评分来自代理判断，工具只做算术与结构校验。',
      'A/B 隔离只保证调用时序，不保证代理未私自运行检测器。',
      '未做人工评审，不能替代项目所有者。',
    ],
    generatedAt: new Date().toISOString(),
  }
  writeFileInWorkspace(cwd, file, JSON.stringify(payload, null, 2) + '\n')
  const header = warnings.length ? `⚠️ ${warnings.join('\n⚠️ ')}\n\n` : ''
  return { score, report: `${header}${report}\n\n已落盘：${file}`, file, warnings }
}

/** 便于 e2e 与调试：把 review 的文本报告原样转出（不含 A/B 语义）。 */
export function reviewText(result: PageReviewResult): string {
  return formatReviewReport(result)
}
