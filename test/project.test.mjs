/**
 * 项目模型测试：通过构建产物驱动工具，验证 upsert（内联/文件/仅改元数据）/get_state、越界写被拒，
 * 以及 canvas_arrange 的 remove / duplicate / link / unlink 与错误路径。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

const cwd = mkdtempSync(join(tmpdir(), 'tsc-proj-'))
const readProj = () => JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
const readPage = (id) => readFileSync(join(cwd, '.tianshu-canvas', 'pages', `${id}.html`), 'utf8')

try {
  // 内联 HTML（未先 canvas_open，也应自动起服务并在返回里带画布 URL）
  const r1 = await tools.canvas_upsert_page.execute({ input: { html: '<h1>Hi</h1>', title: 'A' }, cwd })
  assert.ok(!r1.isError, r1.content)
  assert.match(r1.content, /画布 URL：http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/, 'upsert_page 返回应含画布 URL')
  const p1 = readProj()
  assert.equal(p1.nodes.length, 1)
  const id = p1.nodes[0].id
  assert.match(id, /^page-[0-9a-f]{8}$/)
  assert.equal(readPage(id), '<h1>Hi</h1>')

  // 文件路径（pathParams read 守卫应改写为绝对路径）
  writeFileSync(join(cwd, 'login.html'), '<h1>Login</h1>')
  const r2 = await tools.canvas_upsert_page.execute({ input: { html_path: 'login.html', title: 'B' }, cwd })
  assert.ok(!r2.isError, r2.content)
  assert.equal(readProj().nodes.length, 2)

  // upsert 同 id 不新增，且更新 HTML
  const r3 = await tools.canvas_upsert_page.execute({ input: { id, html: '<h1>Hi2</h1>', title: 'A2' }, cwd })
  assert.ok(!r3.isError, r3.content)
  const p3 = readProj()
  assert.equal(p3.nodes.length, 2)
  assert.equal(p3.nodes.find((n) => n.id === id).title, 'A2')
  assert.equal(readPage(id), '<h1>Hi2</h1>')

  const idA = id
  const idB = p3.nodes.find((n) => n.title === 'B').id

  // ---- 仅改元数据（原 rename / move）：HTML 与尺寸不变 ----
  const before = readProj().nodes.find((n) => n.id === idA)
  const ren = await tools.canvas_upsert_page.execute({ input: { id: idA, title: '首页' }, cwd })
  assert.ok(!ren.isError, ren.content)
  assert.match(ren.content, /首页/)
  assert.match(ren.content, /未改动/, '仅改元数据应提示 HTML 未改动')
  const afterRen = readProj().nodes.find((n) => n.id === idA)
  assert.equal(afterRen.title, '首页')
  assert.equal(afterRen.width, before.width, '只改标题不应重置宽度')
  assert.equal(afterRen.height, before.height, '只改标题不应重置高度')
  assert.equal(afterRen.deviceType, before.deviceType)
  assert.equal(afterRen.x, before.x)
  assert.equal(afterRen.y, before.y)
  assert.equal(afterRen.createdAt, before.createdAt)
  assert.equal(afterRen.htmlPath, before.htmlPath)
  assert.equal(readPage(idA), '<h1>Hi2</h1>', '只改标题不应改动 HTML')

  const mv = await tools.canvas_upsert_page.execute({ input: { id: idB, x: 999, y: 888 }, cwd })
  assert.ok(!mv.isError, mv.content)
  const nodeB = readProj().nodes.find((n) => n.id === idB)
  assert.equal(nodeB.x, 999)
  assert.equal(nodeB.y, 888)
  assert.equal(nodeB.width, 1440, '只移动不应改尺寸')
  assert.equal(nodeB.height, 900)

  // 切换设备预设会改尺寸
  const dev = await tools.canvas_upsert_page.execute({ input: { id: idB, device_type: 'mobile' }, cwd })
  assert.ok(!dev.isError, dev.content)
  const nodeB2 = readProj().nodes.find((n) => n.id === idB)
  assert.equal(nodeB2.deviceType, 'mobile')
  assert.equal(nodeB2.width, 375)
  assert.equal(nodeB2.height, 812)
  assert.equal(nodeB2.x, 999, '改设备不应移动位置')

  // ---- upsert 错误路径 ----
  const bad = await tools.canvas_upsert_page.execute({ input: { html_path: '../../x.html', title: 'X' }, cwd })
  assert.equal(bad.isError, true)
  assert.match(bad.content, /Path rejected/)

  const empty = await tools.canvas_upsert_page.execute({ input: { title: 'Y' }, cwd })
  assert.equal(empty.isError, true, '新建且无 html 应报错')

  const ghost = await tools.canvas_upsert_page.execute({ input: { id: 'no-such-page', title: 'Z' }, cwd })
  assert.equal(ghost.isError, true, '不存在的 id 且无 html 应报错')
  assert.equal(readProj().nodes.length, 2, '报错不应产生新节点')

  const illegal = await tools.canvas_upsert_page.execute({ input: { id: '../evil', html: '<p>x</p>' }, cwd })
  assert.equal(illegal.isError, true)
  assert.match(illegal.content, /非法 id/)

  // ---- get_state ----
  const state1 = await tools.canvas_get_state.execute({ input: {}, cwd })
  assert.ok(!state1.isError, state1.content)
  assert.match(state1.content, /2 个页面节点/)
  assert.match(state1.content, /首页/)
  assert.match(state1.content, /没有选中项/)
  assert.match(state1.content, /画布 URL：http/)

  // ---- canvas_arrange ----
  const dup = await tools.canvas_arrange.execute({ input: { action: 'duplicate', id: idA }, cwd })
  assert.ok(!dup.isError, dup.content)
  const dupId = dup.content.match(/id=([\w-]+)/)[1]
  assert.notEqual(dupId, idA)
  assert.match(readPage(dupId), /Hi2/, '复制应拷贝原型 HTML')

  const link = await tools.canvas_arrange.execute({ input: { action: 'link', source: idA, target: idB, label: '跳转' }, cwd })
  assert.ok(!link.isError, link.content)
  const pl = readProj()
  assert.equal(pl.edges.length, 1)
  assert.equal(pl.edges[0].label, '跳转')

  // 重复连线去重，label 更新
  await tools.canvas_arrange.execute({ input: { action: 'link', source: idA, target: idB, label: '下一步' }, cwd })
  const pd = readProj()
  assert.equal(pd.edges.length, 1, '重复连线应去重')
  assert.equal(pd.edges[0].label, '下一步')

  // get_state 带出连线
  const state2 = await tools.canvas_get_state.execute({ input: {}, cwd })
  assert.match(state2.content, /页面连线（1 条）/)
  assert.match(state2.content, /下一步/)

  // unlink
  const unlink = await tools.canvas_arrange.execute({ input: { action: 'unlink', source: idA, target: idB }, cwd })
  assert.ok(!unlink.isError, unlink.content)
  assert.equal(readProj().edges.length, 0)

  // 重新连线，用于验证删除节点连带删边
  await tools.canvas_arrange.execute({ input: { action: 'link', source: idA, target: idB }, cwd })
  assert.equal(readProj().edges.length, 1)

  // arrange 错误路径
  const noAction = await tools.canvas_arrange.execute({ input: {}, cwd })
  assert.equal(noAction.isError, true)
  const badAction = await tools.canvas_arrange.execute({ input: { action: 'explode' }, cwd })
  assert.equal(badAction.isError, true)
  assert.match(badAction.content, /未知或缺失的 action/)
  const noId = await tools.canvas_arrange.execute({ input: { action: 'remove' }, cwd })
  assert.equal(noId.isError, true)
  assert.match(noId.content, /remove 需要 id/)
  const noEnd = await tools.canvas_arrange.execute({ input: { action: 'link', source: idA }, cwd })
  assert.equal(noEnd.isError, true)
  assert.match(noEnd.content, /link 需要 source 和 target/)
  const rmGhost = await tools.canvas_arrange.execute({ input: { action: 'remove', id: 'no-such-page' }, cwd })
  assert.equal(rmGhost.isError, true)
  const dupGhost = await tools.canvas_arrange.execute({ input: { action: 'duplicate', id: 'no-such-page' }, cwd })
  assert.equal(dupGhost.isError, true)

  // 删除节点连带删边与文件
  const rm = await tools.canvas_arrange.execute({ input: { action: 'remove', id: idA }, cwd })
  assert.ok(!rm.isError, rm.content)
  const pr = readProj()
  assert.ok(!pr.nodes.some((n) => n.id === idA))
  assert.equal(pr.edges.length, 0, '删除节点应连带删除其连线')
  assert.equal(existsSync(join(cwd, '.tianshu-canvas', 'pages', `${idA}.html`)), false, '删除节点应删除页面文件')

  console.log('OK 项目模型: upsert（新建/更新/仅改元数据）/get_state/越界 + arrange（复制/连线/取消连线/删除）全部通过')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
