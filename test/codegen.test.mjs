/**
 * 代码生成：HTML→JSX、Tailwind 配置、CSS 变量 + 无框架 HTML；
 * 多端（ios/android/miniprogram）的 Token 文件与 design-spec.md。
 * 通过 canvas_style action=codegen 端到端走工具层。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { installFakeSdk } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await (async () => {
  installFakeSdk()
  const mod = await import(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const api = await mod.default.activate({ log: { debug() {}, warn() {} } })
  return { tools: Object.fromEntries(api.tools.map((t) => [t.name, t])) }
})()

/** 建一个临时工作区并锁定内置风格 apple，返回 cwd 与清理函数。 */
async function setup() {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-codegen-'))
  await tools.canvas_open.execute({ args: { port: 0 }, cwd, sessionId: 't' })
  const setResult = await tools.canvas_style.execute({ args: { action: 'set', style_id: 'apple' }, cwd, sessionId: 't' })
  assert.match(setResult.content, /已锁定设计风格/)
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

test('codegen react：HTML→JSX（className、style 对象、自闭合）', async () => {
  const { cwd, cleanup } = await setup()
  try {
    const result = await tools.canvas_style.execute({
      args: {
        action: 'codegen',
        target: 'react',
        html: '<div class="ts-card"><label for="x">名</label><img src="a.png"><p style="color: red; font-size: 14px">hi</p></div>',
      },
      cwd,
      sessionId: 't',
    })
    assert.ok(!result.isError, result.content)
    assert.match(result.content, /className="ts-card"/)
    assert.match(result.content, /htmlFor="x"/)
    assert.match(result.content, /<img src="a\.png" \/>/)
    assert.match(result.content, /style=\{\{ color: 'red', fontSize: '14px' \}\}/)
    assert.match(result.content, /\.tsx/)
  } finally {
    cleanup()
  }
})

test('codegen css-vars：产出 index.html + tokens.css + components.css', async () => {
  const { cwd, cleanup } = await setup()
  try {
    const result = await tools.canvas_style.execute({
      args: { action: 'codegen', target: 'css-vars', html: '<body><div class="ts-card">hi</div></body>' },
      cwd,
      sessionId: 't',
    })
    assert.ok(!result.isError, result.content)
    assert.match(result.content, /index\.html/)
    assert.match(result.content, /tokens\.css/)
    assert.match(result.content, /components\.css/)
    assert.match(result.content, /--ts-color-/)
  } finally {
    cleanup()
  }
})

test('codegen tailwind：配置含主题键与真实色值', async () => {
  const { cwd, cleanup } = await setup()
  try {
    const result = await tools.canvas_style.execute({
      args: { action: 'codegen', target: 'tailwind', html: '<div class="ts-card"></div>' },
      cwd,
      sessionId: 't',
    })
    assert.ok(!result.isError, result.content)
    assert.match(result.content, /tailwind\.config\.js/)
    assert.match(result.content, /theme:/)
    assert.match(result.content, /colors:/)
    // apple 的主色 #0071e3 应出现在 colors 里
    assert.match(result.content, /#0071e3/)
  } finally {
    cleanup()
  }
})

test('codegen 多端：ios/swiftui 出 Swift 主题与规格，含真实色值', async () => {
  const { cwd, cleanup } = await setup()
  try {
    const result = await tools.canvas_style.execute({
      args: { action: 'codegen', target: 'ios', stack: 'swiftui', html: '<div></div>' },
      cwd,
      sessionId: 't',
    })
    assert.ok(!result.isError, result.content)
    assert.match(result.content, /DesignTokens\.swift/)
    assert.match(result.content, /design-spec\.md/)
    assert.match(result.content, /#0071e3/)
    assert.match(result.content, /SwiftUI/)
    assert.match(result.content, /保真度/)
  } finally {
    cleanup()
  }
})

test('codegen 多端：android/compose、miniprogram/weapp 均产出', async () => {
  const { cwd, cleanup } = await setup()
  try {
    for (const [target, stack, expect] of [
      ['android', 'compose', /Theme\.kt/],
      ['android', 'xml', /colors\.xml/],
      ['miniprogram', 'weapp', /app\.wxss/],
      ['miniprogram', 'uniapp', /uni\.scss/],
      ['miniprogram', 'taro', /app\.scss/],
    ]) {
      const result = await tools.canvas_style.execute({ args: { action: 'codegen', target, stack, html: '<div></div>' }, cwd, sessionId: 't' })
      assert.ok(!result.isError, `${target}/${stack}: ${result.content}`)
      assert.match(result.content, expect, `${target}/${stack} 应含 ${expect}`)
      assert.match(result.content, /design-spec\.md/)
    }
  } finally {
    cleanup()
  }
})

test('codegen 多端：stack 与 target 不匹配时报错', async () => {
  const { cwd, cleanup } = await setup()
  try {
    const result = await tools.canvas_style.execute({
      args: { action: 'codegen', target: 'ios', stack: 'compose', html: '<div></div>' },
      cwd,
      sessionId: 't',
    })
    assert.equal(result.isError, true)
    assert.match(result.content, /不适用/)
  } finally {
    cleanup()
  }
})

test('codegen 缺 target 时提示先问用户（不臆测）', async () => {
  const { cwd, cleanup } = await setup()
  try {
    const result = await tools.canvas_style.execute({ args: { action: 'codegen' }, cwd, sessionId: 't' })
    assert.equal(result.isError, true)
    assert.match(result.content, /先问用户/)
  } finally {
    cleanup()
  }
})

test('codegen write_files：写到 .tianshu-canvas/exports 下', async () => {
  const { cwd, cleanup } = await setup()
  try {
    const result = await tools.canvas_style.execute({
      args: { action: 'codegen', target: 'android', stack: 'compose', html: '<div></div>', write_files: true },
      cwd,
      sessionId: 't',
    })
    assert.ok(!result.isError, result.content)
    assert.match(result.content, /exports/)
    const colorKt = join(cwd, '.tianshu-canvas', 'exports', 'android', 'Color.kt')
    // Kotlin 用 ARGB 字面量：apple 主色 #0071e3 → 0xFF0071E3
    assert.match(readFileSync(colorKt, 'utf8'), /0xFF0071E3/i)
  } finally {
    cleanup()
  }
})

test('多端生成是确定性的（同输入同输出）', async () => {
  const { cwd, cleanup } = await setup()
  try {
    const a = await tools.canvas_style.execute({ args: { action: 'codegen', target: 'miniprogram', stack: 'weapp', html: '<div></div>' }, cwd, sessionId: 't' })
    const b = await tools.canvas_style.execute({ args: { action: 'codegen', target: 'miniprogram', stack: 'weapp', html: '<div></div>' }, cwd, sessionId: 't' })
    assert.equal(a.content, b.content)
  } finally {
    cleanup()
  }
})
