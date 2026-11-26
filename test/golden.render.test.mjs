/**
 * 渲染级报告 golden（a11y / states）。
 *
 * 与 check-style golden 的区别：这两份报告**需要真实浏览器**。
 * 本地无浏览器时会 skip——这是已知的假绿风险，因此：
 *  - CI 的 `Require a browser for E2E` 步骤保证 CI 一定真跑；
 *  - 报告里唯一随环境变化的数字（元素数、对比度）都由固定页面决定，不依赖窗口尺寸以外的因素。
 *
 * 归一化：页面 id 与标题在录制时替换为 <page-id> / <page-title>，运行时同样替换后再比对。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'
import { resolveTestBrowser } from './helpers/browser.mjs'

const root = resolve(import.meta.dirname, '..')
const goldenDir = join(root, 'test/golden/render')
const browserPath = resolveTestBrowser()
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const bodyOf = (html) => html.replace(/<!--\s*input-sha256:\s*[0-9a-f]{64}\s*-->\n?/, '')
const recordedHash = (html) => /<!--\s*input-sha256:\s*([0-9a-f]{64})\s*-->/.exec(html)?.[1] ?? null
const HINT = '若要更新基线，先用 canvas_audit 人工复核报告，再改 golden；禁止仅为让测试通过而重录。'

/** 归一化：页面 id 与标题替换成占位符（这是报告里唯一的非确定性来源）。 */
function normalize(text, pageId, title) {
  return text.split(pageId).join('<page-id>').split(title).join('<page-title>')
}

function firstDiff(actual, expected) {
  const a = actual.split('\n')
  const b = expected.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `第 ${i + 1} 行：\n  实际：${a[i] ?? '(缺失)'}\n  期望：${b[i] ?? '(缺失)'}`
  }
  return '(无差异)'
}

for (const name of ['clean-page', 'issues-page']) {
  for (const action of ['a11y', 'states']) {
    test(`渲染 golden：${name} 的 ${action} 报告与基线一致`, { skip: !browserPath && '未找到浏览器', timeout: 180000 }, async () => {
      const file = join(goldenDir, `${name}.html`)
      const html = readFileSync(file, 'utf8')
      const golden = readFileSync(join(goldenDir, `${name}.${action}.golden.txt`), 'utf8')

      const expected = recordedHash(html)
      assert.ok(expected, `${name}.html 缺少 input-sha256 注释`)
      assert.equal(sha256(bodyOf(html)), expected, `${name}.html 的输入被改动但没重录基线。${HINT}`)

      const cwd = mkdtempSync(join(tmpdir(), 'tsc-render-golden-'))
      try {
        await tools.canvas_open.execute({ input: { port: 0 }, cwd })
        await tools.canvas_style.execute({ input: { action: 'set', style_id: 'tianshu-original' }, cwd })
        const pageId = `golden-${name}`
        const added = await tools.canvas_upsert_page.execute({ input: { id: pageId, html, title: name }, cwd })
        assert.ok(!added.isError, added.content)

        const res = await tools.canvas_audit.execute({ input: { action, page_id: pageId }, cwd })
        assert.ok(!res.isError, res.content)
        const actual = normalize(res.content, pageId, name)
        assert.equal(actual, golden, `报告与基线不一致：\n${firstDiff(actual, golden)}\n${HINT}`)
      } finally {
        rmSync(cwd, { recursive: true, force: true })
      }
    })
  }
}

test('渲染 golden：同一页面连续两次报告完全相同', { skip: !browserPath && '未找到浏览器', timeout: 180000 }, async () => {
  const html = readFileSync(join(goldenDir, 'issues-page.html'), 'utf8')
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-render-determinism-'))
  try {
    await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'tianshu-original' }, cwd })
    const pageId = 'golden-determinism'
    await tools.canvas_upsert_page.execute({ input: { id: pageId, html, title: 'determinism' }, cwd })
    const once = await tools.canvas_audit.execute({ input: { action: 'a11y', page_id: pageId }, cwd })
    const twice = await tools.canvas_audit.execute({ input: { action: 'a11y', page_id: pageId }, cwd })
    assert.equal(once.content, twice.content)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
