/**
 * 本地服务测试：起服务 → GET /、/api/project → add 页 → 断言节点出现 → GET /page/:id。
 * 用 port:0 避免与真实端口冲突。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

const cwd = mkdtempSync(join(tmpdir(), 'tsc-srv-'))
try {
  const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
  assert.ok(!open.isError, open.content)
  const m = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)
  assert.ok(m, `未返回合法 URL: ${open.content}`)
  const parsed = new URL(m[0])
  const token = parsed.searchParams.get('ws')
  const base = parsed.origin
  const ws = encodeURIComponent(token)

  // healthz
  assert.equal((await fetch(`${base}/healthz`)).status, 200)

  // 首页（画布 SPA）
  const home = await fetch(`${base}/?ws=${ws}`)
  assert.equal(home.status, 200)
  assert.match(await home.text(), /canvas\.js/)

  // 静态资源白名单
  assert.equal((await fetch(`${base}/assets/canvas.js`)).status, 200)
  assert.equal((await fetch(`${base}/assets/canvas.css`)).status, 200)
  assert.equal((await fetch(`${base}/assets/../index.html`)).status, 404)
  assert.equal((await fetch(`${base}/assets/secret.txt`)).status, 404)

  // 项目（空）
  const apiProject = `${base}/api/project?ws=${ws}`
  const before = await (await fetch(apiProject)).json()
  assert.equal(before.nodes.length, 0)

  // 添加一页
  const add = await tools.canvas_upsert_page.execute({ input: { html: '<h1>P</h1>', title: 'P' }, cwd })
  assert.ok(!add.isError, add.content)

  // 项目里出现该节点
  const after = await (await fetch(apiProject)).json()
  assert.equal(after.nodes.length, 1)
  const id = after.nodes[0].id

  // 原型页可访问，且带沙箱 CSP + 注入探针
  const pageRes = await fetch(`${base}/page/${id}?ws=${ws}`)
  assert.equal(pageRes.status, 200)
  assert.match(pageRes.headers.get('content-security-policy') ?? '', /default-src 'none'/)
  const pageHtml = await pageRes.text()
  assert.match(pageHtml, /<h1>P<\/h1>/)
  assert.match(pageHtml, /data-tianshu-probe/, '原型页应注入探针')

  // 选中：写 → 读
  const selRes = await fetch(`${base}/api/selection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
    body: JSON.stringify({
      ws: token,
      pageId: id,
      kind: 'element',
      payload: { xpath: '/html[1]/body[1]/h1[1]', tagName: 'h1', textContent: 'P', computedStyles: { color: 'red' } },
    }),
  })
  assert.equal(selRes.status, 200)
  const gotSel = await (await fetch(`${base}/api/selection?ws=${ws}`)).json()
  assert.equal(gotSel.selection.pageId, id)
  assert.equal(gotSel.selection.kind, 'element')
  assert.equal(gotSel.selection.element.xpath, '/html[1]/body[1]/h1[1]')

  // 选中缺头 → 403
  const selNoHeader = await fetch(`${base}/api/selection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ws: token, pageId: id, kind: 'page' }),
  })
  assert.equal(selNoHeader.status, 403)

  // 未知 token 拒绝
  assert.equal((await fetch(`${base}/api/project?ws=deadbeefdeadbeef`)).status, 404)

  // 变更路由缺自定义头 → 403
  const noHeader = await fetch(`${base}/api/viewport`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ws: token, x: 1, y: 2, zoom: 1 }),
  })
  assert.equal(noHeader.status, 403)

  // 带自定义头 → 200
  const okHeader = await fetch(`${base}/api/viewport`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
    body: JSON.stringify({ ws: token, x: 10, y: 20, zoom: 1.5 }),
  })
  assert.equal(okHeader.status, 200)

  // 设计系统目录
  const catalogRes = await fetch(`${base}/api/design-systems`)
  assert.equal(catalogRes.status, 200)
  const catalog = await catalogRes.json()
  assert.deepEqual(catalog.styles.map((s) => s.id), [
    'apple',
    'google',
    'claude',
    'tianshu-original',
    'barbie',
    'nerv',
    'minimalist',
    'tianshu-inkstone',
    'tianshu-vapor',
    'tianshu-saffron',
    'tianshu-aurora',
  ])
  assert.ok(catalog.notice.includes('无隶属'))

  // 画布 UI 不再提供风格切换：/api/design 已移除（AI 侧走 canvas_style 工具）
  const designGone = await fetch(`${base}/api/design`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
    body: JSON.stringify({ ws: token, styleId: 'claude' }),
  })
  assert.equal(designGone.status, 404)

  console.log('OK 服务: /、/api/project、/page/:id（含探针）、/api/selection、/api/design-systems、CSRF 头、越界 id 全部通过')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
