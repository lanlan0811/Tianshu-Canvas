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

/** 滚动类与指针类交互：同一页里放齐，供真滚真验。 */
const PAGE_SCROLL =
  '<header class="ts-i-sticky-header" id="sh" data-ts-sticky data-ts-scroll-threshold="50" data-ts-hide-threshold="100">' +
  '<div class="ts-nav"><span class="ts-nav__brand">品牌</span></div></header>' +
  '<nav class="ts-i-mobile-nav" id="mn" data-ts-mobile-nav>' +
  '<button class="ts-i-mobile-nav__toggle" id="mn-toggle" type="button" aria-expanded="false" aria-controls="mn-menu" aria-label="打开导航菜单">' +
  '<span class="ts-i-mobile-nav__bar"></span><span class="ts-i-mobile-nav__bar"></span><span class="ts-i-mobile-nav__bar"></span>' +
  '</button>' +
  '<div class="ts-i-mobile-nav__backdrop"></div>' +
  '<div class="ts-nav__links" id="mn-menu"><a class="ts-nav__link" href="#sec-2">去第二节</a></div>' +
  '</nav>' +
  '<div style="height:40px"></div>' +
  '<div class="ts-i-scroll-progress" id="sp" data-ts-scroll-progress data-ts-threshold="100" role="button" tabindex="0" aria-label="返回顶部">' +
  '<svg class="ts-i-scroll-progress__ring" viewBox="0 0 100 100" aria-hidden="true">' +
  '<circle class="ts-i-scroll-progress__track" cx="50" cy="50" r="45"></circle>' +
  '<circle class="ts-i-scroll-progress__value" id="sp-value" cx="50" cy="50" r="45"></circle></svg>' +
  '<span class="ts-i-scroll-progress__icon" aria-hidden="true"><svg data-icon="arrow-up" class="ts-icon"></svg></span>' +
  '<span class="ts-i-scroll-progress__label" id="sp-label">0%</span></div>' +
  '<div class="ts-i-copy" id="cp" data-ts-copy>' +
  '<pre class="ts-i-copy__code" id="cp-code">npm run build</pre>' +
  '<button class="ts-i-copy__btn" id="cp-btn" data-ts-copy-btn data-ts-copied-label="已复制">复制</button></div>' +
  '<div class="ts-i-tilt" id="tilt" data-ts-tilt data-ts-max-tilt="12">' +
  '<div class="ts-i-tilt__inner" id="tilt-inner"><div class="ts-card"><div class="ts-card__body">倾斜</div></div></div></div>' +
  '<div class="ts-i-reveal ts-i-reveal--up" id="rv" data-ts-reveal><div class="ts-card"><div class="ts-card__body">渐显</div></div></div>' +
  '<div class="ts-i-toc" id="toc" data-ts-toc>' +
  '<button class="ts-i-toc__toggle" id="toc-toggle" type="button" aria-expanded="false" aria-label="打开目录">目录</button>' +
  '<div class="ts-i-toc__backdrop"></div>' +
  '<nav class="ts-i-toc__panel" aria-label="目录"><p class="ts-i-toc__title">目录</p>' +
  '<div class="ts-i-toc__list">' +
  '<a class="ts-i-toc__link ts-i-toc__link--active" id="toc-a" href="#sec-1">第一节</a>' +
  '<a class="ts-i-toc__link" id="toc-b" href="#sec-2">第二节</a>' +
  '</div></nav></div>' +
  '<div id="sec-1" style="height:900px">第一节内容</div>' +
  '<div id="sec-2" style="height:900px">第二节内容</div>'

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
  PAGE_SCROLL +
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

    // 注意：画布 iframe 会撑到内容全高（window.innerHeight === scrollHeight），
    // 内部永远不会滚动，所以 scroll-progress / sticky-header / toc 的滚动逻辑
    // 一律放到导出站 e2e（真实视口）里验，这里只验指针与点击类交互。

    // copy-code：点击后进入完成态并改文案
    await clickAt(frame, '#cp-btn')
    await sleep(300)
    const copyState = await frame.evaluate(() => ({
      done: document.getElementById('cp').classList.contains('ts-i-copy--done'),
      label: document.getElementById('cp-btn').textContent,
    }))
    assert.ok(copyState.done, `复制后应加 --done：${JSON.stringify(copyState)}`)
    assert.equal(copyState.label, '已复制', '按钮应换成已复制文案')

    // tilt-card：只对「精细指针且非减弱动效」的环境启用（headless CI 上 pointer:fine 为假）。
    // 支持则必须出现透视变换；不支持则必须环境确实不支持，不允许悄悄跳过。
    const tiltEnv = await frame.evaluate(() => ({
      armed: document.getElementById('tilt').classList.contains('ts-i-tilt--armed'),
      fine: window.matchMedia('(pointer: fine)').matches,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    }))
    if (tiltEnv.armed) {
      await frame.evaluate(() => {
        const el = document.getElementById('tilt')
        const r = el.getBoundingClientRect()
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width * 0.8, clientY: r.top + r.height * 0.2 }))
      })
      await sleep(150)
      const tiltTransform = await frame.evaluate(() => document.getElementById('tilt-inner').style.transform)
      assert.match(tiltTransform, /rotate[XY]\(/, `鼠标移动后应有倾斜：${tiltTransform}`)
    } else {
      assert.ok(
        !tiltEnv.fine || tiltEnv.reduced,
        `未武装 tilt-card，但环境支持精细指针且未减弱动效：${JSON.stringify(tiltEnv)}`,
      )
    }

    // scroll-reveal：运行时应武装元素（进视口后加 --visible；iframe 内元素默认已在视口）
    assert.ok(
      await frame.evaluate(() => document.getElementById('rv').classList.contains('ts-i-reveal--armed')),
      '运行时应武装 reveal 元素',
    )
    await sleep(400)
    assert.ok(
      await frame.evaluate(() => document.getElementById('rv').classList.contains('ts-i-reveal--visible')),
      '入视口后应加 --visible',
    )

    // toc-outline：点链接高亮 + 关合（滚动高亮在导出站验）
    await frame.evaluate(() => document.getElementById('toc-toggle').click())
    await sleep(200)
    assert.ok(
      await frame.evaluate(() => document.getElementById('toc').classList.contains('ts-i-toc--open')),
      '点 toggle 应展开目录',
    )
    await frame.evaluate(() => document.getElementById('toc-b').click())
    await sleep(200)
    // 点链接会锚点跳转并触发 scroll；iframe 内 scrollY 恒为 0，高亮会被滚动逻辑纠正，
    // 所以这里只验「点链接后闭合」，滚动高亮放到导出站（真实视口）验。
    assert.ok(
      !(await frame.evaluate(() => document.getElementById('toc').classList.contains('ts-i-toc--open'))),
      '点链接后应闭合（窄屏行为）',
    )

    // mobile-nav：窄屏开合由运行时维护
    await page.setViewport({ width: 500, height: 900 })
    await sleep(300)
    const mn = await frame.evaluate(() => {
      const nav = document.getElementById('mn')
      document.getElementById('mn-toggle').click()
      return nav.classList.contains('ts-i-mobile-nav--open')
    })
    assert.ok(mn, '窄屏点汉堡应展开菜单')
    assert.equal(
      await frame.evaluate(() => document.getElementById('mn-toggle').getAttribute('aria-expanded')),
      'true',
      'aria-expanded 应同步为 true',
    )

    console.log('OK 交互 e2e（画布侧）：原生默认行为 + tabs + modal + 指针/点击类交互全部通过')
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

    // 导出站是真实视口，滚动类交互在这里真滚真验。
    // scroll-progress：滚过阈值显形，圆环 offset 与百分比变化
    await page.evaluate(() => window.scrollTo(0, 600))
    await sleep(400)
    const spState = await page.evaluate(() => ({
      visible: document.getElementById('sp').classList.contains('ts-i-scroll-progress--visible'),
      offset: document.getElementById('sp-value').style.strokeDashoffset,
      label: document.getElementById('sp-label').textContent,
    }))
    assert.ok(spState.visible, `滚过阈值后进度环应显形：${JSON.stringify(spState)}`)
    assert.ok(/^\d+%$/.test(spState.label), `应更新百分比文案：${spState.label}`)
    assert.notEqual(parseFloat(spState.offset), 282.743, '圆环 offset 应随滚动变化')

    // sticky-header：滚过 scroll-threshold 加 --scrolled
    assert.ok(
      await page.evaluate(() => document.getElementById('sh').classList.contains('ts-i-sticky-header--scrolled')),
      '滚过阈值吸顶头部应加 --scrolled',
    )

    // toc-outline：滚到第二节则高亮切换
    await page.evaluate(() => window.scrollTo(0, document.getElementById('sec-2').offsetTop + 20))
    await sleep(400)
    const tocActive = await page.evaluate(() => ({
      a: document.getElementById('toc-a').classList.contains('ts-i-toc__link--active'),
      b: document.getElementById('toc-b').classList.contains('ts-i-toc__link--active'),
    }))
    assert.ok(tocActive.b && !tocActive.a, `滚到第二节应高亮第二节：${JSON.stringify(tocActive)}`)

    // 点进度环回顶
    await page.evaluate(() => document.getElementById('sp').click())
    await sleep(900)
    assert.ok(await page.evaluate(() => window.scrollY < 200), '点进度环应回到顶部')

    console.log('OK 导出 e2e：多页站 file:// 跳转 + tabs + modal + 滚动类交互全部通过')
  } finally {
    if (browser) await browser.close()
    rmSync(cwd, { recursive: true, force: true })
    rmSync(outDir, { recursive: true, force: true })
  }
})
