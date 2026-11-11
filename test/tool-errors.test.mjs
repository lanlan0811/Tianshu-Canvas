/** Raw plugin calls: the fake host's catch wrapper must not conceal plugin errors. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { installFakeSdk } from './helpers/host.mjs'

installFakeSdk()
const mod = await import(pathToFileURL(join(resolve(import.meta.dirname, '..'), 'dist/index.mjs')).href)

async function fixture(run) {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-tool-errors-'))
  const logs = []
  const plugin = mod.default.activate({ log: { debug() {}, warn(message) { logs.push(message) } } })
  const tools = Object.fromEntries(plugin.tools.map(tool => [tool.name, tool]))
  const call = (name, args = {}) => tools[name].execute({ args, cwd, sessionId: 'raw-error-regression' })
  try { await run({ cwd, call, logs, tools }) } finally {
    await plugin.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
}

function assertPrivate(result, cwd) {
  assert.equal(result.isError, true, result.content)
  assert.equal(result.content.includes(cwd), false, result.content)
  assert.doesNotMatch(result.content, /[A-Za-z]:[\\/]|\\\\|EACCES.*open|EISDIR.*read/)
}

/** Match the actual file behind checked fd reads; never make a read fault a no-op. */
function injectReadFailure(file, getFailure) {
  const original = { openSync: fs.openSync, closeSync: fs.closeSync, readFileSync: fs.readFileSync }
  const descriptors = new Map()
  const pathKey = value => {
    if (typeof value === 'number') return descriptors.get(value)
    const path = value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value
    if (typeof path !== 'string') return undefined
    const absolute = resolve(path)
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute
  }
  const target = pathKey(file)
  let hits = 0
  fs.openSync = function (path, ...args) {
    const fd = original.openSync.call(this, path, ...args)
    descriptors.set(fd, pathKey(path))
    return fd
  }
  fs.closeSync = function (fd, ...args) {
    try { return original.closeSync.call(this, fd, ...args) } finally { descriptors.delete(fd) }
  }
  fs.readFileSync = function (pathOrFd, ...args) {
    if (pathKey(pathOrFd) === target) {
      const failure = getFailure()
      if (failure) { hits++; throw failure }
    }
    return original.readFileSync.call(this, pathOrFd, ...args)
  }
  syncBuiltinESMExports()
  return {
    get hits() { return hits },
    restore() {
      Object.assign(fs, original)
      descriptors.clear()
      syncBuiltinESMExports()
    },
  }
}

test('原始工具边界：项目文件是目录时返回错误而非 reject，修复后恢复', async () => {
  await fixture(async ({ cwd, call, logs }) => {
    const file = join(cwd, '.tianshu-canvas', 'project.json')
    mkdirSync(file, { recursive: true })
    const cases = [
      ['canvas_upsert_page', { html: '<p>safe</p>' }],
      ['canvas_get_state', {}],
      ['canvas_arrange', { action: 'remove', id: 'page-a' }],
      ['canvas_style', { action: 'list' }],
      ['canvas_check_style', {}],
      ['canvas_design_system', { action: 'list' }],
      ['canvas_audit', { action: 'contract' }],
      ['canvas_comments', { action: 'list' }],
    ]
    for (const [name, args] of cases) assertPrivate(await call(name, args), cwd)
    assert.ok(logs.length >= cases.length, '详细故障应进入宿主日志')
    rmSync(file, { recursive: true })
    const recovered = await call('canvas_upsert_page', { id: 'page-recovered', html: '<p>restored</p>' })
    assert.ok(!recovered.isError, recovered.content)
    assert.equal(readFileSync(join(cwd, '.tianshu-canvas/pages/page-recovered.html'), 'utf8'), '<p>restored</p>')
  })
})

