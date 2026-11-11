/** Reject overlapping mutations before publication and isolate commit observers. */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const apiDir = mkdtempSync(join(tmpdir(), 'tsc-transaction-integrity-api-'))
await build({ stdin: { contents: "export * from './src/project.ts'; export * from './src/transaction.ts';", resolveDir: root }, outfile: join(apiDir, 'project.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent' })
const api = await import(pathToFileURL(join(apiDir, 'project.mjs')).href)
after(() => rmSync(apiDir, { recursive: true, force: true }))

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-transaction-integrity-'))
  const dir = join(cwd, '.tianshu-canvas')
  mkdirSync(join(dir, 'pages'), { recursive: true })
  const project = join(dir, 'project.json')
  writeFileSync(project, JSON.stringify({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] }) + '\n')
  return { cwd, dir, project, cleanup() { rmSync(cwd, { recursive: true, force: true }) } }
}

test('通用stageFile不能绕过最终页面HTML容量限制', () => {
  const ws = fixture()
  const before = readFileSync(ws.project)
  const page = join(ws.dir, 'pages', 'page-oversize.html')
  try {
    assert.throws(() => api.withProjectTransaction(ws.cwd, tx => {
      tx.stageFile(join(ws.dir, 'library', 'must-not-publish.json'), '{}')
      tx.stageFile(page, Buffer.alloc(8 * 1024 * 1024 + 1, 97))
    }), error => error.code === 'HTML_SIZE_LIMIT')
    assert.deepEqual(readFileSync(ws.project), before)
    assert.equal(existsSync(page), false)
    assert.equal(existsSync(join(ws.dir, 'library')), false)
    assert.deepEqual(readdirSync(join(ws.dir, 'pages')), [])
    assert.equal(existsSync(join(ws.dir, 'project.lock')), false)
  } finally { ws.cleanup() }
})

test('目录删除与子文件写入冲突在提交前拒绝，项目和原始目录字节不变', () => {
  const ws = fixture()
  const library = join(ws.dir, 'library', 'kept-style')
  mkdirSync(library, { recursive: true })
  const file = join(library, 'style.json')
  writeFileSync(file, '{"retained":true}')
  const before = readFileSync(ws.project)
  try {
    assert.throws(() => api.withProjectTransaction(ws.cwd, tx => {
      tx.stageDelete(library, true)
      tx.stageFile(file, '{"mustNotPublish":true}')
      api.setViewport(ws.cwd, { x: 10, y: 20, zoom: 2 }, tx)
    }), /重叠/)
    assert.deepEqual(readFileSync(ws.project), before)
    assert.equal(readFileSync(file, 'utf8'), '{"retained":true}')
    assert.equal(existsSync(join(ws.dir, 'project.lock')), false)
  } finally { ws.cleanup() }
})

for (const parentWrite of [false, true]) {
  for (const reverse of [false, true]) {
    test('相邻前缀不掩盖父子路径冲突：' + (parentWrite ? '父写子删' : '父删子写') + (reverse ? '，逆序暂存' : '，正序暂存'), () => {
      const ws = fixture()
      const library = join(ws.dir, 'library')
      const parent = join(library, 'style')
      const child = join(parent, 'meta.json')
      const sibling = join(library, 'style-alt', 'meta.json')
      mkdirSync(join(library, 'style-alt'), { recursive: true })
      writeFileSync(sibling, '{"originalSibling":true}')
      if (!parentWrite) {
        mkdirSync(parent)
        writeFileSync(child, '{"originalChild":true}')
      }
      const snapshot = dir => Object.fromEntries(readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
        const path = join(dir, entry.name)
        return [entry.name, entry.isDirectory() ? { directory: snapshot(path) } : { bytes: readFileSync(path).toString('hex') }]
      }))
      const before = snapshot(ws.dir)
      try {
        assert.throws(() => api.withProjectTransaction(ws.cwd, tx => {
          const stages = parentWrite
            ? [() => tx.stageFile(parent, 'must not become a file'), () => tx.stageFile(sibling, 'must not change sibling'), () => tx.stageDelete(child)]
            : [() => tx.stageDelete(parent, true), () => tx.stageFile(sibling, 'must not change sibling'), () => tx.stageFile(child, 'must not publish child')]
          for (const stage of reverse ? stages.reverse() : stages) stage()
          api.setViewport(ws.cwd, { x: 123, y: 456, zoom: 2 }, tx)
        }), /重叠/)
        assert.deepEqual(snapshot(ws.dir), before, 'all project/page/style bytes and directory entries must remain unchanged')
        assert.equal(existsSync(join(ws.dir, 'project.lock')), false)
      } finally { ws.cleanup() }
    })
  }
}

