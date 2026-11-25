/**
 * 选择器级 CSS 解析原语（ruleBlocks / inlineStyleBlocks）的行为测试。
 *
 * 核心不变式：所有下标必须与原文绝对对齐，能直接喂给 lineOf / snippetAt；
 * @media 透明包裹、@keyframes 帧跳过、@font-face 产出规则块、语句型 at-rule 丢弃。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const apiDir = mkdtempSync(join(tmpdir(), 'tsc-css-blocks-'))
await build({
  stdin: { contents: "export * from './src/cssParse.ts';", resolveDir: root },
  outfile: join(apiDir, 'css.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'silent',
})
const { ruleBlocks, inlineStyleBlocks, declarations, lineIndex, lineOf } = await import(
  pathToFileURL(join(apiDir, 'css.mjs')).href
)

test.after(() => rmSync(apiDir, { recursive: true, force: true }))

test('ruleBlocks：基本选择器与声明，偏移对齐原文', () => {
  const css = '.card { border-left: 2px solid #333; border-radius: 12px }'
  const blocks = ruleBlocks(css)
  assert.equal(blocks.length, 1)
  const block = blocks[0]
  assert.equal(block.selector, '.card')
  assert.equal(block.selectorOffset, 0)
  assert.deepEqual(
    block.decls.map((d) => d.prop),
    ['border-left', 'border-radius'],
  )
  // 声明的 offset 必须指向原 CSS 里的值起点
  // declarations() 的 offset 指向冒号之后（含前导空白），因此用 trimStart 判定。
  assert.equal(css.slice(block.decls[0].offset).trimStart().startsWith('2px solid'), true)
  assert.equal(css.slice(block.decls[1].offset).trimStart().startsWith('12px'), true)
})

test('ruleBlocks：多选择器、跨行、逗号分隔', () => {
  const css = `.a,\n.b:hover {\n  color: red;\n}\n.c{color:blue}`
  const blocks = ruleBlocks(css)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].selector, '.a,\n.b:hover')
  assert.equal(blocks[0].decls[0].prop, 'color')
  assert.equal(blocks[1].selector, '.c')
})

test('ruleBlocks：@media 透明包裹并记录 atRule', () => {
  const css = `@media (min-width: 768px) { .grid { gap: 24px } }`
  const blocks = ruleBlocks(css)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].selector, '.grid')
  assert.equal(blocks[0].atRule, '@media (min-width: 768px)')
})

test('ruleBlocks：@media 嵌套 @supports 时取最近的容器 at-rule', () => {
  const css = `@media print { @supports (display: grid) { .x { display: grid } } }`
  const blocks = ruleBlocks(css)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].atRule, '@supports (display: grid)')
})

test('ruleBlocks：@keyframes 内的帧不产出，其后的规则正常产出', () => {
  const css = `@keyframes spin { from { transform: rotate(0) } 100% { transform: rotate(360deg) } } .spinner { animation: spin 1s linear infinite }`
  const blocks = ruleBlocks(css)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].selector, '.spinner')
  assert.equal(blocks[0].decls[0].prop, 'animation')
})

test('ruleBlocks：@font-face 作为规则块产出', () => {
  const css = `@font-face { font-family: "Brand"; src: url(a.woff2) } .t { font-family: Brand }`
  const blocks = ruleBlocks(css)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].selector, '@font-face')
  assert.equal(blocks[0].decls[0].prop, 'font-family')
  assert.equal(blocks[1].selector, '.t')
})

test('ruleBlocks：语句型 at-rule（@import）被丢弃', () => {
  const css = `@import url("x.css"); @charset "utf-8"; .a { color: red }`
  const blocks = ruleBlocks(css)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].selector, '.a')
})

test('ruleBlocks：引号内的花括号与分号不干扰切分', () => {
  const css = `.a::after { content: "} ; {"; color: red } .b { color: blue }`
  const blocks = ruleBlocks(css)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].selector, '.a::after')
  assert.equal(blocks[0].decls.length, 2)
  assert.equal(blocks[1].selector, '.b')
})

test('ruleBlocks：url() 与 data: 值里的花括号不干扰切分', () => {
  const css = `.a { background: url("data:image/svg+xml;utf8,<svg>{}</svg>"); color: red }`
  const blocks = ruleBlocks(css)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].decls[0].prop, 'background')
})

test('ruleBlocks：偏移带 start 基准时与嵌套调用一致', () => {
  const html = `<style>.a { color: red }</style>`
  const inner = html.indexOf('.a')
  const blocks = ruleBlocks('.a { color: red }', inner)
  assert.equal(blocks[0].selectorOffset, inner)
  assert.equal(html.slice(blocks[0].decls[0].offset).trimStart().startsWith('red'), true)
})

test('ruleBlocks：偏移与 declarations 的行号一致', () => {
  const css = `.a {\n  color: red;\n}\n.b {\n  gap: 8px;\n}`
  const index = lineIndex(css)
  const blocks = ruleBlocks(css)
  const flat = declarations(css)
  const linesFromBlocks = blocks.flatMap((b) => b.decls.map((d) => lineOf(index, d.offset)))
  const linesFromFlat = flat.map((d) => lineOf(index, d.offset))
  assert.deepEqual(linesFromBlocks, linesFromFlat)
})

test('ruleBlocks：残缺 CSS 不崩，尾段仍可解析', () => {
  const css = `.a { color`
  const blocks = ruleBlocks(css)
  assert.ok(Array.isArray(blocks))
  const css2 = `.a { color: red } .b { gap`
  const blocks2 = ruleBlocks(css2)
  assert.equal(blocks2.length >= 1, true)
})

test('ruleBlocks：CSS nesting 不崩且不丢偏移', () => {
  const css = `.card { color: red; &:hover { color: blue } }`
  const blocks = ruleBlocks(css)
  assert.ok(blocks.length >= 1)
  assert.equal(blocks[0].selector, '.card')
})

test('ruleBlocks：1 MiB 对抗样本在 3 秒内完成', () => {
  const chunk = `.x{color:red;background:linear-gradient(90deg,#fff,#000);border-left:2px solid #333;border-radius:8px}\n`
  const big = chunk.repeat(Math.ceil((1024 * 1024) / chunk.length))
  const started = Date.now()
  const blocks = ruleBlocks(big)
  const elapsed = Date.now() - started
  assert.equal(blocks.length > 10000, true)
  assert.equal(elapsed < 3000, true, `耗时 ${elapsed}ms`)
})

test('inlineStyleBlocks：抽取标签、类名、属性串与声明偏移', () => {
  const html = `<div class="ts-card is-wide" style="border-left: 2px solid #333; border-radius: 12px">x</div>`
  const blocks = inlineStyleBlocks(html)
  assert.equal(blocks.length, 1)
  const block = blocks[0]
  assert.equal(block.tag, 'div')
  assert.deepEqual(block.classes, ['ts-card', 'is-wide'])
  assert.equal(block.attrs.includes('ts-card'), true)
  assert.deepEqual(
    block.decls.map((d) => d.prop),
    ['border-left', 'border-radius'],
  )
  assert.equal(html.slice(block.decls[0].offset).trimStart().startsWith('2px solid'), true)
})

test('inlineStyleBlocks：单引号属性与自闭合标签', () => {
  const html = `<img src="a.png" style='opacity: 0.5' /><span style="color:red">x</span>`
  const blocks = inlineStyleBlocks(html)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].tag, 'img')
  assert.equal(blocks[0].decls[0].prop, 'opacity')
  assert.equal(blocks[1].tag, 'span')
})

test('inlineStyleBlocks：不把 data-style 之类属性误当成 style', () => {
  const html = `<div data-style="color: red">x</div>`
  const blocks = inlineStyleBlocks(html)
  assert.equal(blocks.length, 0)
})

test('inlineStyleBlocks：无 style 属性的元素不产出', () => {
  const html = `<div class="a"><p>x</p></div>`
  assert.equal(inlineStyleBlocks(html).length, 0)
})
