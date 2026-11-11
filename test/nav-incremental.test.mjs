import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

// Compile only the independent navigation/storage surface: no global server,
// browser or production dist rewrite is needed to exercise transaction behavior.
const root = resolve(import.meta.dirname, '..')
const compiled = mkdtempSync(join(tmpdir(), 'tsc-nav-module-'))
const entry = join(compiled, 'navigation.mjs')
await build({
  stdin: { contents: `export * from './src/nav.ts'; export * from './src/navigation.ts'; export * from './src/project.ts'; export * from './src/limits.ts'`, resolveDir: root, loader: 'ts' },
  outfile: entry, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent',
})
const nav = await import(pathToFileURL(entry).href)
process.on('exit', () => rmSync(compiled, { recursive: true, force: true }))

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-nav-incremental-'))
  const htmlPath = (id) => join(cwd, '.tianshu-canvas', 'pages', `${id}.html`)
  const read = (id) => readFileSync(htmlPath(id), 'utf8')
  const mutate = (callback = () => {}) => nav.withProjectTransaction(cwd, (tx) => {
    callback(tx)
    return nav.backfillNavigation(cwd, tx)
  })
  const add = (tx, id, title, html = '<p>body</p>') => {
    const now = Date.now()
    tx.stagePageHtml(id, html)
    tx.project.nodes.push({ id, title, type: 'page', x: 0, y: 0, width: 320, height: 600, deviceType: 'mobile', htmlPath: `.tianshu-canvas/pages/${id}.html`, htmlRev: now, createdAt: now, updatedAt: now })
    tx.markProjectChanged()
  }
  return { cwd, htmlPath, read, mutate, add, dispose() { nav.clearNavigationCache(cwd); rmSync(cwd, { recursive: true, force: true }) } }
}

test('a shared navigation lookup preserves parser rules and deterministic ID preference', () => {
  const index = nav.createNavIndex([{ id: 'page-aaaaaaaa', title: '首页' }, { id: 'page-bbbbbbbb', title: '产品 详情' }])
  const source = `<script>const x='<a href="产品-详情.html">'</script><!-- <a href="产品-详情.html"> --><style>x{content:'<a href="产品-详情.html">'}</style><a href="%E4%BA%A7%E5%93%81-%E8%AF%A6%E6%83%85.html">go</a><a data-nav="page-aaaaaaaa">home</a><a href="https://example.com/x.html">external</a><a href="#top">anchor</a>`
  const parsed = nav.parseNavDocument(source)
  assert.equal(parsed.anchors.length, 2)
  const output = nav.rewriteParsedNavLinks(parsed, index, '')
  assert.equal(output.rewritten, 2)
  assert.match(output.html, /href="page-bbbbbbbb.html"/)
  assert.match(output.html, /data-nav="page-aaaaaaaa" href="page-aaaaaaaa.html"/)
  assert.ok(output.html.startsWith(source.slice(0, source.indexOf('<a href="%'))))
  assert.ok(output.html.includes('href="https://example.com/x.html"'))
  assert.match(output.html, /href="#top"/)
})

test('legacy parser ID-to-slug fallback remains explicit after a target is removed', () => {
  const ref = { dataNav: null, href: 'page-aaaaaaaa.html' }
  assert.equal(nav.resolveNavRef(ref, [{ id: 'page-aaaaaaaa', title: 'original' }, { id: 'page-other', title: 'page-aaaaaaaa' }]).target, 'page-aaaaaaaa')
  // Version 1 stores no provenance distinguishing a literal slug from an old
  // normalized ID. Preserve the pre-existing parser behavior rather than infer it.
  assert.equal(nav.resolveNavRef(ref, [{ id: 'page-other', title: 'page-aaaaaaaa' }]).target, 'page-other')
  assert.equal(nav.resolveNavRef({ dataNav: 'page-aaaaaaaa', href: null }, [{ id: 'page-other', title: 'page-aaaaaaaa' }]).target, null)
})

