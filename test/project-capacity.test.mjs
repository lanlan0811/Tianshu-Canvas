/** Capacity is checked against final UTF-8 disk bytes, including all transformations. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import { build } from 'esbuild'
import { loadPlugin, rawFetch, testCredential } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const MAX_HTML_BYTES = 8 * 1024 * 1024
const MAX_PAGE_COUNT = 1000
const { tools, api: plugin } = await loadPlugin(pathToFileURL(join(root, 'dist/index.mjs')).href)
const apiDir = mkdtempSync(join(tmpdir(), 'tsc-capacity-api-'))
await build({
  stdin: { contents: "export * from './src/project.ts'; export { inlineAssets } from './src/inlineAssets.ts';", resolveDir: root },
  outfile: join(apiDir, 'api.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent',
})
const storage = await import(pathToFileURL(join(apiDir, 'api.mjs')).href)
after(async () => { await plugin.dispose?.(); rmSync(apiDir, { recursive: true, force: true }) })

function node(id) {
  return { id, type: 'page', title: id, x: 0, y: 0, width: 1440, height: 900, deviceType: 'desktop', htmlPath: `.tianshu-canvas/pages/${id}.html`, htmlRev: 1, createdAt: 1, updatedAt: 1 }
}

function fixture(count = 0) {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-capacity-'))
  const dir = join(cwd, '.tianshu-canvas')
  const pages = join(dir, 'pages')
  mkdirSync(pages, { recursive: true })
  const nodes = Array.from({ length: count }, (_, index) => node(`page-${index}`))
  const file = join(dir, 'project.json')
  writeFileSync(file, JSON.stringify({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] }) + '\n')
  for (const node of nodes) writeFileSync(join(pages, `${node.id}.html`), '<p>original</p>')
  return { cwd, dir, pages, file, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

const project = ws => JSON.parse(readFileSync(ws.file, 'utf8'))
const page = (ws, id) => readFileSync(join(ws.pages, `${id}.html`), 'utf8')
const call = (ws, name, input) => tools[name].execute({ input, cwd: ws.cwd })
const upsert = (ws, input) => call(ws, 'canvas_upsert_page', input)
function snapshot(ws) {
  return Object.fromEntries([['project.json', createHash('sha256').update(readFileSync(ws.file)).digest('hex')], ...readdirSync(ws.pages).sort().map(name => [name, createHash('sha256').update(readFileSync(join(ws.pages, name))).digest('hex')])])
}
function directorySnapshot(dir) {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).filter(item => item.name !== 'project.lock').flatMap(item => {
    const file = join(dir, item.name)
    return item.isDirectory() ? Object.entries(directorySnapshot(file)).map(([name, digest]) => [item.name + '/' + name, digest]) : [[item.name, createHash('sha256').update(readFileSync(file)).digest('hex')]]
  }))
}
function sizedHtml(bytes, text = '') {
  const prefix = '<!doctype html><html><body><main>' + text
  const suffix = '</main></body></html>'
  const padding = bytes - Buffer.byteLength(prefix + suffix)
  assert.ok(padding >= 0)
  const html = prefix + 'a'.repeat(padding) + suffix
  assert.equal(Buffer.byteLength(html), bytes)
  return html
}

test('公开upsert接受8MiB前一字节及精确边界，多一字节拒绝且项目页面字节不变', async () => {
  const ws = fixture()
  try {
    for (const bytes of [MAX_HTML_BYTES - 1, MAX_HTML_BYTES]) {
      const html = sizedHtml(bytes)
      const result = await upsert(ws, { id: 'page-boundary', html })
      assert.ok(!result.isError, result.content)
      assert.equal(Buffer.byteLength(page(ws, 'page-boundary')), bytes)
    }
    const before = snapshot(ws)
    const rejected = await upsert(ws, { id: 'page-boundary', html: sizedHtml(MAX_HTML_BYTES + 1) })
    assert.equal(rejected.isError, true, '8MiB+1 must be rejected')
    assert.match(rejected.content, /8\s*MiB|8388608|8\s*MB/i)
    assert.deepEqual(snapshot(ws), before)
    assert.equal(existsSync(join(ws.dir, 'project.lock')), false)
  } finally { ws.cleanup() }
})

test('中文多字节按UTF-8判限，html_path与内联写入口一致', async () => {
  const ws = fixture(1)
  try {
    const exact = sizedHtml(MAX_HTML_BYTES, '中文容量'.repeat(100))
    assert.ok(exact.length < MAX_HTML_BYTES)
    assert.ok(!(await upsert(ws, { id: 'page-0', html: exact })).isError)
    const rejectedHtml = exact.replace('<main>', '<main>中')
    assert.ok(rejectedHtml.length < MAX_HTML_BYTES)
    assert.equal(Buffer.byteLength(rejectedHtml), MAX_HTML_BYTES + 3)
    const before = snapshot(ws)
    writeFileSync(join(ws.cwd, 'source.html'), rejectedHtml)
    const rejected = await upsert(ws, { id: 'page-0', html_path: 'source.html' })
    assert.equal(rejected.isError, true)
    assert.deepEqual(snapshot(ws), before)
  } finally { ws.cleanup() }
})

test('设计注入后再检查最终字节，换肤批次超限不留下部分改写', async () => {
  const ws = fixture(2)
  try {
    assert.ok(!(await call(ws, 'canvas_style', { action: 'set', style_id: 'claude' })).isError)
    const before = snapshot(ws)
    const source = sizedHtml(MAX_HTML_BYTES - 32)
    const rejected = await upsert(ws, { id: 'page-0', html: source })
    assert.equal(rejected.isError, true, 'design tokens/components must count toward final bytes')
    assert.deepEqual(snapshot(ws), before)
    assert.ok(!(await call(ws, 'canvas_style', { action: 'set', style_id: 'free' })).isError)
    writeFileSync(join(ws.pages, 'page-1.html'), sizedHtml(MAX_HTML_BYTES))
    const beforeBatch = snapshot(ws)
    const batch = await call(ws, 'canvas_style', { action: 'set', style_id: 'apple' })
    assert.equal(batch.isError, true)
    assert.deepEqual(snapshot(ws), beforeBatch, 'a later failing page must not leave an earlier page restyled')
  } finally { ws.cleanup() }
})

test('创建覆盖自定义风格和品牌包导入因注入超限失败时，library/memory/project/pages全字节不变', async () => {
  const ws = fixture(2)
  const source = fixture()
  const tokens = JSON.parse(readFileSync(join(root, 'design-systems/styles/apple/tokens.json'), 'utf8'))
  const custom = { id: 'rollback-existing', tokens, name: '容量事务风格', tagline: '测试', description: '合成验收夹具', tags: ['test'], swatches: ['#ffffff', '#1d1d1f'], iconStyle: { strokeWidth: 1.6 }, set_current: false }
  try {
    assert.ok(!(await call(ws, 'canvas_design_system', { action: 'create', ...custom })).isError)
    assert.ok(!(await call(source, 'canvas_design_system', { action: 'create', ...custom, id: 'rollback-imported', set_current: true })).isError)
    const usage = await call(source, 'canvas_style', { action: 'codegen', target: 'react', html: '<main><button class="ts-btn ts-btn--primary">save</button></main>' })
    assert.ok(!usage.isError, usage.content)
    assert.ok(existsSync(join(source.dir, 'memory/brand.json')), 'pack fixture must contain actual brand memory')
    const exported = await call(source, 'canvas_design_system', { action: 'export', id: 'rollback-imported', out_dir: 'packs' })
    assert.ok(!exported.isError, exported.content)
    const pack = join(ws.cwd, 'incoming-pack.json')
    writeFileSync(pack, readFileSync(join(source.cwd, 'packs/rollback-imported.json')))
    mkdirSync(join(ws.dir, 'memory'), { recursive: true })
    writeFileSync(join(ws.dir, 'memory/brand.json'), JSON.stringify({ schemaVersion: 1, styles: {}, updatedAt: 1 }) + '\n')
    writeFileSync(join(ws.pages, 'page-1.html'), sizedHtml(MAX_HTML_BYTES))
    const before = directorySnapshot(ws.dir)
    for (const input of [
      { action: 'create', ...custom, id: 'rollback-new', set_current: true },
      { action: 'create', ...custom, overwrite: true, name: 'must not replace metadata', set_current: true },
      { action: 'import_pack', pack_path: 'incoming-pack.json' },
    ]) {
      const result = await call(ws, 'canvas_design_system', input)
      assert.equal(result.isError, true, result.content)
      assert.match(result.content, /8\s*MiB|8388608/i)
      assert.deepEqual(directorySnapshot(ws.dir), before)
      assert.equal(existsSync(join(ws.dir, 'library/rollback-new')), false)
      assert.equal(existsSync(join(ws.dir, 'library/rollback-imported')), false)
      assert.equal(existsSync(join(ws.dir, 'project.lock')), false)
    }
  } finally { ws.cleanup(); source.cleanup() }
})

test('资源内联膨胀后的最终HTML经过共用写入限制，拒绝不提交已暂存页面', async () => {
  const ws = fixture(1)
  try {
    const source = sizedHtml(MAX_HTML_BYTES - 200).replace('<main>', '<main><img src="https://cdn.example.com/large.png">')
    assert.ok(Buffer.byteLength(source) < MAX_HTML_BYTES)
    const inlined = await storage.inlineAssets(source, { fetchImpl: async url => ({ body: Buffer.alloc(1024, 255), contentType: 'image/png', url }) })
    assert.equal(inlined.inlined, 1)
    assert.ok(Buffer.byteLength(inlined.html) > MAX_HTML_BYTES)
    const before = snapshot(ws)
    assert.throws(() => storage.withProjectTransaction(ws.cwd, tx => {
      tx.stagePageHtml('page-staged-first', '<p>must not escape</p>')
      tx.stagePageHtml('page-0', inlined.html)
    }), error => error.code === 'HTML_SIZE_LIMIT')
    assert.deepEqual(snapshot(ws), before)
    assert.equal(existsSync(join(ws.pages, 'page-staged-first.html')), false)
    assert.equal(existsSync(join(ws.dir, 'project.lock')), false)
  } finally { ws.cleanup() }
})

test('999页允许创建第1000页，创建与复制不能绕过上限，拒绝无孤立HTML', async () => {
  const ws = fixture(MAX_PAGE_COUNT - 1)
  try {
    const allowed = await upsert(ws, { id: 'page-thousand', title: 'the thousandth', html: '<p>allowed</p>' })
    assert.ok(!allowed.isError, allowed.content)
    assert.equal(project(ws).nodes.length, MAX_PAGE_COUNT)
    assert.equal(readdirSync(ws.pages).length, MAX_PAGE_COUNT)
    const before = snapshot(ws)
    for (const [name, input] of [
      ['canvas_upsert_page', { id: 'page-too-many', html: '<p>denied</p>' }],
      ['canvas_arrange', { action: 'duplicate', id: 'page-0' }],
    ]) {
      const rejected = await call(ws, name, input)
      assert.equal(rejected.isError, true, rejected.content)
      assert.match(rejected.content, /1000/)
      assert.deepEqual(snapshot(ws), before)
    }
    const updated = await upsert(ws, { id: 'page-0', html: '<p>existing updates still allowed</p>' })
    assert.ok(!updated.isError, updated.content)
    assert.equal(project(ws).nodes.length, MAX_PAGE_COUNT)
  } finally { ws.cleanup() }
})

test('批量暂存到第1001页时整体拒绝，第1000页与页面正文不提前落盘', () => {
  const ws = fixture(MAX_PAGE_COUNT - 1)
  try {
    const before = snapshot(ws)
    assert.throws(() => storage.withProjectTransaction(ws.cwd, tx => {
      tx.stagePageHtml('page-first-staged', '<p>first</p>')
      storage.upsertNode(ws.cwd, node('page-first-staged'), tx)
      tx.stagePageHtml('page-second-staged', '<p>second</p>')
      storage.upsertNode(ws.cwd, node('page-second-staged'), tx)
    }), error => error.code === 'PAGE_COUNT_LIMIT')
    assert.deepEqual(snapshot(ws), before)
    assert.equal(existsSync(join(ws.pages, 'page-first-staged.html')), false)
    assert.equal(existsSync(join(ws.pages, 'page-second-staged.html')), false)
  } finally { ws.cleanup() }
})

test('旧超限HTML在未满页数项目中也不能经复制绕过，原页元数据仍可编辑', async () => {
  const ws = fixture(1)
  try {
    const oversized = sizedHtml(MAX_HTML_BYTES + 1)
    writeFileSync(join(ws.pages, 'page-0.html'), oversized)
    const before = snapshot(ws)
    const duplicate = await call(ws, 'canvas_arrange', { action: 'duplicate', id: 'page-0' })
    assert.equal(duplicate.isError, true)
    assert.deepEqual(snapshot(ws), before)
    const rewrite = await upsert(ws, { id: 'page-0', html: oversized })
    assert.equal(rewrite.isError, true)
    assert.deepEqual(snapshot(ws), before)
    const metadata = await upsert(ws, { id: 'page-0', title: 'retained legacy body' })
    assert.ok(!metadata.isError, metadata.content)
    assert.equal(page(ws, 'page-0'), oversized)
  } finally { ws.cleanup() }
})

test('旧1001页/超限HTML仍可读取、元数据更新和删除，重写内容必须降至限额', async () => {
  const ws = fixture(MAX_PAGE_COUNT + 1)
  try {
    const oversized = sizedHtml(MAX_HTML_BYTES + 1)
    writeFileSync(join(ws.pages, 'page-0.html'), oversized)
    const listed = await call(ws, 'canvas_get_state', {})
    assert.ok(!listed.isError, listed.content)
    assert.match(listed.content, /1001/)
    const renamed = await upsert(ws, { id: 'page-0', title: 'legacy title', x: 15 })
    assert.ok(!renamed.isError, renamed.content)
    assert.equal(page(ws, 'page-0'), oversized)
    assert.equal(project(ws).nodes.length, MAX_PAGE_COUNT + 1)
    const before = snapshot(ws)
    const copied = await call(ws, 'canvas_arrange', { action: 'duplicate', id: 'page-0' })
    assert.equal(copied.isError, true)
    assert.deepEqual(snapshot(ws), before)
    const rewritten = await upsert(ws, { id: 'page-0', html: '<p>reduced content</p>' })
    assert.ok(!rewritten.isError, rewritten.content)
    assert.equal(page(ws, 'page-0'), '<p>reduced content</p>')
    const removed = await call(ws, 'canvas_arrange', { action: 'remove', id: 'page-1000' })
    assert.ok(!removed.isError, removed.content)
    assert.equal(project(ws).nodes.length, MAX_PAGE_COUNT)
    assert.equal(existsSync(join(ws.pages, 'page-1000.html')), false)
  } finally { ws.cleanup() }
})

test('HTTP复制同样返回容量错误，锁争用返回409且正常工具恢复', async () => {
  const ws = fixture(MAX_PAGE_COUNT)
  try {
    const opened = await call(ws, 'canvas_open', { port: 0 })
    assert.ok(!opened.isError, opened.content)
    const url = new URL(opened.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)[0])
    const token = url.searchParams.get('ws')
    const endpoint = `${url.origin}/api/nodes`
    const post = body => rawFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1', Authorization: `Bearer ${testCredential(token)}` }, body: JSON.stringify({ ws: token, ...body }) })
    const before = snapshot(ws)
    const duplicate = await post({ op: 'duplicate', id: 'page-0' })
    assert.equal(duplicate.status, 400)
    assert.match(await duplicate.text(), /1000/)
    assert.deepEqual(snapshot(ws), before)
    const lock = join(ws.dir, 'project.lock')
    writeFileSync(lock, '{manual-test-lock}')
    const locked = await post({ op: 'rename', id: 'page-0', title: 'denied' })
    assert.equal(locked.status, 409)
    assert.deepEqual(snapshot(ws), before)
    const toolLocked = await upsert(ws, { id: 'page-0', title: 'denied' })
    assert.equal(toolLocked.isError, true)
    assert.equal(readFileSync(lock, 'utf8'), '{manual-test-lock}')
    rmSync(lock)
    const recovered = await post({ op: 'rename', id: 'page-0', title: 'recovered' })
    assert.equal(recovered.status, 200)
    assert.equal(project(ws).nodes[0].title, 'recovered')
  } finally { ws.cleanup() }
})

test('同族写入口全部遵守工作区锁，争用不改简报、批注、连线、自定义风格或HTML', async () => {
  const ws = fixture(2)
  const tokens = JSON.parse(readFileSync(join(root, 'design-systems/styles/apple/tokens.json'), 'utf8'))
  const custom = { id: 'capacity-lock-style', tokens, name: '锁测试风格', tagline: '测试', description: '本地合成夹具', tags: ['test'], swatches: ['#ffffff', '#1d1d1f'], iconStyle: { strokeWidth: 1.6 }, set_current: false }
  const tree = directorySnapshot
  try {
    const created = await call(ws, 'canvas_design_system', { ...custom, action: 'create' })
    assert.ok(!created.isError, created.content)
    const opened = await call(ws, 'canvas_open', { port: 0 })
    assert.ok(!opened.isError, opened.content)
    const url = new URL(opened.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)[0])
    const token = url.searchParams.get('ws')
    const lock = join(ws.dir, 'project.lock')
    const before = tree(ws.dir)
    writeFileSync(lock, '{another-holder}')
    for (const [name, input] of [
      ['canvas_upsert_page', { id: 'page-0', html: '<p>changed</p>' }],
      ['canvas_arrange', { action: 'link', source: 'page-0', target: 'page-1' }],
      ['canvas_arrange', { action: 'unlink', source: 'page-0', target: 'page-1' }],
      ['canvas_arrange', { action: 'remove', id: 'page-0' }],
      ['canvas_comments', { action: 'resolve', ids: ['cmt-none'] }],
      ['canvas_comments', { action: 'remove', ids: ['cmt-none'] }],
      ['canvas_style', { action: 'brief', page_id: 'page-0', brief: { purpose: 'must not save' } }],
      ['canvas_style', { action: 'set', style_id: 'apple' }],
      ['canvas_design_system', { ...custom, action: 'create', id: 'new-locked-style' }],
      ['canvas_design_system', { ...custom, action: 'create', overwrite: true }],
      ['canvas_design_system', { action: 'remove', id: custom.id }],
    ]) {
      const result = await call(ws, name, input)
      assert.equal(result.isError, true, `${name} ${input.action}: ${result.content}`)
      assert.match(result.content, /重试/, `${name} ${input.action} should report contention`)
      assert.deepEqual(tree(ws.dir), before)
      assert.equal(readFileSync(lock, 'utf8'), '{another-holder}')
    }
    for (const [route, body] of [
      ['/api/viewport', { x: 5, y: 8, zoom: 2 }],
      ['/api/comments', { op: 'add', pageId: 'page-0', xpath: '/html/body/p', note: 'must not save' }],
      ['/api/nodes', { op: 'move', id: 'page-0', x: 5, y: 8 }],
      ['/api/edges', { op: 'add', source: 'page-0', target: 'page-1' }],
    ]) {
      const result = await rawFetch(url.origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1', Authorization: `Bearer ${testCredential(token)}` }, body: JSON.stringify({ ws: token, ...body }) })
      assert.equal(result.status, 409, route + ': ' + await result.text())
      assert.deepEqual(tree(ws.dir), before)
    }
    rmSync(lock)
  } finally { ws.cleanup() }
})
