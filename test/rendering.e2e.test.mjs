/**
 * 端到端（真实浏览器）：画布渲染回归。
 *
 * 锁定：
 *   - 选中元素后面板只提供批注入口，不提供文案/样式编辑（用户以批注表达修改）；
 *   - 批注写入 project.json，不改写原型文件；
 *   - 节点高度无反馈循环、项目事件后高度不丢；
 *   - AI 更新页面后 iframe 自动刷新，只改标题不刷新；
 *   - 页面脚本伪造写入类消息不能改写文件。
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
const browserPath = [
  process.env.TIANSHU_CANVAS_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const doc = (head, body) => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`

const PAGES = {
  structure: doc('', '<section id="s"><h2 id="title">原标题</h2><p id="para">段落一</p></section>'),
  short: doc('', '<h1>短内容</h1>'),
  hero: doc('<style>*{margin:0;box-sizing:border-box}.hero{height:100vh}</style>', '<div class="hero">全屏</div>'),
  padded: doc('<style>body{margin:0;padding:40px;min-height:100vh}</style>', '<h1>撑满视口</h1>'),
  tall: doc('<style>body{margin:0}.t{height:2000px}</style>', '<div class="t">长页面</div>'),
  refresh: doc('', '<h1 id="v">第一版</h1>'),
  forged: doc('', '<h1 id="f">不应被改写</h1>'),
}

test('渲染与只读编辑回归', { skip: !browserPath && '未找到浏览器' }, async () => {
  const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const puppeteer = (await import('puppeteer-core')).default
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-render-'))
  let browser
  try {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)[0]

    const ids = {}
    for (const [name, html] of Object.entries(PAGES)) {
      const added = await tools.canvas_upsert_page.execute({ input: { html, title: name }, cwd })
      assert.ok(!added.isError, added.content)
      ids[name] = added.content.match(/id=([\w-]+)/)[1]
    }
    const fileOf = (name) => readFileSync(join(cwd, '.tianshu-canvas', 'pages', `${ids[name]}.html`), 'utf8')

    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1600, height: 1000 })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForSelector('.page-node__iframe', { timeout: 15000 })

    async function frameOf(name) {
      const el = await page.waitForSelector(`iframe[src*="${ids[name]}"]`, { timeout: 15000 })
      return el.contentFrame()
    }

    async function clickIn(name, selector, ctrlKey = true) {
      const frame = await frameOf(name)
      await frame.waitForSelector(selector, { timeout: 15000 })
      await frame.evaluate(
        (sel, ctrl) => {
          const el = document.querySelector(sel)
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
        },
        selector,
        ctrlKey,
      )
      await sleep(400)
    }

    // 1) 选中元素后：面板只有批注入口，没有文案/样式编辑与「应用修改」
    await clickIn('structure', '#title')
    await page.waitForSelector('.selection-panel', { timeout: 5000 })
    assert.equal(await page.$('.selection-panel__styles'), null, '不应再提供样式编辑')
    assert.equal(await page.$('.selection-panel__text'), null, '不应再提供文案编辑')
    assert.equal(await page.$('.selection-panel input'), null, '不应再提供任何编辑输入框')
    assert.ok(await page.$('.selection-panel__note-input'), '应提供批注输入框')
    const applyButton = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.selection-panel .btn')).some((b) => b.textContent?.includes('应用修改')),
    )
    assert.equal(applyButton, false, '不应再出现「应用修改」按钮')

    // 2) 填批注 → 添加批注：写入 project.json，文件本身不被改动
    const before = fileOf('structure')
    await page.type('.selection-panel__note-input', '标题改短一点')
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.selection-panel .btn'))
      buttons.find((b) => b.textContent?.trim() === '添加批注')?.click()
    })
    await sleep(900)
    const project = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
    assert.equal(project.comments?.length, 1, '应写入一条批注')
    assert.equal(project.comments[0].note, '标题改短一点')
    assert.equal(project.comments[0].xpath, '/html[1]/body[1]/section[1]/h2[1]')
    assert.equal(fileOf('structure'), before, '批注不应改写原型文件')

    // 3) 页面脚本伪造写入类消息不能改写文件（现在已无任何写入类消息处理）
    const beforeForged = fileOf('forged')
    await (
      await frameOf('forged')
    ).evaluate(() => {
      parent.postMessage({ type: '__vd_edit_applied', payload: { xpath: null, ok: true, html: '<h1>被改写</h1>' } }, '*')
      parent.postMessage({ type: '__vd_apply_edits', payload: { xpath: '/html[1]/body[1]/h1[1]', text: '被改写' } }, '*')
    })
    await sleep(400)
    assert.equal(fileOf('forged'), beforeForged)

    // 4) 节点高度：只变化一次并稳定，不低于设备高度
    const heightOf = (name) =>
      page.$eval(`iframe[src*="${ids[name]}"]`, (e) => e.closest('.page-node').style.height)
    for (const name of ['short', 'hero', 'padded', 'tall']) await frameOf(name)
    await sleep(1500)
    const first = {}
    for (const name of ['short', 'hero', 'padded', 'tall']) first[name] = await heightOf(name)
    await sleep(1500)
    for (const name of ['short', 'hero', 'padded', 'tall']) {
      assert.equal(await heightOf(name), first[name], `${name} 高度应稳定`)
    }
    assert.equal(first.short, '900px', '短内容不应缩小')
    assert.equal(first.hero, '900px', '100vh 内容不应缩小')
    assert.equal(first.padded, '980px', '撑满视口的内容只增长一次')
    assert.equal(first.tall, '2002px', '长页面应完整显示')

    // 5) 项目事件（如视口保存）后，测得的高度不丢
    await tools.canvas_upsert_page.execute({ input: { id: ids.short, title: 'short-renamed' }, cwd })
    await sleep(600)
    assert.equal(await heightOf('tall'), '2002px')

    // 6) AI 更新已有页面：iframe 自动刷新；只改标题不刷新
    const frameV = await frameOf('refresh')
    await frameV.waitForSelector('#v')
    await frameV.evaluate(() => {
      window.__marker = 1
    })
    await tools.canvas_upsert_page.execute({ input: { id: ids.refresh, title: '只改标题' }, cwd })
    await sleep(800)
    assert.equal(await (await frameOf('refresh')).evaluate(() => window.__marker), 1, '只改标题不应刷新 iframe')
    await tools.canvas_upsert_page.execute({ input: { id: ids.refresh, html: doc('', '<h1 id="v">第二版</h1>') }, cwd })
    await sleep(1200)
    assert.equal(await (await frameOf('refresh')).$eval('#v', (e) => e.textContent), '第二版', '应显示新内容')

    console.log('OK 渲染 e2e: 面板只留批注、批注落盘不改文件、高度稳定、自动刷新')
  } finally {
    if (browser) await browser.close().catch(() => {})
    rmSync(cwd, { recursive: true, force: true })
  }
})
