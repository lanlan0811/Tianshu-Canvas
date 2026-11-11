/** Real plugin-tool regression tests: intent survives edits without inventing approval. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools, api } = await loadPlugin(pathToFileURL(join(root, 'dist/index.mjs')).href)
after(async () => { await api.dispose?.() })
const pageId = 'page-brief-test'
const html = '<!doctype html><html><body><main><h1>Original content</h1></main></body></html>'

function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-brief-'))
  const dir = join(cwd, '.tianshu-canvas')
  mkdirSync(join(dir, 'pages'), { recursive: true })
  const node = { id: pageId, type: 'page', title: 'Intent', x: 0, y: 0, width: 1440, height: 900, deviceType: 'desktop', htmlPath: `.tianshu-canvas/pages/${pageId}.html`, createdAt: 1, updatedAt: 1 }
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [node], edges: [] }) + '\n')
  writeFileSync(join(dir, 'pages', `${pageId}.html`), html)
  return { cwd, file: join(dir, 'project.json'), cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

const read = (cwd) => JSON.parse(readFileSync(join(cwd, '.tianshu-canvas/project.json'), 'utf8'))
const brief = (cwd, data, id = pageId) => tools.canvas_style.execute({ input: { action: 'brief', page_id: id, ...(data === undefined ? {} : { brief: data }) }, cwd })
async function okay(cwd, data, id) {
  const result = await brief(cwd, data, id)
  assert.ok(!result.isError, result.content)
  return result
}

test('旧项目读取无简报：不迁移、不改写项目或页面', async () => {
  const ws = workspace()
  try {
    const before = readFileSync(ws.file, 'utf8')
    await okay(ws.cwd)
    assert.equal(readFileSync(ws.file, 'utf8'), before)
    assert.equal(read(ws.cwd).pageBriefs, undefined)
    assert.equal(readFileSync(join(ws.cwd, '.tianshu-canvas/pages', `${pageId}.html`), 'utf8'), html)
  } finally { ws.cleanup() }
})

test('内容简报往返保存与部分更新，草稿方向不等于用户认可', async () => {
  const ws = workspace()
  try {
    const input = { audience: ' 独立创作者 ', purpose: '展示实体产品', proposition: '本地优先', primaryAction: '查看样品', evidence: ['用户提供的规格说明'], assets: ['images/product.svg'], brandConstraints: ['保持深绿品牌色'], prototypeId: 'product-showcase', directionId: 'product-evidence' }
    await okay(ws.cwd, input)
    const saved = read(ws.cwd).pageBriefs[pageId]
    assert.equal(saved.version, 1)
    assert.equal(saved.audience, '独立创作者')
    for (const field of ['purpose', 'proposition', 'primaryAction', 'evidence', 'assets', 'brandConstraints', 'prototypeId', 'directionId']) assert.deepEqual(saved[field], input[field])
    assert.equal(saved.confirmedDirection, undefined)
    assert.ok(Number.isFinite(saved.updatedAt) && saved.updatedAt > 0)
    const loaded = await okay(ws.cwd)
    assert.match(loaded.content, /独立创作者/)
    await okay(ws.cwd, { purpose: '新的目标', evidence: [] })
    const changed = read(ws.cwd).pageBriefs[pageId]
    assert.equal(changed.purpose, '新的目标')
    assert.equal(changed.audience, '独立创作者')
    assert.deepEqual(changed.evidence, [])
    assert.equal(changed.confirmedDirection, undefined)
    assert.equal(readFileSync(join(ws.cwd, '.tianshu-canvas/pages', `${pageId}.html`), 'utf8'), html)
  } finally { ws.cleanup() }
})

test('只有显式确认才创建决定；读写与原位深化保留原确认时间，改方向清理旧确认', async () => {
  const ws = workspace()
  try {
    await okay(ws.cwd, { confirmation: { confirmed: true, directionId: 'editorial-narrative', reason: '用户选择 A：阅读节奏适合长文内容' } })
    const confirmed = read(ws.cwd).pageBriefs[pageId].confirmedDirection
    assert.equal(confirmed.directionId, 'editorial-narrative')
    assert.ok(confirmed.confirmedAt > 0)
    await okay(ws.cwd)
    await okay(ws.cwd, { proposition: '深化内容不重选方向', directionId: 'editorial-narrative' })
    assert.deepEqual(read(ws.cwd).pageBriefs[pageId].confirmedDirection, confirmed)
    const update = await tools.canvas_upsert_page.execute({ input: { id: pageId, html: '<h1>Expanded page</h1>' }, cwd: ws.cwd })
    assert.ok(!update.isError, update.content)
    assert.deepEqual(read(ws.cwd).pageBriefs[pageId].confirmedDirection, confirmed)
    await okay(ws.cwd, { directionId: 'brand-poster' })
    const changed = read(ws.cwd).pageBriefs[pageId]
    assert.equal(changed.directionId, 'brand-poster')
    assert.equal(changed.confirmedDirection, undefined)
  } finally { ws.cleanup() }
})

test('无效字段、方向、原型与伪造确认全部拒绝，磁盘字节不变', async () => {
  const ws = workspace()
  try {
    await okay(ws.cwd, { audience: '已有内容' })
    const before = readFileSync(ws.file, 'utf8')
    const invalid = [
      null, [], 'text', {}, { transcript: '完整对话' }, { updatedAt: 0 }, { version: 1 },
      { confirmedDirection: { directionId: 'brand-poster', reason: '伪造', confirmedAt: 0 } },
      { directionId: '../outside' }, { directionId: 'apple' }, { prototypeId: '../../secrets' }, { prototypeId: 'toString' },
      { audience: 1 }, { audience: null }, { evidence: 'not an array' }, { evidence: [''] }, { evidence: [1] },
      { audience: 'a'.repeat(2001) }, { evidence: Array(21).fill('proof') },
      { evidence: Array(9).fill('p'.repeat(2000)) },
      { confirmation: { confirmed: false, directionId: 'brand-poster', reason: '未选择' } },
      { confirmation: { confirmed: 'true', directionId: 'brand-poster', reason: '错误类型' } },
      { confirmation: { confirmed: true, directionId: 'brand-poster', reason: '' } },
      { confirmation: { confirmed: true, directionId: 'brand-poster', reason: '理由', confirmedAt: 1 } },
      { directionId: 'product-evidence', confirmation: { confirmed: true, directionId: 'brand-poster', reason: '矛盾' } },
      JSON.parse('{"__proto__":{"polluted":true}}'), { constructor: 'invalid' },
    ]
    for (const input of invalid) {
      const result = await brief(ws.cwd, input)
      assert.equal(result.isError, true, `应拒绝 ${JSON.stringify(input).slice(0, 100)}：${result.content}`)
      assert.equal(readFileSync(ws.file, 'utf8'), before, '失败不能擦除或部分保存简报')
    }
    assert.equal({}.polluted, undefined)
  } finally { ws.cleanup() }
})

test('缺失/非法页面拒绝，不创建隐式页面和简报', async () => {
  const ws = workspace()
  try {
    const before = readFileSync(ws.file, 'utf8')
    for (const id of ['missing-page', '../outside', '__proto__']) {
      assert.equal((await brief(ws.cwd, { purpose: 'x' }, id)).isError, true)
      assert.equal((await brief(ws.cwd, undefined, id)).isError, true)
    }
    const missing = await tools.canvas_style.execute({ input: { action: 'brief', brief: { purpose: 'x' } }, cwd: ws.cwd })
    assert.equal(missing.isError, true)
    assert.equal(readFileSync(ws.file, 'utf8'), before)
  } finally { ws.cleanup() }
})

test('复制保留原决定且互相独立，删除清理自身简报，最后删除不残留空字段', async () => {
  const ws = workspace()
  try {
    await okay(ws.cwd, { audience: '原页面', evidence: ['proof'], confirmation: { confirmed: true, directionId: 'product-evidence', reason: '用户选择产品演示' } })
    const original = read(ws.cwd).pageBriefs[pageId]
    const copied = await tools.canvas_arrange.execute({ input: { action: 'duplicate', id: pageId }, cwd: ws.cwd })
    assert.ok(!copied.isError, copied.content)
    const copyId = read(ws.cwd).nodes.find((node) => node.id !== pageId).id
    assert.deepEqual(read(ws.cwd).pageBriefs[copyId], original)
    await okay(ws.cwd, { audience: '副本', evidence: ['different'] }, copyId)
    assert.deepEqual(read(ws.cwd).pageBriefs[pageId], original)
    assert.equal(read(ws.cwd).pageBriefs[copyId].confirmedDirection.confirmedAt, original.confirmedDirection.confirmedAt)
    const removed = await tools.canvas_arrange.execute({ input: { action: 'remove', id: pageId }, cwd: ws.cwd })
    assert.ok(!removed.isError, removed.content)
    assert.equal(Object.hasOwn(read(ws.cwd).pageBriefs, pageId), false)
    assert.ok(read(ws.cwd).pageBriefs[copyId])
    const removedCopy = await tools.canvas_arrange.execute({ input: { action: 'remove', id: copyId }, cwd: ws.cwd })
    assert.ok(!removedCopy.isError, removedCopy.content)
    assert.equal(read(ws.cwd).pageBriefs, undefined)
  } finally { ws.cleanup() }
})

test('相同页面 ID 的不同工作区内容严格隔离，后续读写不会沿用缓存', async () => {
  const first = workspace()
  const second = workspace()
  try {
    await okay(first.cwd, { audience: 'A_ONLY', confirmation: { confirmed: true, directionId: 'brand-poster', reason: 'A选择' } })
    const result = await okay(second.cwd)
    assert.doesNotMatch(result.content, /A_ONLY|A选择/)
    assert.equal(read(second.cwd).pageBriefs, undefined)
    await okay(second.cwd, { audience: 'B_ONLY', directionId: 'product-evidence' })
    assert.equal(read(first.cwd).pageBriefs[pageId].audience, 'A_ONLY')
    assert.equal(read(second.cwd).pageBriefs[pageId].confirmedDirection, undefined)
    await okay(first.cwd, { purpose: '后续操作' })
    assert.equal(read(first.cwd).pageBriefs[pageId].confirmedDirection.reason, 'A选择')
  } finally { first.cleanup(); second.cleanup() }
})

test('损坏或无效存盘简报不伪装成空数据，失败不覆盖，人工修复后可恢复', async () => {
  const ws = workspace()
  try {
    const healthy = read(ws.cwd)
    const invalid = [
      '{broken',
      JSON.stringify({ ...healthy, pageBriefs: [] }),
      JSON.stringify({ ...healthy, pageBriefs: { [pageId]: { version: 1, updatedAt: 1, directionId: 'bogus' } } }),
      JSON.stringify({ ...healthy, pageBriefs: { 'missing-page': { version: 1, updatedAt: 1 } } }),
      JSON.stringify({ ...healthy, pageBriefs: { [pageId]: { version: 1, updatedAt: 1, directionId: 'brand-poster', confirmedDirection: { directionId: 'product-evidence', reason: '矛盾', confirmedAt: 1 } } } }),
    ]
    for (const bytes of invalid) {
      writeFileSync(ws.file, bytes)
      assert.equal((await brief(ws.cwd)).isError, true)
      assert.equal((await brief(ws.cwd, { audience: '禁止覆盖' })).isError, true)
      assert.equal(readFileSync(ws.file, 'utf8'), bytes)
    }
    writeFileSync(ws.file, JSON.stringify(healthy))
    await okay(ws.cwd, { audience: '恢复成功' })
    assert.equal(read(ws.cwd).pageBriefs[pageId].audience, '恢复成功')
  } finally { ws.cleanup() }
})

test('项目目录 junction 越界：拒绝读写且外部简报字节不变', async () => {
  const ws = workspace()
  const outside = workspace()
  try {
    const outsideBytes = readFileSync(outside.file, 'utf8')
    rmSync(join(ws.cwd, '.tianshu-canvas'), { recursive: true, force: true })
    symlinkSync(join(outside.cwd, '.tianshu-canvas'), join(ws.cwd, '.tianshu-canvas'), 'junction')
    assert.equal((await brief(ws.cwd)).isError, true)
    assert.equal((await brief(ws.cwd, { audience: '不得泄露或覆盖' })).isError, true)
    assert.equal(readFileSync(outside.file, 'utf8'), outsideBytes)
    assert.deepEqual(readdirSync(join(outside.cwd, '.tianshu-canvas')).sort(), ['pages', 'project.json'])
  } finally { ws.cleanup(); outside.cleanup() }
})
