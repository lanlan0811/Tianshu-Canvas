/** Issue #7: real iframe geometry, native-size defaults, overflow and DPR. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'
import { resolveTestBrowser } from './helpers/browser.mjs'

const root = resolve(import.meta.dirname, '..')
const browserPath = resolveTestBrowser()
const fixture = readFileSync(join(root, 'test/fixtures/preview-clarity.html'), 'utf8')
const sizes = { tablet: [768, 1024], mobile: [375, 812], free: [800, 600] }
const evidenceDir = process.env.TIANSHU_CANVAS_PREVIEW_EVIDENCE
  ? resolve(process.env.TIANSHU_CANVAS_PREVIEW_EVIDENCE) : null

async function ready(page) {
  const handle = await page.waitForSelector('.preview-device__iframe', { timeout: 10000 })
  const frame = await handle.contentFrame()
  assert.ok(frame, '预览 iframe 应已创建')
  await frame.waitForSelector('#fixture-title', { timeout: 10000 })
  await frame.evaluate(async () => { await document.fonts.ready })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return frame
}

async function openPreview(page) {
  await page.waitForSelector('.page-node__header', { timeout: 10000 })
  const header = (await page.$$('.page-node__header'))[0]
  await page.waitForFunction(() => {
    const header = document.querySelector('.page-node__header')
    const box = header.getBoundingClientRect()
    return box.top > 60 && box.left > 10 && box.right < innerWidth && box.bottom < innerHeight
  })
  const box = await header.boundingBox()
  assert.ok(box)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  await page.waitForSelector('.context-menu', { timeout: 5000 })
  const buttons = await page.$$('.context-menu > .context-menu__item')
  const button = await Promise.all(buttons.map(async (el) => ({ el, text: await el.evaluate((n) => n.textContent.trim()) })))
  await button.find((item) => item.text === '预览').el.click()
  return ready(page)
}

async function device(page, name) {
  await page.click(`.preview-device-seg__btn[data-device="${name}"]`)
  await page.waitForFunction((name) => document.querySelector('.preview-device')?.dataset.device === name, {}, name)
  return ready(page)
}

async function zoom(page, label) {
  await page.click('.preview-zoom__btn')
  await page.waitForSelector('.preview-zoom__menu')
  const options = await page.$$('.preview-zoom__menu button')
  for (const option of options) {
    if (await option.evaluate((el) => el.textContent.trim()) === label) {
      await option.click()
      await page.waitForSelector('.preview-zoom__menu', { hidden: true })
      return ready(page)
    }
  }
  assert.fail(`找不到缩放选项 ${label}`)
}

async function clickInPreview(page, selector) {
  const frame = await ready(page)
  await frame.$eval(selector, (el) => el.scrollIntoView({ block: 'center', inline: 'center' }))
  const point = await frame.$eval(selector, (el) => {
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  const mapped = await page.$eval('.preview-device__iframe', (iframe, point) => {
    const rect = iframe.getBoundingClientRect()
    return { x: rect.left + point.x * rect.width / iframe.clientWidth, y: rect.top + point.y * rect.height / iframe.clientHeight }
  }, point)
  await page.mouse.click(mapped.x, mapped.y)
}

async function geometry(page) {
  const frame = await ready(page)
  const inner = await frame.evaluate(() => ({
    width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    narrow: getComputedStyle(document.getElementById('narrow')).display !== 'none',
  }))
  const outer = await page.evaluate(() => {
    const scaler = document.querySelector('.preview-device__scaler')
    const iframe = document.querySelector('.preview-device__iframe')
    const stage = document.querySelector('.preview-stage')
    const rect = iframe.getBoundingClientRect()
    const sr = stage.getBoundingClientRect()
    const cs = getComputedStyle(stage)
    return {
      width: iframe.clientWidth, height: iframe.clientHeight,
      renderedWidth: rect.width, renderedHeight: rect.height,
      transform: getComputedStyle(scaler).transform,
      dpr: devicePixelRatio, label: document.querySelector('.preview-zoom__btn').textContent.trim(),
      stageWidth: stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      stageHeight: stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
      top: rect.top - sr.top, left: rect.left - sr.left,
      scrollWidth: stage.scrollWidth, scrollHeight: stage.scrollHeight,
      clientWidth: stage.clientWidth, clientHeight: stage.clientHeight,
    }
  })
  return { inner, outer }
}

async function setup() {
  const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist/index.mjs')).href)
  const puppeteer = (await import('puppeteer-core')).default
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-preview-geometry-'))
  let browser
  try {
    const result = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const url = result.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)?.[0]
    assert.ok(url, result.content)
    const target = await tools.canvas_upsert_page.execute({ input: { title: '目标页', html: fixture.replace('__TARGET_PAGE__', 'missing') }, cwd })
    const targetId = target.content.match(/id=([\w-]+)/)?.[1]
    assert.ok(targetId, target.content)
    const source = await tools.canvas_upsert_page.execute({ input: { title: '清晰度基线', html: fixture.replace('__TARGET_PAGE__', targetId), width: 375, height: 812 }, cwd })
    const sourceId = source.content.match(/id=([\w-]+)/)?.[1]
    assert.ok(sourceId, source.content)
    browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const browserVersion = await browser.version()
    console.log('预览验收浏览器：' + browserVersion)
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewport({ width: 1400, height: 900 })
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.page-node__iframe')
    return { page, browser, browserVersion, cwd, url, errors, sourceId, targetId, close: async () => { await browser.close(); rmSync(cwd, { recursive: true, force: true }) } }
  } catch (error) {
    await browser?.close().catch(() => {})
    rmSync(cwd, { recursive: true, force: true })
    throw error
  }
}

async function pageChoice(page, title) {
  await page.click('.preview-page-btn')
  for (const button of await page.$$('.preview-pages__item')) {
    if (await button.evaluate((el, title) => el.querySelector('.preview-pages__title').textContent === title, title)) {
      await button.click()
      return ready(page)
    }
  }
  assert.fail('找不到预览页 ' + title)
}

async function inputSize(page, axis, value) {
  const input = await page.$('input[aria-label="预览' + (axis === 'width' ? '宽度' : '高度') + '"]')
  await input.click({ clickCount: 3 })
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.type(String(value))
  await page.keyboard.press('Enter')
  await page.waitForFunction((axis, value) => document.querySelector('.preview-device__scaler')[axis === 'width' ? 'clientWidth' : 'clientHeight'] === value, {}, axis, value)
  await ready(page)
}

async function assertCorners(page, label) {
  for (const [horizontal, vertical] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const result = await page.$eval('.preview-stage', (stage, horizontal, vertical) => {
      stage.scrollLeft = horizontal ? stage.scrollWidth : 0
      stage.scrollTop = vertical ? stage.scrollHeight : 0
      const viewport = document.querySelector('.preview-device__iframe').getBoundingClientRect()
      const box = stage.getBoundingClientRect()
      const x = horizontal ? viewport.right - 12 : viewport.left + 12
      const y = vertical ? viewport.bottom - 12 : viewport.top + 12
      const hit = document.elementFromPoint(x, y)
      return { x, y, visible: x >= box.left && x < box.left + stage.clientWidth && y >= box.top && y < box.top + stage.clientHeight, hit: hit?.className }
    }, horizontal, vertical)
    assert.ok(result.visible, label + '四角应能滚动到达 ' + JSON.stringify(result))
    assert.equal(result.hit, 'preview-device__iframe', label + '原型四角不应被覆盖')
  }
  await page.$eval('.preview-stage', (stage) => { stage.scrollLeft = 0; stage.scrollTop = 0 })
}

test('预览几何矩阵：3种DPR × 3种窗口 × 4种设备，真实逻辑视口/100%/四角', { skip: !browserPath && '未找到浏览器' }, async () => {
  const env = await setup()
  const results = []
  try {
    const { page } = env
    await openPreview(page)
    for (const dpr of [1, 1.25, 2]) {
      for (const viewport of [{ width: 1400, height: 900 }, { width: 800, height: 600 }, { width: 1280, height: 500 }]) {
        await page.setViewport({ ...viewport, deviceScaleFactor: dpr })
        for (const name of ['desktop', 'tablet', 'mobile', 'free']) {
          await device(page, name)
          const metrics = await geometry(page)
          const label = JSON.stringify({ dpr, viewport, name })
          const expected = sizes[name] ?? [Math.max(320, metrics.outer.stageWidth), Math.max(240, metrics.outer.stageHeight)]
          assert.deepEqual([metrics.inner.width, metrics.inner.height], expected, label + 'iframe真实视口')
          assert.deepEqual([metrics.outer.width, metrics.outer.height], expected, label + 'iframe CSS尺寸')
          assert.deepEqual([metrics.outer.renderedWidth, metrics.outer.renderedHeight], expected, label + '显示不压缩')
          assert.equal(metrics.inner.dpr, dpr, label + '不得伪造DPR')
          assert.equal(metrics.outer.transform, 'none', label + '100%无缩放层')
          assert.equal(metrics.outer.label, '100%', label + '默认100%')
          if (name === 'mobile') assert.equal(metrics.inner.narrow, false, label + '375px断点不得偏成374px')
          await assertCorners(page, label)
          console.log('预览矩阵通过 ' + label)
          results.push({ browserVersion: env.browserVersion, dpr, viewport, name, ...metrics })
        }
      }
    }
    assert.equal(results.length, 36)
    assert.deepEqual(env.errors, [], '不得出现运行时或ResizeObserver错误')
    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true })
      writeFileSync(join(evidenceDir, 'preview-geometry-matrix.json'), JSON.stringify(results, null, 2))
    }
  } finally { await env.close() }
})

test('预览状态和交互：手选缩放/切页保留/切设备与重开重置/原生交互/缩放拖拽', { skip: !browserPath && '未找到浏览器' }, async () => {
  const env = await setup()
  try {
    const { page } = env
    await openPreview(page)
    await device(page, 'mobile')
    await zoom(page, '75%')
    await device(page, 'mobile')
    assert.equal((await geometry(page)).outer.label, '75%', '相同设备点击保留缩放')
    await pageChoice(page, '目标页')
    assert.equal((await geometry(page)).outer.label, '75%', '切页保留缩放')
    await pageChoice(page, '清晰度基线')
    let frame = await ready(page)
    await clickInPreview(page, '#internal-link')
    await page.waitForFunction(() => document.querySelector('.preview-page-btn__title').textContent === '目标页')
    assert.equal((await geometry(page)).outer.label, '75%', '原型站内跳转保留缩放')
    await device(page, 'tablet')
    assert.equal((await geometry(page)).outer.label, '100%', '跨设备重置100%')
    await zoom(page, '50%')
    await page.click('.preview-exit')
    await page.waitForSelector('.preview-overlay', { hidden: true })
    await openPreview(page)
    assert.equal((await geometry(page)).outer.label, '100%', '重开预览重置100%')
    await pageChoice(page, '清晰度基线')
    await device(page, 'free')
    await inputSize(page, 'width', 500)
    await inputSize(page, 'height', 500)
    frame = await ready(page)
    const selectionPath = join(env.cwd, '.tianshu-canvas/selection.json')
    const before = existsSync(selectionPath) ? readFileSync(selectionPath, 'utf8') : null
    await clickInPreview(page, '#click-target')
    await frame.waitForFunction(() => document.getElementById('click-count').textContent === '1')
    await frame.type('#text-input', '真实输入')
    assert.equal(await frame.$eval('#text-input', (el) => el.value), '真实输入')
    const iframe = await page.$('.preview-device__iframe')
    const box = await iframe.boundingBox()
    await page.mouse.move(box.x + 100, box.y + 200)
    await page.mouse.wheel({ deltaY: 150 })
    await frame.waitForFunction(() => scrollY > 0)
    assert.equal(existsSync(selectionPath) ? readFileSync(selectionPath, 'utf8') : null, before, '预览交互不写selection')
    await zoom(page, '50%')
    for (const dir of ['top', 'right', 'bottom', 'left']) {
      const handle = await page.$('.preview-handle--' + dir)
      const rect = await handle.boundingBox()
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('preview-handle'), point)
      assert.equal(hit, true, dir + '缩放后handle应可命中')
    }
    for (const [dir, axis] of [['right', 'width'], ['bottom', 'height']]) {
      const initial = await geometry(page)
      const handle = await page.$('.preview-handle--' + dir)
      const rect = await handle.boundingBox()
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + (axis === 'width' ? 40 : 0), y + (axis === 'height' ? 40 : 0), { steps: 4 })
      await page.mouse.up()
      await page.waitForFunction((axis, expected) => document.querySelector('.preview-device__scaler')[axis === 'width' ? 'clientWidth' : 'clientHeight'] === expected, {}, axis, initial.inner[axis] + 80)
    }
    for (const label of ['50%', '75%', '100%', '125%', '150%', '200%', '适应窗口']) {
      await zoom(page, label)
      const metrics = await geometry(page)
      if (label !== '适应窗口') assert.equal(metrics.outer.label, label)
      assert.equal(metrics.inner.dpr, metrics.outer.dpr)
    }
    await page.keyboard.press('Escape')
    await page.waitForSelector('.preview-overlay', { hidden: true })
    assert.deepEqual(env.errors, [])
  } finally { await env.close() }
})

test('预览适配极大尺寸：10000像素/窗口变化/滚动条切换稳定且不污染项目', { skip: !browserPath && '未找到浏览器' }, async () => {
  const env = await setup()
  try {
    const { page } = env
    await openPreview(page)
    await device(page, 'free')
    const projectPath = join(env.cwd, '.tianshu-canvas/project.json')
    const before = readFileSync(projectPath, 'utf8')
    await inputSize(page, 'width', 10000)
    await inputSize(page, 'height', 10000)
    for (const viewport of [{ width: 800, height: 600 }, { width: 1280, height: 500 }, { width: 800, height: 600 }]) {
      await page.setViewport(viewport)
      await zoom(page, '适应窗口')
      const fitted = await geometry(page)
      assert.ok(fitted.outer.renderedWidth <= fitted.outer.stageWidth + 1, '极大宽度必须真实适配')
      assert.ok(fitted.outer.renderedHeight <= fitted.outer.stageHeight + 1, '极大高度必须真实适配')
      assert.ok(fitted.outer.scrollWidth <= fitted.outer.clientWidth + 1 && fitted.outer.scrollHeight <= fitted.outer.clientHeight + 1, '适配不得保留未缩放布局的滚动范围')
      const samples = await page.evaluate(async () => {
        const values = []
        for (let i = 0; i < 8; i++) {
          await new Promise(requestAnimationFrame)
          const el = document.querySelector('.preview-device')
          values.push([el.clientWidth, el.clientHeight, document.querySelector('.preview-zoom__btn').textContent])
        }
        return values
      })
      assert.equal(new Set(samples.map(JSON.stringify)).size, 1, '适配尺寸不得振荡')
      await zoom(page, '100%')
      await assertCorners(page, '10000像素原尺寸')
    }
    assert.equal(readFileSync(projectPath, 'utf8'), before, '设备/尺寸/缩放只影响预览，不写project.json')
    assert.deepEqual(env.errors, [])
  } finally { await env.close() }
})

test('预览清晰度证据：各DPR手机100%与相同视口直连页面截图', { skip: !browserPath && '未找到浏览器' }, async () => {
  const env = await setup()
  const records = []
  const screenshotDir = evidenceDir ?? mkdtempSync(join(tmpdir(), 'tsc-preview-clarity-'))
  mkdirSync(screenshotDir, { recursive: true })
  try {
    const { page } = env
    await page.setViewport({ width: 1401, height: 1100 })
    await openPreview(page)
    await pageChoice(page, '清晰度基线')
    await device(page, 'mobile')
    for (const dpr of [1, 1.25, 2]) {
      await page.setViewport({ width: 1401, height: 1100, deviceScaleFactor: dpr })
      const frame = await ready(page)
      const metrics = await geometry(page)
      assert.equal(metrics.outer.transform, 'none')
      const previewPath = join(screenshotDir, 'preview-mobile-100-dpr-' + dpr + '.png')
      await (await page.$('.preview-device__iframe')).screenshot({ path: previewPath })
      const direct = await env.browser.newPage()
      try {
        await direct.setViewport({ width: 375, height: 812, deviceScaleFactor: dpr })
        await direct.goto(frame.url(), { waitUntil: 'domcontentloaded' })
        await direct.waitForSelector('#fixture-title')
        await direct.evaluate(async () => { await document.fonts.ready })
        const directPath = join(screenshotDir, 'direct-mobile-dpr-' + dpr + '.png')
        await direct.screenshot({ path: directPath })
        const directMetrics = await direct.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
        assert.deepEqual(directMetrics, { width: 375, height: 812, dpr })
        console.log('清晰度截图证据 DPR=' + dpr + ' ' + previewPath + ' / ' + directPath)
        records.push({ browserVersion: env.browserVersion, dpr, previewPath, directPath, metrics, directMetrics })
      } finally { await direct.close() }
    }
    writeFileSync(join(screenshotDir, 'preview-clarity-manifest.json'), JSON.stringify(records, null, 2))
  } finally {
    await env.close()
    if (!evidenceDir) rmSync(screenshotDir, { recursive: true, force: true })
  }
})

test('预览默认原尺寸：首次进入 / 跨设备 / 100%无transform / 原尺寸四角可达', { skip: !browserPath && '未找到浏览器' }, async () => {
  const env = await setup()
  try {
    const { page } = env
    await openPreview(page)
    const first = await geometry(page)
    assert.equal(first.outer.transform, 'none', '100%不得为iframe建立transform缩放层')
    await device(page, 'mobile')
    const mobile = await geometry(page)
    assert.equal(mobile.outer.label, '100%', '切换手机默认100%，不得自动压缩')
    assert.equal(mobile.outer.renderedWidth, 375)
    assert.equal(mobile.outer.renderedHeight, 812)
    await page.setViewport({ width: 800, height: 600 })
    await ready(page)
    await page.$eval('.preview-stage', (stage) => { stage.scrollLeft = 0; stage.scrollTop = 0 })
    const small = await geometry(page)
    assert.ok(small.outer.top >= 0 && small.outer.left >= 0, `原尺寸左上角必须可达：${JSON.stringify(small)}`)
    assert.deepEqual(env.errors, [])
  } finally { await env.close() }
})

test('Issue7红绿回归：手机默认不得被fit压缩', { skip: !browserPath && '未找到浏览器' }, async () => {
  const env = await setup()
  try {
    await openPreview(env.page)
    await device(env.page, 'mobile')
    const metrics = await geometry(env.page)
    assert.equal(metrics.outer.label, '100%', '手机默认必须100%，旧版会自动fit为96%')
    assert.equal(metrics.outer.renderedWidth, 375)
    assert.equal(metrics.outer.renderedHeight, 812)
  } finally { await env.close() }
})

test('Issue7红绿回归：小窗手选100%时原型顶部仍可达', { skip: !browserPath && '未找到浏览器' }, async () => {
  const env = await setup()
  try {
    await openPreview(env.page)
    await device(env.page, 'mobile')
    await zoom(env.page, '100%')
    await env.page.setViewport({ width: 800, height: 600 })
    await ready(env.page)
    await env.page.$eval('.preview-stage', (stage) => { stage.scrollLeft = 0; stage.scrollTop = 0 })
    const metrics = await geometry(env.page)
    assert.ok(metrics.outer.top >= 0, '原尺寸顶部不得位于滚动起点之外：' + JSON.stringify(metrics.outer))
  } finally { await env.close() }
})
