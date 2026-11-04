/**
 * 端到端：真实浏览器验证 iframe 探针的两层选择与编辑回写。
 *
 * 链路：iframe 内点击 → 探针 → postMessage → 画布前端 ProbeBridge → POST /api/selection
 *      → selection.json；编辑同理回写 pages/<id>.html。
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

test('探针 e2e：两层选择 + 编辑回写', { skip: !browserPath && '未找到浏览器' }, async () => {
  const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)
  const puppeteer = (await import('puppeteer-core')).default
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-e2e-'))
  let browser
  try {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]{16}/)[0]
    const token = new URL(url).searchParams.get('ws')

    const pageHtml =
      '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
      '<div id="a" style="padding:20px"><button id="b">OK</button></div></body></html>'
    const add = await tools.canvas_add_page.execute({ input: { html: pageHtml, title: 'E2E' }, cwd })
    assert.ok(!add.isError, add.content)
    const id = add.content.match(/id=([\w-]+)/)[1]

    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForSelector('.page-node__iframe', { timeout: 15000 })

    const frameEl = await page.$('.page-node__iframe')
    const frame = await frameEl.contentFrame()
    assert.ok(frame, '应能取得 iframe frame')
    await frame.waitForSelector('#b', { timeout: 10000 })

    async function readSelection() {
      const res = await fetch(`http://127.0.0.1:${new URL(url).port}/api/selection?ws=${token}`)
      return (await res.json()).selection
    }

    // 在 button 中心派发带指定修饰键的点击（真实浏览器 + 真实 elementFromPoint + 真实 postMessage）
    async function clickButtonWith(ctrlKey) {
      await frame.evaluate((ctrl) => {
        const el = document.querySelector('#b')
        const r = el.getBoundingClientRect()
        el.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            ctrlKey: ctrl,
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
          }),
        )
      }, ctrlKey)
      await new Promise((r) => setTimeout(r, 400))
    }

    // 1) 无修饰键点击 button：应选中「scope(body) 的直接子」= div#a
    await clickButtonWith(false)
    let sel = await readSelection()
    assert.ok(sel, '点击后应有选中')
    assert.equal(sel.kind, 'element')
    assert.match(sel.element.xpath, /div\[1\]$/, `无修饰键应选中 div，实际 ${sel.element.xpath}`)
    assert.equal(sel.element.tagName, 'div')

    // 2) Ctrl+点击 button：应选中最深元素 = button#b
    await clickButtonWith(true)
    sel = await readSelection()
    assert.ok(sel, 'Ctrl 点击后应有选中')
    assert.match(sel.element.xpath, /button\[1\]$/, `Ctrl 点击应选中 button，实际 ${sel.element.xpath}`)
    assert.equal(sel.element.tagName, 'button')

    // 3) 编辑回写（走真实 UI 路径）：选中元素 → 面板出现 → 填样式 → 点「应用修改」
    //    → 面板 postToPage(__vd_apply_edits) → 探针改 DOM+序列化 → POST /api/page-html → 文件
    await clickButtonWith(true) // 选中 button#b，面板显示
    await page.waitForSelector('.selection-panel', { timeout: 5000 })
    const colorInput = await page.$('.selection-panel input')
    assert.ok(colorInput, '面板应有样式输入框')
    await colorInput.click({ clickCount: 3 })
    await colorInput.type('rgb(1, 2, 3)')
    await page.click('.selection-panel .btn:not(.btn--primary)')
    await new Promise((r) => setTimeout(r, 800))

    const saved = readFileSync(join(cwd, '.tianshu-canvas', 'pages', `${id}.html`), 'utf8')
    assert.match(saved, /color: rgb\(1, 2, 3\)/, '编辑应写回页面文件')
    assert.doesNotMatch(saved, /data-tianshu-probe/, '写回文件不应含探针')
    assert.doesNotMatch(saved, /__tianshu_probe__/, '写回文件不应含探针运行时')
    assert.doesNotMatch(saved, /data-tianshu-(hover|selected)/, '写回文件不应含高亮标记')

    console.log('OK 探针 e2e: 两层选择（div / button）+ UI 编辑回写（无探针痕迹）')
  } finally {
    if (browser) await browser.close().catch(() => {})
    rmSync(cwd, { recursive: true, force: true })
  }
})
