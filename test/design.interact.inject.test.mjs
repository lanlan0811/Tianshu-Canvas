/**
 * 交互库注入：用到交互才注入运行时、未用不注入、幂等、剥离可还原、契约校验。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

const pageFile = (cwd, id) => readFileSync(join(cwd, '.tianshu-canvas', 'pages', `${id}.html`), 'utf8')
const count = (text, needle) => text.split(needle).length - 1

test('交互库：未用交互的页面不注入运行时', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-i-none-'))
  try {
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })
    const r = await tools.canvas_upsert_page.execute({
      input: { html: '<html><head></head><body><p>纯静态</p></body></html>', title: '静态' },
      cwd,
    })
    const id = r.content.match(/id=([\w-]+)/)[1]
    const saved = pageFile(cwd, id)
    assert.ok(!saved.includes('tianshu-interactions'), '未用交互不应注入交互运行时')
    assert.ok(saved.includes('tianshu-tokens'), 'token 应照常注入')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('交互库：用 data-ts-* 时注入交互样式与运行时，且幂等', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-i-use-'))
  try {
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'claude' }, cwd })
    const html =
      '<html><head></head><body>' +
      '<div class="ts-tabs" data-ts-tabs><button class="ts-tab ts-tab--active" data-ts-tab="a">A</button></div>' +
      '<div data-ts-panel="a">A</div></body></html>'
    const r = await tools.canvas_upsert_page.execute({ input: { html, title: '带交互' }, cwd })
    const id = r.content.match(/id=([\w-]+)/)[1]
    let saved = pageFile(cwd, id)
    assert.ok(saved.includes('<style id="tianshu-interactions"'), '应注入交互样式')
    assert.ok(/<script id="tianshu-interactions"[^>]*defer>/.test(saved), '应注入交互运行时脚本')

    // 幂等：再次写入仍只有一份
    await tools.canvas_upsert_page.execute({ input: { id, html }, cwd })
    saved = pageFile(cwd, id)
    assert.equal(count(saved, 'id="tianshu-interactions"'), 2, 'style + script 各一处')
    assert.equal(count(saved, 'tianshu-ds:start'), 1, '注入块仍只有一块')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('交互库：切回自由发挥时剥离交互运行时（还原）', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-i-free-'))
  try {
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })
    const html = '<html><head></head><body><div class="ts-tabs" data-ts-tabs><button class="ts-tab ts-tab--active" data-ts-tab="a">A</button></div><div data-ts-panel="a">A</div></body></html>'
    const r = await tools.canvas_upsert_page.execute({ input: { html, title: 'x' }, cwd })
    const id = r.content.match(/id=([\w-]+)/)[1]
    assert.ok(pageFile(cwd, id).includes('tianshu-interactions'))

    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'free' }, cwd })
    // 重写该页（free）：应回到原始 HTML
    await tools.canvas_upsert_page.execute({ input: { id, html }, cwd })
    const saved = pageFile(cwd, id)
    assert.ok(!saved.includes('tianshu-ds:start'), 'free 应剥离注入块')
    assert.ok(!saved.includes('tianshu-interactions'), 'free 应剥离交互运行时')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('交互库：canvas_style get 列清单，action=interaction 取骨架', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-i-get-'))
  try {
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })
    const get = await tools.canvas_style.execute({ input: { action: 'get' }, cwd })
    assert.match(get.content, /交互库（16）/)

    const one = await tools.canvas_style.execute({ input: { action: 'interaction', interaction_id: 'modal' }, cwd })
    assert.ok(!one.isError, one.content)
    assert.ok(one.content.includes('ts-i-modal'), '应含骨架与类')
    assert.ok(one.content.includes('data-ts-modal'))

    const bad = await tools.canvas_style.execute({ input: { action: 'interaction', interaction_id: 'nope' }, cwd })
    assert.equal(bad.isError, true)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('交互库：lint 检出「用了交互但缺运行时」', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-i-lint-'))
  try {
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })
    // 手写 HTML（未经过写入，因此没有注入运行时）→ 应报 interaction
    const r = await tools.canvas_check_style.execute({
      input: { html: '<div class="ts-tabs" data-ts-tabs><button class="ts-tab ts-tab--active" data-ts-tab="a">A</button></div>' },
      cwd,
    })
    assert.match(r.content, /\[interaction\]/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
