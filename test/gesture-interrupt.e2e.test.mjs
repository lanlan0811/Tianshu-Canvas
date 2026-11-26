/**
 * 中断手势 e2e：合成 PointerEvent 验证处理器逻辑。
 *
 * 证据边界（写在这里以免误读）：这里用 page.evaluate 合成 PointerEvent，
 * 验证的是我们自己的处理器对 pointercancel / 第二指针 / 失焦的响应，
 * **不是**浏览器的原生手势仲裁（touch-action、滚动接管、指针捕获的内核行为）。
 * 真机与多浏览器差异仍是未测项。
 *
 * 环境确定性：tilt-card 按设计只在 (pointer: fine) 下武装。headless Linux CI
 * 没有精细指针，处理器不会绑定，断言必然失败；Windows headless 又为真，
 * 直接依赖宿主会得到随平台翻转的结果。页内因此只把 (pointer: fine) 回答为真
 * 以模拟桌面指针设备，其余媒体查询走原生实现；「无精细指针时不武装」由
 * interaction.e2e 按真实环境能力验证。
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

/** 页面只保留倾斜卡片，避免其它交互干扰。 */
const PAGE = `<!doctype html><html lang="zh-CN"><head>
<script>
/* 合成 PointerEvent 需要处理器真实绑定；tilt-card 只在精细指针下绑定。
   内联脚本在文档解析期执行，先于注入的 defer 运行时，因此在这里把
   (pointer: fine) 固定回答为真，模拟桌面指针设备。 */
(function () {
  var native = window.matchMedia.bind(window)
  window.matchMedia = function (query) {
    return query === '(pointer: fine)'
      ? { matches: true, media: query, onchange: null, addEventListener: function () {}, removeEventListener: function () {}, addListener: function () {}, removeListener: function () {}, dispatchEvent: function () { return false; } }
      : native(query)
  }
})()
</script>
<style>
body{margin:0;background:#fff;padding:40px;font-family:system-ui}
.ts-i-tilt{width:320px;height:200px;perspective:1000px}
.ts-i-tilt__inner{width:100%;height:100%;background:#e5e7eb;border-radius:12px;transform-style:preserve-3d;transition:transform 120ms}
</style></head><body>
<div class="ts-i-tilt" id="tilt" data-ts-tilt="12"><div class="ts-i-tilt__inner" id="inner">卡片</div></div>
</body></html>`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 打开画布并返回页面 iframe（与 interaction.e2e 同一路径，确保走真实注入）。 */
async function withFrame(fn) {
  const { api, tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-gesture-'))
  const puppeteer = (await import('puppeteer-core')).default
  let browser
  try {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)?.[0]
    assert.ok(url, open.content)
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })
    const added = await tools.canvas_upsert_page.execute({ input: { html: PAGE, title: '手势页' }, cwd })
    const pageId = /id=([\w-]+)/.exec(added.content)?.[1]
    assert.ok(pageId, added.content)

    browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1400, height: 900 })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForSelector('.page-node__iframe', { timeout: 15000 })
    await sleep(800)
    const frame = page.frames().find((f) => f.url().includes(pageId))
    assert.ok(frame, '应找到页面 iframe')
    return await fn({ frame })
  } finally {
    if (browser) await browser.close().catch(() => {})
    await api.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
}

/** 在页内合成一次拖拽序列；返回每步之后的 transform。 */
const SCRIPT = `(async (steps) => {
  const root = document.getElementById('tilt')
  const inner = document.getElementById('inner')
  const rect = root.getBoundingClientRect()
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const fire = (type, id, x, y) => root.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
    clientX: rect.left + x, clientY: rect.top + y,
  }))
  const out = {}
  for (const step of steps) {
    if (step.kind === 'down') fire('pointerdown', step.id, step.x, step.y)
    else if (step.kind === 'move') fire('pointermove', step.id, step.x, step.y)
    else if (step.kind === 'up') fire('pointerup', step.id, step.x, step.y)
    else if (step.kind === 'cancel') fire('pointercancel', step.id, step.x, step.y)
    else if (step.kind === 'blur') window.dispatchEvent(new Event('blur'))
    await sleep(60)
    out[step.label] = inner.style.transform
  }
  return out
})`

test('手势中断：取消后复位，第二次拖拽仍生效，第二指针不夺取', { skip: !browserPath && '未找到浏览器', timeout: 180000 }, async () => {
  await withFrame(async ({ frame }) => {
    const steps = [
      { kind: 'move', id: 1, x: 200, y: 60, label: 'first-move' },
      { kind: 'move', id: 2, x: 20, y: 180, label: 'second-pointer-move' },
      { kind: 'cancel', id: 1, x: 200, y: 60, label: 'after-cancel' },
      { kind: 'move', id: 1, x: 260, y: 40, label: 'second-drag' },
      { kind: 'blur', label: 'after-blur' },
    ]
    const result = await frame.evaluate(`${SCRIPT}(${JSON.stringify(steps)})`)
    // 第一指针产生倾斜
    assert.match(result['first-move'] ?? '', /rotate[XY]\(/, `首次移动应产生倾斜：${JSON.stringify(result)}`)
    // 第二指针不夺取：transform 保持第一指针的结果（不被 20,180 覆盖）
    assert.equal(result['second-pointer-move'], result['first-move'], '第二个指针不应夺取第一个拖拽')
    // 取消后复位
    assert.equal(result['after-cancel'], '', `pointercancel 后必须复位：${result['after-cancel']}`)
    // 取消之后第二次拖拽仍然生效（无需刷新）
    assert.match(result['second-drag'] ?? '', /rotate[XY]\(/, `取消后第二次拖拽应生效：${result['second-drag']}`)
    // 失焦复位
    assert.equal(result['after-blur'], '', `窗口失焦后必须复位：${result['after-blur']}`)
  })
})

test('手势中断：lostpointercapture 也会复位', { skip: !browserPath && '未找到浏览器', timeout: 180000 }, async () => {
  await withFrame(async ({ frame }) => {
    const result = await frame.evaluate(`(async () => {
      const root = document.getElementById('tilt')
      const inner = document.getElementById('inner')
      const rect = root.getBoundingClientRect()
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const fire = (type, id, x, y) => root.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: id, pointerType: 'pen',
        clientX: rect.left + x, clientY: rect.top + y,
      }))
      fire('pointerdown', 7, 200, 60)
      fire('pointermove', 7, 260, 40)
      await sleep(60)
      const tilted = inner.style.transform
      root.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 7 }))
      await sleep(60)
      return { tilted, after: inner.style.transform }
    })()`)
    assert.match(result.tilted, /rotate[XY]\(/, `拖拽中应有倾斜：${JSON.stringify(result)}`)
    assert.equal(result.after, '', `丢失指针捕获后必须复位：${result.after}`)
  })
})
