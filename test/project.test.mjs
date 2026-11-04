/**
 * 项目模型测试：通过构建产物驱动工具，验证 add(内联/文件)/upsert/list + 越界写被拒。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)

const cwd = mkdtempSync(join(tmpdir(), 'tsc-proj-'))
try {
  // 内联 HTML
  const r1 = await tools.canvas_add_page.execute({ input: { html: '<h1>Hi</h1>', title: 'A' }, cwd })
  assert.ok(!r1.isError, r1.content)
  const p1 = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
  assert.equal(p1.nodes.length, 1)
  const id = p1.nodes[0].id
  assert.match(id, /^page-[0-9a-f]{8}$/)
  assert.equal(
    readFileSync(join(cwd, '.tianshu-canvas', 'pages', `${id}.html`), 'utf8'),
    '<h1>Hi</h1>',
  )

  // 文件路径（pathParams read 守卫应改写为绝对路径）
  writeFileSync(join(cwd, 'login.html'), '<h1>Login</h1>')
  const r2 = await tools.canvas_add_page.execute({ input: { html_path: 'login.html', title: 'B' }, cwd })
  assert.ok(!r2.isError, r2.content)
  const p2 = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
  assert.equal(p2.nodes.length, 2)

  // upsert 同 id 不新增
  const r3 = await tools.canvas_add_page.execute({ input: { id, html: '<h1>Hi2</h1>', title: 'A2' }, cwd })
  assert.ok(!r3.isError, r3.content)
  const p3 = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
  assert.equal(p3.nodes.length, 2)
  const a = p3.nodes.find((n) => n.id === id)
  assert.equal(a.title, 'A2')
  assert.equal(readFileSync(join(cwd, '.tianshu-canvas', 'pages', `${id}.html`), 'utf8'), '<h1>Hi2</h1>')

  // 列表
  const list = await tools.canvas_list_pages.execute({ input: {}, cwd })
  assert.match(list.content, /A2/)
  assert.match(list.content, /B/)
  assert.match(list.content, /2 个页面节点/)

  // 越界读被守卫拒绝
  const bad = await tools.canvas_add_page.execute({ input: { html_path: '../../x.html', title: 'X' }, cwd })
  assert.equal(bad.isError, true)
  assert.match(bad.content, /Path rejected/)

  // 缺内容报错
  const empty = await tools.canvas_add_page.execute({ input: { title: 'Y' }, cwd })
  assert.equal(empty.isError, true)

  console.log('OK 项目模型: add(内联/文件) / upsert / list / 越界拒绝 全部通过')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
