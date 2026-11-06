/**
 * 元素批注测试：
 *  - canvas_comments list/resolve/reopen/remove
 *  - 批注从 project.json 读出（前端落盘路径）
 *  - 非法条目被静默归一化丢弃
 *  - 删除节点连带删除该页批注
 *  - 服务端 /api/comments 读写往返
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)

const cwd = mkdtempSync(join(tmpdir(), 'tsc-cmt-'))
const projectFile = join(cwd, '.tianshu-canvas', 'project.json')
const readJson = () => JSON.parse(readFileSync(projectFile, 'utf8'))

/** 模拟前端 POST /api/comments 落盘：直接改 project.json 的 comments[]。 */
function injectComments(list) {
  const p = readJson()
  p.comments = list
  writeFileSync(projectFile, JSON.stringify(p, null, 2) + '\n')
}

try {
  // 建一页
  const add = await tools.canvas_upsert_page.execute({ input: { html: '<h1>Hello</h1>', title: '登录页' }, cwd })
  assert.ok(!add.isError, add.content)
  const id = add.content.match(/id=([\w-]+)/)[1]

  // 无批注
  const empty = await tools.canvas_comments.execute({ input: { action: 'list' }, cwd })
  assert.ok(!empty.isError)
  assert.match(empty.content, /没有元素批注/)

  // 注入两条批注（一条已解决）
  injectComments([
    {
      id: 'cmt-11111111',
      pageId: id,
      xpath: '/html[1]/body[1]/h1[1]',
      tagName: 'h1',
      textContent: 'Hello',
      note: '改成主色标题',
      createdAt: 1000,
      resolved: false,
    },
    {
      id: 'cmt-22222222',
      pageId: id,
      xpath: '/html[1]/body[1]/p[1]',
      tagName: 'p',
      note: '这段删掉',
      createdAt: 2000,
      resolved: true,
      resolvedAt: 3000,
    },
  ])

  const list = await tools.canvas_comments.execute({ input: { action: 'list' }, cwd })
  assert.ok(!list.isError)
  assert.match(list.content, /待处理批注 1 条/)
  assert.match(list.content, /登录页/)
  assert.match(list.content, /改成主色标题/)
  assert.match(list.content, /h1\[1\]/)
  assert.doesNotMatch(list.content, /这段删掉/, 'list 默认不列已解决')

  const listAll = await tools.canvas_comments.execute({ input: { action: 'list', include_resolved: true }, cwd })
  assert.match(listAll.content, /这段删掉/)

  // canvas_get_state 提示待处理数
  const state = await tools.canvas_get_state.execute({ input: {}, cwd })
  assert.match(state.content, /待处理批注：1 条/)

  // resolve
  const resolved = await tools.canvas_comments.execute({ input: { action: 'resolve', ids: ['cmt-11111111'] }, cwd })
  assert.ok(!resolved.isError)
  assert.match(resolved.content, /已标记 1 条/)
  const afterResolve = readJson().comments
  assert.equal(afterResolve.find((c) => c.id === 'cmt-11111111').resolved, true)
  assert.ok(afterResolve.find((c) => c.id === 'cmt-11111111').resolvedAt > 0)

  const nonePending = await tools.canvas_comments.execute({ input: { action: 'list' }, cwd })
  assert.match(nonePending.content, /全部已解决/)

  // reopen
  const reopened = await tools.canvas_comments.execute({ input: { action: 'reopen', ids: ['cmt-11111111'] }, cwd })
  assert.match(reopened.content, /已重新打开 1 条/)
  const afterReopen = readJson().comments.find((c) => c.id === 'cmt-11111111')
  assert.equal(afterReopen.resolved, false)
  assert.equal(afterReopen.resolvedAt, undefined)

  // 非法条目：缺 note / 非字符串 xpath → 静默丢弃，其余保留
  injectComments([
    { id: 'cmt-33333333', pageId: id, xpath: '/html[1]/body[1]/h1[1]', tagName: 'h1', note: '有效批注', createdAt: 1, resolved: false },
    { id: 'cmt-bad-1', pageId: id, xpath: '/x', tagName: 'x', createdAt: 1, resolved: false },
    { id: 'cmt-bad-2', pageId: id, xpath: 123, tagName: 'x', note: 'xpath 非字符串', createdAt: 1, resolved: false },
    { id: '', pageId: id, xpath: '/x', note: 'id 空', createdAt: 1, resolved: false },
  ])
  const cleaned = await tools.canvas_comments.execute({ input: { action: 'list' }, cwd })
  assert.match(cleaned.content, /有效批注/)
  assert.doesNotMatch(cleaned.content, /xpath 非字符串/)
  assert.doesNotMatch(cleaned.content, /id 空/)

  // remove ids
  const removed = await tools.canvas_comments.execute({ input: { action: 'remove', ids: ['cmt-33333333'] }, cwd })
  assert.match(removed.content, /已删除 1 条/)
  assert.equal(readJson().comments, undefined)

  // 删除节点 → 连带删除该页批注
  injectComments([
    { id: 'cmt-44444444', pageId: id, xpath: '/html[1]/body[1]/h1[1]', tagName: 'h1', note: '将被连带删除', createdAt: 1, resolved: false },
  ])
  const del = await tools.canvas_arrange.execute({ input: { action: 'remove', id }, cwd })
  assert.ok(!del.isError, del.content)
  assert.equal(readJson().comments, undefined)

  // remove 缺参
  const badRemove = await tools.canvas_comments.execute({ input: { action: 'remove' }, cwd })
  assert.ok(badRemove.isError)

  // ---- 服务端 /api/comments 往返 ----
  const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
  const m = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]{16}/)
  assert.ok(m, `未返回合法 URL: ${open.content}`)
  const token = new URL(m[0]).searchParams.get('ws')
  const base = new URL(m[0]).origin
  const ws = encodeURIComponent(token)

  const page2 = await tools.canvas_upsert_page.execute({ input: { html: '<h1>B</h1>', title: 'B' }, cwd })
  const id2 = page2.content.match(/id=([\w-]+)/)[1]

  const addRes = await fetch(`${base}/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
    body: JSON.stringify({ ws: token, op: 'add', pageId: id2, xpath: '/html[1]/body[1]/h1[1]', tagName: 'h1', note: '服务端批注' }),
  })
  assert.equal(addRes.status, 200)
  const created = (await addRes.json()).comment
  assert.ok(created.id)

  const got = await (await fetch(`${base}/api/comments?ws=${ws}`)).json()
  assert.equal(got.comments.length, 1)
  assert.equal(got.comments[0].note, '服务端批注')

  const resolveRes = await fetch(`${base}/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
    body: JSON.stringify({ ws: token, op: 'resolve', ids: [created.id], resolved: true }),
  })
  assert.equal((await resolveRes.json()).changed, 1)
  assert.equal((await (await fetch(`${base}/api/comments?ws=${ws}`)).json()).comments[0].resolved, true)

  // 缺自定义头 → 403
  const noHeader = await fetch(`${base}/api/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ws: token, op: 'remove', ids: [created.id] }),
  })
  assert.equal(noHeader.status, 403)

  console.log('OK 批注: list/resolve/reopen/remove + 归一化 + 节点连带删除 + /api/comments 往返')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
