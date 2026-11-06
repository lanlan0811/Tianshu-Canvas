/**
 * 回归：切换风格后图标属性正确、注入可逆且幂等、不破坏脚本、不插到 doctype 之前。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const entry = pathToFileURL(join(root, 'dist', 'index.mjs')).href
const { tools } = await loadPlugin(entry)

const strokeOf = (styleId) =>
  JSON.parse(readFileSync(join(root, 'dist', 'design', 'styles', styleId, 'icons.json'), 'utf8')).stroke

async function withProject(fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ds-icons-'))
  const run = (name, input) => tools[name].execute({ input, cwd })
  const upsert = async (html) => {
    const added = await run('canvas_upsert_page', { html, title: 'P' })
    assert.ok(!added.isError, added.content)
    return { id: added.content.match(/id=([\w-]+)/)[1], content: added.content }
  }
  const page = (id) => readFileSync(join(cwd, '.tianshu-canvas', 'pages', `${id}.html`), 'utf8')
  try {
    await fn({ run, upsert, page })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

const iconPage =
  '<!doctype html><html><head>\n  <meta charset="utf-8">\n</head><body>' +
  '<svg data-icon="search" class="ts-icon"></svg></body></html>'
const iconTag = (html) => html.match(/<svg\b[^>]*>/)[0]

test('切换风格：图标只保留当前风格的描边属性', async () => {
  await withProject(async ({ run, upsert, page }) => {
    await run('canvas_style', { action: 'set', style_id: 'apple' })
    const { id } = await upsert(iconPage)
    for (const styleId of ['google', 'claude', 'tianshu-original', 'apple']) {
      await run('canvas_style', { action: 'set', style_id: styleId })
      const tag = iconTag(page(id))
      const widths = [...tag.matchAll(/stroke-width="([^"]+)"/g)].map((m) => m[1])
      assert.deepEqual(widths, [String(strokeOf(styleId).strokeWidth)], `${styleId}: ${tag}`)
      for (const attr of ['fill', 'stroke', 'viewBox', 'stroke-linecap', 'stroke-linejoin']) {
        assert.equal(tag.match(new RegExp(`\\s${attr}=`, 'g'))?.length, 1, `${styleId} 的 ${attr} 应只有一个：${tag}`)
      }
    }
  })
})

test('注入幂等：重设同一风格不改写页面，切走再切回字节一致', async () => {
  await withProject(async ({ run, upsert, page }) => {
    await run('canvas_style', { action: 'set', style_id: 'apple' })
    const { id } = await upsert(iconPage)
    const first = page(id)

    const again = await run('canvas_style', { action: 'set', style_id: 'apple' })
    assert.match(again.content, /重写 0 个页面/)
    assert.equal(page(id), first)

    await run('canvas_style', { action: 'set', style_id: 'google' })
    assert.notEqual(page(id), first)
    await run('canvas_style', { action: 'set', style_id: 'apple' })
    assert.equal(page(id), first, '切回原风格应与首次注入完全一致')

    const { id: second } = await upsert(first)
    assert.equal(page(second), first, '把已注入的页面再次写入不应变化')
  })
})

test('注入块可逆：解除锁定后重新写入能还原原始字节', async () => {
  await withProject(async ({ run, upsert, page }) => {
    await run('canvas_style', { action: 'set', style_id: 'claude' })
    const source = '<!doctype html><html><head>\n  <title>T</title>\n</head><body><p>x</p></body></html>'
    const { id } = await upsert(source)
    const injected = page(id)
    await run('canvas_style', { action: 'set', style_id: 'free' })
    const { id: restored } = await upsert(injected)
    assert.equal(page(restored), source)
  })
})

test('展开图标：脚本、样式和注释保持原样，并提示脚本里的图标', async () => {
  await withProject(async ({ run, upsert, page }) => {
    await run('canvas_style', { action: 'set', style_id: 'apple' })
    const script = `<script>el.innerHTML = "<svg data-icon='search'></svg>";</script>`
    const style = `<style>.a{background:url("data:image/svg+xml,<svg data-icon='bell'/>")}</style>`
    const comment = '<!-- <svg data-icon="home"></svg> -->'
    const plainSvg = '<svg viewBox="0 0 1 1"/>'
    const stat = '<svg data-icon="bell" class="ts-icon"></svg>'
    const { id, content } = await upsert(
      `<!doctype html><html><head></head><body>${comment}${plainSvg}${stat}<div id="el"></div>${style}${script}</body></html>`,
    )
    const saved = page(id)
    assert.ok(saved.includes(script), '脚本不应被改动')
    assert.ok(saved.includes(style), '样式不应被改动')
    assert.ok(saved.includes(comment), '注释不应被改动')
    assert.ok(saved.includes(plainSvg), '非图标 svg 不应被改写')
    assert.match(saved, /<svg data-icon="bell" class="ts-icon" viewBox="0 0 24 24" fill="none"/, '静态图标仍应展开')
    assert.match(content, /脚本里的图标不会展开：search/)
    assert.doesNotMatch(content, /不在目录中/)
  })
})

test('用户写在图标上的描边属性由当前风格接管', async () => {
  await withProject(async ({ run, upsert, page }) => {
    await run('canvas_style', { action: 'set', style_id: 'google' })
    const { id } = await upsert(
      `<!doctype html><html><head></head><body><svg data-icon="search" stroke='red' fill=blue data-fill="keep"></svg></body></html>`,
    )
    const tag = iconTag(page(id))
    assert.doesNotMatch(tag, /red|blue/)
    assert.match(tag, /data-fill="keep"/, '只接管描边属性，其它属性保留')
  })
})

test('没有 html/head 标签的页面：样式块和探针都在 doctype 之后', async () => {
  await withProject(async ({ run, upsert, page }) => {
    await run('canvas_style', { action: 'set', style_id: 'apple' })
    const { id } = await upsert('<!-- 注释 -->\n<!doctype html><h1>片段</h1>')
    const saved = page(id)
    assert.ok(saved.toLowerCase().indexOf('<!doctype') < saved.indexOf('<style'), '样式块不应早于 doctype')

    const open = await run('canvas_open', { port: 0 })
    const url = new URL(open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]{16}/)[0])
    const served = await (await fetch(`${url.origin}/page/${id}?ws=${url.searchParams.get('ws')}`)).text()
    assert.ok(served.toLowerCase().indexOf('<!doctype') < served.indexOf('<script'), '探针不应早于 doctype')

    const { resolveBrowser } = await import(entry)
    const browserPath = resolveBrowser()
    if (!browserPath) return
    const puppeteer = (await import('puppeteer-core')).default
    const browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    })
    try {
      const tab = await browser.newPage()
      await tab.setContent(served)
      assert.equal(await tab.evaluate(() => document.compatMode), 'CSS1Compat')
    } finally {
      await browser.close().catch(() => {})
    }
  })
})
