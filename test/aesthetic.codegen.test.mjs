import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import * as ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const compiled = await build({ entryPoints: [join(root, 'src/codegen.ts')], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' })
const codegen = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const tempRoot = join(root, '.tmp')
mkdirSync(tempRoot, { recursive: true })

function compile(files, { fixture = '' } = {}) {
  const dir = mkdtempSync(join(tempRoot, 'aesthetic-codegen-'))
  try {
    for (const [name, value] of Object.entries(files)) { mkdirSync(join(dir, name, '..'), { recursive: true }); writeFileSync(join(dir, name), value) }
    if (fixture) writeFileSync(join(dir, 'negative.tsx'), fixture)
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, types: ['react'], lib: ['ES2022','DOM'] }, include: ['*.tsx'] }))
    try { execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', dir], { encoding: 'utf8', stdio: 'pipe' }); return { ok: true, output: '' } }
    catch (error) { return { ok: false, output: String(error.stdout) + String(error.stderr) } }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const fileMap = (files) => Object.fromEntries(files.map((file) => [file.name, file.content]))

test('React export keeps all 32 prototype and 6 direction layouts and compiles with real React types', () => {
  const catalog = JSON.parse(readFileSync(join(root, 'dist/design/prototypes/index.json'), 'utf8'))
  assert.equal(catalog.prototypes.length, 32)
  const resources = catalog.prototypes.map((summary) => JSON.parse(readFileSync(join(root, 'dist/design/prototypes', summary.id + '.json'), 'utf8')))
  const directions = JSON.parse(readFileSync(join(root, 'dist/design/directions/index.json'), 'utf8'))
  assert.equal(directions.directions.length, 3)
  for (const summary of directions.directions) {
    const direction = JSON.parse(readFileSync(join(root, 'dist/design/directions', summary.id + '.json'), 'utf8'))
    assert.equal(direction.examples.length, 2)
    for (const example of direction.examples) resources.push(JSON.parse(readFileSync(join(root, 'dist/design', example.prototypeId ? 'prototypes' : 'directions', example.resourceId + '.json'), 'utf8')))
  }
  assert.equal(resources.length, 38)
  const files = {}
  for (const [index, resource] of resources.entries()) {
    const html = '<!doctype html><html><head><style data-tianshu-prototype="' + resource.id + '">' + resource.css + '</style></head><body>' + resource.html + '</body></html>'
    const generated = codegen.toReactComponent(html, 'Composition' + index)
    const css = generated.find((file) => file.name === 'layout.css')
    assert.equal(css.content, resource.css, resource.id + ' layout must survive export')
    const component = generated.find((file) => file.name.endsWith('.tsx'))
    assert.match(component.content, /静态结构导出/)
    files[component.name] = component.content
  }
  const result = compile(files)
  assert.equal(result.ok, true, result.output)
  const negative = compile(files, { fixture: 'export const InvalidReactAttribute = () => <button type="not-a-button-type" />' })
  assert.equal(negative.ok, false, '真实类型门禁必须拒绝非法button props，不能any假绿')
  assert.match(negative.output, /not-a-button-type/)
})

test('HTML expression-like attributes and CSS values remain inert strings with SVG casing preserved', async () => {
  const html = '<div title="{globalThis.__codegenExecuted = true}" data-example="a > b &amp; c"><p style="--accent: red; font-family: \'A;B\'; background-image: url(&quot;data:image/svg+xml;a;b&quot;)">a < b > c {literal}</p><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><linearGradient id="t"><stop offset="0" stop-color="red" /></linearGradient><path stroke-width="2" d="M0 0h2" /></svg></div><p>Second root</p>'
  const files = codegen.toReactComponent(html)
  const component = files[0].content
  assert.match(component, /title="\{globalThis\.__codegenExecuted = true\}"/)
  assert.match(component, /'--accent': 'red'/)
  assert.match(component, /fontFamily: '\\'A;B\\''/)
  assert.match(component, /viewBox="0 0 24 24"/)
  assert.match(component, /preserveAspectRatio="xMidYMid meet"/)
  assert.match(component, /<linearGradient/)
  assert.match(component, /a &lt; b &gt; c &#123;literal&#125;/)
  assert.equal(compile(fileMap(files)).ok, true)
  globalThis.__codegenExecuted = false
  const transformed = ts.transpileModule(component.replace(/^import .*$/gm, ''), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const createElement = (type, props, ...children) => ({ type, props, children })
  Function('exports', 'module', 'React', transformed)(module.exports, module, { createElement, Fragment: 'fragment' })
  const tree = module.exports.default()
  assert.equal(globalThis.__codegenExecuted, false)
  assert.ok(JSON.stringify(tree).includes('{globalThis.__codegenExecuted = true}'))
  delete globalThis.__codegenExecuted
})

test('React export strips executable HTML and unsafe URLs, retains supplied CSS, and rejects identifier injection', () => {
  const generated = codegen.toReactComponent('<html><head><style>.example{display:grid;grid-template-columns:2fr 1fr}</style></head><body><div onclick="bad()"><a href="java&#x73;cript:bad()">text</a><script>globalThis.__evil=true</script><style>.inside{color:red}</style><p>value</p></div></body></html>')
  const component = generated[0].content
  assert.doesNotMatch(component, /onclick|javascript:|__evil|<script|<style/)
  assert.ok(generated.find((file) => file.name === 'layout.css').content.includes('grid-template-columns:2fr 1fr'))
  assert.ok(generated.find((file) => file.name === 'layout.css').content.includes('.inside{color:red}'))
  assert.throws(() => codegen.toReactComponent('<div />', 'A(){};evil'), /identifier/)
  const legacy = codegen.htmlToJsx('<div class="ts-card"><label for="x">名</label><img src="a.png"><p style="color:red;font-size:14px">hi</p></div>')
  assert.match(legacy, /style=\{\{ color: 'red', fontSize: '14px' \}\}/)
})

test('real dependency verifier is valid JavaScript, not TypeScript masquerading as mjs', () => {
  execFileSync(process.execPath, ['--check', join(root, 'scripts/verify-codegen-real.mjs')], { encoding: 'utf8', stdio: 'pipe' })
})

test('Tailwind export keeps custom token keys and values inert when imported as JavaScript', async () => {
  const attack = "x' + (globalThis.__tailwindExecuted = true) + '"
  const input = {
    colors: { primary: '#123456' },
    fontFamilies: { sans: "system-ui, A'B", 'display-font': "A\\B\nFamily" },
    fontSizes: { body: 16 }, spacing: [4, 8], radius: [0, 8, 9999],
    shadows: { subtle: attack, "name'with-quote": 'none' },
  }
  globalThis.__tailwindExecuted = false
  try {
    const executableWithoutEscaping = codegen.toTailwindConfig({
      colors: {}, fontFamilies: { sans: 'system-ui' }, fontSizes: {}, spacing: [], radius: [], shadows: { subtle: attack },
    })
    const attackResult = await import('data:text/javascript;base64,' + Buffer.from(executableWithoutEscaping).toString('base64'))
    assert.equal(globalThis.__tailwindExecuted, false, 'shadow text must not become a JavaScript expression')
    assert.equal(attackResult.default.theme.extend.boxShadow.subtle, attack)
    const config = codegen.toTailwindConfig(input)
    const exported = await import('data:text/javascript;base64,' + Buffer.from(config).toString('base64'))
    assert.equal(globalThis.__tailwindExecuted, false, 'custom tokens must never execute during config import')
    assert.equal(exported.default.theme.extend.boxShadow.subtle, attack)
    assert.equal(exported.default.theme.extend.boxShadow["name'with-quote"], 'none')
    assert.deepEqual(exported.default.theme.extend.fontFamily.sans, ['system-ui', "A'B"])
    assert.deepEqual(exported.default.theme.extend.fontFamily['display-font'], ["A\\B\nFamily"])
  } finally { delete globalThis.__tailwindExecuted }
})
