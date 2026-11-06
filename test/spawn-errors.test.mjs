/**
 * 回归：启动外部程序失败时以错误返回，不能变成未捕获异常打垮宿主。
 * spawn 失败走异步 error 事件，try/catch 接不住。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const cwd = mkdtempSync(join(tmpdir(), 'tsc-spawn-'))
// 浏览器候选路径在模块加载时读取，必须先设置。指向目录：存在，但无法执行。
const notABrowser = join(cwd, 'not-a-browser')
mkdirSync(notABrowser)
process.env.TIANSHU_CANVAS_BROWSER = notABrowser

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)

test.after(() => rmSync(cwd, { recursive: true, force: true }))

test('PNG 导出：浏览器无法启动时返回可读错误，且不重试', async () => {
  const added = await tools.canvas_upsert_page.execute({ input: { html: '<h1>x</h1>', title: 'x' }, cwd })
  assert.ok(!added.isError, added.content)

  // 导出没有 AI 工具，走画布顶栏调用的 HTTP 路由。
  const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
  const m = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]{16}/)
  assert.ok(m, `未返回合法 URL: ${open.content}`)
  const token = new URL(m[0]).searchParams.get('ws')
  const base = new URL(m[0]).origin
  const post = (kind) =>
    fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
      body: JSON.stringify({ ws: token, kind }),
    })

  const started = Date.now()
  const png = await (await post('png')).json()
  assert.match(png.pngError, /无法启动浏览器/)
  assert.ok(png.pngError.includes(notABrowser), `错误里应有路径：${png.pngError}`)
  // 重试三轮至少要 7.5 秒；上限留出加载 puppeteer 的余量。
  assert.ok(Date.now() - started < 6000, '程序本身无法启动时不应重试')

  const both = await (await post('both')).json()
  assert.ok(both.files.some((f) => f.name.endsWith('.zip')), 'PNG 失败不影响 ZIP')
})

test('canvas_open：打不开系统浏览器时不影响返回', async () => {
  const saved = { PATH: process.env.PATH, Path: process.env.Path, ComSpec: process.env.ComSpec }
  process.env.PATH = ''
  process.env.Path = ''
  process.env.ComSpec = ''
  try {
    const res = await tools.canvas_open.execute({ input: { port: 0, open: true }, cwd })
    assert.ok(!res.isError, res.content)
    assert.match(res.content, /http:\/\/127\.0\.0\.1/)
    // 给异步 error 事件留出触发时间；未处理时测试进程会因未捕获异常失败。
    await new Promise((r) => setTimeout(r, 500))
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
