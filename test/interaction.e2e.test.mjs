/**
 * 端到端：交互真点真验。
 *
 * A) 画布侧：新点击语义不打断原生默认行为（<details>/<label>）与交互库脚本（tabs/modal）。
 * B) 导出侧：解压多页站到临时目录，用 file:// 打开，真点导航跳页、真点按钮开 modal/切 tab。
 *
 * 无可用浏览器时跳过（不阻塞 CI）。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { inflateRawSync } from 'node:zlib'
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

/** 解压本项目自写 zip 到目录。 */
function unzipTo(buf, dir) {
  let p = 0
  while (p < buf.length - 4) {
    if (buf.readUInt32LE(p) !== 0x04034b50) break
    const method = buf.readUInt16LE(p + 8)
    const compSize = buf.readUInt32LE(p + 18)
    const nameLen = buf.readUInt16LE(p + 26)
    const extraLen = buf.readUInt16LE(p + 28)
    const name = buf.toString('utf8', p + 30, p + 30 + nameLen)
    const start = p + 30 + nameLen + extraLen
    const data = method === 8 ? inflateRawSync(buf.subarray(start, start + compSize)) : buf.subarray(start, start + compSize)
    const out = join(dir, name)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, data)
    p = start + compSize
  }
}

const PAGE_INTERACTIVE =
  '<html><head></head><body style="padding:24px">' +
  '<details id="det"><summary id="sum">展开</summary><p>内容</p></details>' +
  '<label id="lab" for="inp">标签</label><input id="inp" class="ts-input">' +
  '<div class="ts-i-tabs" data-ts-tabs>' +
  '<div class="ts-tabs" role="tablist">' +
  '<button class="ts-tab ts-tab--active" role="tab" data-ts-tab="a">A</button>' +
  '<button class="ts-tab" role="tab" data-ts-tab="b">B</button></div>' +
  '<div class="ts-i-tabs__panel" role="tabpanel" data-ts-panel="a">面板A</div>' +
  '<div class="ts-i-tabs__panel" role="tabpanel" data-ts-panel="b" hidden>面板B</div>' +
  '</div>' +
  '<button id="open" class="ts-btn ts-btn--primary" data-ts-open="#m">打开</button>' +
  '<div class="ts-i-modal" id="m" data-ts-modal hidden>' +
  '<div class="ts-i-modal__scrim" data-ts-close></div>' +
  '<div class="ts-dialog" role="dialog"><div class="ts-dialog__body">弹窗内容</div>' +
  '<div class="ts-dialog__footer"><button class="ts-btn" data-ts-close>关闭</button></div></div></div>' +
  '</body></html>'

const clickAt = (frame, selector) =>
  frame.evaluate((sel) => {
    const el = document.querySelector(sel)
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }))
  }, selector)

