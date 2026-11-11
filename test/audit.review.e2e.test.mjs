import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { resolveTestBrowser } from './helpers/browser.mjs'

const root = resolve(import.meta.dirname, '..')
const browserPath = resolveTestBrowser()
const apiDir = mkdtempSync(join(tmpdir(), 'tsc-review-api-'))
await build({
  stdin: { contents: "export { reviewPage, formatReviewReport } from './src/audit/review.ts'; export { writePageHtml, upsertNode } from './src/project.ts'; export { ensureServer, shutdownForTests } from './src/server.ts'; export { decodePng } from './src/audit/png.ts';", resolveDir: root },
  outfile: join(apiDir, 'api.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24',
  banner: { js: "import { createRequire as __reviewCreateRequire } from 'node:module'; const require = __reviewCreateRequire(import.meta.url);" },
  logLevel: 'silent',
})
cpSync(join(root, 'dist', 'web'), join(apiDir, 'web'), { recursive: true })
const api = await import(pathToFileURL(join(apiDir, 'api.mjs')).href)
test.after(async () => { await api.shutdownForTests(); rmSync(apiDir, { recursive: true, force: true }) })

function addPage(cwd, id, html) {
  const htmlPath = api.writePageHtml(cwd, id, html)
  api.upsertNode(cwd, { id, type: 'page', title: '审阅测试', x: 0, y: 0, width: 970, height: 620, deviceType: 'desktop', htmlPath, createdAt: Date.now(), updatedAt: Date.now() })
}

test('review rejects invalid/missing page and outside directory before browser launch or output', async () => {
  const base = mkdtempSync(join(tmpdir(), 'tsc-review-input-'))
  try {
    const cwd = join(base, 'workspace'); mkdirSync(cwd)
    addPage(cwd, 'one', '<h1>test</h1>')
    await assert.rejects(api.reviewPage(cwd, '../outside'), /invalid page id/)
    await assert.rejects(api.reviewPage(cwd, 'missing'), /页面不存在/)
    await assert.rejects(api.reviewPage(cwd, 'one', { outputDir: '../outside' }), /工作区/)
    await assert.rejects(api.reviewPage(cwd, 'one', { outputDir: '' }), /非空/)
    assert.equal(existsSync(join(base, 'outside')), false)
    assert.equal(existsSync(join(cwd, '.tianshu-canvas', 'audit')), false)
  } finally { rmSync(base, { recursive: true, force: true }) }
})

test('review refuses output junction and does not write through it', async () => {
  const base = mkdtempSync(join(tmpdir(), 'tsc-review-junction-'))
  try {
    const cwd = join(base, 'workspace'); const outside = join(base, 'outside')
    mkdirSync(cwd); mkdirSync(outside)
    addPage(cwd, 'one', '<h1>test</h1>')
    // Windows directory junctions require no developer-mode file symlink permission.
    symlinkSync(outside, join(cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(api.reviewPage(cwd, 'one', { outputDir: 'linked/review' }), /工作区|符号链接/)
    assert.deepEqual(readdirSync(outside), [])
  } finally { rmSync(base, { recursive: true, force: true }) }
})

test('review renders authenticated opaque iframe at all widths, captures full content and preserves page/project', { skip: !browserPath && '未找到浏览器', timeout: 180000 }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-review-render-'))
  try {
    addPage(cwd, 'one', '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0}main{padding:24px;min-height:1800px}h1{font:700 32px sans-serif}.clipped{width:80px;overflow:hidden;white-space:nowrap}button{padding:12px}@media(max-width:500px){h1{font-size:24px}}</style></head><body><main><h1>审阅测试</h1><button type="button">开始体验</button><p class="clipped">这是一段可能被裁切的足够长的文字。</p><div id="end" style="margin-top:1450px;height:60px;background:rgb(210,20,30)">页尾证据</div></main><script>try{parent.document.body.dataset.escape="unsafe"}catch(e){document.body.dataset.isolated="true"}setTimeout(()=>{throw Error("review-script-fixture")},20)</script></body></html>')
    const projectFile = join(cwd, '.tianshu-canvas', 'project.json')
    const pageFile = join(cwd, '.tianshu-canvas', 'pages', 'one.html')
    const projectBefore = readFileSync(projectFile, 'utf8'); const pageBefore = readFileSync(pageFile, 'utf8')
    const result = await api.reviewPage(cwd, 'one')
    assert.equal(result.visualAssessment, 'requires-human-review')
    assert.match(result.sourceSha256, /^[a-f0-9]{64}$/)
    assert.ok(Number.isFinite(Date.parse(result.capturedAt)))
    assert.deepEqual(result.captures.map((c) => c.width), [1440, 768, 390])
    assert.ok(result.limitations.some((s) => s.includes('审美')))
    assert.ok(result.limitations.some((s) => s.includes('内部滚动')))
    assert.ok(existsSync(result.reportFile))
    for (const capture of result.captures) {
      assert.equal(capture.metrics.viewportWidth, capture.width)
      assert.equal(capture.metrics.viewportHeight, capture.height)
      assert.equal(capture.metrics.reducedMotion, true)
      assert.equal(capture.metrics.isolatedOrigin, true)
      assert.ok(capture.metrics.contentHeight >= 1800)
      assert.ok(capture.metrics.elements > 3, '不能把认证失败或空iframe当通过')
      assert.equal(capture.metrics.headings, 1)
      assert.equal(capture.metrics.controls, 1)
      assert.ok(capture.issues.some((i) => i.rule === 'script-error' && i.message.includes('review-script-fixture')))
      assert.ok(capture.issues.some((i) => i.rule === 'text-clipping-candidate'))
      assert.ok(!capture.issues.some((i) => i.rule === 'horizontal-overflow'))
      const png = api.decodePng(readFileSync(capture.path))
      assert.equal(png.width, capture.width)
      assert.equal(png.height, capture.metrics.contentHeight)
      assert.equal(capture.captureMode, 'stitched-scroll')
      // Evidence must include the red footer, not just the first viewport enlarged into a blank PNG.
      let red = 0
      for (let p = Math.max(0, png.height - 350) * png.width * png.channels; p < png.data.length; p += png.channels) {
        if (png.data[p] > 180 && png.data[p + 1] < 50 && png.data[p + 2] < 60) red++
      }
      assert.ok(red > 100, '应捕获视口之外的页尾红色证据')
    }
    assert.match(api.formatReviewReport(result), /待宿主读图|项目所有者/)
    assert.equal(readFileSync(projectFile, 'utf8'), projectBefore)
    assert.equal(readFileSync(pageFile, 'utf8'), pageBefore)
    assert.equal(existsSync(join(cwd, '.tianshu-canvas', 'selection.json')), false)
    const second = await api.reviewPage(cwd, 'one')
    assert.notEqual(second.outputDir, result.outputDir, '重复审阅不能覆盖旧证据')
  } finally { await api.shutdownForTests(); rmSync(cwd, { recursive: true, force: true }) }
})

test('review reports real responsive overflow and blocked resources without allowing network access', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-review-overflow-'))
  try {
    addPage(cwd, 'overflow', '<!doctype html><html><head><style>body{margin:0}.wide{width:1600px;height:90px}button{width:50px;height:35px}</style></head><body><h1>宽屏问题</h1><div class="wide">不可重排</div><button tabindex="-1"></button><img src="https://example.invalid/test.png" alt="测试图片"></body></html>')
    const result = await api.reviewPage(cwd, 'overflow')
    assert.ok(result.captures.every((c) => c.issues.some((i) => i.rule === 'horizontal-overflow')))
    assert.ok(result.captures.every((c) => c.issues.some((i) => i.rule === 'control-name')))
    assert.ok(result.captures.every((c) => c.issues.some((i) => i.rule === 'keyboard-unreachable-candidate')))
    assert.ok(result.captures.every((c) => c.issues.some((i) => ['csp-blocked-resource','external-resource','broken-image'].includes(i.rule))))
  } finally { await api.shutdownForTests(); rmSync(cwd, { recursive: true, force: true }) }
})

test('review full-height pixels preserve every scroll band including the overlapping final viewport', { skip: !browserPath && '未找到浏览器', timeout: 180000 }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-review-bands-'))
  try {
    const contentHeight = 4557
    const rowColor = (y) => [y % 251, (Math.floor(y / 251) * 30 + 10) % 256, 170]
    const rows = Array.from({ length: contentHeight }, (_, y) => '<div style="height:1px;background:rgb(' + rowColor(y).join(',') + ')"></div>').join('')
    addPage(cwd, 'bands', '<!doctype html><html><head><style>html,body{margin:0;padding:0}main{height:' + contentHeight + 'px}</style></head><body><main>' + rows + '</main></body></html>')
    const result = await api.reviewPage(cwd, 'bands')
    for (const capture of result.captures) {
      const png = api.decodePng(readFileSync(capture.path))
      assert.equal(png.height, contentHeight)
      for (let y = 0; y < contentHeight; y++) {
        const p = (y * png.width + 10) * png.channels
        assert.deepEqual([png.data[p], png.data[p + 1], png.data[p + 2]], rowColor(y), capture.width + 'px row ' + y + ' must appear exactly once in source order')
      }
    }
  } finally { await api.shutdownForTests(); rmSync(cwd, { recursive: true, force: true }) }
})