test('回调与监听器失败不把已提交操作报告为失败，后续回调照常执行', () => {
  const ws = fixture()
  const observed = []
  const listener = () => { throw new Error('expected observer failure') }
  api.projectEvents.on('change', listener)
  try {
    assert.doesNotThrow(() => api.withProjectTransaction(ws.cwd, tx => {
      tx.project.viewport = { x: 99, y: 11, zoom: 2 }
      tx.markProjectChanged()
      tx.afterCommit(() => { throw new Error('expected cache failure') })
      tx.afterCommit(() => { observed.push('committed') })
    }))
    assert.deepEqual(observed, ['committed'])
    assert.equal(JSON.parse(readFileSync(ws.project, 'utf8')).viewport.x, 99)
    assert.equal(existsSync(join(ws.dir, 'project.lock')), false)
  } finally { api.projectEvents.removeListener('change', listener); ws.cleanup() }
})

test('锁初始化fstat或随机数失败均关闭描述符且不遗留已确认属于本次的锁', () => {
  const ws = fixture()
  const before = readFileSync(ws.project)
  const originalFstat = fs.fstatSync
  const originalClose = fs.closeSync
  const originalRandom = crypto.randomBytes
  let closed = 0
  let failed = false
  fs.fstatSync = function (...args) {
    if (!failed) { failed = true; throw new Error('expected first fstat failure') }
    return originalFstat.apply(this, args)
  }
  fs.closeSync = function (...args) { closed++; return originalClose.apply(this, args) }
  syncBuiltinESMExports()
  try {
    assert.throws(() => api.withWorkspaceLock(ws.cwd, () => assert.fail('must not run')), /expected first fstat failure/)
    assert.equal(closed, 1, 'the newly opened descriptor must close even when initialization fails')
    assert.equal(existsSync(join(ws.dir, 'project.lock')), false)
    fs.fstatSync = originalFstat
    crypto.randomBytes = function () { throw new Error('expected RNG failure') }
    syncBuiltinESMExports()
    assert.throws(() => api.withWorkspaceLock(ws.cwd, () => assert.fail('must not run')), /expected RNG failure/)
    assert.equal(existsSync(join(ws.dir, 'project.lock')), false)
    assert.deepEqual(readFileSync(ws.project), before)
  } finally {
    fs.fstatSync = originalFstat; fs.closeSync = originalClose; crypto.randomBytes = originalRandom; syncBuiltinESMExports(); ws.cleanup()
  }
})

test('锁尚未写入record时遭替换，初始化异常不得删除替换锁', () => {
  const ws = fixture()
  const originalFstat = fs.fstatSync
  let replaced = false
  const replacement = '{another-owner-before-record}'
  fs.fstatSync = function (...args) {
    if (!replaced) {
      replaced = true
      fs.renameSync(join(ws.dir, 'project.lock'), join(ws.dir, 'project.lock.owned'))
      writeFileSync(join(ws.dir, 'project.lock'), replacement)
      throw new Error('expected initialization replacement')
    }
    return originalFstat.apply(this, args)
  }
  syncBuiltinESMExports()
  try {
    assert.throws(() => api.withWorkspaceLock(ws.cwd, () => assert.fail('must not run')), /expected initialization replacement/)
    assert.equal(readFileSync(join(ws.dir, 'project.lock'), 'utf8'), replacement)
    assert.equal(existsSync(join(ws.dir, 'project.lock.owned')), true)
  } finally { fs.fstatSync = originalFstat; syncBuiltinESMExports(); ws.cleanup() }
})
