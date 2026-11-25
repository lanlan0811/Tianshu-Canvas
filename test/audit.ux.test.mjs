/**
 * UX 三段式评审的纯逻辑测试（零浏览器）。
 *
 * 覆盖：量表校验（A 结论合规性）、算分（n/a 分母重算与百分比判档）、
 * 模板不含检测结论、B 阶段门禁、报告骨架的结构完整性。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const apiDir = mkdtempSync(join(tmpdir(), 'tsc-ux-unit-'))
await build({
  stdin: { contents: "export { validateAssessment, scoreAssessment, loadRubric, uxSynthesize, readAssessment, readSession } from './src/audit/ux.ts'", resolveDir: root },
  outfile: join(apiDir, 'ux.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'silent',
})
// 与 dist 同构：bundle 的 import.meta.url 指向临时目录，因此把量表放到它旁边的 design/ 下。
mkdirSync(join(apiDir, 'design', 'rubrics'), { recursive: true })
writeFileSync(join(apiDir, 'design', 'rubrics', 'ux-review.json'), readFileSync(join(root, 'design-systems', 'rubrics', 'ux-review.json')))
const m = await import(pathToFileURL(join(apiDir, 'ux.mjs')).href)
test.after(() => rmSync(apiDir, { recursive: true, force: true }))

const rubric = m.loadRubric()

/** 造一份合规的 A 结论，允许局部覆盖。 */
function assessment(over = {}) {
  return {
    specificity: { verdict: '设计对本品类成立，但换到邻近产品仍可用', evidence: ['版面结构是通用仪表盘骨架'] },
    heuristics: rubric.heuristics.map((h, index) => ({
      id: h.id,
      score: index === 9 ? 'n/a' : 3,
      ...(index === 9 ? { reason: '内部工具没有帮助文档' } : {}),
      keyIssue: index === 0 ? '保存后没有确认反馈' : '无重大问题',
    })),
    cognitiveLoad: { failed: ['chunking'] },
    personas: [
      { id: 'alex', redFlags: ['没有批量操作'] },
      { id: 'sam', redFlags: ['焦点环在表格里不可见'] },
    ],
    priorityIssues: [
      { severity: 'P1', what: '保存无反馈', why: '用户不知道是否成功', fix: '加行内确认' },
      { severity: 'P2', what: '表格焦点不可见', why: '键盘用户会迷路', fix: '补 focus-visible' },
      { severity: 'P3', what: '空状态缺引导', why: '首次使用会卡住', fix: '加创建入口' },
    ],
    strengths: ['信息层级清晰'],
    ...over,
  }
}

test('合规的 A 结论通过校验', () => {
  assert.deepEqual(m.validateAssessment(assessment(), rubric), [])
})

test('缺一条启发式评分必须报错', () => {
  const bad = assessment()
  bad.heuristics = bad.heuristics.slice(0, 9)
  const errors = m.validateAssessment(bad, rubric)
  assert.ok(errors.some((e) => e.includes('缺少启发式评分')), errors.join('|'))
})

test('非 interpretive 项标 n/a 必须报错', () => {
  const bad = assessment()
  bad.heuristics[0] = { id: bad.heuristics[0].id, score: 'n/a', reason: '不想评', keyIssue: '—' }
  const errors = m.validateAssessment(bad, rubric)
  assert.ok(errors.some((e) => e.includes('不允许标记 n/a')), errors.join('|'))
})

test('标 n/a 但没写理由必须报错', () => {
  const bad = assessment()
  bad.heuristics[9] = { id: bad.heuristics[9].id, score: 'n/a', keyIssue: '—' }
  assert.ok(m.validateAssessment(bad, rubric).some((e) => e.includes('必须写明理由')))
})

test('分数越界（5 / -1 / 小数）必须报错', () => {
  for (const score of [5, -1, 2.5]) {
    const bad = assessment()
    bad.heuristics[0] = { id: bad.heuristics[0].id, score, keyIssue: '—' }
    assert.ok(m.validateAssessment(bad, rubric).some((e) => e.includes('0–4 的整数')), `score=${score}`)
  }
})

test('缺设计特异性判词必须报错（它是第一输出项）', () => {
  const bad = assessment({ specificity: { verdict: '', evidence: [] } })
  const errors = m.validateAssessment(bad, rubric)
  assert.ok(errors.some((e) => e.includes('设计特异性判词')))
  assert.ok(errors.some((e) => e.includes('至少一条证据')))
})