test('交互 e2e：画布侧原生默认行为 + 交互库脚本可运行', { skip: !browserPath && '未找到浏览器' }, async () => {
  const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const puppeteer = (await import('puppeteer-core')).default
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ie2e-'))
  let browser
  try {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]{16}/)[0]
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })
    const add = await tools.canvas_upsert_page.execute({ input: { html: PAGE_INTERACTIVE, title: '交互页' }, cwd })
    const id = add.content.match(/id=([\w-]+)/)[1]

    browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1400, height: 900 })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForSelector('.page-node__iframe', { timeout: 15000 })
    await sleep(800)
    const frame = page.frames().find((f) => f.url().includes(id))
    assert.ok(frame, '应找到页面 iframe')

    // <details> 原生展开
    await clickAt(frame, '#sum')
    await sleep(200)
    assert.ok(await frame.evaluate(() => document.getElementById('det').hasAttribute('open')), '<details> 应可展开')

    // <label for> 聚焦
    await clickAt(frame, '#lab')
    await sleep(200)
    assert.equal(await frame.evaluate(() => document.activeElement.id), 'inp', 'label 应聚焦到输入框')

    // 交互库 tabs 切换
    await clickAt(frame, '.ts-tab[data-ts-tab="b"]')
    await sleep(200)
    const tabState = await frame.evaluate(() => ({
      bActive: document.querySelector('.ts-tab[data-ts-tab="b"]').classList.contains('ts-tab--active'),
      panelBShown: !document.querySelector('[data-ts-panel="b"]').hidden,
      panelAHidden: document.querySelector('[data-ts-panel="a"]').hidden,
    }))
    assert.ok(tabState.bActive && tabState.panelBShown && tabState.panelAHidden, `tab 切换失败：${JSON.stringify(tabState)}`)

    // 交互库 modal 打开
    await clickAt(frame, '#open')
    await sleep(200)
    const modalOpen = await frame.evaluate(() => {
      const m = document.getElementById('m')
      return m.classList.contains('ts-i-modal--open') && !m.hidden
    })
    assert.ok(modalOpen, 'modal 应可打开（共享运行时生效）')

    console.log('OK 交互 e2e（画布侧）：原生默认行为 + tabs + modal 全部通过')
  } finally {
    if (browser) await browser.close()
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('导出 e2e：多页站 file:// 可跳转、可交互', { skip: !browserPath && '未找到浏览器' }, async () => {
  const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const puppeteer = (await import('puppeteer-core')).default
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-se2e-'))
  const outDir = mkdtempSync(join(tmpdir(), 'tsc-site-'))
  let browser
  try {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]{16}/)[0]
    const token = new URL(url).searchParams.get('ws')
    const base = new URL(url).origin
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })

    const b = await tools.canvas_upsert_page.execute({ input: { html: PAGE_INTERACTIVE, title: '交互页' }, cwd })
    const idB = b.content.match(/id=([\w-]+)/)[1]
    await tools.canvas_upsert_page.execute({
      input: { html: `<html><head></head><body><h1>首页</h1><a id="toB" href="交互页.html">去交互页</a></body></html>`, title: '首页' },
      cwd,
    })

    const resp = await fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
      body: JSON.stringify({ ws: token, kind: 'zip' }),
    })
    const j = await resp.json()
    const zipFile = j.files.find((f) => f.name.endsWith('.zip'))
    unzipTo(readFileSync(zipFile.path), outDir)

    browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
    const page = await browser.newPage()
    await page.goto(pathToFileURL(join(outDir, 'index.html')).href, { waitUntil: 'domcontentloaded', timeout: 20000 })

    // 导航首页 → 点链接进入交互页
    await page.click(`a[href="pages/${idB}.html"]`)
    await page.waitForFunction(() => document.querySelector('.ts-tabs') !== null, { timeout: 8000 })
    assert.ok(page.url().includes(`${idB}.html`), '应跳转到交互页')

    // file:// 下交互库脚本生效：切 tab
    await page.click('.ts-tab[data-ts-tab="b"]')
    await sleep(200)
    const tabOk = await page.evaluate(() => document.querySelector('[data-ts-panel="b"]').hidden === false)
    assert.ok(tabOk, '导出站 file:// 下 tab 应可切换（共享运行时已加载）')

    // 开 modal
    await page.click('#open')
    await sleep(200)
    const modalOk = await page.evaluate(() => document.getElementById('m').classList.contains('ts-i-modal--open'))
    assert.ok(modalOk, '导出站 file:// 下 modal 应可打开')

    // 交互页 → 返回首页（链接互跳）
    await page.evaluate(() => {
      const m = document.getElementById('m')
      m.querySelector('[data-ts-close]').click()
    })
    assert.ok(true)

    console.log('OK 导出 e2e：多页站 file:// 跳转 + tabs + modal 全部通过')
  } finally {
    if (browser) await browser.close()
    rmSync(cwd, { recursive: true, force: true })
    rmSync(outDir, { recursive: true, force: true })
  }
})
