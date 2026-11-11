/** Full rendered evidence for every original prototype and all six direction examples.
 * Run after npm run build: node scripts/verify-prototypes.mjs [--out <workspace-relative-dir>] [--only <id>]
 * This checks objective failures. It does not assign or approve an aesthetic score.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { buildDesignSystems } from './build-design.mjs'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(name + ' needs a value')
  return args[index + 1]
}
for (let index = 0; index < args.length; index += 2) if (!['--out', '--only'].includes(args[index])) throw new Error('Unknown option: ' + args[index])
const out = resolve(root, option('--out') ?? '.tmp/verify-prototypes/' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid)
const only = option('--only')
const digest = value => createHash('sha256').update(value).digest('hex')
const files = dir => readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)])
const textExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.svg', '.yaml', '.yml'])
const fingerprint = directories => {
  const entries = directories.flatMap(dir => files(join(root, dir))).map(file => ({ file: relative(root, file).replaceAll('\\', '/'), sha256: digest(textExtensions.has(extname(file)) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : readFileSync(file)) }))
  return { sha256: digest(JSON.stringify(entries)), files: entries.length }
}
// Freeze both source and shipped resources. A previous capture of an older
// dist tree must never pass as evidence for the current working tree.
const sourceBefore = fingerprint(['src', 'web', 'design-systems', 'scripts'])
const artifactsBefore = fingerprint(['dist'])
// Use the same realpath/junction guard as runtime writes before creating directories.
const { build: compile } = await import('esbuild')
const guard = await compile({ stdin: { contents: "export { assertInsideWorkspace } from './src/paths.ts'", resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' })
const boundary = await import('data:text/javascript;base64,' + Buffer.from(guard.outputFiles[0].text).toString('base64'))
boundary.assertInsideWorkspace(root, out, '原型验收输出')
mkdirSync(out, { recursive: true })
const expected = join(out, 'expected-build')
buildDesignSystems({ root, dist: expected })
const expectedFiles = files(join(expected, 'design'))
assert.deepEqual(files(join(root, 'dist', 'design')).map(file => relative(join(root, 'dist'), file)).sort(), expectedFiles.map(file => relative(expected, file)).sort(), 'dist/design file set is stale; run npm run build')
for (const file of expectedFiles) assert.ok(readFileSync(file).equals(readFileSync(join(root, 'dist', relative(expected, file)))), relative(expected, file) + ' differs from source; run npm run build')
const bundled = await build({
  absWorkingDir: root, entryPoints: ['src/index.ts'], outfile: 'dist/index.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node24',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  sourcemap: false, legalComments: 'none', logLevel: 'silent', write: false,
})
assert.ok(Buffer.from(bundled.outputFiles[0].contents).equals(readFileSync(join(root, 'dist', 'index.mjs'))), 'dist/index.mjs differs from source; run npm run build')
const web = await build({
  absWorkingDir: root, entryPoints: ['web/src/main.tsx'], outfile: 'dist/web/canvas.js', bundle: true, platform: 'browser', format: 'esm', target: ['es2020'], jsx: 'automatic', minify: true,
  sourcemap: false, define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'css', '.png': 'dataurl' }, logLevel: 'silent', write: false,
})
for (const file of web.outputFiles) assert.ok(Buffer.from(file.contents).equals(readFileSync(file.path)), relative(root, file.path) + ' differs from source; run npm run build')
const shell = readFileSync(join(root, 'web', 'index.html'), 'utf8').replace(/\r\n/g, '\n').replace('__FAVICON__', 'data:image/png;base64,' + readFileSync(join(root, 'web', 'favicon.png')).toString('base64'))
assert.equal(readFileSync(join(root, 'dist', 'web', 'index.html'), 'utf8'), shell, 'dist/web/index.html differs from source; run npm run build')
const buildEvidence = { source: sourceBefore, artifacts: artifactsBefore, designMatchesSource: true, entryMatchesSource: true, webMatchesSource: true }
writeFileSync(join(out, 'build-evidence.json'), JSON.stringify(buildEvidence, null, 2) + '\n')
const runtime = join(out, 'runtime')
mkdirSync(runtime)
await build({
  stdin: { contents: "export { listPrototypes, getPrototype, listDirections, getDirection } from './src/prototypes.ts'; export { reviewPage } from './src/audit/review.ts'; export { writePageHtml, upsertNode } from './src/project.ts'; export { shutdownForTests } from './src/server.ts'; export { launchBrowser, resolveBrowser } from './src/export.ts';", resolveDir: root },
  outfile: join(runtime, 'api.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24',
  banner: { js: "import { createRequire as __prototypeCreateRequire } from 'node:module'; const require = __prototypeCreateRequire(import.meta.url);" }, logLevel: 'silent',
})
cpSync(join(root, 'dist', 'web'), join(runtime, 'web'), { recursive: true })
cpSync(join(root, 'dist', 'design'), join(runtime, 'design'), { recursive: true })
const api = await import(pathToFileURL(join(runtime, 'api.mjs')).href)
const cwd = join(out, 'workspace')
mkdirSync(cwd)
const prototypes = api.listPrototypes()
const directions = api.listDirections()
assert.equal(prototypes.length, 32, 'must cover all 32 neutral target prototypes')
assert.equal(directions.length, 3)
const tasks = prototypes.map((p) => ({ id: p.id, type: 'prototype', name: p.name, html: api.getPrototype(p.id).html }))
for (const summary of directions) {
  const direction = api.getDirection(summary.id)
  assert.equal(direction.examples.length, 2, summary.id + ' needs two original examples')
  assert.deepEqual(new Set(direction.examples.map((example) => example.language)), new Set(['zh-CN', 'en']))
  for (const example of direction.examples) tasks.push({ id: 'direction-' + example.id, type: 'direction-example', directionId: summary.id, name: example.name, html: example.html })
}
assert.equal(tasks.length, 38)
const selected = only ? tasks.filter((task) => task.id === only) : tasks
assert.ok(selected.length, 'Unknown --only id')
const results = []
try {
  for (const task of selected) {
    const htmlPath = api.writePageHtml(cwd, task.id, task.html)
    api.upsertNode(cwd, { id: task.id, type: 'page', title: task.name, x: 0, y: 0, width: 1440, height: 1000, deviceType: 'desktop', htmlPath, createdAt: Date.now(), updatedAt: Date.now() })
    const result = await api.reviewPage(cwd, task.id, { outputDir: 'evidence' })
    assert.deepEqual(result.captures.map(capture => capture.width), [1440, 768, 390], task.id + ' must capture every required viewport')
    assert.equal(result.sourceSha256, digest(task.html), task.id + ' captured a different page')
    const failures = result.captures.flatMap((capture) => {
      const items = capture.issues.filter((issue) => issue.severity === 'error').map((issue) => ({ width: capture.width, ...issue }))
      if (!capture.metrics.isolatedOrigin || !capture.metrics.reducedMotion || capture.metrics.elements < 3) items.push({ width: capture.width, rule: 'render-contract', severity: 'error', message: 'Sandbox/media/content readiness failed' })
      if (capture.capturedHeight < Math.max(capture.height, capture.metrics.contentHeight)) items.push({ width: capture.width, rule: 'incomplete-capture', severity: 'error', message: 'Screenshot does not cover the complete page' })
      return items
    })
    results.push({ id: task.id, type: task.type, directionId: task.directionId, name: task.name, report: result, failures })
    writeFileSync(join(out, 'results.json'), JSON.stringify({ state: 'running', buildEvidence, total: selected.length, completed: results.length, results }, null, 2) + '\n')
    console.log('[' + results.length + '/' + selected.length + '] ' + task.id + ': ' + (failures.length ? failures.length + ' objective failure(s)' : 'objective checks passed'))
  }
} finally { await api.shutdownForTests() }
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
const contactSheets = []
for (const width of [1440, 768, 390]) {
  const file = join(out, 'contact-' + width + '.html')
  const cards = results.map((entry) => {
    const capture = entry.report.captures.find((c) => c.width === width)
    return '<article><h2>' + escape(entry.id) + '</h2><p>' + escape(entry.name) + '</p><a href="' + escape(pathToFileURL(capture.path).href) + '"><img src="data:image/png;base64,' + readFileSync(capture.path).toString('base64') + '" alt="' + escape(entry.name) + '"></a><p>' + capture.metrics.contentWidth + '×' + capture.metrics.contentHeight + ' · ' + capture.issues.length + ' issue(s)</p></article>'
  }).join('')
  writeFileSync(file, '<!doctype html><meta charset="utf-8"><title>Original composition review</title><style>body{margin:0;padding:24px;background:#e5e5e5;color:#151515;font:14px system-ui}header{margin-bottom:24px}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}article{background:white;padding:14px;min-width:0}h1{font-size:28px}h2{font-size:14px;overflow-wrap:anywhere}p{font-size:12px}img{width:100%;height:360px;object-fit:contain;object-position:top;background:#f3f3f3}</style><header><h1>' + width + 'px / original compositions</h1><p>Objective evidence only. Aesthetic assessment requires project owner review. Full images are linked.</p></header><main>' + cards + '</main>')
  const exe = api.resolveBrowser()
  if (!exe) throw new Error('Browser required for contact sheet')
  const { browser, dispose } = await api.launchBrowser(exe)
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' })
    await page.screenshot({ path: join(out, 'contact-' + width + '.png'), fullPage: true })
    await page.close()
  } finally { await dispose() }
  contactSheets.push(file)
}
const failures = results.flatMap((entry) => entry.failures.map((issue) => ({ id: entry.id, ...issue })))
const sourceAfter = fingerprint(['src', 'web', 'design-systems', 'scripts'])
const artifactsAfter = fingerprint(['dist'])
if (sourceAfter.sha256 !== sourceBefore.sha256 || artifactsAfter.sha256 !== artifactsBefore.sha256) failures.push({ id: 'build', rule: 'inputs-changed', severity: 'error', message: 'Source or dist changed during capture; rerun against the final revision' })
writeFileSync(join(out, 'results.json'), JSON.stringify({ state: 'complete', fullCatalog: !only, buildEvidence: { ...buildEvidence, unchangedDuringCapture: sourceAfter.sha256 === sourceBefore.sha256 && artifactsAfter.sha256 === artifactsBefore.sha256 }, total: selected.length, screenshots: selected.length * 3, visualAssessment: 'requires-human-review', contactSheets, failures, results }, null, 2) + '\n')
console.log('Evidence: ' + join(out, 'results.json'))
console.log('Objective failures: ' + failures.length + '; aesthetic approval: pending human review')
if (failures.length) process.exitCode = 1
