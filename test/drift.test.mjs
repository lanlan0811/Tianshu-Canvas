/**
 * 漂移检测的纯函数测试：快照三字段、报告排序、旧版升级提示。
 * 不启动浏览器——只验证 diffSnapshots / formatDriftReport / readSnapshot 的行为。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
/* drift.ts 依赖 TS 模块（paths/design/components），裸 import 会因 .js 后缀解析失败；
   用 esbuild 现场打包成单文件再导入（与 rules.unit.test.mjs 同一手法）。 */
const apiDir = mkdtempSync(join(tmpdir(), 'tsc-drift-unit-'))
await build({
  stdin: { contents: "export * from './src/audit/drift.ts';", resolveDir: root },
  outfile: join(apiDir, 'drift.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'silent',
})
const { diffSnapshots, formatDriftReport, readSnapshot, writeSnapshot } = await import(
  pathToFileURL(join(apiDir, 'drift.mjs')).href
)
test.after(() => rmSync(apiDir, { recursive: true, force: true }))

function snapshot(overrides = {}) {
  return {
    schemaVersion: 2,
    styleId: 'tianshu-original',
    vars: ['--ts-color-text-primary'],
    declaredClasses: ['ts-btn'],
    usedVars: ['--ts-color-text-primary'],
    classes: ['ts-btn'],
    icons: [],
    modes: ['persuade'],
    usedStates: [{ component: 'button', states: ['hover', 'focus'] }],
    browserSurfaces: ['::selection', 'caret-color'],
    pageStates: ['loading'],
    hashes: { tokens: 'aaa', components: 'bbb' },
    ...overrides,
  }
}

test('无差异时报告「未检测到漂移」', () => {
  const report = formatDriftReport(diffSnapshots(snapshot(), snapshot()), '上次', '当前')
  assert.match(report, /未检测到漂移/)
})

test('模式变化单列一行', () => {
  const after = snapshot({ modes: ['operate'] })
  const report = formatDriftReport(diffSnapshots(snapshot(), after), '上次', '当前')
  assert.match(report, /模式：persuade → operate/)
})

test('组件状态丢失与新增分别列出', () => {
  const after = snapshot({ usedStates: [{ component: 'button', states: ['hover'] }, { component: 'input', states: ['error'] }] })
  const drift = diffSnapshots(snapshot(), after)
  assert.deepEqual(drift.statesRemoved, ['button:focus'])
  assert.deepEqual(drift.statesAdded, ['input:error'])
  const report = formatDriftReport(drift, '上次', '当前')
  assert.match(report, /丢失的组件状态 1 项：button:focus/)
  assert.match(report, /新增的组件状态 1 项：input:error/)
})

test('浏览器表面增减分别列出', () => {
  const after = snapshot({ browserSurfaces: ['::selection', 'tabular-nums'] })
  const drift = diffSnapshots(snapshot(), after)
  assert.deepEqual(drift.surfacesAdded, ['tabular-nums'])
  assert.deepEqual(drift.surfacesRemoved, ['caret-color'])
  const report = formatDriftReport(drift, '上次', '当前')
  assert.match(report, /浏览器表面：\+1\/-1/)
})

test('报告按严重度排序：越界 > 未使用 > 移除 > 新增', () => {
  const before = snapshot({ vars: ['--ts-color-text-primary', '--ts-color-bg-canvas'], usedVars: [] })
  const after = snapshot({
    vars: ['--ts-color-text-primary', '--ts-color-bg-canvas', '--ts-color-bg-raised'],
    usedVars: ['--ts-color-unknown'],
    classes: ['ts-btn', 'ts-unknown'],
  })
  const report = formatDriftReport(diffSnapshots(before, after), '上次', '当前')
  const order = ['越界', '未使用', '新增'].map((label) => report.indexOf(label))
  assert.ok(order.every((index) => index >= 0), report)
  assert.ok(order[0] < order[1] && order[1] < order[2], `顺序不对：\n${report}`)
})

test('未使用补名单（旧版只给数量）', () => {
  const before = snapshot()
  const after = snapshot({ vars: ['--ts-color-text-primary', '--ts-color-bg-canvas'], usedVars: ['--ts-color-text-primary'] })
  const report = formatDriftReport(diffSnapshots(before, after), '上次', '当前')
  assert.match(report, /未使用 1 项：--ts-color-bg-canvas/)
})

test('旧版快照读入后补齐字段，并在 diff 里标记升级', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-drift-v1-'))
  try {
    const file = join(cwd, 'snapshot.json')
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      styleId: 'tianshu-original',
      vars: ['--ts-color-text-primary'],
      declaredClasses: ['ts-btn'],
      usedVars: ['--ts-color-text-primary'],
      classes: ['ts-btn'],
      icons: [],
      hashes: { tokens: 'aaa', components: 'bbb' },
    }) + '\n')
    const before = readSnapshot(cwd, file)
    assert.equal(before.schemaVersion, 2)
    assert.deepEqual(before.modes, [])
    assert.deepEqual(before.usedStates, [])
    assert.deepEqual(before.browserSurfaces, [])
    const drift = diffSnapshots(before, snapshot())
    assert.equal(drift.upgradedFromV1, true)
    assert.match(formatDriftReport(drift, '上次', '当前'), /基线来自旧版快照/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('页面侧状态信号增减分别列出', () => {
  const after = snapshot({ pageStates: ['error', 'loading'] })
  const drift = diffSnapshots(snapshot(), after)
  assert.deepEqual(drift.pageStatesAdded, ['error'])
  assert.deepEqual(drift.pageStatesRemoved, [])
  const report = formatDriftReport(drift, '上次', '当前')
  assert.match(report, /页面新增的状态：error/)

  const back = diffSnapshots(after, snapshot({ pageStates: [] }))
  assert.deepEqual(back.pageStatesRemoved, ['error', 'loading'])
  assert.match(formatDriftReport(back, '上次', '当前'), /页面不再使用的状态：error、loading/)
})

test('快照写盘确定性：同输入两次字节相同', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-drift-write-'))
  try {
    const a = join(cwd, 'a.json')
    const b = join(cwd, 'b.json')
    writeSnapshot(cwd, a, snapshot())
    writeSnapshot(cwd, b, snapshot())
    assert.equal(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
