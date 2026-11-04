/**
 * 选中回传测试：写 selection.json 后 canvas_get_selection 能读出；无选中给友好文案。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)

const cwd = mkdtempSync(join(tmpdir(), 'tsc-sel-'))
try {
  // 无选中
  const none = await tools.canvas_get_selection.execute({ input: {}, cwd })
  assert.ok(!none.isError)
  assert.match(none.content, /没有选中项/)

  // 先放一个页面节点，便于展示页面标题
  const add = await tools.canvas_add_page.execute({ input: { html: '<h1>Hello</h1>', title: '登录页' }, cwd })
  assert.ok(!add.isError, add.content)
  const id = add.content.match(/id=([\w-]+)/)[1]

  // 写入选中（模拟画布前端 POST /api/selection 落盘）
  const dir = join(cwd, '.tianshu-canvas')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'selection.json'),
    JSON.stringify({
      pageId: id,
      kind: 'element',
      at: Date.now(),
      element: {
        xpath: '/html[1]/body[1]/h1[1]',
        tagName: 'h1',
        textContent: 'Hello',
        computedStyles: { color: 'rgb(0, 0, 0)', 'font-size': '32px' },
      },
    }),
  )

  const sel = await tools.canvas_get_selection.execute({ input: {}, cwd })
  assert.ok(!sel.isError)
  assert.match(sel.content, /登录页/)
  assert.match(sel.content, /<h1>/)
  assert.match(sel.content, /h1\[1\]/)
  assert.match(sel.content, /Hello/)
  assert.match(sel.content, /font-size: 32px/)

  console.log('OK 选中: 无选中友好提示 + 有选中能读出页面/元素/样式')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
