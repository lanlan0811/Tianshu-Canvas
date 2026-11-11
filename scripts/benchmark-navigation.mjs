/** Fixed local benchmark. Run after npm ci; never edits production dist. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const root = resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(join(tmpdir(), 'tsc-nav-benchmark-'))
const output = process.argv[2] ? resolve(process.argv[2]) : null
const originalRename = fs.renameSync
let projectCommits = 0
fs.renameSync = (source, destination) => {
  if (String(destination).endsWith('project.json')) projectCommits++
  return originalRename(source, destination)
}
syncBuiltinESMExports()
const results = []
try {
  const entry = join(temp, 'navigation.mjs')
  await build({
    stdin: { contents: "export * from './src/navigation.ts'; export * from './src/project.ts'", resolveDir: root, loader: 'ts' },
    outfile: entry, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent',
  })
  const nav = await import(pathToFileURL(entry).href)
  for (const count of [50, 200, 1000]) {
    const cwd = join(temp, 'pages-' + count)
    const pages = join(cwd, '.tianshu-canvas', 'pages')
    fs.mkdirSync(pages, { recursive: true })
    const nodes = []
    const now = 1794412800000
    const fixtureHtml = '<!doctype html><html><head><meta charset="utf-8"></head><body><p>' + '固定夹具'.repeat(128) + '</p></body></html>'
    for (let i = 0; i < count; i++) {
      const id = 'page-fixture-' + i
      const html = i === 0 ? '<a href="target-0.html">target</a>' + fixtureHtml : fixtureHtml
      nodes.push({ id, type: 'page', title: '静态 ' + i, x: (i % 20) * 380, y: Math.floor(i / 20) * 720, width: 320, height: 600, deviceType: 'mobile', htmlPath: '.tianshu-canvas/pages/' + id + '.html', htmlRev: now, createdAt: now, updatedAt: now })
      fs.writeFileSync(join(pages, id + '.html'), html)
    }
    fs.writeFileSync(join(cwd, '.tianshu-canvas', 'project.json'), JSON.stringify({ version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] }, null, 2) + String.fromCharCode(10))
    const run = (operation) => {
      projectCommits = 0
      const started = performance.now()
      const navigation = nav.withProjectTransaction(cwd, (tx) => { operation(tx); return nav.backfillNavigation(cwd, tx) })
      return { ms: performance.now() - started, ...navigation.stats, projectCommits, changed: navigation.changed.length }
    }
    const cold = run(() => {})
    assert.equal(cold.bodyReads, count)
    assert.equal(cold.projectCommits, 0)
    const rename = [], move = []
    for (let round = 0; round < 3; round++) {
      if (round > 0) run((tx) => {
        tx.project.nodes.at(-1).title = '静态 ' + (count - 1)
        tx.stagePageHtml('page-fixture-0', '<a href="target-' + round + '.html">target</a>' + fixtureHtml)
        tx.markProjectChanged()
      })
      const renamed = run((tx) => { tx.project.nodes.at(-1).title = 'target-' + round; tx.markProjectChanged() })
      assert.equal(renamed.bodyReads, 1, 'only the forward source body is reread')
      assert.equal(renamed.projectCommits, 1, 'one project commit includes navigation revisions')
      assert.equal(renamed.changed, 1)
      rename.push(renamed)
      const moved = run((tx) => { tx.project.nodes[1].x += 1; tx.markProjectChanged() })
      assert.equal(moved.bodyReads, 0, 'moving a node rereads no unrelated bodies')
      assert.equal(moved.projectCommits, 1)
      assert.equal(moved.parsed, 0)
      move.push(moved)
    }
    const summarize = (samples) => {
      const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b)
      return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], samples }
    }
    const row = { pages: count, cold, rename: summarize(rename), move: summarize(move) }
    results.push(row)
    console.log(JSON.stringify(row))
    nav.clearNavigationCache(cwd)
  }
  const evidence = { capturedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, repetitions: 3, units: 'milliseconds', results }
  if (output) { fs.mkdirSync(dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + String.fromCharCode(10)) }
} finally {
  fs.renameSync = originalRename
  syncBuiltinESMExports()
  fs.rmSync(temp, { recursive: true, force: true })
}
