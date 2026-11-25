/**
 * 渲染级工艺审计的纯判定测试（零浏览器）。
 *
 * analyzeQuality / analyzeHierarchy 只吃采集证据，因此可以直接构造 RawQualityScan。
 * 统一写法：先取 report，再断言规则名数组，避免深层括号嵌套。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const apiDir = mkdtempSync(join(tmpdir(), 'tsc-quality-unit-'))
await build({
  stdin: { contents: "export * from './src/audit/quality.ts';", resolveDir: root },
  outfile: join(apiDir, 'quality.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'silent',
})
const m = await import(pathToFileURL(join(apiDir, 'quality.mjs')).href)
test.after(() => rmSync(apiDir, { recursive: true, force: true }))

/** 构造一条采集证据；未指定的字段用「正常正文」默认值。 */
function item(overrides = {}) {
  return {
    tag: 'p',
    selector: 'p.text',
    snippet: '<p class="text">示例文本</p>',
    text: '这是一段用于测试的正文内容，长度足够触发多行判定。',
    textChars: 26,
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 24,
    letterSpacing: 0,
    textTransform: 'none',
    isHeading: false,
    headingLevel: 0,
    interactive: false,
    uiText: false,
    isCjk: true,
    lines: 2,
    charsPerLine: 30,
    gapBelow: 16,
    gapAbove: 16,
    inSmallCard: false,
    inBlockquote: false,
    hasTextWrapBalance: false,
    hasTextWrapPretty: false,
    displayInline: false,
    ...overrides,
  }
}

function scan(items, extra = {}) {
  return {
    elements: items.length,
    multiLine: items.filter((i) => i.lines > 1).length,
    items,
    skipped: [],
    fontStatus: '',
    ...extra,
  }
}

/** 跑一次判定，返回规则名数组。 */
function rules(items, options = {}) {
  return m.analyzeQuality(scan(items), options).issues.map((i) => i.rule)
}

test('tiny-text：正文 <12px 报，标题不报', () => {
  const report = m.analyzeQuality(
    scan([item({ fontSize: 11 }), item({ fontSize: 11, isHeading: true, headingLevel: 1, textChars: 4 })]),
  )
  assert.deepEqual(report.issues.map((i) => i.rule), ['tiny-text'])
  assert.equal(report.issues[0].severity, 'warning')
})

test('tiny-text：12px 及以上的正文不报', () => {
  assert.deepEqual(rules([item({ fontSize: 12 })]), [])
})

test('undersized-ui-text：功能性文字 <11px 报，普通正文不报', () => {
  assert.deepEqual(rules([item({ uiText: true, fontSize: 10, textChars: 4 })]), ['undersized-ui-text'])
  assert.deepEqual(rules([item({ fontSize: 10, textChars: 4, text: '短' })]), [])
})

test('all-caps-body：≥80 字符大写段落报，短标签与标题不报', () => {
  assert.deepEqual(rules([item({ textTransform: 'uppercase', textChars: 96 })]), ['all-caps-body'])
  assert.deepEqual(rules([item({ textTransform: 'uppercase', textChars: 20 })]), [])
  assert.deepEqual(rules([item({ textTransform: 'uppercase', textChars: 120, isHeading: true })]), [])
})

test('wide-tracking：字距 >0.05em 且 >20 字符报；短大写标签与 CJK 不报', () => {
  assert.deepEqual(rules([item({ letterSpacing: 1.6, isCjk: false, textChars: 30 })]), ['wide-tracking'])
  const capsLabel = item({
    letterSpacing: 1.6,
    isCjk: false,
    textChars: 30,
    textTransform: 'uppercase',
    lines: 1,
  })
  assert.deepEqual(rules([capsLabel]), [])
  assert.deepEqual(rules([item({ letterSpacing: 1.6, isCjk: true, textChars: 30 })]), [])
})

test('tight-leading：行高比 <1.3 的多行正文报；导语、粗标题、单行豁免', () => {
  assert.deepEqual(rules([item({ lineHeight: 18, fontSize: 16, textChars: 60, lines: 3 })]), ['tight-leading'])
  const lead = item({ fontSize: 20, lineHeight: 24, textChars: 60, lines: 2 })
  assert.deepEqual(rules([lead]), [])
  const bold = item({ fontSize: 18, lineHeight: 20, textChars: 60, lines: 2, fontWeight: 700 })
  assert.deepEqual(rules([bold]), [])
  const single = item({ lineHeight: 18, fontSize: 16, textChars: 60, lines: 1 })
  assert.deepEqual(rules([single]), [])
})

test('line-length：单行 >85 字符且多行报；CJK 与单行不判', () => {
  assert.deepEqual(rules([item({ charsPerLine: 92, lines: 3, isCjk: false })]), ['line-length'])
  assert.deepEqual(rules([item({ charsPerLine: 92, lines: 3, isCjk: true })]), [])
  assert.deepEqual(rules([item({ charsPerLine: 92, lines: 1, isCjk: false })]), [])
})

