/** 浏览器回归：链接目标与区块选中独立，默认导航不能丢失工作区。 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'
import { resolveTestBrowser } from './helpers/browser.mjs'

const root = resolve(import.meta.dirname, '..')
const browserPath = resolveTestBrowser()

async function until(check, message) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((done) => setTimeout(done, 25))
  }
  assert.fail(message)
}

test('跳转 e2e：issue 7 嵌套链接、修饰键与原生控件', { skip: !browserPath && '未找到浏览器' }, async (t) => {
  const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const puppeteer = (await import('puppeteer-core')).default
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-nave2e-'))
  let browser
  try {
    const opened = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    assert.ok(!opened.isError, opened.content)
    const url = opened.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)[0]
    const ws = new URL(url).searchParams.get('ws')
    const idA = 'nav-source', idB = 'nav-target', idC = 'nav-other'
    const add = async (input) => {
      const result = await tools.canvas_upsert_page.execute({ input, cwd })
      assert.ok(!result.isError, result.content)
    }
    await add({ id: idB, title: '目标页', x: 800, y: 0, width: 320, height: 240, html: '<html><head></head><body><h1>目标页</h1></body></html>' })
    await add({ id: idC, title: '另一页', x: 800, y: 350, width: 320, height: 240, html: '<html><head></head><body><h1>另一页</h1></body></html>' })
    const fixture = '<!doctype html><html><head><meta charset="utf-8"><style>' +
      'body{margin:0;font:16px sans-serif}#scope{padding:24px}a,button,label,summary{display:block;margin:8px 0;padding:4px}svg,img{width:36px;height:30px}' +
      '</style></head><body><div id="scope"><div id="inner-scope">' +
      '<a id="go" href="nav-target.html"><span id="nested">嵌套文本</span></a>' +
      '<a href="nav-target.html"><svg viewBox="0 0 36 30"><path id="svg-path" d="M0 0H36V30H0Z" /></svg></a>' +
      '<a href="nav-target.html"><img id="image" alt="图片链接" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></a>' +
      '<a href="https://example.com" target="_blank"><span id="external">外链</span></a>' +
      '<a href="missing.html"><span id="unknown">未知页面</span></a>' +
      '<a href="%E0%A4%A.html"><span id="malformed">畸形编码</span></a>' +
      '<a href="nav-other.html" data-nav="nav-target"><span id="data-nav">data-nav 优先</span></a>' +
      '<button id="button" type="button" onclick="this.dataset.clicked=String(Number(this.dataset.clicked||0)+1)">普通按钮</button>' +
      '<details id="details"><summary id="summary">展开</summary><p>内容</p></details>' +
      '<label id="label" for="checkbox">原生复选框</label><input id="checkbox" type="checkbox">' +
      '<a href="#anchor-target"><span id="anchor">页内锚点</span></a>' +
      '</div></div><div id="anchor-target">锚点目标</div></body></html>'
    await add({ id: idA, title: '首页', x: 0, y: 0, width: 640, height: 700, html: fixture })
    const htmlPath = join(cwd, '.tianshu-canvas', 'pages', idA + '.html')
    const savedHtml = readFileSync(htmlPath, 'utf8')
    browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
    let page
    const failures = [], pageErrors = [], consoleErrors = [], popups = []
    const readSelection = () => {
      try { return JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'selection.json'), 'utf8')) } catch { return null }
    }
    const frameSelector = 'iframe[src*="' + idA + '"]'
    const fresh = async () => {
      // 关闭旧页会取消其尚未完成的 fitView/debounce，场景间不共享 React 运行时。
      if (page) await page.close()
      const reset = await fetch(new URL('api/viewport', url), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
        body: JSON.stringify({ ws, x: 380, y: 90, zoom: 0.8 }),
      })
      assert.equal(reset.status, 200, '场景准备应重置为可见视口')
      page = await browser.newPage()
      await page.setViewport({ width: 1600, height: 1000 })
      failures.length = 0; pageErrors.length = 0; consoleErrors.length = 0
      page.on('response', (response) => {
        if (response.status() >= 400) failures.push({ status: response.status(), path: new URL(response.url()).pathname })
      })
      page.on('pageerror', (error) => pageErrors.push(error.message))
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
      page.on('popup', (popup) => { popups.push(popup); void popup.close() })
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      // DOMContentLoaded 不等待 main.tsx 的异步授权；React 挂载后 cookie 才已就绪。
      await page.waitForSelector('.sidebar__item', { timeout: 15000 })
      // 另从真实浏览器读取工作区，证明 cookie 生效；准备步骤的 Node Bearer 不能代替此验证。
      const resetStatus = await page.evaluate(async (token) => {
        const response = await fetch(location.pathname + 'api/project?ws=' + encodeURIComponent(token))
        return response.status
      }, ws)
      assert.equal(resetStatus, 200, '真实浏览器的工作区授权必须有效')
      await page.waitForSelector(frameSelector, { timeout: 15000 })
      let frame
      await until(() => {
        frame = page.frames().find((item) => { try { return new URL(item.url()).pathname.endsWith('/page/' + idA) } catch { return false } })
        return !!frame
      }, '应找到已导航的源页面 iframe')
      await frame.waitForSelector('#nested', { timeout: 10000 })
      await frame.waitForFunction(() => window.__tianshu_probe__ === true)
      await page.waitForFunction(() => document.querySelector('.sidebar__item'))
      failures.length = 0; pageErrors.length = 0; consoleErrors.length = 0
      return frame
    }
    const click = (frame, selector, modifiers = {}) => frame.evaluate((sel, keys) => {
      const element = document.querySelector(sel), rect = element.getBoundingClientRect()
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, ...keys })
      element.dispatchEvent(event)
      return event.defaultPrevented
    }, selector, modifiers)
    const stable = async (frame) => {
      await frame.waitForSelector('#nested', { timeout: 1000 })
      const current = new URL(frame.url())
      assert.equal(current.pathname, new URL(url).pathname + 'page/' + idA, '源 iframe 不能自行导航')
      assert.equal(current.searchParams.get('ws'), ws, '源 iframe 必须保留 workspace')
      assert.doesNotMatch(await frame.evaluate(() => document.body.innerText), /unknown workspace/)
      assert.deepEqual(failures, [], '不能出现 404 或其他失败响应')
      assert.deepEqual(pageErrors, [], '不能出现未捕获异常')
      assert.deepEqual(consoleErrors, [], '不能出现控制台错误')
      assert.equal(popups.length, 0, '不能打开额外窗口')
    }
    const selected = async (id, kind, after) => {
      await until(() => { const s = readSelection(); return s?.pageId === id && s.kind === kind && s.at > after }, '选中未写入 ' + id + '/' + kind + '，实际=' + JSON.stringify(readSelection()))
      return readSelection()
    }

    await t.test('首次嵌套 span 真实鼠标点击不能丢失 workspace', async () => {
      const frame = await fresh(), iframe = await page.$(frameSelector)
      // 等待 React Flow 的初始适应视图和探针高度回报稳定，避免鼠标坐标使用过渡布局。
      await until(async () => {
        const before = await iframe.boundingBox()
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
        const after = await iframe.boundingBox()
        return before && after && ['x', 'y', 'width', 'height'].every((key) => Math.abs(before[key] - after[key]) < 0.1)
      }, '真实鼠标点击前画布布局应稳定')
      const rect = await iframe.boundingBox()
      const local = await frame.$eval('#nested', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: innerWidth, height: innerHeight } })
      assert.ok(rect && rect.width > 0 && rect.height > 0)
      const after = readSelection()?.at ?? 0
      // 外层画布 transform 缩放：将 iframe 内 CSS 像素转换为真实屏幕点击坐标。
      await page.mouse.click(rect.x + local.x * rect.width / local.width, rect.y + local.y * rect.height / local.height)
      await selected(idB, 'page', after)
      await stable(frame)
    })
    for (const selector of ['#nested', '#svg-path', '#image', '#data-nav']) {
      await t.test('首次深层链接 ' + selector + ' 使用现有站内导航', async () => {
        const frame = await fresh(), after = readSelection()?.at ?? 0
        assert.equal(await click(frame, selector), true, '必须取消浏览器默认导航')
        await selected(idB, 'page', after)
        await stable(frame)
      })
    }
    for (const selector of ['#external', '#unknown', '#malformed']) {
      await t.test('无效或外部链接 ' + selector + ' 不离开原型', async () => {
        const frame = await fresh(), after = readSelection()?.at ?? 0
        assert.equal(await click(frame, selector), true, '必须取消未知/外链默认导航')
        await selected(idA, 'element', after)
        await stable(frame)
      })
    }
    for (const key of ['ctrlKey', 'metaKey']) {
      for (const selector of ['#nested', '#svg-path', '#image', '#external']) {
        await t.test(key + ' 点击 ' + selector + ' 只选中内层', async () => {
          const frame = await fresh(), after = readSelection()?.at ?? 0
          assert.equal(await click(frame, selector, { [key]: true }), true, '修饰键不能放行默认导航')
          const s = await selected(idA, 'element', after)
          assert.equal(s.element.tagName, selector === '#svg-path' ? 'svg' : selector === '#image' ? 'img' : 'span')
          await stable(frame)
        })
      }
    }
    await t.test('区块 scope 改变后与重复点击仍正常导航', async () => {
      const frame = await fresh()
      for (let depth = 0; depth < 2; depth++) {
        const after = readSelection()?.at ?? 0
        assert.equal(await click(frame, '#button'), false)
        const s = await selected(idA, 'element', after)
        assert.equal(s.element.tagName, 'div', '普通点击继续逐层选择区块')
      }
      for (let repeat = 0; repeat < 3; repeat++) {
        const after = readSelection()?.at ?? 0
        assert.equal(await click(frame, '#nested'), true)
        await selected(idB, 'page', after)
        await stable(frame)
      }
    })
    await t.test('原生 button/details/label/checkbox 和锚点保留', async () => {
      const frame = await fresh()
      assert.equal(await click(frame, '#button'), false)
      assert.equal(await frame.$eval('#button', (el) => el.dataset.clicked), '1')
      assert.equal(await click(frame, '#summary'), false)
      assert.equal(await frame.$eval('#details', (el) => el.open), true)
      assert.equal(await click(frame, '#label'), false)
      assert.equal(await frame.$eval('#checkbox', (el) => el.checked), true)
      assert.equal(await click(frame, '#anchor'), false)
      await frame.waitForFunction(() => location.hash === '#anchor-target')
      await stable(frame)
    })
    await t.test('退出预览后首次嵌套链接不复发', async () => {
      const frame = await fresh()
      await page.$eval(frameSelector, (el) => {
        el.closest('.react-flow__node').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 220 }))
      })
      await page.waitForSelector('.context-menu__item')
      await page.click('.context-menu__item')
      await page.waitForSelector('.preview-device__iframe')
      await page.click('.preview-exit')
      await page.waitForSelector('.preview-overlay', { hidden: true })
      const after = readSelection()?.at ?? 0
      assert.equal(await click(frame, '#nested'), true)
      await selected(idB, 'page', after)
      await stable(frame)
    })
    assert.equal(readFileSync(htmlPath, 'utf8'), savedHtml, '选择与导航不能修改原型文件')
  } finally {
    if (browser) await browser.close()
    rmSync(cwd, { recursive: true, force: true })
  }
})
