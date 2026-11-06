/**
 * 设计契约与漂移检测：结构化结果 + 可落盘测试文件 + 四类差集。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { api } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
const tool = (name) => api.tools.find((t) => t.name === name)

const CLEAN_PAGE = `<!doctype html><html><head><style>
:root { --x: 0; }
body { color: var(--ts-color-text-primary); background: var(--ts-color-bg-canvas); }
</style></head><body>
<div class="ts-app"><button class="ts-btn ts-btn--primary">新建</button></div>
</body></html>`

const DIRTY_PAGE = `<!doctype html><html><head><style>
body { color: #ff00aa; margin: 13px; font-family: Comic Sans MS, sans-serif; }
</style></head><body>
<div class="ts-app ts-made-up"><button class="ts-btn">按钮</button></div>
</body></html>`

async function workspace(styleId = 'apple') {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-audit-'))
  await tool('canvas_style').execute({ args: { action: 'set', style_id: styleId }, cwd, sessionId: 'test' })
  return cwd
}

async function upsert(cwd, html, title = '页面') {
  const res = await tool('canvas_upsert_page').execute({ args: { html, title, device_type: 'desktop' }, cwd, sessionId: 'test' })
  assert.equal(res.isError, undefined, res.content)
  const id = /id=([A-Za-z0-9_-]+)/.exec(res.content)?.[1]
  assert.ok(id, res.content)
  return id
}

async function test(name, fn) {
  try {
    await fn()
    console.log(`✔ ${name}`)
  } catch (err) {
    console.error(`✖ ${name}`)
    throw err
  }
}

await test('contract：合规页面 score=1，脏页面命中且 score<1', async () => {
  const cwd = await workspace()
  await upsert(cwd, CLEAN_PAGE)
  const clean = await tool('canvas_audit').execute({ args: { action: 'contract' }, cwd, sessionId: 'test' })
  assert.equal(clean.isError, undefined, clean.content)
  assert.match(clean.content, /符合度 100\.0%/)

  const cwd2 = await workspace()
  await upsert(cwd2, DIRTY_PAGE)
  const dirty = await tool('canvas_audit').execute({ args: { action: 'contract' }, cwd: cwd2, sessionId: 'test' })
  assert.match(dirty.content, /符合度 \d+\.\d+%/)
  assert.doesNotMatch(dirty.content, /符合度 100\.0%/)
  assert.match(dirty.content, /契约外类：ts-made-up/)
})

await test('contract：write_files 产出可独立运行的测试文件，且没有 ts- 变量时自洽', async () => {
  const cwd = await workspace()
  const id = await upsert(cwd, CLEAN_PAGE)
  const out = join(cwd, 'audit-out')
  const res = await tool('canvas_audit').execute({ args: { action: 'contract', write_files: true, out_dir: out }, cwd, sessionId: 'test' })
  assert.equal(res.isError, undefined, res.content)
  const files = [`${id}.html`, `${id}.audit.test.mjs`]
  for (const name of files) assert.ok(existsSync(join(out, name)), `缺少 ${name}`)
  const testFile = readFileSync(join(out, `${id}.audit.test.mjs`), 'utf8')
  assert.match(testFile, /EXPECTED_VARS/)
  assert.match(testFile, /不硬编码颜色/)
  // 独立文件不应依赖本插件。
  assert.doesNotMatch(testFile, /tianshu-canvas\/dist/)
})

await test('drift：首次写快照 → 无漂移；改页面后报新增/越界', async () => {
  const cwd = await workspace()
  const id = await upsert(cwd, CLEAN_PAGE)
  const first = await tool('canvas_audit').execute({ args: { action: 'drift' }, cwd, sessionId: 'test' })
  assert.equal(first.isError, undefined, first.content)
  assert.match(first.content, /已写入首个设计快照/)
  assert.ok(existsSync(join(cwd, '.tianshu-canvas/audit/snapshot.json')))

  const same = await tool('canvas_audit').execute({ args: { action: 'drift' }, cwd, sessionId: 'test' })
  assert.match(same.content, /未检测到漂移/)

  // 换风格 → 风格与 token 必须被检出；页面引用一个新变量 → 越界。
  await tool('canvas_upsert_page').execute({
    args: { id, html: CLEAN_PAGE.replace('ts-btn--primary', 'ts-btn--primary ts-made-up') },
    cwd,
    sessionId: 'test',
  })
  await tool('canvas_style').execute({ args: { action: 'set', style_id: 'nerv' }, cwd, sessionId: 'test' })
  const drifted = await tool('canvas_audit').execute({ args: { action: 'drift' }, cwd, sessionId: 'test' })
  assert.match(drifted.content, /风格：已更换/)
  assert.match(drifted.content, /token：已变/)
  assert.match(drifted.content, /越界 1 项/)
})

await test('drift：自由发挥时给出可读错误', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-audit-free-'))
  const res = await tool('canvas_audit').execute({ args: { action: 'drift' }, cwd, sessionId: 'test' })
  assert.equal(res.isError, true)
  assert.match(res.content, /需要已锁定的风格/)
})

await test('未知 action 返回可选清单', async () => {
  const cwd = await workspace()
  const res = await tool('canvas_audit').execute({ args: { action: 'nope' }, cwd, sessionId: 'test' })
  assert.equal(res.isError, true)
  assert.match(res.content, /contract \/ a11y \/ visual \/ baseline \/ drift/)
})

console.log('OK Design CI：契约、独立测试文件、漂移四类差集与错误分支全部通过')