test('persona 少于 2 个或多于 3 个必须报错', () => {
  const one = assessment({ personas: [{ id: 'alex', redFlags: ['x'] }] })
  assert.ok(m.validateAssessment(one, rubric).some((e) => e.includes('persona 必须选 2–3 个')))
  const many = assessment({
    personas: [
      { id: 'alex', redFlags: ['x'] },
      { id: 'sam', redFlags: ['x'] },
      { id: 'jordan', redFlags: ['x'] },
      { id: 'riley', redFlags: ['x'] },
    ],
  })
  assert.ok(m.validateAssessment(many, rubric).some((e) => e.includes('persona 必须选 2–3 个')))
})

test('priorityIssues 少于 3 条必须报错', () => {
  const bad = assessment({ priorityIssues: [assessment().priorityIssues[0]] })
  assert.ok(m.validateAssessment(bad, rubric).some((e) => e.includes('priorityIssues 必须 3–5 条')))
})

test('未知 persona / 认知负荷项 / 严重度必须报错', () => {
  const bad = assessment({
    personas: [
      { id: 'nobody', redFlags: ['x'] },
      { id: 'alex', redFlags: ['x'] },
    ],
    cognitiveLoad: { failed: ['nope'] },
    priorityIssues: [
      { severity: 'P9', what: 'a', why: 'b', fix: 'c' },
      { severity: 'P1', what: 'a', why: 'b', fix: 'c' },
      { severity: 'P2', what: 'a', why: 'b', fix: 'c' },
    ],
  })
  const errors = m.validateAssessment(bad, rubric)
  assert.ok(errors.some((e) => e.includes('未知 persona')))
  assert.ok(errors.some((e) => e.includes('未知认知负荷项')))
  assert.ok(errors.some((e) => e.includes('未知严重度')))
})

test('算分：9 项计分 + 1 项 n/a → 分母 36 而不是 40', () => {
  const score = m.scoreAssessment(assessment(), rubric)
  assert.equal(score.scored, 9)
  assert.equal(score.max, 36)
  assert.equal(score.total, 27)
  assert.equal(score.percent, 75)
  assert.equal(score.band, '良好')
  assert.deepEqual(score.naHeuristics, [rubric.heuristics[9].id])
  assert.equal(score.p1, 1)
  assert.equal(score.p2, 1)
  assert.equal(score.p3, 1)
})

test('算分：全 4 分 → 100% 优秀', () => {
  const all4 = assessment({
    heuristics: rubric.heuristics.map((h) => ({ id: h.id, score: 4, keyIssue: '无' })),
  })
  const score = m.scoreAssessment(all4, rubric)
  assert.equal(score.total, 40)
  assert.equal(score.max, 40)
  assert.equal(score.percent, 100)
  assert.equal(score.band, '优秀')
})

test('算分：档位边界（90 / 70 / 50 / 30）', () => {
  const withPercent = (percent) => {
    // 用 10 项构造精确百分比：total = percent/10
    const per = percent / 10
    const heuristics = rubric.heuristics.map((h, index) => ({
      id: h.id,
      // 前 index 项取 floor/ceil 组合，凑出目标总分
      score: index < Math.floor(per) ? 4 : index === Math.floor(per) && per % 4 ? Math.round(per % 4) : 0,
      keyIssue: '—',
    }))
    return m.scoreAssessment(assessment({ heuristics }), rubric)
  }
  assert.equal(withPercent(100).band, '优秀')
  assert.equal(withPercent(80).band, '良好')
  assert.equal(withPercent(60).band, '可接受')
  assert.equal(withPercent(40).band, '较差')
  assert.equal(withPercent(20).band, '严重')
})

