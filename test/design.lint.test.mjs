/**
 * 风格检查：真阳性必须报，真阴性不能误报（数据 URI、渐变、SVG 自绘、透明色等）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)

async function lint(html, styleId = 'claude') {
  const res = await tools.canvas_check_style.execute({ input: { html, style_id: styleId }, cwd: process.cwd() })
  assert.ok(!res.isError || res.content.length > 0)
  return res.content
}

test('风格检查：真阳性全部命中', async () => {
  const html =
    '<!doctype html><html><head><style>' +
    '.a{background:#f4f4f5;font-family:Inter,sans-serif;padding:13px;border-radius:7px}' +
    '.b{color:rgb(0,0,0);margin:var(--ts-nope)}' +
    '</style></head><body>' +
    '<svg data-icon="rocket" class="ts-icon"></svg>' +
    '<div class="ts-btns"></div>' +
    '</body></html>'
  const out = await lint(html)
  assert.match(out, /\[color\]/, out)
  assert.match(out, /\[font\]/, out)
  assert.match(out, /\[spacing\]/, out)
  assert.match(out, /\[radius\]/, out)
  assert.match(out, /\[icon\].*rocket/, out)
  assert.match(out, /\[component\].*ts-btns/, out)
  assert.match(out, /\[token\].*--ts-nope/, out)
  assert.match(out, /仅报告，未修改文件/)
})

test('风格检查：真阴性不误报', async () => {
  const html =
    '<!doctype html><html><head><style>' +
    '.a{background:transparent;color:currentColor;border:1px solid var(--ts-color-border-default)}' +
    '.b{background-image:url("data:image/svg+xml,%3Csvg%20fill=%22%23fff%22%3E%3C/svg%3E")}' +
    '.c{background:linear-gradient(90deg,var(--ts-color-action-primary),var(--ts-color-bg-surface))}' +
    '.d{box-shadow:var(--ts-shadow-md);border-radius:50%;padding:0 auto}' +
    '.e{margin:calc(var(--ts-space-2) * 2);font-family:inherit}' +
    '</style></head><body>' +
    '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="currentColor"></path></svg>' +
    '<svg data-icon="search" class="ts-icon"></svg>' +
    '<div class="my-layout another-class"></div>' +
    '</body></html>'
  const out = await lint(html)
  assert.match(out, /未发现不符合项/, out)
})

test('风格检查：注入块自身不被误报', async () => {
  const set = await tools.canvas_style.execute({ input: { action: 'set', style_id: 'claude' }, cwd: process.cwd() })
  assert.ok(!set.isError, set.content)
  const html = '<p style="color:var(--ts-color-text-primary)">正文</p>'
  const check = await tools.canvas_check_style.execute({ input: { html }, cwd: process.cwd() })
  assert.match(check.content, /未发现不符合项/, check.content)
})

test('风格检查：自由发挥只查资源引用', async () => {
  const free = mkdtempSync(join(tmpdir(), 'tsc-lint-free-'))
  try {
    const res = await tools.canvas_check_style.execute({
      input: { html: '<link rel="stylesheet" href="https://cdn.example.com/a.css"><p style="color:#fff">x</p>' },
      cwd: free,
    })
    assert.match(res.content, /未锁定风格/)
    assert.match(res.content, /\[resource\]/)
    assert.doesNotMatch(res.content, /\[color\]/)
  } finally {
    rmSync(free, { recursive: true, force: true })
  }
})

test('风格检查：page_id 不存在时报错，检查结果永不 isError', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-lint-page-'))
  try {
    const missing = await tools.canvas_check_style.execute({ input: { page_id: 'page-deadbeef' }, cwd })
    assert.equal(missing.isError, true)

    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })
    await tools.canvas_upsert_page.execute({ input: { html: '<p style="padding:13px">x</p>', title: 'P' }, cwd })
    const all = await tools.canvas_check_style.execute({ input: {}, cwd })
    assert.ok(!all.isError, all.content)
    assert.match(all.content, /\[spacing\]/, all.content)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
