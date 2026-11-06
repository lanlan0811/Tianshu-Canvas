/**
 * 可访问性规则集单测：纯判定层（analyze）——真阳必须报，真阴不能误报。
 */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const { analyze, contrastRgb, parseRgb } = await import(pathToFileURL(join(root, 'src', 'audit', 'a11y.ts')).href)

function item(overrides = {}) {
  return {
    tag: 'div',
    selector: 'div',
    snippet: '<div></div>',
    name: '',
    ariaLabel: '',
    ariaHidden: null,
    tabindex: null,
    role: '',
    type: '',
    alt: null,
    id: '',
    htmlFor: '',
    rect: { width: 100, height: 40 },
    color: 'rgb(0, 0, 0)',
    fontSize: 16,
    fontWeight: 400,
    background: { kind: 'color', color: 'rgb(255, 255, 255)' },
    outlineStyle: 'auto',
    outlineWidth: '1px',
    boxShadow: 'none',
    level: 0,
    disabled: false,
    contentEditable: null,
    hasLabel: false,
    ...overrides,
  }
}

function scan(items, htmlLang = 'zh-CN') {
  return { elements: items.length, items, skipped: [], htmlLang }
}

const rules = (report) => report.issues.map((i) => i.rule)

test('合规页面：0 error（真阴）', () => {
  const report = analyze(
    scan([
      item({ tag: 'h1', level: 1, name: '概览', color: 'rgb(20, 20, 20)' }),
      item({ tag: 'button', name: '新建', color: 'rgb(255, 255, 255)', background: { kind: 'color', color: 'rgb(0, 113, 227)' } }),
      item({ tag: 'a', name: '文档' }),
      item({ tag: 'input', name: '搜索', hasLabel: true, ariaLabel: '搜索' }),
      item({ tag: 'img', alt: '图表', name: '图表' }),
    ]),
  )
  assert.equal(report.counts.error, 0, JSON.stringify(report.issues))
})

test('图片缺 alt 报 error', () => {
  const report = analyze(scan([item({ tag: 'img', alt: null })]))
  assert.ok(rules(report).includes('img-alt'))
})

test('按钮/链接无可访问名报 error', () => {
  const report = analyze(scan([item({ tag: 'button' }), item({ tag: 'a', name: '' })]))
  assert.ok(rules(report).includes('button-name'))
  assert.ok(rules(report).includes('link-name'))
})

test('表单控件无标签报 error；有 aria-label 或 label 不报', () => {
  const bad = analyze(scan([item({ tag: 'input', type: 'text' })]))
  assert.ok(rules(bad).includes('label'))
  const good = analyze(scan([item({ tag: 'input', type: 'text', ariaLabel: '邮箱', hasLabel: true })]))
  assert.ok(!rules(good).includes('label'))
  const submit = analyze(scan([item({ tag: 'input', type: 'submit', name: '提交' })]))
  assert.ok(!rules(submit).includes('label'))
})

test('对比度：黑字白底通过，灰字白底报 error', () => {
  const ok = analyze(scan([item({ tag: 'p', name: '正文', color: 'rgb(0, 0, 0)' })]))
  assert.ok(!rules(ok).includes('contrast'))
  const bad = analyze(scan([item({ tag: 'p', name: '正文', color: 'rgb(200, 200, 200)' })]))
  assert.ok(rules(bad).includes('contrast'))
})

test('对比度：大字号阈值放宽到 3:1', () => {
  // #949494 对白色约 3.03:1 —— 正文不达标，大字号达标。
  const color = 'rgb(148, 148, 148)'
  const normal = analyze(scan([item({ tag: 'p', name: '正文', color, fontSize: 16 })]))
  assert.ok(rules(normal).includes('contrast'))
  const large = analyze(scan([item({ tag: 'p', name: '标题', color, fontSize: 28, fontWeight: 700 })]))
  assert.ok(!rules(large).includes('contrast'))
})

test('背景是渐变/图片时跳过对比度并记录原因（防误报）', () => {
  const report = analyze(scan([item({ tag: 'p', name: '正文', color: 'rgb(200, 200, 200)', background: { kind: 'image', color: '' } })]))
  assert.ok(!rules(report).includes('contrast'))
  assert.ok(report.skipped.some((s) => s.includes('跳过对比度')))
})

test('标题层级跳跃与多个 h1 报 warning', () => {
  const report = analyze(
    scan([
      item({ tag: 'h1', level: 1, name: 'A' }),
      item({ tag: 'h1', level: 1, name: 'B' }),
      item({ tag: 'h4', level: 4, name: 'C' }),
    ]),
  )
  assert.ok(rules(report).includes('heading-h1'))
  assert.ok(rules(report).includes('heading-order'))
})

test('tabindex>0 报 warning，aria-hidden 可聚焦元素报 error', () => {
  const report = analyze(scan([item({ tag: 'div', tabindex: '3' }), item({ tag: 'button', name: '关闭', ariaHidden: 'true' })]))
  assert.ok(rules(report).includes('tabindex-positive'))
  assert.ok(rules(report).includes('aria-hidden-focus'))
})

test('目标尺寸过小报 warning', () => {
  const report = analyze(scan([item({ tag: 'button', name: '×', rect: { width: 16, height: 16 } })]))
  assert.ok(rules(report).includes('target-size'))
})

test('缺少 lang 报 warning', () => {
  const report = analyze(scan([item({ tag: 'p', name: '文本' })], ''))
  assert.ok(rules(report).includes('html-lang'))
})

test('规则 id 稳定且不重复（防止报告漂移）', () => {
  const report = analyze(scan([item({ tag: 'img', alt: null }), item({ tag: 'button' })]))
  for (const issue of report.issues) assert.match(issue.rule, /^[a-z0-9-]+$/)
  assert.equal(Object.values(report.counts).reduce((a, b) => a + b, 0), report.issues.length)
  assert.equal(Object.values(report.byRule).reduce((a, b) => a + b, 0), report.issues.length)
})

test('对比度数学正确', () => {
  assert.equal(contrastRgb([0, 0, 0], [255, 255, 255]).toFixed(2), '21.00')
  assert.deepEqual(parseRgb('rgb(1, 2, 3)'), [1, 2, 3])
  assert.deepEqual(parseRgb('rgba(4, 5, 6, 0.5)'), [4, 5, 6])
})