test('B 阶段门禁：没有 a.json 时 readAssessment 必须报错并给出下一步', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ux-gate-'))
  try {
    const reviewId = 'p1-1700000000000-abcdef'
    mkdirSync(join(cwd, '.tianshu-canvas', 'audit', 'ux', reviewId), { recursive: true })
    // session.json 存在（readSession 通过），但没有 a.json
    writeFileSync(
      join(cwd, '.tianshu-canvas', 'audit', 'ux', reviewId, 'session.json'),
      JSON.stringify({ schema: 1, reviewId, pageId: 'p1', title: '页', mode: null, outputDir: '', shots: [], facts: {}, createdAt: '2026-01-01T00:00:00.000Z' }),
    )
    assert.throws(() => m.readAssessment(cwd, reviewId), /必须先完成 A/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('synthesize 门禁：缺 b.json 时报错', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ux-synth-'))
  try {
    const reviewId = 'p1-1700000000000-abcdef'
    const dir = join(cwd, '.tianshu-canvas', 'audit', 'ux', reviewId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.json'), JSON.stringify({ schema: 1, reviewId, pageId: 'p1', title: '页', mode: 'operate', outputDir: dir, shots: [{ width: 1440, height: 1000, path: join(dir, 'shot.png'), bytes: 1 }], facts: { viewport: '1440×1000', content: '1440×2000', elements: 10, headings: 2, controls: 3, fontStatus: 'ready', reducedMotion: true, internalScrollRegions: 0 }, createdAt: '2026-01-01T00:00:00.000Z' }))
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ ...assessment(), recordedAt: '2026-01-01T00:01:00.000Z' }))
    assert.throws(() => m.uxSynthesize(cwd, reviewId), /缺少 b\.json/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('synthesize：生成报告骨架并落盘 ux.json', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ux-ok-'))
  try {
    const reviewId = 'p1-1700000000000-abcdef'
    const dir = join(cwd, '.tianshu-canvas', 'audit', 'ux', reviewId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'session.json'),
      JSON.stringify({
        schema: 1,
        reviewId,
        pageId: 'p1',
        title: '订单页',
        mode: 'operate',
        outputDir: dir,
        shots: [{ width: 1440, height: 1000, path: join(dir, 'shot.png'), bytes: 1 }],
        facts: { viewport: '1440×1000', content: '1440×2000', elements: 10, headings: 2, controls: 3, fontStatus: 'ready', reducedMotion: true, internalScrollRegions: 0 },
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    )
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ ...assessment(), recordedAt: '2026-01-01T00:01:00.000Z' }))
    writeFileSync(
      join(dir, 'b.json'),
      JSON.stringify({
        contract: { score: 0.95, total: 2, byRule: { color: 2 }, unknownVars: [], unknownClasses: [], missingInteractionRuntime: false },
        a11y: { counts: { error: 1, warning: 2, info: 0 }, byRule: { contrast: 1 }, skipped: [] },
        quality: { counts: { warning: 1, advisory: 0 }, byRule: { 'tiny-text': 1 }, skipped: ['没有可测的文字元素'] },
        review: { issues: [{ rule: 'horizontal-overflow', severity: 'error', message: '横向溢出', width: 1440 }], limitations: ['客观几何不判断审美。'] },
        ranAt: '2026-01-01T00:02:00.000Z',
      }),
    )
    const result = m.uxSynthesize(cwd, reviewId)
    assert.equal(result.score.max, 36)
    assert.equal(existsSync(result.file), true)
    const payload = JSON.parse(readFileSync(result.file, 'utf8'))
    assert.equal(payload.schema, 1)
    assert.equal(payload.score.band, '良好')
    assert.ok(payload.limitations.some((l) => l.includes('不能替代项目所有者')))
    // 报告骨架必须包含关键小节，且不写审美判语
    for (const heading of ['方法：三段式隔离', '设计健康度', '设计特异性', 'A 与 B 的交叉核对', '确定性检测', '优先级问题', 'persona 红旗', '未测项与限制']) {
      assert.ok(result.report.includes(heading), `报告缺少小节：${heading}`)
    }
    assert.ok(result.report.includes('36'), '合计必须写出实际分母')
    assert.ok(!result.report.includes('/40'), '有 n/a 时不得写 /40')
    assert.ok(result.report.includes('评分来自代理的设计判断'))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('n/a 过多时 synthesize 给出警告', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ux-na-'))
  try {
    const reviewId = 'p1-1700000000000-abcdef'
    const dir = join(cwd, '.tianshu-canvas', 'audit', 'ux', reviewId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.json'), JSON.stringify({ schema: 1, reviewId, pageId: 'p1', title: '页', mode: null, outputDir: dir, shots: [], facts: {}, createdAt: '2026-01-01T00:00:00.000Z' }))
    // 只给 5 项计分 → 分母 20，应触发代表性不足警告
    const sparse = assessment({
      heuristics: rubric.heuristics.map((h, index) => ({
        id: h.id,
        score: index < 5 ? 3 : 'n/a',
        ...(index < 5 ? {} : { reason: '不适用' }),
        keyIssue: '—',
      })),
    })
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ ...sparse, recordedAt: '2026-01-01T00:01:00.000Z' }))
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ contract: { score: 1, total: 0, byRule: {}, unknownVars: [], unknownClasses: [], missingInteractionRuntime: false }, a11y: { counts: { error: 0, warning: 0, info: 0 }, byRule: {}, skipped: [] }, quality: { counts: { warning: 0, advisory: 0 }, byRule: {}, skipped: [] }, review: { issues: [], limitations: [] }, ranAt: '2026-01-01T00:02:00.000Z' }))
    const result = m.uxSynthesize(cwd, reviewId)
    assert.ok(result.warnings.some((w) => w.includes('代表性不足')), result.warnings.join('|'))
    assert.ok(result.report.startsWith('⚠️'), '警告必须出现在报告首行之前')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
