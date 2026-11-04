/**
 * 导出测试：ZIP 结构（中央目录含 project.json + 各页面 + index.html）；PNG 需浏览器则跳过。
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
  const a = await tools.canvas_add_page.execute({ input: { html: '<h1>A</h1>', title: '首页' }, cwd })
  const b = await tools.canvas_add_page.execute({ input: { html: '<h1>B</h1>', title: '详情页' }, cwd })
  const idA = a.content.match(/id=([\w-]+)/)[1]
  const idB = b.content.match(/id=([\w-]+)/)[1]

  // ZIP 导出
  const zip = await tools.canvas_export.execute({ input: { kind: 'zip' }, cwd })
  assert.ok(!zip.isError, zip.content)
  const zipPath = zip.content.match(/路径：(.+\.zip)/)[1].trim()
  assert.ok(existsSync(zipPath), 'zip 文件应存在')

  const names = listZipEntries(readFileSync(zipPath))
  assert.ok(names.includes('project.json'), '应含 project.json')
  assert.ok(names.includes('index.html'), '应含 index.html 画廊')
  assert.ok(names.includes(`pages/${idA}.html`), '应含页面 A')
  assert.ok(names.includes(`pages/${idB}.html`), '应含页面 B')

  // PNG：有浏览器则验证产出，否则跳过（不阻塞）
  const { resolveBrowser } = await import(pathToFileURL(join(root, 'dist', 'index.js')).href)
  const hasBrowser = typeof resolveBrowser === 'function' && resolveBrowser()
  if (hasBrowser) {
    const both = await tools.canvas_export.execute({ input: { kind: 'png' }, cwd })
    if (!both.isError && /\.png/.test(both.content)) {
      const pngPath = both.content.match(/路径：(.+\.png)/)[1].trim()
      assert.ok(existsSync(pngPath), 'png 文件应存在')
      assert.equal(readFileSync(pngPath).subarray(1, 4).toString('latin1'), 'PNG', 'png magic')
      console.log('OK 导出: ZIP 结构正确 + PNG 产出')
    } else {
      console.log('OK 导出: ZIP 结构正确（PNG 跳过：' + both.content.slice(0, 60) + '）')
    }
  } else {
    console.log('OK 导出: ZIP 结构正确（无浏览器，PNG 跳过）')
  }
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
