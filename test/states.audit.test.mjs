/**
 * 状态完整性审计的纯判定层：真阳必须报、真阴不能误报。
 * 采集脚本本身由 audit.states.e2e 在真实浏览器里验证。
 */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const { analyzeStates } = await import(pathToFileURL(join(root, 'src', 'audit', 'states.ts')).href)

function container(overrides = {}) {
  return {
    kind: 'list',
    selector: 'ul.items',
    snippet: '<ul class="items"></ul>',
    items: 0,
    emptyHint: false,
    emptyHasAction: false,
    paged: false,
    hasSubmit: false,
    submitGuarded: false,
    ...overrides,
  }
}

function scan(containers, busy = [], extra = {}) {
  return { containers, busy, rows: containers.reduce((n, c) => n + c.items, 0), skipped: [], hasScript: true, ...extra }
}

const rules = (report) => report.issues.map((i) => i.rule)

test('空列表没有提示：报 empty-list-no-hint', () => {
  const report = analyzeStates(scan([container()]))
  assert.deepEqual(rules(report), ['empty-list-no-hint'])
  assert.equal(report.counts.warning, 1)
})

test('空列表有提示但没有下一步：报 empty-hint-no-action', () => {
  const report = analyzeStates(scan([container({ emptyHint: true, emptyHasAction: false })]))
  assert.deepEqual(rules(report), ['empty-hint-no-action'])
  assert.equal(report.counts.advisory, 1)
})

test('空列表有提示且有动作：不报（真阴）', () => {
  const report = analyzeStates(scan([container({ emptyHint: true, emptyHasAction: true })]))
  assert.deepEqual(report.issues, [])
})

test('有数据的列表不触发空态规则', () => {
  const report = analyzeStates(scan([container({ items: 12 })]))
  assert.deepEqual(report.issues, [])
})

test('大数据集超过阈值且无分页：报 large-dataset-unpaged', () => {
  const report = analyzeStates(scan([container({ items: 1200 })]))
  assert.deepEqual(rules(report), ['large-dataset-unpaged'])
})

test('大数据集有分页：不报', () => {
  const report = analyzeStates(scan([container({ items: 1200, paged: true })]))
  assert.deepEqual(report.issues, [])
})

test('大数据集阈值可配置（默认 1000）', () => {
  assert.deepEqual(analyzeStates(scan([container({ items: 120 })])).issues, [])
  const strict = analyzeStates(scan([container({ items: 120 })]), { largeRows: 100 })
  assert.deepEqual(rules(strict), ['large-dataset-unpaged'])
})

test('表格与列表共享同一判定', () => {
  const report = analyzeStates(scan([container({ kind: 'table', selector: 'table.rows', items: 0 })]))
  assert.deepEqual(rules(report), ['empty-list-no-hint'])
})

test('加载态未被播报：报 loading-unannounced', () => {
  const report = analyzeStates(scan([], [
    { selector: 'div.skeleton', snippet: '<div aria-busy="true"></div>', announced: false, labelled: false },
  ]))
  assert.deepEqual(rules(report), ['loading-unannounced'])
})

test('加载态在 live 区域内或有文案：不报', () => {
  const announced = analyzeStates(scan([], [
    { selector: 'div.skeleton', snippet: '<div aria-busy="true"></div>', announced: true, labelled: false },
  ]))
  assert.deepEqual(announced.issues, [])
  const labelled = analyzeStates(scan([], [
    { selector: 'div.skeleton', snippet: '<div aria-busy="true" aria-label="正在加载"></div>', announced: false, labelled: true },
  ]))
  assert.deepEqual(labelled.issues, [])
})

test('表单无防重复提交痕迹：报 submit-unguarded', () => {
  const report = analyzeStates(scan([container({ kind: 'form', selector: 'form.save', hasSubmit: true, submitGuarded: false })]))
  assert.deepEqual(rules(report), ['submit-unguarded'])
})

test('表单有 aria-busy 或 data-ts-form：不报', () => {
  const report = analyzeStates(scan([container({ kind: 'form', selector: 'form.save', hasSubmit: true, submitGuarded: true })]))
  assert.deepEqual(report.issues, [])
})

test('权限与并发必须写进 skipped，不得当成通过', () => {
  const report = analyzeStates(scan([], [], {
    skipped: [
      '权限三态（无权限 / 只读 / 编辑受限）无法从静态渲染判定，需人工核实',
      '并发竞态（双提交、乐观更新回滚）无法从静态渲染判定，需人工核实',
    ],
  }))
  assert.equal(report.skipped.length, 2)
  assert.ok(report.skipped.some((s) => s.includes('权限')))
  assert.ok(report.skipped.some((s) => s.includes('并发')))
  assert.deepEqual(report.issues, [], 'skipped 不等于违规，但也不能算通过')
})

test('ignore 按选择器子串生效', () => {
  const report = analyzeStates(
    scan([container({ selector: 'ul.items' }), container({ selector: 'ul.other' })]),
    { ignore: ['ul.items'] },
  )
  assert.equal(report.issues.length, 1)
  assert.match(report.issues[0].selector, /ul\.other/)
})

test('报告确定性：同一输入两次结果完全一致', () => {
  const raw = scan([container(), container({ items: 1200 }), container({ kind: 'form', selector: 'form.x', hasSubmit: true })])
  assert.deepEqual(analyzeStates(raw), analyzeStates(raw))
})

test('计数自洽：counts 与 byRule 合计都等于 issues 数', () => {
  const report = analyzeStates(scan([container(), container({ items: 1200 }), container({ kind: 'form', selector: 'form.x', hasSubmit: true })]))
  assert.equal(report.counts.warning + report.counts.advisory, report.issues.length)
  assert.equal(Object.values(report.byRule).reduce((a, b) => a + b, 0), report.issues.length)
})