test('第九工具 canvas_open 同样捕获启动异常，合法端口仍可重试', async () => {
  await fixture(async ({ cwd, call }) => {
    assertPrivate(await call('canvas_open', { port: 70000 }), cwd)
    const recovered = await call('canvas_open', { port: 0 })
    assert.ok(!recovered.isError, recovered.content)
    assert.match(recovered.content, /http:\/\/127\.0\.0\.1:/)
  })
})

test('返回式校验错误也脱敏，合法 URL 和相对源码路径保持可读', async () => {
  await fixture(async ({ cwd, call }) => {
    const invalid = await call('canvas_upsert_page', { id: join(cwd, 'private'), html: '<p>x</p>' })
    assertPrivate(invalid, cwd)
    const url = 'https://example.com/app/view?x=1'
    const result = await call('canvas_style', { action: 'unknown ' + url + ' src/App.tsx' })
    assert.equal(result.isError, true)
    assert.ok(result.content.includes(url), result.content)
    assert.ok(result.content.includes('src/App.tsx'), result.content)
  })
})

test('返回错误、日志和成功内联告警不泄露 URL 凭据', async () => {
  await fixture(async ({ call, logs }) => {
    const secret = 'a'.repeat(64)
    const token = 'canvas-private-token'
    const url = 'https://example.com/x?token=' + token + '#' + secret
    const invalid = await call('canvas_style', { action: 'unknown ' + url })
    assert.equal(invalid.isError, true)
    assert.equal(invalid.content.includes(token) || invalid.content.includes(secret), false, invalid.content)
    const privateUrl = 'https://user:private-password@example.com/'
    const extracted = await call('canvas_design_system', { action: 'extract', id: 'reject', url: privateUrl })
    assert.equal(extracted.isError, true)
    assert.equal(extracted.content.includes('private-password'), false)
    assert.ok(logs.every(message => !message.includes('private-password')), '诊断日志不得包含 URL 凭据')
    const inline = await call('canvas_upsert_page', {
      id: 'page-inline-warning', html: '<img src=' + JSON.stringify(privateUrl) + '>', inline_assets: true,
    })
    assert.ok(!inline.isError, inline.content)
    assert.equal(inline.content.includes('private-password'), false, inline.content)
  })
})

test('原始工具边界：确定性权限故障不泄露系统错误，恢复后正常读取', async () => {
  await fixture(async ({ cwd, call }) => {
    await call('canvas_upsert_page', { id: 'page-a', html: '<p>A</p>' })
    const file = join(cwd, '.tianshu-canvas', 'project.json')
    const failure = Object.assign(new Error(`EACCES: permission denied, open '${file}'`), { code: 'EACCES' })
    const injected = injectReadFailure(file, () => failure)
    try {
      const result = await call('canvas_get_state')
      assert.ok(injected.hits > 0, 'EACCES must be injected into an actual project read')
      assertPrivate(result, cwd)
    } finally { injected.restore() }
    assert.ok(!(await call('canvas_get_state')).isError)
  })
})

test('原始工具及 HTTP：坏页面与异步导出脱敏，不误伤成功路径', async () => {
  await fixture(async ({ cwd, call }) => {
    const added = await call('canvas_upsert_page', { id: 'page-a', html: '<p>A</p>' })
    assert.ok(!added.isError, added.content)
    assert.ok(added.content.includes(cwd), '成功响应保留用户需要的文件路径')
    const htmlPath = join(cwd, '.tianshu-canvas/pages/page-a.html')
    rmSync(htmlPath)
    mkdirSync(htmlPath)
    assertPrivate(await call('canvas_arrange', { action: 'duplicate', id: 'page-a' }), cwd)
    assertPrivate(await call('canvas_audit', { action: 'contract' }), cwd)
    const opened = await call('canvas_open', { port: 0 })
    const url = new URL(opened.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)[0])
    const headers = { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' }
    const base = url.origin + url.pathname
    const exported = await fetch(base + 'api/export', { method: 'POST', headers, body: JSON.stringify({ ws: url.searchParams.get('ws'), kind: 'zip' }) })
    assert.equal(exported.status, 500)
    assert.deepEqual(await exported.json(), { error: 'internal error' })
    const badPage = await fetch(base + 'page/page-a?ws=' + url.searchParams.get('ws'), { headers })
    assert.equal(badPage.status, 500)
    assert.equal(await badPage.text(), 'internal error')
    rmSync(htmlPath, { recursive: true })
    writeFileSync(htmlPath, '<p>recovered</p>')
    assert.ok(!(await call('canvas_arrange', { action: 'duplicate', id: 'page-a' })).isError)
  })
})