test('line-length：lineMax 可配置', () => {
  assert.deepEqual(rules([item({ charsPerLine: 70, lines: 2, isCjk: false })], { lineMax: 60 }), ['line-length'])
})

test('heading-rhythm：上方间距明显小于下方时报；卡片内、h1 与正常节奏豁免', () => {
  const crowded = item({ isHeading: true, headingLevel: 2, gapAbove: 8, gapBelow: 40 })
  assert.deepEqual(rules([crowded]), ['heading-rhythm'])
  const inCard = item({ isHeading: true, headingLevel: 2, gapAbove: 8, gapBelow: 40, inSmallCard: true })
  assert.deepEqual(rules([inCard]), [])
  const normal = item({ isHeading: true, headingLevel: 2, gapAbove: 40, gapBelow: 12 })
  assert.deepEqual(rules([normal]), [])
  const h1 = item({ isHeading: true, headingLevel: 1, gapAbove: 8, gapBelow: 40 })
  assert.deepEqual(rules([h1]), [])
})

test('flat-type-hierarchy：标题/正文步进 <1.25 报 warning', () => {
  const report = m.analyzeQuality(
    scan([
      item({ fontSize: 16 }),
      item({ fontSize: 16, selector: 'p.b' }),
      item({ fontSize: 18, isHeading: true, headingLevel: 2, textChars: 6, lineHeight: 24 }),
    ]),
  )
  const flat = report.issues.find((i) => i.rule === 'flat-type-hierarchy')
  assert.ok(flat, JSON.stringify(report.issues))
  assert.equal(flat.severity, 'warning')
})

test('flat-type-hierarchy：步进 ≥1.25 不报', () => {
  const report = m.analyzeQuality(
    scan([
      item({ fontSize: 16 }),
      item({ fontSize: 16, selector: 'p.b' }),
      item({ fontSize: 28, isHeading: true, headingLevel: 2, textChars: 6, lineHeight: 36 }),
    ]),
  )
  assert.equal(
    report.issues.some((i) => i.rule === 'flat-type-hierarchy'),
    false,
  )
})

test('flat-type-hierarchy：字重差 ≥200 且占多数时降级 advisory', () => {
  const report = m.analyzeQuality(
    scan([
      item({ fontSize: 16 }),
      item({ fontSize: 16, selector: 'p.b' }),
      item({ fontSize: 18, fontWeight: 700, isHeading: true, headingLevel: 2, textChars: 6, lineHeight: 24 }),
    ]),
  )
  const flat = report.issues.find((i) => i.rule === 'flat-type-hierarchy')
  assert.ok(flat, JSON.stringify(report.issues))
  assert.equal(flat.severity, 'advisory')
})

test('字号层级：正文或标题不足时跳过并写明原因', () => {
  const noBody = m.analyzeQuality(scan([item({ isHeading: true, headingLevel: 2, fontSize: 32, textChars: 6 })]))
  assert.ok(
    noBody.skipped.some((s) => s.includes('正文字块不足')),
    noBody.skipped.join('|'),
  )
  const noHeading = m.analyzeQuality(scan([item({ fontSize: 16 }), item({ fontSize: 16 })]))
  assert.ok(
    noHeading.skipped.some((s) => s.includes('没有标题')),
    noHeading.skipped.join('|'),
  )
})

test('空页面：不报问题，但明确写出未判定', () => {
  const report = m.analyzeQuality(scan([]))
  assert.deepEqual(report.issues, [])
  assert.ok(
    report.skipped.some((s) => s.includes('没有可测的文字元素')),
    report.skipped.join('|'),
  )
})

test('ignore 选择器：命中的元素被跳过', () => {
  assert.deepEqual(rules([item({ fontSize: 11, selector: 'td.meta' })], { ignore: ['td.meta'] }), [])
})

test('阈值可配置：minBodyPx / minUiPx', () => {
  assert.deepEqual(rules([item({ fontSize: 13 })], { minBodyPx: 14 }), ['tiny-text'])
  assert.deepEqual(rules([item({ uiText: true, fontSize: 12, textChars: 4 })], { minUiPx: 13 }), ['undersized-ui-text'])
})

test('报告格式：含标题行、计数、选择器与跳过说明', () => {
  const report = m.analyzeQuality(scan([item({ fontSize: 11 })]))
  const text = m.formatQualityReport(report, '页面「测试」')
  assert.match(text, /渲染工艺审计：页面「测试」/)
  assert.match(text, /warning 1/)
  assert.match(text, /- \[warning\] tiny-text/)
  assert.match(text, /选择器：/)
})
