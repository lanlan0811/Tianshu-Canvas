/**
 * 回归（技术反馈 02）：工作区文件边界。
 *
 * 复现并锁定三个真实越界场景：
 *   1. 页面文件是指向工作区外的符号链接 → `/api/page-html` 曾直接返回外部内容；
 *   2. 固定的 `<id>.html.tmp` 被预置为符号链接 → 写入曾**跟随**链接改写外部文件；
 *   3. `pages/` 目录本身是 Windows 目录联接（junction）→ 写入曾落到工作区外。
 *
 * 同时覆盖 project.json / exports 的同类越界，以及「无链接时正常读写不受影响」的误伤回归。
 * 创建符号链接需要权限（Windows 需开发者模式或管理员）；无法创建时跳过该用例，
 * 避免在受限环境下变成假绿。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

/** 建一对目录：workspace（含 .tianshu-canvas/pages）与 outside，返回路径。 */
function workspace() {
  const base = mkdtempSync(join(tmpdir(), 'tsc-boundary-'))
  const ws = join(base, 'ws')
  const outside = join(base, 'outside')
  mkdirSync(join(ws, '.tianshu-canvas', 'pages'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  return { base, ws, outside }
}

/** 尝试创建符号链接；平台不允许时返回 false（用例跳过）。 */
function trySymlink(target, linkPath, type) {
  try {
    symlinkSync(target, linkPath, type)
    return true
  } catch {
    return false
  }
}

const canSymlink = (() => {
  const { base } = workspace()
  const ok = trySymlink(join(base, 'outside'), join(base, 'link-probe'), 'junction')
  rmSync(base, { recursive: true, force: true })
  return ok
})()

const skipIfNoSymlink = canSymlink ? false : '当前环境不允许创建符号链接（Windows 需开发者模式或管理员）'

test('页面文件为符号链接：拒绝读取与写入，且外部文件保持原值', { skip: skipIfNoSymlink }, async () => {
  const { base, ws, outside } = workspace()
  try {
    writeFileSync(join(outside, 'secret.html'), '<p>SECRET-OUTSIDE</p>')
    symlinkSync(join(outside, 'secret.html'), join(ws, '.tianshu-canvas', 'pages', 'page-aaaaaaaa.html'), 'file')

    const read = await tools.canvas_get_state.execute({ input: {}, cwd: ws })
    assert.ok(!read.isError, read.content)

    // 通过工具写入该页面：必须被拒绝，且不触碰外部文件。
    const written = await tools.canvas_upsert_page.execute({
      input: { id: 'page-aaaaaaaa', html: '<h1>PWNED</h1>', title: 'x' },
      cwd: ws,
    })
    assert.equal(written.isError, true, '目标页为符号链接时必须拒绝写入')
    assert.match(written.content, /符号链接|工作区外/)
    assert.equal(readFileSync(join(outside, 'secret.html'), 'utf8'), '<p>SECRET-OUTSIDE</p>', '外部文件不得被改写')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('预置的固定 .html.tmp 符号链接不再可用（写入不跟随链接）', { skip: skipIfNoSymlink }, async () => {
  const { base, ws, outside } = workspace()
  try {
    writeFileSync(join(outside, 'victim.txt'), 'VICTIM-ORIGINAL')
    // 旧实现写 `pages/<id>.html.tmp` 时 writeFileSync 会跟随此链接改写 victim.txt。
    symlinkSync(join(outside, 'victim.txt'), join(ws, '.tianshu-canvas', 'pages', 'page-bbbbbbbb.html.tmp'), 'file')

    const res = await tools.canvas_upsert_page.execute({ input: { id: 'page-bbbbbbbb', html: '<h1>PWNED</h1>', title: 'x' }, cwd: ws })
    assert.ok(!res.isError, res.content)
    assert.equal(readFileSync(join(outside, 'victim.txt'), 'utf8'), 'VICTIM-ORIGINAL', '预置的 tmp 链接不得被跟随')
    // 正常写入仍然落到工作区内
    assert.equal(readFileSync(join(ws, '.tianshu-canvas', 'pages', 'page-bbbbbbbb.html'), 'utf8'), '<h1>PWNED</h1>')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('pages 目录为目录联接（junction）：拒绝写入且工作区外不产生文件', { skip: skipIfNoSymlink }, async () => {
  const { base, ws, outside } = workspace()
  try {
    rmSync(join(ws, '.tianshu-canvas', 'pages'), { recursive: true, force: true })
    symlinkSync(outside, join(ws, '.tianshu-canvas', 'pages'), 'junction')

    const res = await tools.canvas_upsert_page.execute({ input: { html: '<h1>OUT</h1>', title: 'x' }, cwd: ws })
    assert.equal(res.isError, true, 'pages 为目录联接时必须拒绝写入')
    assert.match(res.content, /符号链接|工作区外/)
    const leaked = readdirSafe(outside).filter((f) => f.endsWith('.html'))
    assert.deepEqual(leaked, [], '工作区外不得产生页面文件')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('project.json 为符号链接：拒绝写入且外部文件保持原值', { skip: skipIfNoSymlink }, async () => {
  const { base, ws, outside } = workspace()
  try {
    writeFileSync(join(outside, 'victim.json'), '{"keep":true}')
    symlinkSync(join(outside, 'victim.json'), join(ws, '.tianshu-canvas', 'project.json'), 'file')

    const res = await tools.canvas_upsert_page.execute({ input: { html: '<h1>x</h1>', title: 'x' }, cwd: ws })
    assert.equal(res.isError, true)
    assert.equal(readFileSync(join(outside, 'victim.json'), 'utf8'), '{"keep":true}')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('无链接时正常读写不受影响（加固误伤回归）', async () => {
  const base = mkdtempSync(join(tmpdir(), 'tsc-boundary-ok-'))
  try {
    const res = await tools.canvas_upsert_page.execute({ input: { html: '<h1>NORMAL</h1>', title: 'ok' }, cwd: base })
    assert.ok(!res.isError, res.content)
    const id = res.content.match(/id=([\w-]+)/)?.[1]
    assert.equal(readFileSync(join(base, '.tianshu-canvas', 'pages', `${id}.html`), 'utf8'), '<h1>NORMAL</h1>')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
