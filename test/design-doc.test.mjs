/**
 * DESIGN.md 投影的纯函数测试：八节顺序、frontmatter 白名单、
 * 组件 8 属性、引用合法性、缺数据省略、确定性。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const outDir = mkdtempSync(join(tmpdir(), 'tsc-designdoc-'))
await build({
  stdin: { contents: "export * from './src/designDoc.ts';", resolveDir: root },
  outfile: join(outDir, 'doc.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'silent',
})
const { buildDesignDoc, mapComponentTokens } = await import(pathToFileURL(join(outDir, 'doc.mjs')).href)
test.after(() => rmSync(outDir, { recursive: true, force: true }))

const tokens = JSON.parse(readFileSync(join(root, 'design-systems/styles/tianshu-original/tokens.json'), 'utf8'))
const contract = JSON.parse(readFileSync(join(root, 'dist/design/components/contract.json'), 'utf8'))
const input = { id: 'demo', name: '演示系统', tokens, meta: { description: '演示用设计系统' }, components: contract.components }

const SECTIONS = ['## Overview', '## Colors', '## Typography', '## Layout', '## Elevation & Depth', '## Shapes', '## Components', "## Do's and Don'ts"]

test('八节标题原样、顺序固定', () => {
  const doc = buildDesignDoc(input)
  const indexes = SECTIONS.map((title) => doc.indexOf(title))
  assert.ok(indexes.every((index) => index >= 0), JSON.stringify(indexes))
  for (let i = 1; i < indexes.length; i++) assert.ok(indexes[i - 1] < indexes[i], `顺序错了：${SECTIONS[i]}`)
})

test('frontmatter 只含五个允许组', () => {
  const doc = buildDesignDoc(input)
  const frontmatter = doc.split('---')[1]
  const keys = [...frontmatter.matchAll(/^([a-zA-Z]+):/gm)].map((m) => m[1])
  const allowed = new Set(['name', 'description', 'colors', 'typography', 'rounded', 'spacing', 'components'])
  for (const key of keys) assert.ok(allowed.has(key), `frontmatter 出现不允许的组：${key}`)
  for (const required of ['colors', 'rounded', 'spacing']) assert.ok(keys.includes(required), `缺少 ${required}`)
})

test('组件子 token 只出现 8 个属性', () => {
  const allowed = new Set(['backgroundColor', 'textColor', 'typography', 'rounded', 'padding', 'size', 'height', 'width'])
  const doc = buildDesignDoc(input)
  const block = doc.slice(doc.indexOf('components:'), doc.indexOf('\n---'))
  for (const match of block.matchAll(/^ {4}([a-zA-Z]+):/gm)) {
    assert.ok(allowed.has(match[1]), `组件子 token 出现不允许的属性：${match[1]}`)
  }
  // 每个组件至少映射出一项，否则 Components 节会空转。
  for (const component of contract.components) {
    const mapped = mapComponentTokens(component.tokens ?? [], tokens)
    if (component.tokens?.length) assert.ok(Object.keys(mapped).length > 0, `${component.id} 的 token 没能映射到 8 属性`)
  }
})

test('组件引用指向 frontmatter 里真实存在的路径', () => {
  const doc = buildDesignDoc(input)
  const frontmatter = doc.split('---')[1]
  const colorKeys = new Set([...frontmatter.matchAll(/^ {2}([a-z0-9-]+):/gm)].map((m) => m[1]))
  for (const match of frontmatter.matchAll(/\{colors\.([a-z0-9-]+)\}/g)) {
    assert.ok(colorKeys.has(match[1]), `引用了 frontmatter 里不存在的颜色键：${match[1]}`)
  }
  assert.doesNotMatch(frontmatter, /\{[a-z]+\.families\./, 'typography 引用路径写错了（应为 typography.x.fontFamily）')
})

test('原语不进入 frontmatter，只在正文表格里', () => {
  const doc = buildDesignDoc(input)
  const frontmatter = doc.split('---')[1]
  assert.doesNotMatch(frontmatter, /neutral-100|brand-500/, '原色不应出现在 frontmatter')
  assert.match(doc, /原色阶（仅用于生成语义色/, '正文应列出原色阶')
})

test('缺数据时整节省略，不编造', () => {
  const minimal = {
    id: 'min',
    name: '最小系统',
    tokens: { color: { primitives: { brand: { 500: '#123456' } }, semantic: { bg: { canvas: 'brand.500' } } }, radius: { sm: 4 } },
    meta: { description: '只有颜色与圆角' },
    components: [],
  }
  const doc = buildDesignDoc(minimal)
  assert.match(doc, /## Colors/)
  assert.match(doc, /## Shapes/)
  assert.doesNotMatch(doc, /## Typography/, '没有字体数据时不应出现 Typography')
  assert.doesNotMatch(doc, /## Elevation & Depth/, '没有阴影数据时不应出现 Elevation')
  assert.doesNotMatch(doc, /## Components/, '没有组件时不应出现 Components')
})

test('确定性：同输入两次输出字节相同', () => {
  assert.equal(buildDesignDoc(input), buildDesignDoc(input))
})
