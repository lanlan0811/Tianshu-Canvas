/** Source-level transaction checks; independent processes exercise the actual disk lock. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const apiDir = fs.mkdtempSync(join(tmpdir(), 'tsc-transactions-api-'))
const apiFile = join(apiDir, 'project.mjs')
await build({ entryPoints: [join(root, 'src/project.ts')], outfile: apiFile, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent' })
const api = await import(pathToFileURL(apiFile).href)
after(() => fs.rmSync(apiDir, { recursive: true, force: true }))

function fixture() {
  const cwd = fs.mkdtempSync(join(tmpdir(), 'tsc-transaction-'))
  const dir = join(cwd, '.tianshu-canvas')
  fs.mkdirSync(join(dir, 'pages'), { recursive: true })
  const file = join(dir, 'project.json')
  fs.writeFileSync(file, JSON.stringify({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] }) + '\n')
  return { cwd, dir, file, lock: join(dir, 'project.lock'), cleanup: () => fs.rmSync(cwd, { recursive: true, force: true }) }
}

function node(id) {
  return { id, type: 'page', title: id, x: 0, y: 0, width: 1440, height: 900, deviceType: 'desktop', htmlPath: `.tianshu-canvas/pages/${id}.html`, createdAt: 1, updatedAt: 1 }
}

const workerFile = join(apiDir, 'worker.mjs')
fs.writeFileSync(workerFile, `
import fs from 'node:fs';
import { join } from 'node:path';
import * as api from './project.mjs';
const [cwd, id, hold] = process.argv.slice(2);
const barrier = new Int32Array(new SharedArrayBuffer(4));
process.on('message', message => {
  if (message.op !== 'write') return;
  try {
    api.withProjectTransaction(cwd, tx => {
      if (hold === 'hold') {
        process.send({ event: 'locked' });
        const signal = join(cwd, 'release-holder');
        const deadline = Date.now() + 15000;
        while (!fs.existsSync(signal)) {
          if (Date.now() > deadline) throw new Error('test barrier timed out');
          Atomics.wait(barrier, 0, 0, 5);
        }
      }
      api.upsertNode(cwd, { id, type: 'page', title: id, x: 0, y: 0, width: 1440, height: 900, deviceType: 'desktop', htmlPath: '.tianshu-canvas/pages/' + id + '.html', createdAt: 1, updatedAt: 1 }, tx);
    });
    process.send({ event: 'result', ok: true });
  } catch (error) {
    process.send({ event: 'result', ok: false, code: error.code, message: error.message });
  }
});
process.send({ event: 'ready' });
`)

function worker(cwd, id, hold = '') {
  const child = spawn(process.execPath, [workerFile, cwd, id, hold], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const queued = []
  const pending = []
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('message', message => {
    const index = pending.findIndex(item => item.event === message.event)
    if (index < 0) queued.push(message)
    else { const [item] = pending.splice(index, 1); clearTimeout(item.timer); item.resolve(message) }
  })
  child.on('exit', (code, signal) => {
    for (const item of pending.splice(0)) { clearTimeout(item.timer); item.reject(new Error(`worker exited ${code}/${signal}: ${stderr}`)) }
  })
  return {
    child,
    next(event, timeout = 10000) {
      const index = queued.findIndex(item => item.event === event)
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0])
      return new Promise((resolve, reject) => {
        const item = { event, resolve, reject, timer: setTimeout(() => { const index = pending.indexOf(item); if (index >= 0) pending.splice(index, 1); reject(new Error(`worker ${event} timeout: ${stderr}`)) }, timeout) }
        pending.push(item)
      })
    },
    write() { child.send({ op: 'write' }) },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill('SIGKILL')
      await exited
    },
  }
}

test('事务只检查一次项目，健康读取复用同一模型，批量节点仅提交一次', () => {
  const ws = fixture()
  const originalOpen = fs.openSync
  const originalRename = fs.renameSync
  let inspections = 0
  let commits = 0
  fs.openSync = function (path, ...args) {
    if (typeof path === 'string' && resolve(path) === resolve(ws.file)) inspections++
    return originalOpen.call(this, path, ...args)
  }
  fs.renameSync = function (from, to, ...args) {
    if (resolve(String(to)) === resolve(ws.file)) commits++
    return originalRename.call(this, from, to, ...args)
  }
  syncBuiltinESMExports()
  try {
    api.withProjectTransaction(ws.cwd, tx => {
      assert.equal(api.readProject(ws.cwd, tx), tx.project)
      assert.equal(api.projectIssue(ws.cwd, tx), null)
      api.upsertNode(ws.cwd, node('page-one'), tx)
      api.upsertNode(ws.cwd, node('page-two'), tx)
      api.addEdge(ws.cwd, 'page-one', 'page-two', 'next', tx)
      api.moveNode(ws.cwd, 'page-one', 10, 20, tx)
    })
    assert.equal(inspections, 1, 'read/check/write must share one project inspection')
    assert.equal(commits, 1, 'batch must replace project.json once')
    assert.equal(fs.existsSync(ws.lock), false)
    const project = JSON.parse(fs.readFileSync(ws.file, 'utf8'))
    assert.equal(project.nodes.length, 2)
    assert.equal(project.edges.length, 1)
    assert.equal(project.nodes[0].x, 10)
  } finally { fs.openSync = originalOpen; fs.renameSync = originalRename; syncBuiltinESMExports(); ws.cleanup() }
})

test('损坏备份保留本次inspection读取的原始字节，隐式视口不改盘', () => {
  const ws = fixture()
  const raw = Buffer.from([0xef, 0xbb, 0xbf, 0xff, 0x7b, 0x62, 0x61, 0x64, 0x0d, 0x0a])
  fs.writeFileSync(ws.file, raw)
  try {
    assert.equal(api.readProject(ws.cwd).nodes.length, 0)
    assert.ok(api.projectIssue(ws.cwd))
    api.setViewport(ws.cwd, { x: 5, y: 6, zoom: 2 })
    assert.deepEqual(fs.readFileSync(ws.file), raw)
    assert.equal(fs.readdirSync(ws.dir).some(name => name.includes('.corrupt-')), false)
    api.withProjectTransaction(ws.cwd, tx => {
      // Simulate an editor changing the path after inspection: the backup must
      // still preserve the bytes this transaction actually parsed.
      fs.writeFileSync(ws.file, '{externally-changed-after-inspection}')
      api.upsertNode(ws.cwd, node('page-recovered'), tx)
    })
    const backups = fs.readdirSync(ws.dir).filter(name => name.startsWith('project.json.corrupt-'))
    assert.equal(backups.length, 1)
    assert.deepEqual(fs.readFileSync(join(ws.dir, backups[0])), raw, 'invalid UTF-8 must not be re-encoded before backup')
    assert.equal(api.readProject(ws.cwd).nodes[0].id, 'page-recovered')
    assert.equal(fs.existsSync(ws.lock), false)
  } finally { ws.cleanup() }
})

test('损坏根、无效节点和无效简报的隐式视口均不覆盖或备份，显式修复保存原字节', () => {
  const cases = [
    '{not-json',
    JSON.stringify({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [{ id: '../bad', type: 'page' }], edges: [] }),
    JSON.stringify({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [node('page-valid')], edges: [], pageBriefs: { 'page-valid': { version: 999, purpose: false } } }),
  ]
  for (const raw of cases) {
    const ws = fixture()
    try {
      fs.writeFileSync(ws.file, raw)
      assert.ok(api.projectIssue(ws.cwd), 'precondition: fixture must be detected as unhealthy')
      api.setViewport(ws.cwd, { x: 100, y: 200, zoom: 1.5 })
      assert.equal(fs.readFileSync(ws.file, 'utf8'), raw)
      assert.equal(fs.readdirSync(ws.dir).some(name => name.includes('.corrupt-')), false)
      api.upsertNode(ws.cwd, node('page-repair'))
      const backups = fs.readdirSync(ws.dir).filter(name => name.startsWith('project.json.corrupt-'))
      assert.equal(backups.length, 1)
      assert.equal(fs.readFileSync(join(ws.dir, backups[0]), 'utf8'), raw)
    } finally { ws.cleanup() }
  }
})

test('回调抛错和异步回调被拒后释放锁，暂存页面与项目均不提交', () => {
  const ws = fixture()
  const before = fs.readFileSync(ws.file)
  try {
    assert.throws(() => api.withProjectTransaction(ws.cwd, tx => {
      tx.stagePageHtml('page-aborted', '<p>staged</p>')
      api.upsertNode(ws.cwd, node('page-aborted'), tx)
      throw new Error('expected abort')
    }), /expected abort/)
    assert.deepEqual(fs.readFileSync(ws.file), before)
    assert.deepEqual(fs.readdirSync(join(ws.dir, 'pages')), [])
    assert.equal(fs.existsSync(ws.lock), false)
    assert.throws(() => api.withProjectTransaction(ws.cwd, async () => 42), /同步|Promise|async|异步/i)
    assert.equal(fs.existsSync(ws.lock), false)
    api.upsertNode(ws.cwd, node('page-after-error'))
    assert.equal(api.readProject(ws.cwd).nodes.length, 1)
  } finally { ws.cleanup() }
})

test('两个独立进程屏障竞争：立即409类拒绝，释放后重试保留双方更新', { timeout: 30000 }, async () => {
  const ws = fixture()
  const holder = worker(ws.cwd, 'page-first', 'hold')
  const contender = worker(ws.cwd, 'page-second')
  try {
    await Promise.all([holder.next('ready'), contender.next('ready')])
    holder.write(); await holder.next('locked')
    const lock = JSON.parse(fs.readFileSync(ws.lock, 'utf8'))
    assert.equal(typeof lock.pid, 'number')
    assert.ok(Object.values(lock).some(value => typeof value === 'string' && /^[0-9a-f-]{16,}$/i.test(value)), 'lock must contain a random ownership token')
    const started = performance.now()
    contender.write()
    const rejected = await contender.next('result')
    assert.equal(rejected.ok, false)
    assert.equal(rejected.code, 'WORKSPACE_BUSY')
    assert.match(rejected.message, /重试/)
    assert.ok(performance.now() - started < 2000, 'contention must fail promptly rather than poll')
    fs.writeFileSync(join(ws.cwd, 'release-holder'), '')
    assert.equal((await holder.next('result')).ok, true)
    assert.equal(fs.existsSync(ws.lock), false)
    contender.write(); assert.equal((await contender.next('result')).ok, true)
    assert.deepEqual(api.readProject(ws.cwd).nodes.map(n => n.id).sort(), ['page-first', 'page-second'])
  } finally { await Promise.all([holder.stop(), contender.stop()]); ws.cleanup() }
})

test('强杀独立持锁进程保留遗留锁，不按时间或PID抢占，人工清理后恢复', { timeout: 30000 }, async () => {
  const ws = fixture()
  const holder = worker(ws.cwd, 'page-killed', 'hold')
  try {
    await holder.next('ready'); holder.write(); await holder.next('locked')
    await holder.stop()
    const abandoned = fs.readFileSync(ws.lock)
    assert.throws(() => api.upsertNode(ws.cwd, node('page-denied')), error => error.code === 'WORKSPACE_BUSY')
    assert.deepEqual(fs.readFileSync(ws.lock), abandoned)
    assert.equal(api.readProject(ws.cwd).nodes.length, 0)
    fs.rmSync(ws.lock)
    api.upsertNode(ws.cwd, node('page-retried'))
    assert.equal(api.readProject(ws.cwd).nodes[0].id, 'page-retried')
  } finally { await holder.stop(); ws.cleanup() }
})

test('畸形、目录链接、被替换的锁不自动删除；其他工作区仍可提交', () => {
  const ws = fixture()
  const other = fixture()
  try {
    fs.writeFileSync(ws.lock, '{malformed')
    assert.throws(() => api.upsertNode(ws.cwd, node('page-denied')), error => error.code === 'WORKSPACE_BUSY')
    assert.equal(fs.readFileSync(ws.lock, 'utf8'), '{malformed')
    api.upsertNode(other.cwd, node('page-independent'))
    assert.equal(api.readProject(other.cwd).nodes.length, 1)
    fs.rmSync(ws.lock)
    fs.symlinkSync(other.dir, ws.lock, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => api.upsertNode(ws.cwd, node('page-denied')))
    assert.equal(fs.lstatSync(ws.lock).isSymbolicLink(), true)
    assert.equal(fs.existsSync(other.file), true)
    fs.rmSync(ws.lock)
    const replacement = '{replaced-while-owned}'
    try {
      api.withProjectTransaction(ws.cwd, tx => {
        fs.renameSync(ws.lock, ws.lock + '.owned')
        fs.writeFileSync(ws.lock, replacement)
        api.upsertNode(ws.cwd, node('page-must-not-commit'), tx)
      })
    } catch { /* Refusing commit after ownership loss is permitted and preferred. */ }
    assert.equal(fs.readFileSync(ws.lock, 'utf8'), replacement)
    assert.equal(fs.existsSync(ws.lock + '.owned'), true)
    fs.rmSync(ws.lock)
    let modified
    assert.throws(() => api.withProjectTransaction(ws.cwd, tx => {
      const owned = fs.readFileSync(ws.lock, 'utf8')
      const record = JSON.parse(owned)
      assert.equal(typeof record.token, 'string')
      record.token = (record.token[0] === '0' ? '1' : '0') + record.token.slice(1)
      modified = JSON.stringify(record) + (owned.endsWith('\n') ? '\n' : '')
      assert.equal(Buffer.byteLength(modified), Buffer.byteLength(owned), 'precondition: same inode and size; only holder bytes differ')
      fs.writeFileSync(ws.lock, modified)
      api.upsertNode(ws.cwd, node('page-must-not-commit'), tx)
    }), error => error.code === 'WORKSPACE_BUSY')
    assert.equal(fs.readFileSync(ws.lock, 'utf8'), modified, 'matching inode alone must not authorize removing tampered lock bytes')
    assert.equal(api.readProject(ws.cwd).nodes.length, 0)
  } finally { ws.cleanup(); other.cleanup() }
})

