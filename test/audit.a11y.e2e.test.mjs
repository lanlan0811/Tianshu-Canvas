/**
 * a11y 对比度必须覆盖普通正文（p/span/div），而不只是按钮、链接与标题。
 * 审核反馈：1.6:1 的正文在旧实现里完全不会产生 contrast 条目。
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
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

async function audit(html) {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-a11y-contrast-'))
  try {
    await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const added = await tools.canvas_upsert_page.execute({ input: { html, title: '对比度页' }, cwd })
    assert.ok(!added.isError, added.content)
    const id = /id=([A-Za-z0-9_-]+)/.exec(added.content)?.[1]
    assert.ok(id, added.content)
    const report = await tools.canvas_audit.execute({ input: { action: 'a11y', page_id: id }, cwd })
    assert.ok(!report.isError, report.content)
    return report.content
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

test('对比度：普通正文 1.6:1 必须报 contrast', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  const out = await audit('<!doctype html><html lang="zh-CN"><head><style>body{margin:0;background:#fff}.low{color:#bbb;font-size:16px}</style></head><body><h1>标题</h1><p class="low">这是一段只有 1.6 比一的正文</p></body></html>')
  assert.match(out, /contrast/, out)
  assert.match(out, /对比度 1\.\d+ 低于 4\.5/, out)
})

test('对比度：正常正文不误报', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  const out = await audit('<!doctype html><html lang="zh-CN"><head><style>body{margin:0;background:#fff;color:#111}</style></head><body><h1>标题</h1><p>这是一段正常对比度的正文</p></body></html>')
  assert.doesNotMatch(out, /\[error\] contrast/, out)
})

test('对比度：渐变背景跳过并写明原因', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  const out = await audit('<!doctype html><html lang="zh-CN"><head><style>body{margin:0}.grad{background:linear-gradient(#fff,#eee);color:#ccc}</style></head><body><h1>标题</h1><p class="grad">渐变上的正文</p></body></html>')
  assert.doesNotMatch(out, /\[error\] contrast/, out)
  assert.match(out, /跳过对比度/, out)
})
