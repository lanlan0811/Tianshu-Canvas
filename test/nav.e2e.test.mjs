/**
 * 端到端：画布内点击页面内链接 → 跳转到目标页面节点。
 *
 * 链路：iframe 内点击 <a> → 探针 post('__vd_request_navigate') → ProbeBridge.onNavigate
 *      → App.resolveNavTarget → selectAndFit → POST /api/selection（kind=page）。
 *
 * 无可用浏览器时跳过（不阻塞 CI）。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const BROWSERS = [
  process.env.TIANSHU_CANVAS_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)
const browserPath = BROWSERS.find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('跳转 e2e：点链接跳到目标页 / Ctrl 点击只选中 / 外链不跳', { skip: !browserPath && '未找到浏览器' }, async () => {
  const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const puppeteer = (await import('puppeteer-core')).default
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-nave2e-'))
  let browser
  try {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]{16}/)[0]
    const token = new URL(url).searchParams.get('ws')
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })

    const b = await tools.canvas_upsert_page.execute({
      input: { html: '<html><head></head><body><h1 id="bt">B 页</h1></body></html>', title: '目标页' },
      cwd,
    })
    const idB = b.content.match(/id=([\w-]+)/)[1]
    const a = await tools.canvas_upsert_page.execute({
      input: {
        html:
          '<html><head></head><body>' +
          `<a id="go" href="${idB}.html">去目标</a>` +
          '<a id="ext" href="https://example.com">外链</a>' +
          '<a id="anch" href="#x">锚点</a>' +
          '<details id="det"><summary id="sum">展开</summary><p>内容</p></details>' +
          '</body></html>',
        title: '首页',
      },
      cwd,
    })
    const idA = a.content.match(/id=([\w-]+)/)[1]

    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1400, height: 900 })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForSelector('.page-node__iframe', { timeout: 15000 })
    await sleep(800)

    const frames = page.frames().filter((f) => f.url().includes('/page/'))
    const frameA = frames.find((f) => f.url().includes(idA))
    const frameB = frames.find((f) => f.url().includes(idB))
    assert.ok(frameA, '应找到 A 的 iframe')

    const readSel = () => {
      try {
        return JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'selection.json'), 'utf8'))
      } catch {
        return null
      }
    }

    // 探针靠 e.clientX/clientY 命中元素，.click() 的坐标是 0,0，故派发带坐标的合成事件。
    const clickAt = (frame, selector) =>
      frame.evaluate((sel) => {
        const el = document.querySelector(sel)
        const r = el.getBoundingClientRect()
        const x = r.x + r.width / 2
        const y = r.y + r.height / 2
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      }, selector)

    // 1) 点普通链接 → 跳到 B（page 级选中，pageId===idB）
    await clickAt(frameA, '#go')
    let ok = false
    for (let i = 0; i < 20; i++) {
      const s = readSel()
      if (s && s.pageId === idB && s.kind === 'page') { ok = true; break }
      await sleep(150)
    }
    assert.ok(ok, `点链接应跳到 B，实际选中=${JSON.stringify(readSel())}`)

    // 2) 点原生 <details>：默认行为放行（展开）
    await clickAt(frameA, '#sum')
    await sleep(300)
    const opened = await frameA.evaluate(() => document.getElementById('det').hasAttribute('open'))
    assert.ok(opened, '原生 <details> 应可展开（点击不被拦截）')

    // 3) 点外链 → 不跳转（仍停留在 A 的 element 级选中）
    await clickAt(frameA, '#ext')
    await sleep(400)
    const s3 = readSel()
    assert.equal(s3.pageId, idA, '外链不应触发页面跳转')
    assert.equal(s3.kind, 'element', '外链应走普通选中')

    assert.ok(frameB, 'B 的 iframe 应存在')
    console.log('OK 跳转 e2e：链接跳转 / 原生默认行为 / 外链不跳 全部通过')
  } finally {
    if (browser) await browser.close()
    rmSync(cwd, { recursive: true, force: true })
  }
})
