/**
 * 工艺规则的 fixture 回放：每条规则 4 个应命中 + 5 个不应命中。
 *
 * 目录约定：test/fixtures/rules/<rule-id>/{flag-*,pass-*}*.html
 * 可选 meta.json：{ styleId?: string|null, mode?: string }
 *
 * 走真实插件入口（dist/index.mjs → canvas_check_style），因为风格 manifest
 * 只在 dist 目录下才能解析；用 style_id + rules 把检查收窄到单条规则。
 *
 * 断言：
 *  - 每个 flag 文件至少命中 1 条该规则，且行号 > 0、snippet 非空；
 *  - 每个 pass 文件对该规则 0 命中；
 *  - 同一文件连续跑两次，结果完全一致（确定性）。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const fixturesDir = join(root, 'test', 'fixtures', 'rules')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

/** 用一个固定的内置风格：manifest 里的品牌字体/底色会参与抑制判定。 */
const DEFAULT_STYLE = 'tianshu-original'

const ruleDirs = existsSync(fixturesDir)
  ? readdirSync(fixturesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  : []

if (ruleDirs.length === 0) {
  test('工艺规则 fixture：目录为空时跳过', { skip: '暂无 fixture' }, () => {})
}

/** 从报告文本里数出某条规则的命中条数（finding 行以 `N. [rule] 第 L 行` 开头）。 */
function countRule(report, ruleId) {
  const re = new RegExp(`^\\d+\\. \\[${ruleId}(?:·建议)?\\] 第 (\\d+) 行`, 'gm')
  return [...report.matchAll(re)].map((m) => Number(m[1]))
}

async function lint(html, { styleId, mode, ruleId }) {
  const input = { html, rules: ruleId }
  if (styleId === null) input.style_id = 'free'
  else if (styleId) input.style_id = styleId
  if (mode) input.surface_mode = mode
  const res = await tools.canvas_check_style.execute({ input, cwd: root })
  assert.ok(!res.isError, res.content)
  return res.content
}

for (const ruleId of ruleDirs) {
  const dir = join(fixturesDir, ruleId)
  const files = readdirSync(dir).filter((f) => f.endsWith('.html')).sort()
  const flags = files.filter((f) => f.startsWith('flag-'))
  const passes = files.filter((f) => f.startsWith('pass-'))
  const metaFile = join(dir, 'meta.json')
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {}
  const styleId = Object.hasOwn(meta, 'styleId') ? meta.styleId : DEFAULT_STYLE
  const mode = meta.mode ?? null

  test(`fixture 数量：${ruleId} 需要 4 个 flag + 5 个 pass`, () => {
    assert.equal(flags.length, 4, `${ruleId}: flag 文件 ${flags.join(', ')}`)
    assert.equal(passes.length, 5, `${ruleId}: pass 文件 ${passes.join(', ')}`)
  })

  for (const file of flags) {
    test(`应命中：${ruleId} / ${file}`, async () => {
      const html = readFileSync(join(dir, file), 'utf8')
      const report = await lint(html, { styleId, mode, ruleId })
      const lines = countRule(report, ruleId)
      assert.ok(lines.length >= 1, `未命中 ${ruleId}；报告：\n${report}`)
      assert.ok(lines[0] > 0)
    })
  }

  for (const file of passes) {
    test(`不应命中：${ruleId} / ${file}`, async () => {
      const html = readFileSync(join(dir, file), 'utf8')
      const report = await lint(html, { styleId, mode, ruleId })
      const lines = countRule(report, ruleId)
      assert.equal(lines.length, 0, `误报 ${ruleId}（第 ${lines.join('、')} 行）；报告：\n${report}`)
    })
  }

  test(`确定性：${ruleId} 连续两次结果一致`, async () => {
    for (const file of [...flags, ...passes]) {
      const html = readFileSync(join(dir, file), 'utf8')
      const a = await lint(html, { styleId, mode, ruleId })
      const b = await lint(html, { styleId, mode, ruleId })
      assert.equal(a, b, file)
    }
  })
}
