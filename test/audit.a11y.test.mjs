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
    rect: { x: 0, y: 0, width: 100, height: 40 },
    inlineText: false,
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

test('正文采集条目只参与对比度，不产生可访问名/焦点类误报', () => {
  const report = analyze(scan([
    item({ textOnly: true, tag: 'p', name: '正文', color: 'rgb(200, 200, 200)', selector: 'body > p' }),
  ]))
  assert.deepEqual(rules(report), ['contrast'])
})

test('textElements 未提供时报告回落为 0', () => {
  const report = analyze(scan([item({ tag: 'p', name: '正文' })]))
  assert.equal(report.textElements, 0)
})

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

test('目标尺寸：孤立的 16px 目标按 WCAG 间距豁免通过', () => {
  // 24px 圆不与任何其他目标重叠 → 通过（旧实现会误报）。
  const report = analyze(scan([item({ tag: 'button', name: '×', rect: { x: 0, y: 0, width: 16, height: 16 } })]))
  assert.ok(!rules(report).includes('target-size'), JSON.stringify(report.issues))
})

test('目标尺寸：两个相距 4px 的 16px 图标命中（密集图标栏）', () => {
  // 24px 圆直径大于 16px 目标，间距 4px 时两圆相交 → 间距豁免不成立。
  const report = analyze(scan([
    item({ tag: 'button', name: '粗体', rect: { x: 0, y: 0, width: 16, height: 16 } }),
    item({ tag: 'button', name: '斜体', rect: { x: 20, y: 0, width: 16, height: 16 } }),
  ]))
  assert.equal(report.byRule['target-size'] ?? 0, 2, JSON.stringify(report.issues))
})

test('目标尺寸：间距 10px 的两个 16px 图标按间距豁免通过', () => {
  // 圆半径 12、目标半宽 8：两圆要相交，中心距必须 ≤24，即间隙 ≤8px。
  const report = analyze(scan([
    item({ tag: 'button', name: '粗体', rect: { x: 0, y: 0, width: 16, height: 16 } }),
    item({ tag: 'button', name: '斜体', rect: { x: 26, y: 0, width: 16, height: 16 } }),
  ]))
  assert.equal(report.byRule['target-size'] ?? 0, 0, JSON.stringify(report.issues))
})

test('目标尺寸：行内文字中的链接按 WCAG 2.5.8 inline 例外跳过', () => {
  const report = analyze(scan([
    item({ tag: 'a', name: '文档', inlineText: true, rect: { x: 0, y: 0, width: 30, height: 16 } }),
    item({ tag: 'button', name: '×', rect: { x: 200, y: 0, width: 16, height: 16 } }),
  ]))
  assert.equal(report.byRule['target-size'] ?? 0, 0, JSON.stringify(report.issues))
})

test('移动轮次：44px 设计地板对 36px 按钮报警，桌面 24px 档不报', () => {
  const scan36 = () => scan([item({ tag: 'button', name: '保存', rect: { x: 0, y: 0, width: 36, height: 36 } })])
  const desktop = analyze(scan36(), { minTargetSize: 24 })
  assert.equal(desktop.byRule['target-size'] ?? 0, 0, '桌面 36px 满足 24px')
  const mobile = analyze(scan36(), { minTargetSize: 44, spacingExemption: false, viewportLabel: '375×812', only: ['target-size'] })
  assert.equal(mobile.byRule['target-size'] ?? 0, 1, '移动 44px 地板应命中')
  assert.match(mobile.issues[0].message, /375×812/)
})

test('目标尺寸：only 过滤只保留指定规则', () => {
  const report = analyze(scan([
    item({ tag: 'img', alt: null }),
    item({ tag: 'button', name: '×', rect: { x: 0, y: 0, width: 16, height: 16 } }),
    item({ tag: 'button', name: 'y', rect: { x: 10, y: 0, width: 16, height: 16 } }),
  ]), { only: ['target-size'] })
  assert.deepEqual(Object.keys(report.byRule), ['target-size'])
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
