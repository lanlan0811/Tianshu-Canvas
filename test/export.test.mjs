/**
 * 导出测试：验证画布顶栏走的导出接口（POST /api/export）。
 * ZIP 结构（中央目录含 project.json + 各页面 + index.html）；PNG 需浏览器则跳过。
 * 导出不再有 AI 工具，仅由用户在画布上触发。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

/** 解析 zip，返回 { name, text } 列表（本地头顺序；本项目自写的 deflate 存储）。 */
function readZipEntries(buf) {
  const out = []
  let p = 0
  while (p < buf.length - 4) {
    if (buf.readUInt32LE(p) !== 0x04034b50) break
    const method = buf.readUInt16LE(p + 8)
    const compSize = buf.readUInt32LE(p + 18)
    const nameLen = buf.readUInt16LE(p + 26)
    const extraLen = buf.readUInt16LE(p + 28)
    const name = buf.toString('utf8', p + 30, p + 30 + nameLen)
    const start = p + 30 + nameLen + extraLen
    const data = method === 8 ? inflateRawSync(buf.subarray(start, start + compSize)) : buf.subarray(start, start + compSize)
    out.push({ name, text: data.toString('utf8') })
    p = start + compSize
  }
  return out
}

/** 解析 zip 中央目录，返回条目名列表。 */
function listZipEntries(buf) {
  // 从尾部找 EOCD（0x06054b50）
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  assert.ok(eocd >= 0, '应能找到 EOCD')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const names = []
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(off), 0x02014b50, '中央目录头签名')
    const nameLen = buf.readUInt16LE(off + 28)
    names.push(buf.subarray(off + 46, off + 46 + nameLen).toString('utf8'))
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    off += 46 + nameLen + extraLen + commentLen
  }
  return names
}

const cwd = mkdtempSync(join(tmpdir(), 'tsc-exp-'))
try {
  // 锁定风格，才能产出共享 CSS 与多页站；页面用 slug / data-nav 写法互链，B 另含内联脚本与交互。
  await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })
  const b = await tools.canvas_upsert_page.execute({
    input: {
      html: '<html><head></head><body><div class="ts-tabs" data-ts-tabs><button class="ts-tab ts-tab--active" data-ts-tab="x">X</button></div><div data-ts-panel="x"><script>document.title="t"</script>内容</div><h1>B</h1></body></html>',
      title: '详情页',
    },
    cwd,
  })
  const idB = b.content.match(/id=([\w-]+)/)[1]
  // A 用标题 slug 链到 B（写入时应规范化成 <idB>.html）；再加一条 data-nav 自链。
  const a = await tools.canvas_upsert_page.execute({
    input: {
      html: `<html><head></head><body><a href="详情页.html">去B</a><a data-nav="${idB}">再来</a><h1>A</h1></body></html>`,
      title: '首页',
    },
    cwd,
  })
  const idA = a.content.match(/id=([\w-]+)/)[1]

  // 起本地服务（画布顶栏导出走的就是这条 HTTP 路由）
  const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
  assert.ok(!open.isError, open.content)
  const m = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)
  assert.ok(m, `未返回合法 URL: ${open.content}`)
  const token = new URL(m[0]).searchParams.get('ws')
  const base = new URL(m[0]).origin
  const post = (body) =>
    fetch(`${base}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
      body: JSON.stringify({ ws: token, ...body }),
    })

  // ZIP 导出
  const zipRes = await post({ kind: 'zip' })
  assert.equal(zipRes.status, 200)
  const zip = await zipRes.json()
  assert.ok(zip.ok, JSON.stringify(zip))
  const zipFile = zip.files.find((f) => f.name.endsWith('.zip'))
  assert.ok(zipFile, '应产出 zip')
  assert.ok(existsSync(zipFile.path), 'zip 文件应存在')

  const names = listZipEntries(readFileSync(zipFile.path))
  assert.ok(names.includes('project.json'), '应含 project.json')
  assert.ok(names.includes('index.html'), '应含 index.html 导航首页')
  assert.ok(names.includes('overview.html'), '应含 overview.html（旧画廊）')
  assert.ok(names.includes(`pages/${idA}.html`), '应含页面 A')
  assert.ok(names.includes(`pages/${idB}.html`), '应含页面 B')
  assert.ok(names.includes('assets/tokens.css'), '锁定风格应含共享 tokens.css')
  assert.ok(names.includes('assets/components.css'), '锁定风格应含共享 components.css')
  assert.ok(names.includes('assets/interactions.css'), '用到交互应含共享 interactions.css')
  assert.ok(names.includes('assets/interactions.js'), '用到交互应含共享 interactions.js')

  const entries = readZipEntries(readFileSync(zipFile.path))
  const text = (n) => entries.find((e) => e.name === n)?.text ?? ''
  const pageA = text(`pages/${idA}.html`)
  const pageB = text(`pages/${idB}.html`)
  // 链接规范化：slug → 真实 id；data-nav 保留并补 href
  assert.ok(pageA.includes(`href="${idB}.html"`), 'A 的 slug 链接应被规范化为 B 的 id.html')
  assert.ok(pageA.includes(`data-nav="${idB}"`) && pageA.includes(`href="${idB}.html"`), 'data-nav 应保留并补 href')
  // 共享 CSS：剥离 ds 内联块，改挂相对外链
  assert.ok(!pageB.includes('tianshu-ds:start') && !pageB.includes('tianshu-tokens'), '导出页应剥离内联 ds 块')
  assert.ok(pageB.includes('../assets/tokens.css'), '导出页应挂共享 tokens.css')
  assert.ok(pageB.includes('../assets/interactions.js'), '用到交互的页应挂共享 interactions.js')
  // 页面自写的内联脚本原样保留（不被探针/导出破坏）
  assert.ok(pageB.includes('<script>document.title="t"</script>'), '页面内联脚本应原样保留')
  // 导航首页含各页真链接
  const indexHtml = text('index.html')
  assert.ok(indexHtml.includes(`pages/${idA}.html`) && indexHtml.includes(`pages/${idB}.html`), '导航首页应含各页链接')
  assert.ok(indexHtml.includes('overview.html'), '导航首页应链接到 overview.html')

  // 导出文件可下载
  const dl = await fetch(`${base}/api/export-file?ws=${encodeURIComponent(token)}&name=${encodeURIComponent(zipFile.name)}`)
  assert.equal(dl.status, 200)
  assert.equal((await dl.arrayBuffer()).byteLength, zipFile.bytes)

  // PNG：有浏览器则验证产出，否则跳过（不阻塞）
  const pngRes = await post({ kind: 'png' })
  const png = await pngRes.json()
  const pngFile = png.files?.find((f) => f.name.endsWith('.png'))
  if (pngFile && existsSync(pngFile.path)) {
    assert.equal(readFileSync(pngFile.path).subarray(1, 4).toString('latin1'), 'PNG', 'png magic')
    console.log('OK 导出: ZIP 结构正确 + PNG 产出')
  } else {
    console.log('OK 导出: ZIP 结构正确（PNG 跳过：' + String(png.pngError ?? '无浏览器').slice(0, 60) + '）')
  }
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