test('warm exact-ID deletion matches a cold rebuild when its literal slug exists', () => {
  const f = fixture()
  try {
    f.mutate((tx) => {
      f.add(tx, 'page-source', '来源', '<a href="page-target.html">id</a><a data-nav="page-target">explicit</a>')
      f.add(tx, 'page-target', '原目标')
      f.add(tx, 'page-fallback', 'page-target')
    })
    const renamed = f.mutate((tx) => { tx.project.nodes.find((node) => node.id === 'page-target').title = '改名'; tx.markProjectChanged() })
    assert.equal(renamed.stats.bodyReads, 0, 'renaming an exact target never rereads stable links')
    const removed = f.mutate((tx) => {
      tx.project.nodes = tx.project.nodes.filter((node) => node.id !== 'page-target')
      tx.stageDelete(f.htmlPath('page-target'))
      tx.markProjectChanged()
    })
    assert.equal(removed.stats.bodyReads, 1)
    assert.deepEqual(removed.changed, ['来源'])
    assert.equal(f.read('page-source'), '<a href="page-fallback.html">id</a><a data-nav="page-target" href="page-target.html">explicit</a>')
    nav.clearNavigationCache(f.cwd)
    assert.deepEqual(f.mutate().changed, [])
  } finally { f.dispose() }
})

test('warm creates read only the affected forward source; move/no-op keeps bytes and revisions', () => {
  const f = fixture()
  try {
    f.mutate((tx) => {
      f.add(tx, 'page-aaaaaaaa', '首页', '<a href="详情.html">go</a>')
      for (let i = 0; i < 50; i++) f.add(tx, `page-static-${i}`, `静态 ${i}`)
    })
    const initial = nav.readProject(f.cwd).nodes.find((node) => node.id === 'page-aaaaaaaa')
    const changed = f.mutate((tx) => f.add(tx, 'page-bbbbbbbb', '详情'))
    assert.deepEqual(changed.changed, ['首页'])
    assert.equal(changed.stats.bodyReads, 1, 'only the cached forward-reference source is read')
    assert.match(f.read('page-aaaaaaaa'), /href="page-bbbbbbbb.html"/)
    const stable = nav.readProject(f.cwd).nodes.find((node) => node.id === 'page-aaaaaaaa')
    assert.ok(stable.htmlRev > initial.htmlRev)
    const before = statSync(f.htmlPath('page-aaaaaaaa'), { bigint: true })
    const move = f.mutate((tx) => { tx.project.nodes[0].x = 100; tx.markProjectChanged() })
    assert.equal(move.stats.bodyReads, 0)
    assert.equal(move.stats.parsed, 0)
    assert.deepEqual(move.changed, [])
    const after = statSync(f.htmlPath('page-aaaaaaaa'), { bigint: true })
    assert.equal(after.mtimeNs, before.mtimeNs)
    assert.equal(nav.readProject(f.cwd).nodes[0].htmlRev, stable.htmlRev)
    assert.equal(f.mutate().stats.bodyReads, 0)
  } finally { f.dispose() }
})

test('ambiguous sources remain wholly unchanged and deferred resolved links recover on rename/delete', () => {
  const f = fixture()
  try {
    const source = '<a href="详情.html">ambiguous</a><a href="later.html">later</a>'
    const first = f.mutate((tx) => {
      f.add(tx, 'page-source', '来源', source)
      f.add(tx, 'page-a', '详情')
      f.add(tx, 'page-b', '详情')
    })
    assert.match(first.warnings.join(''), /歧义/)
    f.mutate((tx) => f.add(tx, 'page-later', 'later'))
    assert.equal(f.read('page-source'), source, 'one ambiguous reference defers every rewrite')
    const renamed = f.mutate((tx) => {
      tx.project.nodes.find((node) => node.id === 'page-b').title = '其他'
      tx.markProjectChanged()
    })
    assert.deepEqual(renamed.changed, ['来源'])
    assert.equal(f.read('page-source'), '<a href="page-a.html">ambiguous</a><a href="page-later.html">later</a>')
    // Already normalized IDs stay attached when duplicate titles are introduced.
    f.mutate((tx) => { tx.project.nodes.find((node) => node.id === 'page-b').title = '详情'; tx.markProjectChanged() })
    assert.match(f.read('page-source'), /href="page-a.html"/)
    // A new ambiguous externally edited page must recover when a duplicate is removed.
    writeFileSync(f.htmlPath('page-source'), '<a href="详情.html">new ambiguity</a>')
    f.mutate()
    const removed = f.mutate((tx) => {
      tx.project.nodes = tx.project.nodes.filter((node) => node.id !== 'page-b')
      tx.stageDelete(f.htmlPath('page-b'))
      tx.markProjectChanged()
    })
    assert.deepEqual(removed.changed, ['来源'])
    assert.match(f.read('page-source'), /href="page-a.html"/)
  } finally { f.dispose() }
})

