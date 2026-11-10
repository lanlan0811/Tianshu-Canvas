/**
 * 端到端：画布内全屏预览。
 *
 * 覆盖：右键「预览 / 预览设备」→ 全屏预览层 → 设备切换（网页/平板/手机/自定义）
 * → 自定义 W/H + 边缘拖拽 → 缩放 → 预览内原生交互（不写 selection.json）
 * → 预览内站内跳转 / 外链拦截 → 页面切换 / Esc / 退出 → 编辑态回归。
 *
 * 正式验收缺少浏览器必须失败，不能以跳过产生假绿。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin, rawFetch } from './helpers/host.mjs'
import { resolveTestBrowser } from './helpers/browser.mjs'

const root = resolve(import.meta.dirname, '..')
const browserPath = resolveTestBrowser()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('预览 e2e：右键菜单 / 设备切换 / 交互 / 跳转 / 关闭', { skip: !browserPath && '未找到浏览器' }, async () => {
  const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const puppeteer = (await import('puppeteer-core')).default
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-preview-e2e-'))
  let browser
  try {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)[0]
    const token = new URL(url).searchParams.get('ws')
    const port = new URL(url).port

    const b = await tools.canvas_upsert_page.execute({
      input: { html: '<html><head></head><body><h1 id="bt">B 页</h1><p>目标页内容</p></body></html>', title: '目标页' },
      cwd,
    })
    const idB = b.content.match(/id=([\w-]+)/)[1]
    const a = await tools.canvas_upsert_page.execute({
      input: {
        html:
          '<html><head><style>body{margin:0;font-family:sans-serif}.box{height:1600px;padding:20px}</style></head><body>' +
          '<div class="box">' +
          '<h1 id="title">首页</h1>' +
          '<details id="det"><summary id="sum">展开</summary><p>内容</p></details>' +
          `<a id="go" href="${idB}.html">去目标</a>` +
          '<a id="ext" href="https://example.com">外链</a>' +
          '<button id="btn">按钮</button>' +
          '</div></body></html>',
        title: '首页',
        width: 900,
        height: 600,
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
    await sleep(1000)

    const readSelectionFile = () => {
      try {
        return JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'selection.json'), 'utf8'))
      } catch {
        return null
      }
    }

    /**
     * 在画布上右键指定页面节点。
     * 必须点标题栏：节点主体被 iframe 覆盖，iframe 内的右键不会冒泡到画布父页面。
     */
    async function openNodeMenu(title) {
      const box = await page.evaluate((t) => {
        const nodes = Array.from(document.querySelectorAll('.page-node'))
        const node = nodes.find((n) => n.querySelector('.page-node__title')?.textContent?.includes(t))
        if (!node) return null
        const header = node.querySelector('.page-node__header')
        const r = (header ?? node).getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }, title)
      assert.ok(box, `应找到节点「${title}」`)
      await page.mouse.click(box.x, box.y, { button: 'right' })
      await page.waitForSelector('.context-menu', { timeout: 5000 })
    }

    // ---------- 1) 右键菜单：只有预览 / 预览设备 ----------
    await openNodeMenu('首页')
    const menuItems = await page.$$eval('.context-menu > .context-menu__item, .context-menu .context-menu__subwrap > .context-menu__item', (els) =>
      els.map((e) => e.textContent?.trim()),
    )
    assert.deepEqual(menuItems, ['预览', '预览设备'], `右键菜单只应保留预览两项，实际 ${JSON.stringify(menuItems)}`)

    // 悬停「预览设备」展开二级菜单 → 默认「网页」打勾
    await page.hover('.context-menu__subwrap > .context-menu__item')
    await page.waitForSelector('.context-menu__sub', { timeout: 3000 })
    const sub = await page.$$eval('.context-menu__sub .context-menu__subitem', (els) =>
      els.map((e) => ({
        text: e.textContent?.trim(),
        checked: e.getAttribute('aria-checked') === 'true',
      })),
    )
    assert.deepEqual(
      sub.map((s) => s.text),
      ['网页', '平板', '手机', '自定义'],
    )
    assert.equal(sub.find((s) => s.text === '网页')?.checked, true, '默认应勾选「网页」')

    // ---------- 2) 点「预览」→ 全屏预览层 ----------
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.context-menu > .context-menu__item'))
      const target = items.find((e) => e.textContent?.trim() === '预览')
      target?.click()
    })
    await page.waitForSelector('.preview-overlay', { timeout: 5000 })
    await page.waitForSelector('.preview-device__iframe', { timeout: 5000 })
    await sleep(1200)

    const deviceOf = () => page.$eval('.preview-device', (el) => el.getAttribute('data-device'))
    const activeDevice = () => page.$eval('.preview-device-seg__btn.is-active', (el) => el.getAttribute('data-device'))
    const previewFrame = () => page.frames().find((f) => f.url().includes('/page/') && f.url().includes('preview=1'))
    const selectionBefore = readSelectionFile()

    assert.equal(await deviceOf(), 'desktop', '默认设备应为网页')
    assert.equal(await activeDevice(), 'desktop')
    assert.ok(await page.$eval('.preview-exit', (el) => el.textContent?.includes('退出预览')), '应有退出预览按钮')

    // 网页尺寸铺满预览区
    const desktopBox = await page.$eval('.preview-device', (el) => ({
      w: el.clientWidth,
      h: el.clientHeight,
    }))
    assert.ok(desktopBox.w > 1000 && desktopBox.h > 600, `网页预览应铺满舞台：${JSON.stringify(desktopBox)}`)

    // ---------- 3) 预览内原生交互：details 展开 / 按钮点击都不写 selection ----------
    let frame = previewFrame()
    assert.ok(frame, '应有预览 iframe（带 preview=1）')
    await frame.waitForSelector('#sum', { timeout: 10000 })

    async function clickInFrame(selector) {
      await frame.click(selector)
      await page.evaluate(() => new Promise(requestAnimationFrame))
    }

    await clickInFrame('#sum')
    const opened = await frame.evaluate(() => document.getElementById('det').hasAttribute('open'))
    assert.equal(opened, true, '预览内 <details> 应可展开（原生交互生效）')
    await clickInFrame('#btn')
    assert.deepEqual(readSelectionFile(), selectionBefore, '预览内点击不应写 selection.json')

    // 预览页 HTML 应为预览模式探针
    const previewHtml = await (await fetch(`http://127.0.0.1:${port}/page/${idA}?ws=${token}&preview=1`)).text()
    assert.match(previewHtml, /var PREVIEW = true/, 'preview=1 应注入预览态探针')
    const editHtml = await (await fetch(`http://127.0.0.1:${port}/page/${idA}?ws=${token}`)).text()
    assert.match(editHtml, /var PREVIEW = false/, '编辑态应为普通探针')

    // ---------- 4) 设备切换：平板 / 手机（逻辑尺寸） ----------
    async function pickDevice(device) {
      await page.click(`.preview-device-seg__btn[data-device="${device}"]`)
      await sleep(900)
    }

    await pickDevice('tablet')
    let size = await page.$eval('.preview-device__scaler', (el) => ({ w: el.clientWidth, h: el.clientHeight }))
    assert.deepEqual(size, { w: 768, h: 1024 }, `平板逻辑尺寸应为 768×1024：${JSON.stringify(size)}`)
    assert.equal(await activeDevice(), 'tablet')
    assert.equal(await page.$eval('.preview-zoom__btn', (el) => el.textContent.trim()), '100%')

    await pickDevice('mobile')
    size = await page.$eval('.preview-device__scaler', (el) => ({ w: el.clientWidth, h: el.clientHeight }))
    assert.deepEqual(size, { w: 375, h: 812 }, `手机逻辑尺寸应为 375×812：${JSON.stringify(size)}`)
    assert.equal(await activeDevice(), 'mobile')
    assert.equal(await page.$eval('.preview-device__scaler', (el) => getComputedStyle(el).transform), 'none')

    // ---------- 5) 自定义：W/H 输入 ----------
    await pickDevice('free')
    await page.waitForSelector('.preview-free-size', { timeout: 3000 })
    const widthInput = (await page.$$('.preview-free-size input'))[0]
    const heightInput = (await page.$$('.preview-free-size input'))[1]
    async function setSize(input, value) {
      await input.click()
      await page.keyboard.down('Control')
      await page.keyboard.press('KeyA')
      await page.keyboard.up('Control')
      await page.keyboard.press('Backspace')
      await input.type(String(value))
      await page.keyboard.press('Enter')
      await sleep(250)
    }
    await setSize(widthInput, 500)
    await setSize(heightInput, 700)
    await sleep(400)
    size = await page.$eval('.preview-device__scaler', (el) => ({ w: el.clientWidth, h: el.clientHeight }))
    assert.deepEqual(size, { w: 500, h: 700 }, `自定义尺寸应为 500×700：${JSON.stringify(size)}`)

    // 非法输入回退：0 → 保持原值
    await setSize(widthInput, 0)
    await sleep(300)
    size = await page.$eval('.preview-device__scaler', (el) => ({ w: el.clientWidth, h: el.clientHeight }))
    assert.deepEqual(size, { w: 500, h: 700 }, '非法宽度应回退原值')

    // ---------- 6) 拖拽右边缘加宽 ----------
    const handleBox = await page.$eval('.preview-handle--right', (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    await page.mouse.move(handleBox.x, handleBox.y)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + 120, handleBox.y, { steps: 6 })
    await page.mouse.up()
    await sleep(400)
    const dragged = await page.$eval('.preview-device__scaler', (el) => ({ w: el.clientWidth, h: el.clientHeight }))
    assert.ok(dragged.w > 500, `拖拽右边缘应加宽：${JSON.stringify(dragged)}`)

    // ---------- 7) 缩放：100% / 适应窗口 ----------
    await page.click('.preview-zoom__btn')
    await page.waitForSelector('.preview-zoom__menu', { timeout: 3000 })
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.preview-zoom__menu button'))
      items.find((b) => b.textContent?.trim() === '100%')?.click()
    })
    await sleep(500)
    size = await page.$eval('.preview-device__scaler', (el) => ({ w: el.clientWidth, h: el.clientHeight }))
    const box100 = await page.$eval('.preview-device', (el) => ({ w: el.clientWidth, h: el.clientHeight }))
    // 100% 时外层显示尺寸 = 逻辑尺寸（舞台内可能滚动，取 round 后比较）
    assert.ok(Math.abs(box100.w - size.w) <= 2, `100% 缩放显示尺寸应等于逻辑尺寸：${JSON.stringify({ box100, size })}`)
    const zoomText = await page.$eval('.preview-zoom__btn', (el) => el.textContent?.trim())
    assert.equal(zoomText, '100%')

    await page.click('.preview-zoom__btn')
    await page.waitForSelector('.preview-zoom__menu', { timeout: 3000 })
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.preview-zoom__menu button'))
      items.find((b) => b.textContent?.trim() === '适应窗口')?.click()
    })
    await sleep(500)
    const fitBox = await page.$eval('.preview-device', (el) => ({ w: el.clientWidth, h: el.clientHeight }))
    assert.ok(fitBox.w <= box100.w, '适应窗口不应大于 100% 显示尺寸')

    // ---------- 8) 站内跳转：预览内切到目标页 ----------
    await pickDevice('mobile')
    frame = previewFrame()
    await frame.waitForSelector('#go', { timeout: 10000 })
    await clickInFrame('#go')
    await sleep(900)
    const titleText = await page.$eval('.preview-page-btn__title', (el) => el.textContent)
    assert.equal(titleText, '目标页', `预览应切到目标页，实际「${titleText}」`)
    frame = previewFrame()
    await frame.waitForSelector('#bt', { timeout: 10000 })
    assert.equal(await deviceOf(), 'mobile', '站内跳转后设备应保持不变')
    assert.deepEqual(readSelectionFile(), selectionBefore, '预览内跳转不应写 selection.json')

    // ---------- 9) 外链拦截提示 ----------
    await page.click('.preview-page-btn')
    await page.waitForSelector('.preview-pages', { timeout: 3000 })
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.preview-pages__item'))
      items.find((b) => b.textContent?.includes('首页'))?.click()
    })
    await sleep(900)
    frame = previewFrame()
    await frame.waitForSelector('#ext', { timeout: 10000 })
    await clickInFrame('#ext')
    await page.waitForSelector('.preview-toast', { timeout: 3000 })
    const toast = await page.$eval('.preview-toast', (el) => el.textContent?.trim())
    assert.equal(toast, '外链不可在预览内打开')
    assert.ok(await page.$('.preview-overlay'), '外链后预览层应仍在')

    // ---------- 10) 页面下拉切换 + Esc 关闭 ----------
    await page.click('.preview-page-btn')
    await page.waitForSelector('.preview-pages', { timeout: 3000 })
    const pageOptions = await page.$$eval('.preview-pages__item', (els) => els.map((e) => e.textContent?.trim()))
    assert.equal(pageOptions.length, 2, `页面下拉应列出全部页面：${JSON.stringify(pageOptions)}`)

    await page.keyboard.press('Escape')
    await sleep(400)
    assert.equal(await page.$('.preview-overlay'), null, 'Esc 应关闭预览层')

    // ---------- 11) 右键「预览设备」直接进入手机预览 ----------
    await openNodeMenu('首页')
    await page.hover('.context-menu__subwrap > .context-menu__item')
    await page.waitForSelector('.context-menu__sub', { timeout: 3000 })
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.context-menu__sub .context-menu__subitem'))
      items.find((b) => b.textContent?.trim() === '手机')?.click()
    })
    await page.waitForSelector('.preview-overlay', { timeout: 5000 })
    await sleep(1000)
    assert.equal(await deviceOf(), 'mobile', '「预览设备 → 手机」应直接以手机进入预览')
    assert.equal(await activeDevice(), 'mobile')

    // 退出按钮关闭
    assert.equal(await page.$eval('.preview-zoom__btn', (el) => el.textContent.trim()), '100%', '右键直达预览也应默认100%')
    await page.click('.preview-exit')
    await sleep(300)
    assert.equal(await page.$('.preview-overlay'), null, '退出按钮应关闭预览层')

    // ---------- 12) 关闭后编辑态回归：点节点 iframe 仍写 selection ----------
    const nodeFrame = page.frames().find((f) => f.url().includes(`/page/${idA}`) && !f.url().includes('preview=1'))
    assert.ok(nodeFrame, '编辑态节点 iframe 应存在')
    await nodeFrame.waitForSelector('#btn', { timeout: 10000 })
    await nodeFrame.evaluate(() => {
      const el = document.querySelector('#btn')
      const r = el.getBoundingClientRect()
      el.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
        }),
      )
    })
    await sleep(600)
    const selAfter = readSelectionFile()
    assert.ok(selAfter && selAfter.pageId === idA, `关闭预览后编辑态点击应恢复选中：${JSON.stringify(selAfter)}`)

    // ---------- 13) 安全：无凭证访问 preview=1 仍被拒（rawFetch 绕开测试垫片的 Bearer） ----------
    const denied = await rawFetch(`http://127.0.0.1:${port}/page/${idA}?ws=${token}&preview=1`)
    assert.ok([403, 404].includes(denied.status), `无凭证的预览页应被拒，实际 ${denied.status}`)
    const deniedEdit = await rawFetch(`http://127.0.0.1:${port}/page/${idA}?ws=${token}`)
    assert.ok([403, 404].includes(deniedEdit.status), `无凭证的编辑页也应被拒，实际 ${deniedEdit.status}`)
    const scope = new URL(url).pathname.split('/')[2]
    const wrongSecret = await rawFetch(`http://127.0.0.1:${port}/w/${scope}/page/${idA}?ws=${token}&preview=1`, {
      headers: { Authorization: 'Bearer ' + '0'.repeat(64) },
    })
    assert.ok([403, 404].includes(wrongSecret.status), `错误凭证的预览页应被拒，实际 ${wrongSecret.status}`)

    console.log('OK 预览 e2e：右键菜单/四设备/自定义尺寸拖拽/缩放/原生交互/站内跳转/外链拦截/退出，全部通过')
  } finally {
    if (browser) await browser.close().catch(() => {})
    rmSync(cwd, { recursive: true, force: true })
  }
})
