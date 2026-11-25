/**
 * 写入时工艺提示与 list_rules：不阻塞、不干扰既有响应、可枚举规则。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

test('写入提示：命中工艺规则时追加一行，且明确不阻塞', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-craft-hint-'))
  try {
    const html = `<!doctype html><html><head><style>
body { font-family: Inter, sans-serif; }
.hero { background-image: linear-gradient(90deg, #db2777, #7c3aed); -webkit-background-clip: text; background-clip: text; color: transparent; }
</style></head><body><h1 class="hero">标题</h1></body></html>`
    const res = await tools.canvas_upsert_page.execute({ input: { html, title: '营销页', surface_mode: 'persuade' }, cwd })
    assert.ok(!res.isError, res.content)
    assert.match(res.content, /工艺提示（不阻塞，详见 canvas_check_style）/)
    assert.match(res.content, /overused-font|gradient-text/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('写入提示：0 命中时不追加任何行（既有响应不变）', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-craft-clean-'))
  try {
    const html = '<!doctype html><html><body><h1>标题</h1><p>正文内容。</p></body></html>'
    const res = await tools.canvas_upsert_page.execute({ input: { html, title: '干净页' }, cwd })
    assert.ok(!res.isError, res.content)
    assert.doesNotMatch(res.content, /工艺提示/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('写入提示：只报非 advisory，且最多 5 类', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-craft-advisory-'))
  try {
    const html = `<!doctype html><html><head><style>
.card { box-shadow: 4px 4px 0 #333333; }
.btn { transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1); }
</style></head><body><div class="card"><button class="btn">按钮</button></div></body></html>`
    const res = await tools.canvas_upsert_page.execute({ input: { html, title: '只有建议级' }, cwd })
    assert.ok(!res.isError, res.content)
    // hard-offset-shadow 与 bounce-easing 都是 advisory → 不应触发提示
    assert.doesNotMatch(res.content, /工艺提示/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('list_rules：列出规则、严重度、模式画像与忽略语法', async () => {
  const res = await tools.canvas_check_style.execute({ input: { action: 'list_rules' }, cwd: root })
  assert.ok(!res.isError, res.content)
  assert.match(res.content, /工艺规则共 \d+ 条/)
  assert.match(res.content, /overused-font/)
  assert.match(res.content, /gradient-text/)
  assert.match(res.content, /advisory = 建议/)
  assert.match(res.content, /tianshu-lint-disable/)
  assert.match(res.content, /## slop/)
  assert.match(res.content, /## quality/)
})

test('规则子集：rules 参数只跑指定规则', async () => {
  const html = `<!doctype html><html><head><style>
body { font-family: Inter, sans-serif; }
h1 { background-image: linear-gradient(90deg, #db2777, #7c3aed); background-clip: text; color: transparent; }
</style></head><body><h1>标题</h1></body></html>`
  const both = await tools.canvas_check_style.execute({ input: { html, style_id: 'free' }, cwd: root })
  assert.match(both.content, /overused-font/)
  assert.match(both.content, /gradient-text/)
  const onlyOne = await tools.canvas_check_style.execute({ input: { html, style_id: 'free', rules: 'gradient-text' }, cwd: root })
  assert.match(onlyOne.content, /gradient-text/)
  assert.doesNotMatch(onlyOne.content, /overused-font/)
})

test('模式画像：read 模式不报渐变文字与光晕', async () => {
  const html = `<!doctype html><html><head><style>
body { background-color: #0b0b0f; }
h1 { background-image: linear-gradient(90deg, #db2777, #7c3aed); background-clip: text; color: transparent; }
.hero::before { background: radial-gradient(circle at 50% 0%, rgba(124,58,237,0.95), transparent 70%); }
</style></head><body><h1>标题</h1></body></html>`
  const persuade = await tools.canvas_check_style.execute({
    input: { html, style_id: 'free', surface_mode: 'persuade' },
    cwd: root,
  })
  assert.match(persuade.content, /gradient-text/)
  assert.match(persuade.content, /radial-halo/)
  const read = await tools.canvas_check_style.execute({
    input: { html, style_id: 'free', surface_mode: 'read' },
    cwd: root,
  })
  assert.doesNotMatch(read.content, /gradient-text/)
  assert.doesNotMatch(read.content, /radial-halo/)
})

test('模式画像：operate 把渐变文字降级为建议', async () => {
  const html = `<!doctype html><html><head><style>
h1 { background-image: linear-gradient(90deg, #db2777, #7c3aed); background-clip: text; color: transparent; }
</style></head><body><h1>标题</h1></body></html>`
  const res = await tools.canvas_check_style.execute({
    input: { html, style_id: 'free', surface_mode: 'operate' },
    cwd: root,
  })
  assert.match(res.content, /gradient-text·建议/)
})

test('inline 豁免：文件级与下一行生效，未生效豁免被点名', async () => {
  const html = `<!doctype html>
<html><body>
<!-- tianshu-lint-disable-next-line gradient-text -->
<h1 style="background-image:linear-gradient(90deg,#db2777,#7c3aed);background-clip:text;color:transparent">标题</h1>
<!-- tianshu-lint-disable overused-font -->
<p style="font-family: Inter">正文</p>
<!-- tianshu-lint-disable-next-line no-such-rule -->
<p>普通段落</p>
</body></html>`
  const res = await tools.canvas_check_style.execute({ input: { html, style_id: 'free' }, cwd: root })
  assert.doesNotMatch(res.content, /\[gradient-text/)
  assert.doesNotMatch(res.content, /\[overused-font/)
  assert.match(res.content, /未生效的忽略/)
  assert.match(res.content, /no-such-rule/)
})

test('ignore 参数：本次运行临时豁免，不写进页面', async () => {
  const html = `<!doctype html><html><head><style>
h1 { background-image: linear-gradient(90deg, #db2777, #7c3aed); background-clip: text; color: transparent; }
</style></head><body><h1>标题</h1></body></html>`
  const res = await tools.canvas_check_style.execute({
    input: { html, style_id: 'free', ignore: 'gradient-text' },
    cwd: root,
  })
  assert.doesNotMatch(res.content, /\[gradient-text/)
})
