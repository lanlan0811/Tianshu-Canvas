/**
 * 回归（技术反馈 02 / 0.8.1 阻断项一）：工作区文件边界。
 *
 * 复现并锁定真实越界场景：
 *   1. 页面文件是指向工作区外的符号链接 → 读取入口曾直接返回外部内容；
 *   2. 固定的 `<id>.html.tmp` 被预置为符号链接 → 写入曾**跟随**链接改写外部文件；
 *   3. `pages/` 目录本身是 Windows 目录联接（junction）→ 写入曾落到工作区外；
 *   4. `.tianshu-canvas/url.txt` 是符号链接 → `canvas_open` 曾跟随链接覆盖外部文件（本次新修）；
 *   5. 品牌记忆 / 自定义设计系统 / 代码生成 / 导出 / 漂移快照 / 视觉基线的同类越界；
 *   6. 「校验后目标被替换成链接」的竞态（写出前再拒一次）。
 *
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

// ---------------------------------------------------------------------------
// 阻断项一：url.txt 及其他隐式读写入口（0.8.2 新增）
// ---------------------------------------------------------------------------

/**
 * 与反馈给的 PoC 同路径的端到端回归：预置 `.tianshu-canvas/url.txt` 为指向工作区外的
 * 符号链接，调用 `canvas_open` 后外部文件字节必须保持不变，且画布仍能正常打开。
 */