test('批量最终输入校验失败不提前发布已暂存HTML、删除或项目元数据', () => {
  const ws = fixture()
  try {
    api.withProjectTransaction(ws.cwd, tx => {
      tx.stagePageHtml('page-existing', '<p>must remain</p>')
      api.upsertNode(ws.cwd, node('page-existing'), tx)
    })
    const before = fs.readFileSync(ws.file)
    assert.throws(() => api.withProjectTransaction(ws.cwd, tx => {
      tx.stagePageHtml('page-new', '<p>must not be published</p>')
      tx.stageDelete(join(ws.dir, 'pages', 'page-existing.html'))
      api.upsertNode(ws.cwd, node('page-new'), tx)
      tx.project.edges.push({ id: 'invalid-edge' })
      tx.markProjectChanged()
    }), /无效|invalid/i)
    assert.deepEqual(fs.readFileSync(ws.file), before)
    assert.equal(fs.readFileSync(join(ws.dir, 'pages', 'page-existing.html'), 'utf8'), '<p>must remain</p>')
    assert.equal(fs.existsSync(join(ws.dir, 'pages', 'page-new.html')), false)
    assert.equal(fs.existsSync(ws.lock), false)
  } finally { ws.cleanup() }
})

test('通用stageFile不能绕过HTML限额，重叠写删在任何正式文件变更前拒绝', () => {
  const ws = fixture()
  try {
    const file = join(ws.dir, 'pages', 'page-existing.html')
    fs.writeFileSync(file, '<p>original</p>')
    const before = fs.readFileSync(ws.file)
    assert.throws(() => api.withProjectTransaction(ws.cwd, tx => {
      tx.stageFile(file, Buffer.alloc(8 * 1024 * 1024 + 1, 97))
    }), error => error.code === 'HTML_SIZE_LIMIT')
    for (const action of [
      tx => { tx.stageFile(file, '<p>changed</p>'); tx.stageDelete(join(ws.dir, 'pages'), true) },
      tx => { tx.stageFile(join(ws.dir, 'pages'), 'not-a-directory'); tx.stageFile(file, '<p>changed</p>') },
    ]) {
      assert.throws(() => api.withProjectTransaction(ws.cwd, action), /重叠|普通文件|目录/)
      assert.deepEqual(fs.readFileSync(ws.file), before)
      assert.equal(fs.readFileSync(file, 'utf8'), '<p>original</p>')
      assert.equal(fs.existsSync(ws.lock), false)
    }
    assert.deepEqual(fs.readdirSync(join(ws.dir, 'pages')), ['page-existing.html'])
  } finally { ws.cleanup() }
})
