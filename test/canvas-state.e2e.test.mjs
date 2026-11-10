/**
 * 端到端（真实浏览器）：平移和项目刷新不丢选中，视口能恢复。
 *
 * 普通本机无浏览器可跳过；CI / 正式验收缺少浏览器必须失败。
 */
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('画布状态回归', { skip: !browserPath && '未找到浏览器' }, async () => {
  const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const puppeteer = (await import('puppeteer-core')).default
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-state-'))
  let browser
  try {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)[0]
    const { origin, searchParams } = new URL(url)
    const ws = searchParams.get('ws')
    const added = await tools.canvas_upsert_page.execute({
      input: { html: '<!doctype html><html><head></head><body><h1>页面</h1></body></html>', title: '原标题', device_type: 'mobile' },
      cwd,
    })
    const id = added.content.match(/id=([\w-]+)/)[1]
    const savedViewport = () => JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8')).viewport

    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1600, height: 1000 })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForSelector('.page-node__header', { timeout: 15000 })
    await sleep(1200)

    // 1) 初次适应视图不算用户操作，不能写进项目文件
    assert.deepEqual(savedViewport(), { x: 0, y: 0, zoom: 1 })

    const state = () =>
      page.evaluate(() => ({
        selected: document.querySelectorAll('.page-node--selected').length,
        toolbar: document.querySelectorAll('.node-toolbar').length,
        title: document.querySelector('.page-node__title')?.textContent,
        transform: document.querySelector('.react-flow__viewport')?.style.transform,
      }))
    async function wheelAt(x, y) {
      await page.mouse.move(x, y)
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel({ deltaX: 0, deltaY: 40 })
        await sleep(30)
      }
    }

    // 2) 选中节点后连续滚轮平移：视口已保存，选中仍在
    const box = await (await page.$('.page-node__header')).boundingBox()
    await page.mouse.click(box.x + 40, box.y + box.height / 2)
    await sleep(300)
    assert.equal((await state()).selected, 1, '点击后应选中')
    await wheelAt(box.x + 40, box.y + box.height / 2)
    await sleep(1500)
    let now = await state()
    assert.equal(now.selected, 1, '平移后不应丢选中')
    assert.equal(now.toolbar, 1, '平移后工具栏应保留')
    assert.notEqual(savedViewport().y, 0, '平移后视口应保存')

    // 3) 项目刷新（AI 改标题）：内容更新，选中保留
    await tools.canvas_upsert_page.execute({ input: { id, title: '新标题' }, cwd })
    await sleep(800)
    now = await state()
    assert.equal(now.title, '新标题', '项目刷新应更新内容')
    assert.equal(now.selected, 1, '项目刷新不应丢选中')

    // 4) 刷新页面：回到上次的视口，而不是重新适应
    const before = now.transform
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.page-node__header', { timeout: 15000 })
    await sleep(1000)
    assert.equal((await state()).transform, before, '应恢复保存的视口')

    // 5) 鼠标在 iframe 上滚动（探针转发）：视口同样会保存
    const frameBox = await (await page.$('.page-node__iframe')).boundingBox()
    const savedBefore = savedViewport().y
    await wheelAt(frameBox.x + 50, Math.max(frameBox.y + 50, 200))
    await sleep(1000)
    assert.notEqual(savedViewport().y, savedBefore, 'iframe 上的滚动也应保存')

    // 6) 保存的视口看不到任何节点时：回退到适应视图，避免打开是一片空白
    const res = await fetch(`${origin}/api/viewport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
      body: JSON.stringify({ ws, x: 100000, y: 100000, zoom: 1 }),
    })
    assert.equal(res.status, 200)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.page-node__header', { timeout: 15000 })
    await sleep(1000)
    const rect = await page.$eval('.page-node', (e) => {
      const r = e.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    })
    assert.ok(rect.left < 1600 && rect.right > 0 && rect.top < 1000 && rect.bottom > 0, `节点应可见：${JSON.stringify(rect)}`)

    console.log('OK 画布状态 e2e: 平移与项目刷新不丢选中、视口恢复')
  } finally {
    if (browser) await browser.close().catch(() => {})
    rmSync(cwd, { recursive: true, force: true })
  }
})