test('url.txt 为符号链接：canvas_open 不覆盖工作区外文件，且画布仍可用', { skip: skipIfNoSymlink }, async () => {
  const { base, ws, outside } = workspace()
  try {
    writeFileSync(join(outside, 'outside.txt'), 'ORIGINAL')
    symlinkSync(join(outside, 'outside.txt'), join(ws, '.tianshu-canvas', 'url.txt'), 'file')

    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd: ws })
    assert.ok(!open.isError, open.content)
    assert.match(open.content, /127\.0\.0\.1/, '画布 URL 仍应返回')
    assert.equal(readFileSync(join(outside, 'outside.txt'), 'utf8'), 'ORIGINAL', '外部文件不得被覆盖')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('url.txt 无链接时正常写入画布地址', async () => {
  const base = mkdtempSync(join(tmpdir(), 'tsc-boundary-url-'))
  try {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd: base })
    assert.ok(!open.isError, open.content)
    const written = readFileSync(join(base, '.tianshu-canvas', 'url.txt'), 'utf8')
    assert.match(written, /^http:\/\/127\.0\.0\.1:\d+\/\?ws=[0-9a-f]+/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

/**
 * 品牌记忆 / 自定义设计系统 / 代码生成 / 导出 / 漂移快照：这些隐式入口此前直接用
 * `writeFileSync(tmp)` 或 `renameSync`，预置的叶子链接会被跟随。逐条验证外部文件不变。
 */
test('品牌记忆文件为符号链接：tool 调用被拒且外部文件保持原值', { skip: skipIfNoSymlink }, async () => {
  const { base, ws, outside } = workspace()
  try {
    writeFileSync(join(outside, 'victim.json'), '{"keep":true}')
    mkdirSync(join(ws, '.tianshu-canvas', 'memory'), { recursive: true })
    symlinkSync(join(outside, 'victim.json'), join(ws, '.tianshu-canvas', 'memory', 'brand.json'), 'file')
    // codegen 会触发 recordUsage → writeMemory（隐式写入品牌记忆）。
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd: ws })
    const res = await tools.canvas_style.execute({
      input: { action: 'codegen', target: 'android', stack: 'compose', html: '<div class="ts-app"></div>', write_files: false },
      cwd: ws,
    })
    assert.ok(!res.isError, res.content)
    assert.equal(readFileSync(join(outside, 'victim.json'), 'utf8'), '{"keep":true}', '外部文件不得被改写')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('自定义设计系统目录为目录联接：拒绝写入且工作区外不产生文件', { skip: skipIfNoSymlink }, async () => {
  const { base, ws, outside } = workspace()
  try {
    symlinkSync(outside, join(ws, '.tianshu-canvas', 'library'), 'junction')
    const tokens = JSON.parse(readFileSync(join(root, 'design-systems', 'styles', 'apple', 'tokens.json'), 'utf8'))
    const res = await tools.canvas_design_system.execute({
      input: { action: 'create', id: 'escaped', tokens: { ...tokens, id: 'escaped' }, name: 'X', set_current: false },
      cwd: ws,
    })
    assert.equal(res.isError, true, 'library 为目录联接时必须拒绝写入')
    assert.deepEqual(readdirSafe(outside), [], '工作区外不得产生文件')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('代码生成产物目标为符号链接：拒绝覆盖工作区外文件', { skip: skipIfNoSymlink }, async () => {
  const { base, ws, outside } = workspace()
  try {
    writeFileSync(join(outside, 'Color.kt'), 'ORIGINAL')
    const outDir = join(ws, '.tianshu-canvas', 'exports', 'android')
    mkdirSync(outDir, { recursive: true })
    symlinkSync(join(outside, 'Color.kt'), join(outDir, 'Color.kt'), 'file')
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd: ws })
    const res = await tools.canvas_style.execute({
      input: { action: 'codegen', target: 'android', stack: 'compose', html: '<div class="ts-app"></div>', out_dir: outDir },
      cwd: ws,
    })
    assert.equal(res.isError, true, '目标为符号链接时必须拒绝写入')
    assert.equal(readFileSync(join(outside, 'Color.kt'), 'utf8'), 'ORIGINAL')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('导出产物目录为目录联接：拒绝导出且工作区外不产生文件', { skip: skipIfNoSymlink }, async () => {
  const { base, ws, outside } = workspace()
  try {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd: ws })
    assert.ok(!open.isError, open.content)
    const m = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)
    assert.ok(m, open.content)
    const token = new URL(m[0]).searchParams.get('ws')
    await tools.canvas_upsert_page.execute({ input: { html: '<h1>z</h1>', title: 'z' }, cwd: ws })
    // exports 目录被替换成指向工作区外的目录联接：导出应拒绝，且外部不出现产物。
    rmSync(join(ws, '.tianshu-canvas', 'exports'), { recursive: true, force: true })
    writeFileSync(join(outside, 'keep.txt'), 'ORIGINAL')
    symlinkSync(outside, join(ws, '.tianshu-canvas', 'exports'), 'junction')
    const res = await fetch(`${new URL(m[0]).origin}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
      body: JSON.stringify({ ws: token, kind: 'zip' }),
    })
    const body = await res.json()
    assert.equal(res.status, 403, JSON.stringify(body))
    assert.match(String(body.error), /符号链接|工作区外/, JSON.stringify(body))
    assert.equal(String(body.error).includes(ws) || String(body.error).includes(outside), false, '拒绝响应不得泄露绝对路径')
    assert.deepEqual(readdirSafe(outside), ['keep.txt'], '工作区外不得产生导出产物')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('漂移快照文件为符号链接：拒绝覆盖工作区外文件', { skip: skipIfNoSymlink }, async () => {
  const { base, ws, outside } = workspace()
  try {
    writeFileSync(join(outside, 'snap.json'), 'ORIGINAL-SNAP')
    mkdirSync(join(ws, '.tianshu-canvas', 'audit'), { recursive: true })
    symlinkSync(join(outside, 'snap.json'), join(ws, '.tianshu-canvas', 'audit', 'snapshot.json'), 'file')
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd: ws })
    await tools.canvas_upsert_page.execute({ input: { html: '<div class="ts-app"></div>', title: 'p' }, cwd: ws })
    const res = await tools.canvas_audit.execute({ input: { action: 'drift' }, cwd: ws })
    assert.equal(res.isError, true, '快照为符号链接时必须拒绝写入')
    assert.equal(readFileSync(join(outside, 'snap.json'), 'utf8'), 'ORIGINAL-SNAP')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

/**
 * 「校验后被替换」竞态：写入流程用独占创建的**随机**临时文件，攻击者无法预知替换点；
 * 且 rename 之前会再拒一次叶子链接。这里验证固定名 `.tmp` 预置链接着实不起作用。
 */
test('父目录为链接时，深层写入一并被拒（叶子不存在也拦）', { skip: skipIfNoSymlink }, async () => {
  const { base, ws, outside } = workspace()
  try {
    rmSync(join(ws, '.tianshu-canvas', 'pages'), { recursive: true, force: true })
    symlinkSync(outside, join(ws, '.tianshu-canvas', 'pages'), 'junction')
    const res = await tools.canvas_upsert_page.execute({ input: { html: '<h1>deep</h1>', title: 'deep' }, cwd: ws })
    assert.equal(res.isError, true)
    assert.match(res.content, /符号链接|工作区外/)
    assert.deepEqual(readdirSafe(outside).filter((f) => f.endsWith('.html')), [])
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
