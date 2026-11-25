/**
 * 动效判定的纯函数测试（零浏览器）。
 *
 * analyzeMotion 只吃帧序列，因此可以精确构造"首帧跳变""中间跳帧"
 * "中间被裁切""reduced 没减少位移"这些形状，并断言不误报。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const apiDir = mkdtempSync(join(tmpdir(), 'tsc-motion-unit-'))
await build({
  stdin: { contents: "export { analyzeMotion, MOTION_THRESHOLDS, formatMotionReport } from './src/audit/motion.ts'", resolveDir: root },
  outfile: join(apiDir, 'motion.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'silent',
})
const m = await import(pathToFileURL(join(apiDir, 'motion.mjs')).href)
test.after(() => rmSync(apiDir, { recursive: true, force: true }))

/** 造一帧：ratio 是相对首帧的变化比例，span 是位移跨度。 */
function frame(index, ratio, span = Math.round(ratio * 200), elapsedMs = index * 100) {
  return {
    index,
    elapsedMs,
    changeRatio: ratio,
    bbox: ratio > 0 ? { x: 0, y: 0, width: span, height: span } : null,
    span,
    path: `frame-${index}.png`,
  }
}

function seq(ratios, spans = null, stepMs = 100) {
  return {
    frames: ratios.map((ratio, index) => frame(index, ratio, spans ? spans[index] : Math.round(ratio * 200), index * stepMs)),
    durationMs: (ratios.length - 1) * stepMs,
  }
}

test('正常渐入：不报任何发现', () => {
  const findings = m.analyzeMotion(seq([0, 0.05, 0.2, 0.45, 0.7, 0.9, 0.95]), null)
  assert.deepEqual(findings, [])
})

test('start-jump：第 1 帧即完成全部变化且后续不动', () => {
  const findings = m.analyzeMotion(seq([0, 0.6, 0.605, 0.61, 0.61, 0.61, 0.61]), null)
  assert.ok(findings.some((f) => f.kind === 'start-jump'), JSON.stringify(findings))
})

test('正常渐入不误报 start-jump（后续仍有变化）', () => {
  const findings = m.analyzeMotion(seq([0, 0.1, 0.3, 0.5, 0.7, 0.85, 0.9]), null)
  assert.ok(!findings.some((f) => f.kind === 'start-jump'), JSON.stringify(findings))
})

test('end-jump：末帧相对前一帧仍有大变化', () => {
  const findings = m.analyzeMotion(seq([0, 0.1, 0.2, 0.3, 0.4, 0.45, 0.7]), null)
  assert.ok(findings.some((f) => f.kind === 'end-jump'), JSON.stringify(findings))
})

test('mid-step：中间单帧跳变且超过相邻帧 4 倍', () => {
  const findings = m.analyzeMotion(seq([0, 0.01, 0.02, 0.4, 0.42, 0.43, 0.43]), null)
  assert.ok(findings.some((f) => f.kind === 'mid-step'), JSON.stringify(findings))
})

test('mid-step：均匀变化不误报', () => {
  const findings = m.analyzeMotion(seq([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]), null)
  assert.ok(!findings.some((f) => f.kind === 'mid-step'), JSON.stringify(findings))
})

test('clipped-midway：中间出现而首末都平静', () => {
  const findings = m.analyzeMotion(seq([0, 0.002, 0.05, 0.08, 0.05, 0.002, 0.002]), null)
  assert.ok(findings.some((f) => f.kind === 'clipped-midway'), JSON.stringify(findings))
})

test('clipped-midway：末帧仍有变化时不算被裁切（那是正常过渡）', () => {
  const findings = m.analyzeMotion(seq([0, 0.02, 0.2, 0.4, 0.6, 0.8, 0.9]), null)
  assert.ok(!findings.some((f) => f.kind === 'clipped-midway'), JSON.stringify(findings))
})

test('reduced-motion-ignored：跨度与基线相同即报', () => {
  const normal = seq([0, 0.2, 0.5, 0.8, 0.95], [0, 40, 100, 160, 200], 200)
  const reduced = seq([0, 0.2, 0.5, 0.8, 0.95], [0, 40, 100, 160, 195], 200)
  const findings = m.analyzeMotion(normal, reduced)
  assert.ok(findings.some((f) => f.kind === 'reduced-motion-ignored'), JSON.stringify(findings))
})

test('reduced 正确减少位移时不报', () => {
  const normal = seq([0, 0.2, 0.5, 0.8, 0.95], [0, 40, 100, 160, 200], 200)
  const reduced = seq([0, 0.05, 0.1, 0.12, 0.12], [0, 2, 4, 5, 5], 200)
  const findings = m.analyzeMotion(normal, reduced)
  assert.ok(!findings.some((f) => f.kind === 'reduced-motion-ignored'), JSON.stringify(findings))
})

test('基线跨度太小或时长太短时不做 reduced 比较', () => {
  const tinySpan = m.analyzeMotion(seq([0, 0.3, 0.6], [0, 2, 3], 200), seq([0, 0.3, 0.6], [0, 2, 3], 200))
  assert.ok(!tinySpan.some((f) => f.kind === 'reduced-motion-ignored'), '跨度不足 4px 不应比较')
  const short = m.analyzeMotion(seq([0, 0.3, 0.6], [0, 100, 200], 40), seq([0, 0.3, 0.6], [0, 100, 200], 40))
  assert.ok(!short.some((f) => f.kind === 'reduced-motion-ignored'), '时长不足 100ms 不应比较')
})

test('帧数不足时返回空（不猜）', () => {
  assert.deepEqual(m.analyzeMotion(seq([0, 0.5]), null), [])
})

test('确定性：同一输入两次结果完全一致', () => {
  const normal = seq([0, 0.01, 0.02, 0.5, 0.52, 0.52, 0.52])
  const a = m.analyzeMotion(normal, null)
  const b = m.analyzeMotion(normal, null)
  assert.deepEqual(a, b)
})

test('报告格式：含选择器、帧序列、未测项', () => {
  const capture = { label: 'normal', dir: '/tmp', frames: seq([0, 0.5, 0.9]).frames, filmstrip: '/tmp/filmstrip.png', viewer: '/tmp/index.html', report: '/tmp/report.json', durationMs: 200, totalSpan: 180 }
  const report = {
    pageId: 'p1',
    selector: '#open',
    region: null,
    viewport: { width: 1000, height: 760 },
    normal: capture,
    reduced: null,
    findings: m.analyzeMotion(seq([0, 0.9, 0.9]), null),
    limitations: ['采样帧数固定，只证明这些帧上的变化，不证明动画平滑。'],
  }
  const text = m.formatMotionReport(report)
  assert.match(text, /动效抓帧审计：p1/)
  assert.match(text, /选择器 #open/)
  assert.match(text, /未测项/)
  assert.match(text, /filmstrip/)
})
