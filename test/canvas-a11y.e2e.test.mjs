/** 画布自身的键盘与可访问名验收；不以原型 a11y 审计代替外壳检查。 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'
import { resolveTestBrowser } from './helpers/browser.mjs'

const browserPath = resolveTestBrowser()
const root = resolve(import.meta.dirname, '..')

test('画布外壳：图标名称、可见焦点、导出键盘与重命名取消', { skip: !browserPath && '未找到浏览器' }, async () => {
  const { api, tools } = await loadPlugin(pathToFileURL(join(root, 'dist/index.mjs')).href)
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-shell-a11y-'))
  let browser
  try {
    const result = await tools.canvas_upsert_page.execute({ cwd, input: { id: 'page-a11y', title: '键盘页面', html: '<html><head></head><body><h1>键盘页面</h1></body></html>', device_type: 'mobile' } })
    assert.ok(!result.isError, result.content)
    const opened = await tools.canvas_open.execute({ cwd, input: { port: 0 } })
    const url = opened.content.split(String.fromCharCode(10)).find(line => line.startsWith('http://127.0.0.1:'))?.trim()
    assert.ok(url)
    browser = await (await import('puppeteer-core')).default.launch({ executablePath: browserPath, headless: true, args: ['--disable-gpu', '--disable-dev-shm-usage'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1600, height: 1000 })
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.page-node__header')
    assert.deepEqual(await page.$$eval('.zoom-controls__btn', buttons => buttons.map(button => button.getAttribute('aria-label'))), ['缩小', '放大', '适应视图'])

    // 使用真实 Tab，断言焦点不只存在于 DOM，而且能被看见。
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => {
      const target = document.activeElement
      const style = getComputedStyle(target)
      return target.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2
    }), true, 'Tab 焦点必须可见')

    await page.focus('.export-menu__trigger')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.export-menu__list')
    assert.equal(await page.$eval('.export-menu__trigger', button => button.getAttribute('aria-expanded')), 'true')
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement.closest('.export-menu__list') !== null), true)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.export-menu__list'))
    assert.equal(await page.evaluate(() => document.activeElement.matches('.export-menu__trigger')), true)
    assert.equal(await page.$eval('.export-menu__trigger', button => button.getAttribute('aria-expanded')), 'false')
    await page.keyboard.press('Space')
    await page.waitForSelector('.export-menu__list')
    await page.keyboard.press('Tab')
    await page.keyboard.down('Shift')
    await page.keyboard.press('Tab')
    await page.keyboard.up('Shift')
    assert.equal(await page.evaluate(() => document.activeElement.matches('.export-menu__trigger')), true, 'Shift+Tab 返回触发器')
    await page.keyboard.press('Escape')

    await page.click('.page-node__header')
    await page.waitForSelector('.node-toolbar')
    assert.deepEqual(await page.$$eval('.node-toolbar__btn', buttons => buttons.map(button => button.getAttribute('aria-label'))), ['重命名', '复制', '删除'])
    await page.focus('.node-toolbar__btn[title=重命名]')
    await page.keyboard.press('Enter')
    await page.waitForSelector('input[aria-label=页面名称]')
    assert.equal(await page.$eval('.node-toolbar__input', input => getComputedStyle(input).outlineStyle !== 'none'), true)
    await page.type('.node-toolbar__input', '不保存')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '重命名')
    assert.equal(await page.$eval('.page-node__title', element => element.textContent), '键盘页面')

    await page.keyboard.press('Enter')
    await page.waitForSelector('.node-toolbar__input')
    await page.focus('.node-toolbar__input')
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.type('.node-toolbar__input', '键盘已修改')
    assert.equal(await page.$eval('.node-toolbar__input', input => input.value), '键盘已修改')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.page-node__title')?.textContent === '键盘已修改', { timeout: 8000 }).catch(async error => {
      console.log('rename failure detail', await page.evaluate(() => ({ title: document.querySelector('.page-node__title')?.textContent, alert: document.querySelector('.app-error')?.textContent, input: document.querySelector('.node-toolbar__input')?.value })))
      throw error
    })
    await page.focus('.zoom-controls__btn[aria-label=放大]')
    const before = await page.$eval('.zoom-controls__value', element => element.textContent)
    await page.keyboard.press('Space')
    await page.waitForFunction(value => document.querySelector('.zoom-controls__value')?.textContent !== value, {}, before)
  } finally {
    if (browser) await browser.close()
    await api.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
})
