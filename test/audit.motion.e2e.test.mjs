/**
 * 动效抓帧的端到端测试（需要 Chrome/Edge，无则跳过）。
 *
 * 只验证产物齐全与协议正确：帧序列、filmstrip、查看器、report.json、
 * 以及 reduced 采集确实在减少动效模式下跑过一次。不判决动效好坏。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { resolveTestBrowser } from './helpers/browser.mjs'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const browserPath = resolveTestBrowser()

const PAGE = `<!doctype html><html lang="zh-CN"><head><style>
body{margin:0;background:#fff;color:#111;font-family:system-ui;padding:24px}
#panel{width:320px;height:180px;background:#e5e7eb;border-radius:12px;transform:translateY(-200px);transition:transform 400ms cubic-bezier(.16,1,.3,1)}
#panel.open{transform:translateY(0)}
button{font-size:16px;padding:8px 16px}
@media (prefers-reduced-motion: reduce){#panel{transition-duration:0.01ms}}
</style></head><body>
<button id="open" type="button">打开面板</button>
<div id="panel"></div>
<script>document.getElementById('open').addEventListener('click',()=>document.getElementById('panel').classList.add('open'))</script>
</body></html>`

async function withPlugin(fn) {
  const { api, tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-motion-e2e-'))
  try {
    return await fn({ api, tools, cwd })
  } finally {
    await api.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
}

test('motion：抓帧产出帧序列、filmstrip、查看器与报告', { skip: !browserPath && '未找到浏览器', timeout: 180000 }, async () => {
  await withPlugin(async ({ tools, cwd }) => {
    await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const added = await tools.canvas_upsert_page.execute({ input: { html: PAGE, title: '动效页' }, cwd })
    assert.ok(!added.isError, added.content)
    const pageId = /id=([A-Za-z0-9_-]+)/.exec(added.content)?.[1]
    assert.ok(pageId, added.content)

    const res = await tools.canvas_audit.execute({
      input: { action: 'motion', page_id: pageId, motion_selector: '#open', motion_region: '#panel', motion_frames: 5, motion_window_ms: 500 },
      cwd,
    })
    assert.ok(!res.isError, res.content)
    assert.match(res.content, /动效抓帧审计/)
    assert.match(res.content, /未测项/)

    const filmstrip = /filmstrip：(.+)/.exec(res.content)?.[1]?.trim()
    assert.ok(filmstrip && existsSync(filmstrip), `filmstrip 未生成：${filmstrip}`)
    const viewer = /拖帧查看：(.+)/.exec(res.content)?.[1]?.trim()
    assert.ok(viewer && existsSync(viewer), `查看器未生成：${viewer}`)

    const dir = join(filmstrip, '..')
    for (let i = 0; i < 5; i++) {
      assert.equal(existsSync(join(dir, `frame-${String(i).padStart(2, '0')}.png`)), true, `缺帧 ${i}`)
    }
    const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'))
    assert.equal(report.label, 'normal')
    assert.equal(report.frames.length, 5)
    assert.ok(Array.isArray(report.limitations) && report.limitations.length >= 4)

    // reduced 目录必须同时存在
    const reducedDir = join(dir, '..', 'reduced')
    assert.equal(existsSync(join(reducedDir, 'report.json')), true, '缺少 reduced 采集')
    const reduced = JSON.parse(readFileSync(join(reducedDir, 'report.json'), 'utf8'))
    assert.equal(reduced.label, 'reduced')

    // summary.json 必须包含两次采集与发现
    const summary = JSON.parse(readFileSync(join(dir, '..', 'summary.json'), 'utf8'))
    assert.equal(summary.selector, '#open')
    assert.ok(Array.isArray(summary.findings))
  })
})

test('motion：缺 motion_selector 时给出可执行提示', { timeout: 60000 }, async () => {
  await withPlugin(async ({ tools, cwd }) => {
    await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const added = await tools.canvas_upsert_page.execute({ input: { html: PAGE, title: '动效页' }, cwd })
    const pageId = /id=([A-Za-z0-9_-]+)/.exec(added.content)?.[1]
    const res = await tools.canvas_audit.execute({ input: { action: 'motion', page_id: pageId }, cwd })
    assert.equal(res.isError, true)
    assert.match(res.content, /motion_selector/)
  })
})

test('motion：找不到选择器时报错而不是产出空报告', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  await withPlugin(async ({ tools, cwd }) => {
    await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const added = await tools.canvas_upsert_page.execute({ input: { html: PAGE, title: '动效页' }, cwd })
    const pageId = /id=([A-Za-z0-9_-]+)/.exec(added.content)?.[1]
    const res = await tools.canvas_audit.execute({ input: { action: 'motion', page_id: pageId, motion_selector: '#does-not-exist' }, cwd })
    assert.equal(res.isError, true)
    assert.match(res.content, /找不到动效触发选择器/)
  })
})