test('HTTP 变更统一映射锁争用409、HTML超限413、页数400和未知500', async () => {
  await fixture(async ({ cwd, call }) => {
    const opened = await call('canvas_open', { port: 0 })
    await call('canvas_upsert_page', { id: 'page-a', html: '<p>A</p>' })
    const url = new URL(opened.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)[0])
    const file = join(cwd, '.tianshu-canvas', 'project.json')
    let failure
    const injected = injectReadFailure(file, () => failure)
    try {
      for (const [code, status, message] of [
        ['WORKSPACE_BUSY', 409, '工作区正在写入，请稍后重试'],
        ['HTML_SIZE_LIMIT', 413, 'HTML 超过 8 MiB，请压缩资源'],
        ['PAGE_COUNT_LIMIT', 400, '页面超过 1000，请先删除页面'],
        ['EIO', 500, 'raw system error'],
      ]) {
        failure = Object.assign(new Error(message + '：' + file), { code })
        const previousHits = injected.hits
        const response = await fetch(url.origin + url.pathname + 'api/nodes', {
          method: 'POST',
          headers: { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
          body: JSON.stringify({ ws: url.searchParams.get('ws'), op: 'rename', id: 'page-a', title: 'Changed' }),
        })
        assert.ok(injected.hits > previousHits, `${code} must be injected into this request's actual project read`)
        assert.equal(response.status, status)
        const body = await response.json()
        assert.equal(body.error.includes(cwd), false, body.error)
        if (status === 500) assert.equal(body.error, 'internal error')
        else assert.ok(body.error.includes(message), body.error)
      }
    } finally { injected.restore() }
    assert.ok(!(await call('canvas_get_state')).isError)
  })
})

test('路径边界拒绝保留中文原因但隐藏工作区及外部绝对路径', async () => {
  await fixture(async ({ cwd, call }) => {
    const outside = mkdtempSync(join(tmpdir(), 'tsc-tool-outside-'))
    try {
      mkdirSync(join(cwd, '.tianshu-canvas'), { recursive: true })
      symlinkSync(outside, join(cwd, '.tianshu-canvas/pages'), 'junction')
      const result = await call('canvas_upsert_page', { html: '<p>blocked</p>' })
      assertPrivate(result, cwd)
      assert.equal(result.content.includes(outside), false)
      assert.match(result.content, /工作区外|符号链接|目录联接/)
      assert.deepEqual(fs.readdirSync(outside), [])
      const opened = await call('canvas_open', { port: 0 })
      const url = new URL(opened.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)[0])
      const response = await fetch(url.origin + url.pathname + 'page/page-a?ws=' + url.searchParams.get('ws'), {
        headers: { Authorization: `Bearer ${url.hash.slice(1)}` },
      })
      // A missing leaf is 404; an existing junction-backed page is rejected as 403.
      writeFileSync(join(outside, 'page-a.html'), '<p>outside</p>')
      const rejected = await fetch(url.origin + url.pathname + 'page/page-a?ws=' + url.searchParams.get('ws'), {
        headers: { Authorization: `Bearer ${url.hash.slice(1)}` },
      })
      assert.equal(response.status, 404)
      assert.equal(rejected.status, 403)
      const body = await rejected.text()
      assert.match(body, /工作区外|符号链接/)
      assert.equal(body.includes(outside) || body.includes(cwd), false, body)
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })
})