test('review resolves the committed opaque frame for successive pages instead of reusing a blank or prior document', { skip: !browserPath && '未找到浏览器', timeout: 180000 }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-review-frame-swap-'))
  const colors = [[213, 31, 41], [17, 149, 73], [29, 89, 217]]
  try {
    for (const [index, color] of colors.entries()) {
      const id = 'frame-page-' + index
      addPage(cwd, id, '<!doctype html><html><head><style>html,body{margin:0;min-height:100%;background:rgb(' + color.join(',') + ')}h1{margin:0;padding:40px;color:white}</style></head><body><h1>' + id + '</h1></body></html>')
    }
    for (const index of [0, 1, 2, 1]) {
      const id = 'frame-page-' + index
      const result = await api.reviewPage(cwd, id)
      assert.equal(result.pageId, id)
      assert.equal(result.captures.length, 3)
      for (const capture of result.captures) {
        assert.equal(capture.metrics.isolatedOrigin, true)
        assert.equal(capture.metrics.headings, 1)
        const png = api.decodePng(readFileSync(capture.path))
        const pixel = ((capture.height - 20) * png.width + 20) * png.channels
        assert.deepEqual([png.data[pixel], png.data[pixel + 1], png.data[pixel + 2]], colors[index], 'each viewport must contain the requested page, including after revisiting a previous page')
      }
    }
  } finally { await api.shutdownForTests(); rmSync(cwd, { recursive: true, force: true }) }
})
