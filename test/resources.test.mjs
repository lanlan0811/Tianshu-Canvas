/**
 * 写入原型时提示会被画布 CSP 拦截的资源引用。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

const cwd = mkdtempSync(join(tmpdir(), 'tsc-res-'))
const upsert = (html) => tools.canvas_upsert_page.execute({ input: { html }, cwd })

try {
  const blocked = await upsert(`<!doctype html><html><head>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="./theme.css">
    <style>@import "https://fonts.example/a.css"; .a{background:url(images/bg.png)}</style>
    </head><body><img src='photo.jpg'></body></html>`)
  assert.ok(!blocked.isError, blocked.content)
  assert.match(blocked.content, /画布 CSP 会拦截/)
  for (const ref of ['https://cdn.tailwindcss.com', './theme.css', 'https://fonts.example/a.css', 'images/bg.png', 'photo.jpg']) {
    assert.ok(blocked.content.includes(ref), `应提示 ${ref}：${blocked.content}`)
  }

  const clean = await upsert(`<!doctype html><html><head><style>.a{background:url(data:image/png;base64,AAAA)}</style></head>
    <body><img src="data:image/png;base64,AAAA"><a href="https://example.com">外部链接不是资源</a><svg><use href="#icon"></use></svg></body></html>`)
  assert.ok(!clean.isError, clean.content)
  assert.doesNotMatch(clean.content, /画布 CSP 会拦截/)

  // 内联默认关闭：不传 inline_assets 时不做任何抓取（相对路径资源仍照常提示）。
  const notInlined = await upsert(`<img src="./photo.png">`)
  assert.ok(!notInlined.isError, notInlined.content)
  assert.doesNotMatch(notInlined.content, /资源内联/, '未显式开启时不应尝试内联')

  // 显式开启但没有 origin：相对路径保留原引用并说明原因（不触网）。
  const opened = await tools.canvas_upsert_page.execute({ input: { html: '<img src="./photo.png">', inline_assets: true }, cwd })
  assert.ok(!opened.isError, opened.content)
  assert.match(opened.content, /资源内联/)
  assert.match(opened.content, /未提供 origin/)

  console.log('OK 资源提示: 外链与相对路径会提示，内联内容与普通链接不提示；内联仅在显式开启时触发')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
