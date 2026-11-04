/**
 * 手动端到端验证：用无头浏览器（Edge/Chrome）打开画布，断言 React Flow 真正渲染。
 *
 * 为什么不能只用 `--dump-dom`：画布页面持有 SSE 长连接，页面永不进入 "idle"，
 * 基于 load 事件的 dump-dom 会挂起。因此用 puppeteer 等具体 selector。
 *
 * 用法：node scripts/verify-web.mjs [浏览器可执行文件路径]
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const { installFakeSdk } = await import(pathToFileURL(join(root, 'test/helpers/host.mjs')).href)
installFakeSdk()
const mod = await import(pathToFileURL(join(root, 'dist/index.js')).href)
const api = await mod.default.activate({ log: { debug() {}, warn() {} } })
const tools = Object.fromEntries(api.tools.map((t) => [t.name, t]))

const CHROME_CANDIDATES = [
  process.argv[2],
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)

const puppeteer = (await import('puppeteer-core')).default
const cwd = mkdtempSync(join(tmpdir(), 'tsc-web-'))
let browser
try {
  const open = await tools.canvas_open.execute({ args: { port: 0 }, cwd, sessionId: 's' })
  const m = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]{16}/)
  if (!m) throw new Error('未返回合法 URL: ' + open.content)
  const url = m[0]
  await tools.canvas_add_page.execute({
    args: { html: '<h1 id="probe">HELLO_CANVAS</h1>', title: 'Probe' },
    cwd,
    sessionId: 's',
  })

  const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!executablePath) throw new Error('未找到可用浏览器，请传入路径：node scripts/verify-web.mjs <chrome.exe>')
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text())
  })

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForSelector('.page-node', { timeout: 15000 })

  const probe = await page.evaluate(() => ({
    app: !!document.querySelector('.app'),
    flow: !!document.querySelector('.react-flow'),
    node: !!document.querySelector('.page-node'),
    title: document.querySelector('.page-node__title')?.textContent ?? null,
    iframeSrc: document.querySelector('.page-node__iframe')?.getAttribute('src') ?? null,
    minimap: !!document.querySelector('.react-flow__minimap'),
    hint: !!document.querySelector('.hint'),
  }))

  const checks = {
    'React 已挂载(.app)': probe.app,
    '画布容器(.react-flow)': probe.flow,
    '节点已渲染(.page-node)': probe.node,
    '标题=Probe': probe.title === 'Probe',
    'iframe 指向 /page/': /\/page\/page-/.test(probe.iframeSrc ?? ''),
    'MiniMap 渲染': probe.minimap,
    '提示条渲染': probe.hint,
    '无 JS 报错': errors.length === 0,
  }
  let ok = true
  for (const [k, v] of Object.entries(checks)) {
    console.log((v ? 'PASS' : 'FAIL') + '  ' + k)
    if (!v) ok = false
  }
  if (errors.length) console.log('errors:', errors)
  process.exit(ok ? 0 : 1)
} finally {
  if (browser) await browser.close().catch(() => {})
  rmSync(cwd, { recursive: true, force: true })
}
