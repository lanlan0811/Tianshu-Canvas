/**
 * 项目模型测试：通过构建产物驱动工具，验证 add(内联/文件)/upsert/list + 越界写被拒。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)

const cwd = mkdtempSync(join(tmpdir(), 'tsc-proj-'))
try {
  // 内联 HTML（未先 canvas_open，也应自动起服务并在返回里带画布 URL）
  const r1 = await tools.canvas_add_page.execute({ input: { html: '<h1>Hi</h1>', title: 'A' }, cwd })
  assert.ok(!r1.isError, r1.content)
  assert.match(r1.content, /画布 URL：http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]{16}/, 'add_page 返回应含画布 URL')
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

  // ---- 画布编排：重命名 / 复制 / 移动 / 删除 / 连线 ----
  const p0 = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
  const idA = p0.nodes.find((n) => n.title === 'A2').id
  const idB = p0.nodes.find((n) => n.title === 'B').id

  const ren = await tools.canvas_rename_page.execute({ input: { id: idA, title: '首页' }, cwd })
  assert.ok(!ren.isError, ren.content)
  assert.match(ren.content, /首页/)

  const dup = await tools.canvas_duplicate_page.execute({ input: { id: idA }, cwd })
  assert.ok(!dup.isError, dup.content)
  const dupId = dup.content.match(/id=([\w-]+)/)[1]
  assert.notEqual(dupId, idA)
  const dupHtml = readFileSync(join(cwd, '.tianshu-canvas', 'pages', `${dupId}.html`), 'utf8')
  assert.match(dupHtml, /Hi2/, '复制应拷贝原型 HTML')

  const mv = await tools.canvas_move_page.execute({ input: { id: idB, x: 999, y: 888 }, cwd })
  assert.ok(!mv.isError, mv.content)
  const pm = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
  const nodeB = pm.nodes.find((n) => n.id === idB)
  assert.equal(nodeB.x, 999)
  assert.equal(nodeB.y, 888)

  const link = await tools.canvas_link_pages.execute({ input: { source: idA, target: idB, label: '跳转' }, cwd })
  assert.ok(!link.isError, link.content)
  const pl = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
  assert.equal(pl.edges.length, 1)
  assert.equal(pl.edges[0].label, '跳转')

  // 重复连线去重
  await tools.canvas_link_pages.execute({ input: { source: idA, target: idB }, cwd })
  const pd = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
  assert.equal(pd.edges.length, 1, '重复连线应去重')

  // 删除节点连带删边与文件
  const rm = await tools.canvas_remove_page.execute({ input: { id: idA }, cwd })
  assert.ok(!rm.isError, rm.content)
  const pr = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
  assert.ok(!pr.nodes.some((n) => n.id === idA))
  assert.equal(pr.edges.length, 0, '删除节点应连带删除其连线')
  assert.equal(existsSync(join(cwd, '.tianshu-canvas', 'pages', `${idA}.html`)), false, '删除节点应删除页面文件')

  console.log('OK 项目模型: add/upsert/list/越界 + 重命名/复制/移动/删除/连线 全部通过')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