test('external replacement, restart and changed HTML reindex only relevant bodies', () => {
  const f = fixture()
  try {
    f.mutate((tx) => { f.add(tx, 'page-source', '来源', '<p>old</p>'); f.add(tx, 'page-target', '目标') })
    writeFileSync(f.htmlPath('page-source'), '<a href="目标.html">external</a>')
    const external = f.mutate()
    assert.equal(external.stats.bodyReads, 1)
    assert.deepEqual(external.changed, ['来源'])
    assert.equal(f.read('page-source'), '<a href="page-target.html">external</a>')
    f.mutate((tx) => tx.stagePageHtml('page-source', '<a href="新目标.html">changed</a>'))
    assert.deepEqual(f.mutate((tx) => f.add(tx, 'page-new', '新目标')).changed, ['来源'])
    nav.clearNavigationCache(f.cwd)
    const restart = f.mutate()
    assert.equal(restart.stats.bodyReads, 3)
    assert.deepEqual(restart.changed, [])
  } finally { f.dispose() }
})

test('atomic external replacement is detected even when file length and mtime are preserved', () => {
  const f = fixture()
  try {
    f.mutate((tx) => { f.add(tx, 'page-source', '来源', '<a href="old.html">old</a>'); f.add(tx, 'page-target', 'new') })
    const file = f.htmlPath('page-source')
    const before = statSync(file)
    writeFileSync(file + '.replacement', '<a href="new.html">new</a>')
    utimesSync(file + '.replacement', before.atime, before.mtime)
    renameSync(file + '.replacement', file)
    const updated = f.mutate()
    assert.equal(updated.stats.bodyReads, 1)
    assert.deepEqual(updated.changed, ['来源'])
    assert.equal(f.read('page-source'), '<a href="page-target.html">new</a>')
  } finally { f.dispose() }
})

test('failed transactions cannot publish navigation metadata or new HTML into the cache', () => {
  const f = fixture()
  try {
    f.mutate((tx) => f.add(tx, 'page-source', '来源', '<a href="later.html">later</a>'))
    const originalProject = readFileSync(join(f.cwd, '.tianshu-canvas', 'project.json'))
    const originalHtml = f.read('page-source')
    assert.throws(() => nav.withProjectTransaction(f.cwd, (tx) => {
      f.add(tx, 'page-later', 'later')
      nav.backfillNavigation(f.cwd, tx)
      throw new Error('reject after navigation')
    }), /reject after navigation/)
    assert.deepEqual(readFileSync(join(f.cwd, '.tianshu-canvas', 'project.json')), originalProject)
    assert.equal(f.read('page-source'), originalHtml)
    const retry = f.mutate((tx) => f.add(tx, 'page-later', 'later'))
    assert.deepEqual(retry.changed, ['来源'])
    assert.match(f.read('page-source'), /href="page-later.html"/)
  } finally { f.dispose() }
})

test('legacy over-limit pages retain exact bytes and warn when automatic backfill would stay oversized', () => {
  const f = fixture()
  try {
    f.mutate((tx) => f.add(tx, 'page-source', '旧页面'))
    const oldHtml = '<a href="目标.html">target</a>' + '中'.repeat(Math.ceil(nav.MAX_HTML_BYTES / 3))
    writeFileSync(f.htmlPath('page-source'), oldHtml)
    f.mutate()
    const revision = nav.readProject(f.cwd).nodes[0].htmlRev
    const result = f.mutate((tx) => f.add(tx, 'page-target', '目标'))
    assert.equal(f.read('page-source'), oldHtml)
    assert.equal(nav.readProject(f.cwd).nodes[0].htmlRev, revision)
    assert.deepEqual(result.changed, [])
    assert.match(result.warnings.join(''), /8 MiB/)
  } finally { f.dispose() }
})

test('separate workspaces never share forward-reference candidates', () => {
  const a = fixture()
  const b = fixture()
  try {
    a.mutate((tx) => a.add(tx, 'page-source', '来源', '<a href="目标.html">target</a>'))
    b.mutate((tx) => b.add(tx, 'page-source', '来源', '<p>isolated</p>'))
    assert.equal(b.mutate((tx) => b.add(tx, 'page-target', '目标')).stats.bodyReads, 0)
    assert.equal(b.read('page-source'), '<p>isolated</p>')
    assert.deepEqual(a.mutate((tx) => a.add(tx, 'page-target', '目标')).changed, ['来源'])
  } finally { a.dispose(); b.dispose() }
})
