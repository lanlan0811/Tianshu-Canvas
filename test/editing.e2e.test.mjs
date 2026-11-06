/**
 * 端到端（真实浏览器）：文案编辑不丢结构、回写源文件而非运行时 DOM、
 * 节点高度无反馈循环、AI 更新页面后 iframe 自动刷新。
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
const LONG_TEXT = '很长的文案'.repeat(60)

const PAGES = {
  structure: doc('', '<section id="s"><h2 id="title">原标题</h2><p id="para">段落一</p></section>'),
  long: doc('', `<p id="long">${LONG_TEXT}</p>`),
  script: doc(
    '',
    '<main><h1 id="t">静态标题</h1></main>' +
      '<script>var d=document.createElement("div");d.id="gen";d.textContent="脚本生成";document.body.appendChild(d);' +
      'document.getElementById("t").setAttribute("data-ran","1");</script>',
  ),
  shifted: doc(
    '',
    '<h1 id="orig">原始</h1>' +
      '<script>var h=document.createElement("h1");h.id="added";h.textContent="插入";document.body.insertBefore(h,document.body.firstChild);</script>',
  ),
  short: doc('', '<h1>短内容</h1>'),
  hero: doc('<style>*{margin:0;box-sizing:border-box}.hero{height:100vh}</style>', '<div class="hero">全屏</div>'),
  padded: doc('<style>body{margin:0;padding:40px;min-height:100vh}</style>', '<h1>撑满视口</h1>'),
  tall: doc('<style>body{margin:0}.t{height:2000px}</style>', '<div class="t">长页面</div>'),
  refresh: doc('', '<h1 id="v">第一版</h1>'),
  forged: doc('', '<h1 id="f">不应被改写</h1>'),
}

test('编辑与渲染回归', { skip: !browserPath && '未找到浏览器' }, async () => {
  const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)
  const puppeteer = (await import('puppeteer-core')).default
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-edit-'))
  let browser
  try {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]{16}/)[0]

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

    const applyButton = '.selection-panel .btn:not(.btn--primary)'
    const textArea = '.selection-panel__text'
    async function replaceText(text) {
      await page.click(textArea, { clickCount: 3 })
      await page.keyboard.down('Control')
      await page.keyboard.press('a')
      await page.keyboard.up('Control')
      await page.keyboard.type(text)
      await page.click(applyButton)
      await sleep(600)
    }
    async function setColor(value) {
      await page.click('.selection-panel__styles input', { clickCount: 3 })
      await page.keyboard.type(value)
      await page.click(applyButton)
      await sleep(600)
    }
    const errorText = () => page.evaluate(() => document.querySelector('.app-error')?.textContent ?? '')

    // 1) 选中含子元素的区块：不提供文案输入，无法整体覆盖
    await clickIn('structure', '#title', false)
    await page.waitForSelector('.selection-panel', { timeout: 5000 })
    assert.equal(await page.$(textArea), null, '区块不应提供文案输入')
    assert.ok(await page.$('.selection-panel__note'), '应提示改用 Ctrl 点击')

    // 2) 选中叶子元素改文案：只改该元素，兄弟节点保留
    await clickIn('structure', '#title')
    await replaceText('新标题')
    let saved = fileOf('structure')
    assert.match(saved, /<h2 id="title">新标题<\/h2>/)
    assert.match(saved, /<p id="para">段落一<\/p>/, '兄弟节点不应丢失')
    assert.match(saved, /^<!doctype html>/i)
    const liveTitle = await (await frameOf('structure')).$eval('#title', (e) => e.textContent)
    assert.equal(liveTitle, '新标题', '画布上应立即更新')

    // 3) 同一选中项连续编辑：改完文案后再改样式不应被判定为对不上
    await setColor('rgb(1, 2, 3)')
    assert.equal(await errorText(), '')
    assert.match(fileOf('structure'), /color: rgb\(1, 2, 3\)/)

    // 4) 超过 200 字的文案：输入框是全文，追加不会截断
    await clickIn('long', '#long')
    const shown = await page.$eval(textArea, (e) => e.value)
    assert.equal(shown, LONG_TEXT, '输入框应是完整文案')
    await page.focus(textArea)
    await page.keyboard.down('Control')
    await page.keyboard.press('End')
    await page.keyboard.up('Control')
    await page.keyboard.type('X')
    await page.click(applyButton)
    await sleep(600)
    assert.ok(fileOf('long').includes(`${LONG_TEXT}X</p>`), '不应截断原文')

    // 5) 脚本改过 DOM：回写源文件，不固化运行时内容
    await clickIn('script', '#t')
    await replaceText('改后标题')
    saved = fileOf('script')
    assert.match(saved, /改后标题/)
    assert.match(saved, /<h1 id="t">改后标题<\/h1>/, '脚本设置的属性不应写回')
    assert.doesNotMatch(saved, /<div id="gen"/, '脚本生成的元素不应写回')
    assert.equal(saved.match(/createElement/g)?.length, 1, '脚本应只有一份')

    // 6) 脚本生成的元素：拒绝回写并提示，文件不变
    const beforeGen = fileOf('script')
    await clickIn('script', '#gen')
    await replaceText('改脚本内容')
    assert.match(await errorText(), /脚本生成/)
    assert.equal(fileOf('script'), beforeGen)

    // 7) 脚本在前面插入同名元素：xpath 对应到别的元素时拒绝，不能改错
    const beforeShift = fileOf('shifted')
    await clickIn('shifted', '#added')
    await replaceText('改错了')
    assert.match(await errorText(), /脚本生成/)
    assert.equal(fileOf('shifted'), beforeShift)

    // 8) 页面脚本伪造编辑消息不能改写文件
    const beforeForged = fileOf('forged')
    await (
      await frameOf('forged')
    ).evaluate(() => {
      parent.postMessage({ type: '__vd_edit_applied', payload: { xpath: null, ok: true, html: '<h1>被改写</h1>' } }, '*')
    })
    await sleep(400)
    assert.equal(fileOf('forged'), beforeForged)

    // 9) 节点高度：只变化一次并稳定，不低于设备高度
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

    // 10) 项目事件（如视口保存）后，测得的高度不丢
    await tools.canvas_upsert_page.execute({ input: { id: ids.short, title: 'short-renamed' }, cwd })
    await sleep(600)
    assert.equal(await heightOf('tall'), '2002px')

    // 11) AI 更新已有页面：iframe 自动刷新；只改标题不刷新
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

    console.log('OK 编辑 e2e: 结构保留、回写源文件、高度稳定、自动刷新')
  } finally {
    if (browser) await browser.close().catch(() => {})
    rmSync(cwd, { recursive: true, force: true })
  }
})
