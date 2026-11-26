/**
 * 状态完整性审计 e2e：真实浏览器里按真页面验证采集与判定链路。
 * 证据边界：只验证我们自己的静态判定；权限三态与并发竞态不可静态判定，
 * 报告里必须出现在「未判定」中，不能被当成通过。
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
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-states-'))
  try {
    await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const added = await tools.canvas_upsert_page.execute({ input: { html, title: '状态页' }, cwd })
    assert.ok(!added.isError, added.content)
    const id = /id=([A-Za-z0-9_-]+)/.exec(added.content)?.[1]
    assert.ok(id, added.content)
    const report = await tools.canvas_audit.execute({ input: { action: 'states', page_id: id }, cwd })
    assert.ok(!report.isError, report.content)
    return report.content
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

test('空列表无提示：报 empty-list-no-hint，并列出权限/并发为未判定', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  const out = await audit('<!doctype html><html lang="zh-CN"><body><h1>列表</h1><ul class="items"></ul></body></html>')
  assert.match(out, /empty-list-no-hint/, out)
  assert.match(out, /权限三态/, out)
  assert.match(out, /并发竞态/, out)
})

test('空列表有 .ts-empty 与动作：不报空态，仍列出未判定项', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  const out = await audit('<!doctype html><html lang="zh-CN"><body><h1>列表</h1><ul class="items"></ul><div class="ts-empty"><p>还没有项目</p><a href="#new">新建</a></div></body></html>')
  assert.doesNotMatch(out, /empty-list-no-hint/, out)
  assert.doesNotMatch(out, /empty-hint-no-action/, out)
  assert.match(out, /未判定/, out)
})

test('加载态未播报与表单无防重复：各自命中', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  const out = await audit('<!doctype html><html lang="zh-CN"><body><h1>加载</h1><div aria-busy="true"><span class="spinner"></span></div><form><input aria-label="名称"><button type="submit">保存</button></form></body></html>')
  assert.match(out, /loading-unannounced/, out)
  assert.match(out, /submit-unguarded/, out)
})

test('有分页与防重复标记的页面：warning 0', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  const rows = Array.from({ length: 40 }, (_, i) => `<tr><td>项目 ${i + 1}</td></tr>`).join('')
  const out = await audit(`<!doctype html><html lang="zh-CN"><body><h1>表格</h1><div aria-busy="true" aria-label="正在加载"><p>正在加载…</p></div><table><tbody>${rows}</tbody></table><nav class="ts-i-pagination" data-ts-pagination aria-label="分页"><button>1</button></nav><form data-ts-form><input aria-label="名称"><button type="submit">保存</button></form></body></html>`)
  assert.match(out, /warning 0/, out)
})
