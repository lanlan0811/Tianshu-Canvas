/** Only fetchUrl is controlled; real inlining, tools, design, navigation and transactions run. */
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const apiDir = mkdtempSync(join(tmpdir(), 'tsc-async-api-'))
await build({
  stdin: { contents: "export { tools } from './src/tools.ts'; export * from './src/project.ts'; export { shutdownForTests } from './src/server.ts'; export { setHostServices } from './src/host.ts';", resolveDir: root },
  outfile: join(apiDir, 'api.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent',
  banner: { js: "import { createRequire as __capacityCreateRequire } from 'node:module'; const require = __capacityCreateRequire(import.meta.url);" },
  plugins: [{
    name: 'controlled-resource-fetch',
    setup(build) {
      build.onResolve({ filter: /netFetch\.js$/ }, args => ({ path: resolve(args.resolveDir, args.path), namespace: 'controlled-fetch' }))
      build.onLoad({ filter: /.*/, namespace: 'controlled-fetch' }, args => ({
        contents: `export * from ${JSON.stringify(args.path.replace(/\.js$/, '.ts'))}; export async function fetchUrl(url, options = {}) { return globalThis.__tianshuCapacityFetch(url, options) }`,
        loader: 'ts', resolveDir: root,
      }))
    },
  }],
})
cpSync(join(root, 'dist/design'), join(apiDir, 'design'), { recursive: true })
cpSync(join(root, 'dist/web'), join(apiDir, 'web'), { recursive: true })
const api = await import(pathToFileURL(join(apiDir, 'api.mjs')).href)
api.setHostServices({ isWorker: false, log: { debug() {}, warn() {} } })
const tools = Object.fromEntries(api.tools.map(tool => [tool.definition.name, tool]))
after(async () => { delete globalThis.__tianshuCapacityFetch; await api.shutdownForTests(); rmSync(apiDir, { recursive: true, force: true }) })

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-async-capacity-'))
  mkdirSync(join(cwd, '.tianshu-canvas/pages'), { recursive: true })
  return { cwd, lock: join(cwd, '.tianshu-canvas/project.lock'), file: join(cwd, '.tianshu-canvas/project.json'), cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}
const call = (ws, name, args) => tools[name].execute({ args, cwd: ws.cwd, sessionId: 'controlled-resource-regression' })
const upsert = (ws, args) => call(ws, 'canvas_upsert_page', args)
const assertOkay = result => assert.ok(!result.isError, result.content)
const project = ws => JSON.parse(readFileSync(ws.file, 'utf8'))
const body = (ws, id) => readFileSync(join(ws.cwd, '.tianshu-canvas/pages', id + '.html'), 'utf8')
function tree(dir) {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? Object.entries(tree(join(dir, item.name))).map(([name, digest]) => [item.name + '/' + name, digest]) : [[item.name, createHash('sha256').update(readFileSync(join(dir, item.name))).digest('hex')]]))
}
function deferredFetch(ws, assetBytes = 16) {
  let entered
  let release
  const started = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  globalThis.__tianshuCapacityFetch = async url => {
    assert.equal(existsSync(ws.lock), false, 'fetch must begin outside workspace lock')
    entered()
    await gate
    assert.equal(existsSync(ws.lock), false, 'fetch must finish outside workspace lock')
    return { body: Buffer.alloc(assetBytes, 127), contentType: 'image/png', url }
  }
  return { started, release }
}

test('资源等待不持锁；已有页面在等待期间重命名移动换肤，恢复时保留最新状态和导航', { timeout: 30000 }, async () => {
  const ws = fixture()
  let gate
  try {
    assertOkay(await upsert(ws, { id: 'page-edit', title: 'before', html: '<p>original</p>', x: 0, y: 0 }))
    gate = deferredFetch(ws)
    const pending = upsert(ws, { id: 'page-edit', html: '<main><img src="https://cdn.example.com/icon.png"><a href="new-target.html">target</a></main>', inline_assets: true })
    await gate.started
    assertOkay(await upsert(ws, { id: 'page-edit', title: 'latest title', x: 432, y: 765, width: 390, height: 844 }))
    assertOkay(await upsert(ws, { id: 'page-target', title: 'new target', html: '<p>new target</p>' }))
    assertOkay(await call(ws, 'canvas_style', { action: 'set', style_id: 'apple' }))
    gate.release()
    assertOkay(await pending)
    const actual = project(ws).nodes.find(node => node.id === 'page-edit')
    assert.equal(actual.title, 'latest title')
    assert.deepEqual([actual.x, actual.y, actual.width, actual.height], [432, 765, 390, 844])
    assert.equal(project(ws).nodes.length, 2)
    assert.match(body(ws, 'page-edit'), /data:image\/png;base64,/)
    assert.match(body(ws, 'page-edit'), /href="page-target\.html"/)
    assert.match(body(ws, 'page-edit'), /tianshu-ds:start[^>]*apple/)
    assert.equal(existsSync(ws.lock), false)
  } finally { gate?.release(); ws.cleanup() }
})

test('新页面资源等待期间另建页面，自动布局按取锁后最新页数计算', { timeout: 30000 }, async () => {
  const ws = fixture()
  let gate
  try {
    gate = deferredFetch(ws)
    const pending = upsert(ws, { id: 'page-pending', html: '<img src="https://cdn.example.com/icon.png">', inline_assets: true })
    await gate.started
    assertOkay(await upsert(ws, { id: 'page-created-while-fetching', html: '<p>first</p>' }))
    gate.release(); assertOkay(await pending)
    const actual = project(ws).nodes.find(node => node.id === 'page-pending')
    assert.equal(actual.x, 1560)
    assert.equal(actual.y, 0)
    assert.equal(project(ws).nodes.length, 2)
    assert.equal(existsSync(ws.lock), false)
  } finally { gate?.release(); ws.cleanup() }
})

test('真实内联管线经受控fetch膨胀超8MiB，工具拒绝且所有正式字节不变', { timeout: 30000 }, async () => {
  const ws = fixture()
  let gate
  try {
    assertOkay(await upsert(ws, { id: 'page-existing', html: '<p>retained</p>' }))
    const before = tree(join(ws.cwd, '.tianshu-canvas'))
    const prefix = '<html><body><img src="https://cdn.example.com/icon.png">'
    const suffix = '</body></html>'
    const source = prefix + 'a'.repeat(8 * 1024 * 1024 - 200 - Buffer.byteLength(prefix + suffix)) + suffix
    assert.equal(Buffer.byteLength(source), 8 * 1024 * 1024 - 200)
    gate = deferredFetch(ws, 1024)
    const pending = upsert(ws, { id: 'page-existing', html: source, inline_assets: true })
    await gate.started
    gate.release()
    const rejected = await pending
    assert.equal(rejected.isError, true)
    assert.match(rejected.content, /8\s*MiB|8388608/i)
    assert.deepEqual(tree(join(ws.cwd, '.tianshu-canvas')), before)
    assert.equal(existsSync(ws.lock), false)
  } finally { gate?.release(); ws.cleanup() }
})
