/**
 * 渲染工艺审计的真实浏览器端到端（需要 Chrome/Edge，无则跳过）。
 *
 * 每个用例结束都要 dispose 插件（关掉本地服务），否则后续用例会争用端口与服务单例。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { resolveTestBrowser } from './helpers/browser.mjs'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const browserPath = resolveTestBrowser()

async function withPlugin(fn) {
  const { api, tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-quality-e2e-'))
  try {
    return await fn({ api, tools, cwd })
  } finally {
    await api.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
}

async function auditQuality(html) {
  return withPlugin(async ({ tools, cwd }) => {
    await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const added = await tools.canvas_upsert_page.execute({ input: { html, title: '工艺页' }, cwd })
    assert.ok(!added.isError, added.content)
    const id = /id=([A-Za-z0-9_-]+)/.exec(added.content)?.[1]
    assert.ok(id, added.content)
    const report = await tools.canvas_audit.execute({ input: { action: 'quality', page_id: id }, cwd })
    assert.ok(!report.isError, report.content)
    return report.content
  })
}

test('quality：11px 正文必须报 tiny-text', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  const out = await auditQuality(
    '<!doctype html><html lang="zh-CN"><head><style>body{margin:0;background:#fff;color:#111}.tiny{font-size:11px;line-height:1.6}</style></head><body><h1>标题</h1><p class="tiny">这是一段只有十一像素的正文，用来验证字号下限规则是否会命中。</p></body></html>',
  )
  assert.match(out, /tiny-text/, out)
  assert.match(out, /低于 12px 下限/, out)
})

test('quality：正常排版不误报 tiny-text / tight-leading', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  const out = await auditQuality(
    '<!doctype html><html lang="zh-CN"><head><style>body{margin:0;background:#fff;color:#111;font-size:16px;line-height:1.6}h1{font-size:32px;margin-bottom:12px}</style></head><body><h1>标题</h1><p>这是一段正常排版的正文，行高与字号都在合理范围内，不应触发任何工艺规则。</p></body></html>',
  )
  assert.doesNotMatch(out, /- \[warning\] tiny-text/, out)
  assert.doesNotMatch(out, /- \[warning\] tight-leading/, out)
})

test('quality：报告必须写明扫描元素数与跳过项', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  const out = await auditQuality(
    '<!doctype html><html lang="zh-CN"><head><style>body{margin:0;background:#fff;color:#111;font-size:16px;line-height:1.6}</style></head><body><h1>标题</h1><p>正文内容。</p></body></html>',
  )
  assert.match(out, /渲染工艺审计：/s, out)
  assert.match(out, /扫描 \d+ 个文字元素/, out)
})

test('quality：无浏览器时给出明确错误而不是假通过', { skip: Boolean(browserPath) && '本机有浏览器，跳过无浏览器分支', timeout: 60000 }, async () => {
  const out = await withPlugin(async ({ tools, cwd }) => {
    await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const added = await tools.canvas_upsert_page.execute({ input: { html: '<h1>标题</h1>', title: '页' }, cwd })
    const id = /id=([A-Za-z0-9_-]+)/.exec(added.content)?.[1]
    const report = await tools.canvas_audit.execute({ input: { action: 'quality', page_id: id }, cwd })
    assert.equal(report.isError, true)
    return report.content
  })
  assert.match(out, /未找到 Chrome\/Edge/)
})
