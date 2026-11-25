/**
 * 页面模式（surface mode）：元数据持久化、更新语义、读取展示与非法输入拒绝。
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

const projectFile = (cwd) => JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
const pageIdOf = (content) => content.match(/id=([\w-]+)/)[1]

test('surface_mode：新建页面写入并持久化到 project.json', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-mode-write-'))
  try {
    const res = await tools.canvas_upsert_page.execute({
      input: { html: '<h1>看板</h1>', title: '看板', surface_mode: 'operate' },
      cwd,
    })
    assert.ok(!res.isError, res.content)
    const id = pageIdOf(res.content)
    const node = projectFile(cwd).nodes.find((n) => n.id === id)
    assert.equal(node.mode, 'operate')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('surface_mode：更新时省略则保持原值', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-mode-keep-'))
  try {
    const first = await tools.canvas_upsert_page.execute({
      input: { html: '<h1>A</h1>', title: 'A', surface_mode: 'read' },
      cwd,
    })
    const id = pageIdOf(first.content)
    const second = await tools.canvas_upsert_page.execute({
      input: { id, title: 'A2' },
      cwd,
    })
    assert.ok(!second.isError, second.content)
    const node = projectFile(cwd).nodes.find((n) => n.id === id)
    assert.equal(node.mode, 'read')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('surface_mode：显式传新值覆盖旧值', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-mode-override-'))
  try {
    const first = await tools.canvas_upsert_page.execute({
      input: { html: '<h1>A</h1>', title: 'A', surface_mode: 'read' },
      cwd,
    })
    const id = pageIdOf(first.content)
    await tools.canvas_upsert_page.execute({ input: { id, surface_mode: 'persuade' }, cwd })
    assert.equal(projectFile(cwd).nodes.find((n) => n.id === id).mode, 'persuade')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('surface_mode：非法值被拒绝且不产生页面', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-mode-bad-'))
  try {
    const res = await tools.canvas_upsert_page.execute({
      input: { html: '<h1>A</h1>', title: 'A', surface_mode: 'marketing' },
      cwd,
    })
    assert.equal(res.isError, true)
    assert.match(res.content, /非法 surface_mode/)
    assert.match(res.content, /persuade/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('surface_mode：不传时新建页面无 mode 字段', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-mode-none-'))
  try {
    const res = await tools.canvas_upsert_page.execute({ input: { html: '<h1>A</h1>', title: 'A' }, cwd })
    const id = pageIdOf(res.content)
    assert.equal(Object.hasOwn(projectFile(cwd).nodes.find((n) => n.id === id), 'mode'), false)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('surface_mode：canvas_get_state 显示模式与中文标签', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-mode-state-'))
  try {
    await tools.canvas_upsert_page.execute({
      input: { html: '<h1>看板</h1>', title: '看板', surface_mode: 'operate' },
      cwd,
    })
    const state = await tools.canvas_get_state.execute({ input: {}, cwd })
    assert.match(state.content, /模式 operate（操作型）/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('surface_mode：复制页面时继承模式', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-mode-dup-'))
  try {
    const created = await tools.canvas_upsert_page.execute({
      input: { html: '<h1>A</h1>', title: 'A', surface_mode: 'experience' },
      cwd,
    })
    const id = pageIdOf(created.content)
    const dup = await tools.canvas_arrange.execute({ input: { action: 'duplicate', id, title: 'B' }, cwd })
    assert.ok(!dup.isError, dup.content)
    const nodes = projectFile(cwd).nodes
    assert.equal(nodes.length, 2)
    assert.equal(nodes.filter((n) => n.mode === 'experience').length, 2)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('surface_mode：旧项目里非法的 mode 值读取时被丢弃（不崩）', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-mode-legacy-'))
  try {
    const created = await tools.canvas_upsert_page.execute({ input: { html: '<h1>A</h1>', title: 'A' }, cwd })
    const id = pageIdOf(created.content)
    const file = join(cwd, '.tianshu-canvas', 'project.json')
    const project = JSON.parse(readFileSync(file, 'utf8'))
    project.nodes[0].mode = 'legacy-unknown'
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, JSON.stringify(project, null, 2) + '\n')
    const state = await tools.canvas_get_state.execute({ input: {}, cwd })
    assert.ok(!state.content.includes('legacy-unknown'), state.content)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
