/**
 * 文本安全：不可见 / 双向控制符的硬拒绝与软警告。
 *
 * 硬拒绝：U+202A–202E、U+2066–2069、U+200E/U+200F（Trojan Source 类改写）。
 * 仅警告：U+200B–U+200D、U+2060、U+FEFF（emoji ZWJ 与历史 BOM 要保持可用）。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

function workspace() {
  return mkdtempSync(join(tmpdir(), 'tsc-text-safety-'))
}

async function upsert(cwd, input) {
  return tools.canvas_upsert_page.execute({ input, cwd })
}

test('文本安全：HTML 含 RTL 覆盖符时拒绝写入，且给出位置', async () => {
  const cwd = workspace()
  try {
    const html = '<p>正常</p>\n<p>abc\u202Edef</p>'
    const res = await upsert(cwd, { html, title: '覆盖符' })
    assert.equal(res.isError, true, res.content)
    assert.match(res.content, /U\+202E/)
    assert.match(res.content, /第 2 行第 7 列/, res.content)
    assert.ok(!existsSync(join(cwd, '.tianshu-canvas', 'pages')) || readdirSync(join(cwd, '.tianshu-canvas', 'pages')).length === 0,
      '被拒绝的页面不能留下文件')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('文本安全：标题含方向标记时拒绝写入', async () => {
  const cwd = workspace()
  try {
    const res = await upsert(cwd, { html: '<p>ok</p>', title: '标题\u200E尾部' })
    assert.equal(res.isError, true, res.content)
    assert.match(res.content, /U\+200E/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('文本安全：孤立双向隔离符 U+2066–2069 拒绝', async () => {
  const cwd = workspace()
  try {
    for (const ch of ['\u2066', '\u2067', '\u2068', '\u2069']) {
      const res = await upsert(cwd, { html: `<p>a${ch}b</p>` })
      assert.equal(res.isError, true, `U+${ch.codePointAt(0).toString(16)} 应被拒绝：${res.content}`)
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('文本安全：emoji ZWJ 序列只警告且内容一字不差', async () => {
  const cwd = workspace()
  try {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
    const html = `<p>一家人 ${family}</p>`
    const res = await upsert(cwd, { html, title: '家庭' })
    assert.ok(!res.isError, res.content)
    assert.match(res.content, /警告|不可见/, '应给出零宽字符警告')
    const id = /id=([A-Za-z0-9_-]+)/.exec(res.content)?.[1]
    assert.ok(id, res.content)
    const saved = readFileSync(join(cwd, '.tianshu-canvas', 'pages', id + '.html'), 'utf8')
    assert.ok(saved.includes(family), '零宽连接符必须原样保留，不能被剥离')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('文本安全：正文中的 BOM 只警告，仍可写入', async () => {
  const cwd = workspace()
  try {
    const res = await upsert(cwd, { html: '<p>a\uFEFFb</p>', title: 'BOM' })
    assert.ok(!res.isError, res.content)
    assert.match(res.content, /U\+FEFF/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('文本安全：普通中英文与无连接符 emoji 不产生任何警告', async () => {
  const cwd = workspace()
  try {
    const res = await upsert(cwd, { html: '<p>Hello 世界 😀</p>', title: '普通页' })
    assert.ok(!res.isError, res.content)
    assert.doesNotMatch(res.content, /不可见|警告/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('文本安全：html_path 来源同样被校验', async () => {
  const cwd = workspace()
  try {
    const file = join(cwd, 'dirty.html')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, '<p>x\u202Dbad</p>')
    const res = await upsert(cwd, { html_path: file, title: '文件来源' })
    assert.equal(res.isError, true, res.content)
    assert.match(res.content, /U\+202D/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
