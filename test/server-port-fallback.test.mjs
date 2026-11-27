/**
 * 端口回退行为测试：EACCES 与 EADDRINUSE 都必须继续找下一个候选端口。
 *
 * 背景：Windows 上端口被其他进程独占绑定时（实测 MuMuPlayer 占用 2050），
 * 对 127.0.0.1 的 listen 返回 EACCES 而不是 EADDRINUSE。若只吞 EADDRINUSE，
 * canvas_open 会把环境占用误报成工具失败。
 *
 * 用假的 http.Server 驱动 listenWithFallback：端口 43117 注入 EACCES、43118 注入
 * EADDRINUSE，断言最终落在 43119——负向用例证明「不换端口」的实现会失败。
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const apiDir = mkdtempSync(join(tmpdir(), 'tsc-port-fallback-'))
await build({
  stdin: { contents: "export { listenWithFallback } from './src/server.ts';", resolveDir: root },
  outfile: join(apiDir, 'server-api.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'silent',
})
const { listenWithFallback } = await import(pathToFileURL(join(apiDir, 'server-api.mjs')).href)
test.after(() => rmSync(apiDir, { recursive: true, force: true }))

function fakeServer(failures) {
  const server = new EventEmitter()
  server.bound = []
  server.address = () => ({ port: server.bound.at(-1) })
  server.close = (callback) => callback()
  server.listen = (port) => {
    server.bound.push(port)
    queueMicrotask(() => {
      const code = failures.get(port)
      if (code) {
        const err = Object.assign(new Error(`${code}: synthetic`), { code })
        server.emit('error', err)
      } else server.emit('listening')
    })
  }
  return server
}

test('EACCES 与 EADDRINUSE 都会继续换端口', async () => {
  const server = fakeServer(new Map([[43117, 'EACCES'], [43118, 'EADDRINUSE']]))
  const port = await listenWithFallback(server, 43117)
  assert.equal(port, 43119)
  assert.deepEqual(server.bound, [43117, 43118, 43119])
})

test('其他错误码仍然向上抛出，不静默换端口', async () => {
  const server = fakeServer(new Map([[43117, 'EINVAL']]))
  await assert.rejects(() => listenWithFallback(server, 43117), /EINVAL/)
  assert.equal(server.bound.length, 1)
})

test('负向：候选区间内全部 EACCES 时降级到系统分配端口', async () => {
  const failures = new Map()
  for (let port = 43117; port <= 43137; port++) failures.set(port, 'EACCES')
  const server = fakeServer(failures)
  const port = await listenWithFallback(server, 43117)
  assert.equal(port, 0, '候选区间耗尽后必须落到 listen(0)，而不是放弃')
})
