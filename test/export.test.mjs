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
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)

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
  const a = await tools.canvas_upsert_page.execute({ input: { html: '<h1>A</h1>', title: '首页' }, cwd })
  const b = await tools.canvas_upsert_page.execute({ input: { html: '<h1>B</h1>', title: '详情页' }, cwd })
  const idA = a.content.match(/id=([\w-]+)/)[1]
  const idB = b.content.match(/id=([\w-]+)/)[1]

  // 起本地服务（画布顶栏导出走的就是这条 HTTP 路由）
  const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
  assert.ok(!open.isError, open.content)
  const m = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]{16}/)
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
  assert.ok(names.includes('index.html'), '应含 index.html 画廊')
  assert.ok(names.includes(`pages/${idA}.html`), '应含页面 A')
  assert.ok(names.includes(`pages/${idB}.html`), '应含页面 B')

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
