/** 操作审计日志：追加、差异推导、裁剪与边界。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const apiDir = fs.mkdtempSync(join(tmpdir(), 'tsc-history-api-'))
const apiFile = join(apiDir, 'project.mjs')
await build({ entryPoints: [join(root, 'src/project.ts')], outfile: apiFile, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent' })
const api = await import(pathToFileURL(apiFile).href)
after(() => fs.rmSync(apiDir, { recursive: true, force: true }))

function fixture() {
  const cwd = fs.mkdtempSync(join(tmpdir(), 'tsc-history-'))
  const dir = join(cwd, '.tianshu-canvas')
  fs.mkdirSync(join(dir, 'pages'), { recursive: true })
  fs.writeFileSync(join(dir, 'project.json'), JSON.stringify({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] }) + '\n')
  return { cwd, dir, file: join(dir, 'project.json'), history: join(dir, 'history.jsonl'), cleanup: () => fs.rmSync(cwd, { recursive: true, force: true }) }
}

function node(id, title = id) {
  return { id, type: 'page', title, x: 0, y: 0, width: 1440, height: 900, deviceType: 'desktop', htmlPath: `.tianshu-canvas/pages/${id}.html`, createdAt: 1, updatedAt: 1 }
}

function lines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim())
}

test('成功写入追加一条记录，含时间、进程与变更，且不含 HTML 正文', () => {
  const ws = fixture()
  try {
    api.withProjectTransaction(ws.cwd, (tx) => {
      tx.stagePageHtml('page-a', '<p>secret-body-marker</p>')
      api.upsertNode(ws.cwd, node('page-a', '首页'), tx)
    })
    const entries = lines(ws.history).map((line) => JSON.parse(line))
    assert.equal(entries.length, 1)
    const [entry] = entries
    assert.equal(entry.actor, 'local')
    assert.equal(entry.pid, process.pid)
    assert.equal(typeof entry.ts, 'number')
    assert.ok(entry.changes.some((c) => c.kind === 'page.add' && c.id === 'page-a' && c.bytes > 0))
    const raw = fs.readFileSync(ws.history, 'utf8')
    assert.equal(raw.includes('secret-body-marker'), false, '日志不能包含页面正文')
  } finally { ws.cleanup() }
})

test('重命名、移动、换风格、批注与连线各自产生一条可读差异', () => {
  const ws = fixture()
  try {
    api.withProjectTransaction(ws.cwd, (tx) => {
      tx.stagePageHtml('page-a', '<p>a</p>')
      api.upsertNode(ws.cwd, node('page-a', '旧名'), tx)
    })
    api.renameNode?.(ws.cwd, 'page-a', '新名')
    const project = api.readProject(ws.cwd)
    api.withProjectTransaction(ws.cwd, (tx) => {
      tx.project.nodes[0].x = 400
      tx.project.design = { styleId: 'apple', updatedAt: Date.now() }
      tx.project.comments = [{ id: 'c1', pageId: 'page-a', xpath: '/html/body/p', tagName: 'p', note: '改大一点', createdAt: Date.now(), resolved: false }]
      tx.markProjectChanged()
    })
    const entries = lines(ws.history).map((line) => JSON.parse(line))
    const kinds = entries.flatMap((entry) => entry.changes.map((change) => change.kind))
    assert.ok(kinds.includes('page.move'), kinds.join(','))
    assert.ok(kinds.includes('style.set'), kinds.join(','))
    assert.ok(kinds.includes('comment.add'), kinds.join(','))
    assert.ok(project.nodes.length === 1)
  } finally { ws.cleanup() }
})

test('被拒绝或回滚的事务不写日志', () => {
  const ws = fixture()
  try {
    assert.throws(() => api.withProjectTransaction(ws.cwd, (tx) => {
      tx.stagePageHtml('page-abort', '<p>x</p>')
      api.upsertNode(ws.cwd, node('page-abort'), tx)
      throw new Error('expected abort')
    }), /expected abort/)
    assert.equal(fs.existsSync(ws.history), false)
    const projectBefore = fs.readFileSync(ws.file)
    assert.throws(() => api.withProjectTransaction(ws.cwd, (tx) => {
      tx.stagePageHtml('page-bad', '<p>x</p>')
      api.upsertNode(ws.cwd, node('page-bad'), tx)
      tx.project.edges.push({ id: 'bad' })
      tx.markProjectChanged()
    }))
    assert.equal(fs.existsSync(ws.history), false)
    assert.deepEqual(fs.readFileSync(ws.file), projectBefore)
  } finally { ws.cleanup() }
})

test('畸形日志行不影响追加，损坏行被跳过', () => {
  const ws = fixture()
  try {
    fs.writeFileSync(ws.history, '{not json}\n{"ts":"x"}\n')
    api.withProjectTransaction(ws.cwd, (tx) => {
      tx.stagePageHtml('page-a', '<p>a</p>')
      api.upsertNode(ws.cwd, node('page-a'), tx)
    })
    const raw = fs.readFileSync(ws.history, 'utf8')
    assert.match(raw, /page.add/)
    assert.match(raw, /\{not json\}/, '损坏行原样保留，不因新写入而改写历史')
  } finally { ws.cleanup() }
})

test('超过 1 MiB 时裁剪最旧记录并保留 trimmed 标记与最新记录', () => {
  const ws = fixture()
  const filler = JSON.stringify({ ts: 1, pid: 1, actor: 'local', action: 'noop', changes: [{ kind: 'page.add', id: 'x'.repeat(200) }] })
  try {
    const many = Array.from({ length: 6000 }, () => filler).join('\n') + '\n'
    fs.writeFileSync(ws.history, many)
    assert.ok(Buffer.byteLength(many) > 1024 * 1024)
    api.withProjectTransaction(ws.cwd, (tx) => {
      tx.stagePageHtml('page-new', '<p>new</p>')
      api.upsertNode(ws.cwd, node('page-new'), tx)
    })
    const raw = fs.readFileSync(ws.history, 'utf8')
    assert.ok(Buffer.byteLength(raw) <= 1024 * 1024, '裁剪后不得超过上限')
    assert.match(raw, /"trimmed":true/)
    assert.match(raw, /page-new/)
  } finally { ws.cleanup() }
})

test('history.jsonl 被预置为目录链接时拒绝写入且不越界', () => {
  const ws = fixture()
  const outside = fs.mkdtempSync(join(tmpdir(), 'tsc-history-outside-'))
  try {
    const outsideFile = join(outside, 'victim.jsonl')
    fs.writeFileSync(outsideFile, 'keep\n')
    fs.symlinkSync(outsideFile, ws.history, 'file')
    api.withProjectTransaction(ws.cwd, (tx) => {
      tx.stagePageHtml('page-a', '<p>a</p>')
      api.upsertNode(ws.cwd, node('page-a'), tx)
    })
    // 业务操作照常成功；越界日志被拒绝，外部文件字节不变。
    assert.equal(api.readProject(ws.cwd).nodes.length, 1)
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'keep\n')
  } finally {
    ws.cleanup()
    fs.rmSync(outside, { recursive: true, force: true })
  }
})
