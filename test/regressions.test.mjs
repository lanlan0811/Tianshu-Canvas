/**
 * 回归：畸形百分号编码与未捕获异常、损坏的 project.json、
 * 连线/选中校验、超限请求体、IPv6 Host。
 * 断言的是构建产物 dist/index.js。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, describe, test } from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)

const MAX_BODY = 4 * 1024 * 1024
const MAX_VIEWPORT_BODY = 4096

/** http.request 原样发送 path / Host，不会像 fetch 那样重编码百分号。 */
function rawRequest({ port, method = 'GET', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (status, text) => {
      if (done) return
      done = true
      resolve({ status, body: text })
    }
    const fail = (err) => {
      if (done) return
      done = true
      reject(err)
    }
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path, headers },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        const doneRes = () => finish(res.statusCode ?? 0, Buffer.concat(chunks).toString('utf8'))
        res.on('end', doneRes)
        res.on('aborted', doneRes)
        res.on('error', fail)
      },
    )
    req.on('error', fail)
    req.setTimeout(15000, () => fail(new Error(`timeout ${method} ${path}`)))
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function pageIdFrom(content) {
  const m = String(content).match(/id=([\w-]+)/)
  assert.ok(m, `未返回页面 id: ${content}`)
  return m[1]
}

describe('回归', { concurrency: false }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-reg-'))
  let base = ''
  let port = 0
  let token = ''

  before(async () => {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    assert.ok(!open.isError, open.content)
    const m = open.content.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?ws=([0-9a-f]{16})/)
    assert.ok(m, `未返回合法 URL: ${open.content}`)
    port = Number(m[1])
    token = m[2]
    base = `http://127.0.0.1:${port}`
  })

  after(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  test('畸形百分号编码返回 400，未预期异常返回 500，进程不退出', async () => {
    const keep = await tools.canvas_upsert_page.execute({ input: { html: '<h1>Keep</h1>', title: 'Keep' }, cwd })
    assert.ok(!keep.isError, keep.content)
    const keepId = pageIdFrom(keep.content)

    const encoded = await rawRequest({ port, path: `/page/${keepId.replaceAll('-', '%2D')}?ws=${token}` })
    assert.equal(encoded.status, 200, encoded.body)
    assert.match(encoded.body, /Keep/)

    for (const badPath of ['%E0%A4%A', '%', '%ZZ', '%%']) {
      const bad = await rawRequest({ port, path: `/page/${badPath}?ws=${token}` })
      assert.equal(bad.status, 400, `${badPath} -> ${bad.status} ${bad.body}`)
      assert.equal(bad.body, 'bad page id')
    }

    assert.equal((await fetch(`${base}/healthz`)).status, 200)
    const still = await rawRequest({ port, path: `/page/${keepId}?ws=${token}` })
    assert.equal(still.status, 200)

    const boom = await tools.canvas_upsert_page.execute({ input: { html: '<h1>Boom</h1>', title: 'Boom' }, cwd })
    assert.ok(!boom.isError, boom.content)
    const boomId = pageIdFrom(boom.content)
    const pageFile = join(cwd, '.tianshu-canvas', 'pages', `${boomId}.html`)
    rmSync(pageFile)
    mkdirSync(pageFile)

    const crashed = await rawRequest({ port, path: `/page/${boomId}?ws=${token}` })
    assert.equal(crashed.status, 500, crashed.body)
    assert.equal(crashed.body, 'internal error')
    assert.equal((await fetch(`${base}/healthz`)).status, 200)
    assert.equal((await rawRequest({ port, path: `/page/${keepId}?ws=${token}` })).status, 200)
  })

  test('损坏的 project.json 先备份再按空项目继续，原始字节不丢', async () => {
    async function readAsEmpty(dir, original) {
      const projDir = join(dir, '.tianshu-canvas')
      mkdirSync(projDir, { recursive: true })
      const file = join(projDir, 'project.json')
      const valid = JSON.stringify({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] })
      writeFileSync(file, valid)
      const ok = await tools.canvas_get_state.execute({ input: {}, cwd: dir })
      assert.ok(!ok.isError, ok.content)
      assert.equal(
        readdirSync(projDir).some((name) => name.startsWith('project.json.corrupt-')),
        false,
        '合法项目不应备份',
      )
      assert.equal(readFileSync(file, 'utf8'), valid)

      writeFileSync(file, original)
      const state = await tools.canvas_get_state.execute({ input: {}, cwd: dir })
      assert.ok(!state.isError, state.content)
      assert.match(state.content, /暂无页面节点/)

      const backups = readdirSync(projDir).filter((name) => name.startsWith('project.json.corrupt-'))
      assert.equal(backups.length, 1)
      assert.match(backups[0], /^project\.json\.corrupt-\d+$/)
      assert.equal(readFileSync(join(projDir, backups[0]), 'utf8'), original)
      assert.equal(existsSync(file), false, '损坏文件应被挪走，避免随后写入覆盖')

      await tools.canvas_get_state.execute({ input: {}, cwd: dir })
      assert.equal(readdirSync(projDir).filter((name) => name.startsWith('project.json.corrupt-')).length, 1)

      const add = await tools.canvas_upsert_page.execute({ input: { html: '<p>new</p>', title: 'N' }, cwd: dir })
      assert.ok(!add.isError, add.content)
      assert.equal(readFileSync(join(projDir, backups[0]), 'utf8'), original)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      assert.equal(saved.nodes.length, 1)
      assert.equal(saved.nodes[0].title, 'N')
    }

    const badJson = mkdtempSync(join(tmpdir(), 'tsc-corrupt-json-'))
    const badShape = mkdtempSync(join(tmpdir(), 'tsc-corrupt-shape-'))
    try {
      await readAsEmpty(badJson, '{ this is not json\nbut it matters')
      await readAsEmpty(badShape, '{"version":1,"notes":"keep-me"}')
    } finally {
      rmSync(badJson, { recursive: true, force: true })
      rmSync(badShape, { recursive: true, force: true })
    }
  })

  test('连线校验非法端点与自环，删除无变化不写盘；选中非法 pageId 返回 400', async () => {
    const a = await tools.canvas_upsert_page.execute({ input: { html: '<p>A</p>', title: 'A' }, cwd })
    const b = await tools.canvas_upsert_page.execute({ input: { html: '<p>B</p>', title: 'B' }, cwd })
    assert.ok(!a.isError && !b.isError, `${a.content}\n${b.content}`)
    const idA = pageIdFrom(a.content)
    const idB = pageIdFrom(b.content)
    const file = join(cwd, '.tianshu-canvas', 'project.json')

    const postEdge = (op, source, target) =>
      rawRequest({
        port,
        method: 'POST',
        path: '/api/edges',
        headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
        body: JSON.stringify({ ws: token, op, source, target }),
      })

    const added = await postEdge('add', idA, idB)
    assert.equal(added.status, 200, added.body)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).edges.length, 1)

    const self = await postEdge('add', idA, idA)
    assert.equal(self.status, 400, self.body)
    assert.match(self.body, /自身/)

    const unsafe = await postEdge('add', '../evil', idB)
    assert.equal(unsafe.status, 400, unsafe.body)
    assert.match(unsafe.body, /invalid page id/)

    const missing = await postEdge('add', 'page-missing1', 'page-missing2')
    assert.equal(missing.status, 400, missing.body)
    assert.match(missing.body, /节点不存在/)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).edges.length, 1, '拒绝的连线不应写入')

    const toolSelf = await tools.canvas_arrange.execute({ input: { action: 'link', source: idA, target: idA }, cwd })
    assert.equal(toolSelf.isError, true)
    assert.match(toolSelf.content, /自身/)
    const toolUnsafe = await tools.canvas_arrange.execute({ input: { action: 'unlink', source: '../evil', target: idB }, cwd })
    assert.equal(toolUnsafe.isError, true)
    assert.match(toolUnsafe.content, /invalid page id/)

    const past = new Date(Date.now() - 120_000)
    utimesSync(file, past, past)
    const before = statSync(file).mtimeMs
    const noop = await postEdge('remove', idB, idA)
    assert.equal(noop.status, 200, noop.body)
    assert.equal(statSync(file).mtimeMs, before, '删除不存在的连线不应写盘')
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).edges.length, 1)

    const removed = await postEdge('remove', idA, idB)
    assert.equal(removed.status, 200, removed.body)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).edges.length, 0)
    assert.notEqual(statSync(file).mtimeMs, before)

    utimesSync(file, past, past)
    const beforeAgain = statSync(file).mtimeMs
    const again = await postEdge('remove', idA, idB)
    assert.equal(again.status, 200, again.body)
    assert.equal(statSync(file).mtimeMs, beforeAgain)

    const selPath = join(cwd, '.tianshu-canvas', 'selection.json')
    rmSync(selPath, { force: true })
    const badSel = await rawRequest({
      port,
      method: 'POST',
      path: '/api/selection',
      headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
      body: JSON.stringify({ ws: token, pageId: '../evil', kind: 'page' }),
    })
    assert.equal(badSel.status, 400, badSel.body)
    assert.match(badSel.body, /invalid page id/)
    assert.equal(existsSync(selPath), false)

    const okSel = await rawRequest({
      port,
      method: 'POST',
      path: '/api/selection',
      headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
      body: JSON.stringify({ ws: token, pageId: idA, kind: 'page' }),
    })
    assert.equal(okSel.status, 200, okSel.body)
    assert.equal(JSON.parse(readFileSync(selPath, 'utf8')).pageId, idA)
  })

  test('请求体超限先返回 413，视口与通用上限都生效', async () => {
    const headers = { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' }
    const viewport = (body) =>
      rawRequest({ port, method: 'POST', path: '/api/viewport', headers, body })

    const small = await viewport(JSON.stringify({ ws: token, x: 3, y: 4, zoom: 1.25 }))
    assert.equal(small.status, 200, small.body)

    const overViewport = await viewport('x'.repeat(MAX_VIEWPORT_BODY + 1))
    assert.equal(overViewport.status, 413, overViewport.body)
    assert.match(overViewport.body, /body too large/)

    const atLimit = await viewport(JSON.stringify({ ws: token, x: 1, y: 1, zoom: 1 }).padEnd(MAX_VIEWPORT_BODY, ' '))
    assert.notEqual(atLimit.status, 413, '刚好达到上限仍应接受')
    assert.equal(atLimit.status, 200, atLimit.body)

    const overBody = await rawRequest({
      port,
      method: 'POST',
      path: '/api/edges',
      headers,
      body: 'y'.repeat(MAX_BODY + 1),
    })
    assert.equal(overBody.status, 413, overBody.body)
    assert.match(overBody.body, /body too large/)

    const again = await viewport(JSON.stringify({ ws: token, x: 8, y: 9, zoom: 2 }))
    assert.equal(again.status, 200, again.body)
    assert.equal((await fetch(`${base}/healthz`)).status, 200)

    const saved = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
    assert.equal(saved.viewport.x, 8)
    assert.equal(saved.viewport.y, 9)
    assert.equal(saved.viewport.zoom, 2)
  })

  test('Host 正确解析方括号 IPv6，::1 视为本机', async () => {
    const cases = [
      [`[::1]:${port}`, 200],
      ['::1', 200],
      ['[::1]', 200],
      [`127.0.0.1:${port}`, 200],
      ['127.0.0.1', 200],
      ['localhost', 200],
      [`localhost:${port}`, 200],
      ['evil.example', 403],
      [`evil.example:${port}`, 403],
      [`[::2]:${port}`, 403],
      ['[::1', 403],
    ]
    for (const [host, status] of cases) {
      const res = await rawRequest({ port, path: '/healthz', headers: { Host: host } })
      assert.equal(res.status, status, `Host ${host} -> ${res.status} ${res.body}`)
      if (status === 200) assert.equal(res.body, 'ok')
    }
    assert.equal((await fetch(`${base}/healthz`)).status, 200)
  })
})
