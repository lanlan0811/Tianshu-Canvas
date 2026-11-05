/**
 * 注入与项目级锁定：写入时内联样式与图标、幂等、切换/解绑、自由发挥零改动。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)

const pageFile = (cwd, id) => readFileSync(join(cwd, '.tianshu-canvas', 'pages', `${id}.html`), 'utf8')
const projectFile = (cwd) => JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
const count = (text, needle) => text.split(needle).length - 1

test('设计系统：自由发挥时页面字节不变（回归基线）', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ds-free-'))
  try {
    const html = '<h1 style="color:#123456">标题</h1>'
    const added = await tools.canvas_upsert_page.execute({ input: { html, title: '自由页' }, cwd })
    assert.ok(!added.isError, added.content)
    const id = added.content.match(/id=([\w-]+)/)[1]
    assert.equal(pageFile(cwd, id), html, '未锁定风格时不得改动 HTML')
    assert.ok(added.content.includes('自由发挥'), added.content)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('设计系统：锁定后自动注入并展开图标，且幂等', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ds-inject-'))
  try {
    const set = await tools.canvas_style.execute({ input: { action: 'set', style_id: 'claude' }, cwd })
    assert.ok(!set.isError, set.content)
    assert.match(set.content, /已锁定设计风格「Claude 风」/)

    const html =
      '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
      '<button class="ts-btn ts-btn--primary"><svg data-icon="search" class="ts-icon"></svg>搜索</button>' +
      '<svg data-icon="bell" class="ts-icon"/></body></html>'
    const added = await tools.canvas_upsert_page.execute({ input: { html, title: '锁定页' }, cwd })
    assert.ok(!added.isError, added.content)
    const id = added.content.match(/id=([\w-]+)/)[1]
    const saved = pageFile(cwd, id)

    assert.equal(count(saved, 'tianshu-ds:start'), 1)
    assert.equal(count(saved, 'id="tianshu-tokens"'), 1)
    assert.equal(count(saved, 'id="tianshu-components"'), 1)
    assert.ok(saved.includes('--ts-color-bg-canvas: #faf9f5'), '应注入 Claude 风 token')
    assert.ok(saved.includes('<path'), '图标应展开为 SVG 路径')
    assert.equal(count(saved, 'data-icon="search"'), 1, '图标名应保留，便于再次注入与 lint')

    // 再写一次（新 HTML），仍只有一块
    const again = await tools.canvas_upsert_page.execute({ input: { html: html.replace('搜索', '查找'), id }, cwd })
    assert.ok(!again.isError, again.content)
    const savedAgain = pageFile(cwd, id)
    assert.equal(count(savedAgain, 'tianshu-ds:start'), 1)
    assert.ok(savedAgain.includes('查找'))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('设计系统：切换风格重写所有页面并保留 design 字段', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ds-switch-'))
  try {
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })
    const html = '<p style="color:var(--ts-color-text-primary)">正文</p>'
    const a = await tools.canvas_upsert_page.execute({ input: { html, title: 'A' }, cwd })
    const b = await tools.canvas_upsert_page.execute({ input: { html, title: 'B' }, cwd })
    const idA = a.content.match(/id=([\w-]+)/)[1]
    const idB = b.content.match(/id=([\w-]+)/)[1]
    const revA = projectFile(cwd).nodes.find((n) => n.id === idA).htmlRev

    const switched = await tools.canvas_style.execute({ input: { action: 'set', style_id: 'google' }, cwd })
    assert.ok(!switched.isError, switched.content)
    assert.match(switched.content, /重写 2 个页面/)

    const project = projectFile(cwd)
    assert.equal(project.design.styleId, 'google')
    assert.ok(project.nodes.find((n) => n.id === idA).htmlRev >= revA)
    for (const id of [idA, idB]) {
      const text = pageFile(cwd, id)
      assert.ok(text.includes('--ts-color-bg-canvas: #f8f9fa'), `${id} 应换成谷歌风 token`)
      assert.ok(!text.includes('--ts-color-bg-canvas: #fbfbfd'), `${id} 不应残留苹果风 token`)
      assert.equal(count(text, 'tianshu-ds:start'), 1)
    }

    // 只改标题的 upsert 不能把 design 抹掉
    await tools.canvas_upsert_page.execute({ input: { id: idA, title: 'A2' }, cwd })
    assert.equal(projectFile(cwd).design.styleId, 'google')

    // 解绑：保留旧样式块，但删除 design 字段
    const freed = await tools.canvas_style.execute({ input: { action: 'set', style_id: 'free' }, cwd })
    assert.ok(!freed.isError, freed.content)
    assert.equal(projectFile(cwd).design, undefined)
    assert.ok(pageFile(cwd, idA).includes('--ts-color-bg-canvas'), '解绑不应剥离已有样式块')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('设计系统：未知风格与未知图标有明确反馈', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ds-bad-'))
  try {
    const bad = await tools.canvas_style.execute({ input: { action: 'set', style_id: 'nope' }, cwd })
    assert.equal(bad.isError, true)
    assert.match(bad.content, /未知的设计风格/)

    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'tianshu-original' }, cwd })
    const added = await tools.canvas_upsert_page.execute({
      input: { html: '<svg data-icon="rocket" class="ts-icon"></svg>', title: '未知图标' },
      cwd,
    })
    assert.ok(!added.isError, added.content)
    assert.match(added.content, /rocket/)
    const id = added.content.match(/id=([\w-]+)/)[1]
    assert.ok(pageFile(cwd, id).includes('data-icon="rocket"'), '未知图标应原样保留')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('设计系统：list/get/template 输出可用', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ds-list-'))
  try {
    const list = await tools.canvas_style.execute({ input: { action: 'list' }, cwd })
    assert.ok(!list.isError, list.content)
    for (const name of ['苹果风', '谷歌风', 'Claude 风', '天枢原创']) assert.ok(list.content.includes(name))
    assert.ok(list.content.includes('无隶属'))

    const get = await tools.canvas_style.execute({ input: { action: 'get', style_id: 'apple' }, cwd })
    assert.ok(!get.isError, get.content)
    assert.ok(get.content.includes('--ts-color-action-primary'))
    assert.ok(get.content.includes('ts-btn'))

    const tpl = await tools.canvas_style.execute({ input: { action: 'template', style_id: 'google', template_id: 'dashboard' }, cwd })
    assert.ok(!tpl.isError, tpl.content)
    assert.ok(tpl.content.includes('<!doctype html>'))
    assert.ok(tpl.content.includes('ts-app'))
    assert.ok(!tpl.content.includes('tianshu-ds:start'), '模板不应预注入样式块')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('设计系统：get_state 显示当前风格', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ds-state-'))
  try {
    const free = await tools.canvas_get_state.execute({ input: {}, cwd })
    assert.match(free.content, /自由发挥/)
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })
    const locked = await tools.canvas_get_state.execute({ input: {}, cwd })
    assert.match(locked.content, /苹果风（apple，已锁定）/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('设计系统：project.json 损坏时拒绝切换且不覆盖原文件', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ds-corrupt-'))
  try {
    const file = join(cwd, '.tianshu-canvas', 'project.json')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(cwd, '.tianshu-canvas'), { recursive: true })
    writeFileSync(file, '{not json', 'utf8')
    const res = await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })
    assert.equal(res.isError, true)
    assert.equal(readFileSync(file, 'utf8'), '{not json', '损坏文件不应被覆盖')
    assert.ok(existsSync(file))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
