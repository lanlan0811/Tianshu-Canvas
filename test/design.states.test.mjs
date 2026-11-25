/**
 * 组件状态契约与浏览器表面主题化的回归测试。
 *
 * 状态契约：26 个组件都声明 states，且声明了的状态在 components.css 里真有选择器。
 * 浏览器表面：::selection / caret / 滚动条 / 下划线偏移 / tabular-nums / reduced-motion
 * 必须存在，且只使用 --ts-* 变量、不引入新 ts- 类。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const components = JSON.parse(readFileSync(join(root, 'design-systems/components/components.json'), 'utf8'))
const componentsCss = readFileSync(join(root, 'design-systems/components/components.css'), 'utf8')

const { validateStateContract } = await import(
  pathToFileURL(join(root, 'scripts/design/design-validate.mjs')).href
)

test('状态契约：真实源码零错误', () => {
  const errors = []
  validateStateContract(components, componentsCss, errors)
  assert.deepEqual(errors, [])
})

test('状态契约：26 个组件全部声明 states，且 default 恰好一次', () => {
  assert.equal(components.components.length, 26)
  for (const component of components.components) {
    assert.ok(Array.isArray(component.states) && component.states.length > 0, component.id)
    assert.equal(component.states.filter((s) => s === 'default').length, 1, component.id)
  }
})

test('状态契约：交互组件欠 hover/focus/disabled/loading/error', () => {
  const byId = Object.fromEntries(components.components.map((c) => [c.id, c]))
  assert.deepEqual(byId.button.states, ['default', 'hover', 'focus', 'active', 'disabled', 'loading'])
  assert.deepEqual(byId['icon-button'].states, ['default', 'hover', 'focus', 'active', 'disabled', 'loading'])
  assert.deepEqual(byId.input.states, ['default', 'hover', 'focus', 'disabled', 'error'])
  assert.deepEqual(byId.select.states, ['default', 'hover', 'focus', 'disabled', 'error'])
  assert.deepEqual(byId.switch.states, ['default', 'hover', 'focus', 'disabled'])
  assert.deepEqual(byId.checkbox.states, ['default', 'focus', 'disabled', 'error'])
  assert.deepEqual(byId.tabs.states, ['default', 'hover', 'focus', 'disabled'])
  assert.deepEqual(byId.nav.states, ['default', 'hover', 'focus'])
  assert.deepEqual(byId.sidebar.states, ['default', 'hover', 'focus'])
  assert.deepEqual(byId.toast.states, ['default', 'success', 'error'])
})

test('状态契约负例：缺少状态选择器时报错', () => {
  const copy = JSON.parse(JSON.stringify(components))
  const button = copy.components.find((c) => c.id === 'button')
  button.states.push('success')
  const errors = []
  validateStateContract(copy, componentsCss, errors)
  assert.ok(errors.some((e) => e.includes('button') && e.includes('success')), errors.join('; '))
})

test('状态契约负例：未知状态名报错', () => {
  const copy = JSON.parse(JSON.stringify(components))
  copy.components[0].states.push('hovering')
  const errors = []
  validateStateContract(copy, componentsCss, errors)
  assert.ok(errors.some((e) => e.includes('未知状态')), errors.join('; '))
})

test('状态契约负例：新增未声明的 ts- 状态类报错', () => {
  const errors = []
  validateStateContract(components, `${componentsCss}\n.ts-btn--loading { opacity: 0.6; }\n`, errors)
  assert.ok(errors.some((e) => e.includes('未声明的 ts- 类') && e.includes('ts-btn--loading')), errors.join('; '))
})

test('浏览器表面：选择/光标/滚动条/下划线/等宽数字全部主题化', () => {
  for (const selector of [
    '::selection',
    'caret-color',
    'scrollbar-color',
    'scrollbar-width',
    '*::-webkit-scrollbar-thumb',
    'text-underline-offset',
    'font-variant-numeric: tabular-nums',
  ]) {
    assert.ok(componentsCss.includes(selector), `缺少 ${selector}`)
  }
})

test('浏览器表面：reduced-motion 缩短而不是删除（保事件）', () => {
  const block = componentsCss.slice(componentsCss.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.ok(block.includes('animation-duration: 0.01ms'), block.slice(0, 200))
  assert.ok(block.includes('transition-duration: 0.01ms'), block.slice(0, 200))
  assert.ok(!/animation:\s*none/.test(block), '不能用 animation: none（会吞掉 animationend）')
})

test('浏览器表面：只用 --ts-* 变量，不引入外链与新类', () => {
  const start = componentsCss.indexOf('/* ---------- 浏览器表面')
  assert.ok(start > 0)
  const block = componentsCss.slice(start)
  assert.ok(!/url\(/.test(block), '浏览器表面不得引用外部资源')
  assert.ok(!/https?:/.test(block), '浏览器表面不得引用外链')
  // 新增的 ts- 类只允许 stat__value（已声明）
  for (const match of block.matchAll(/\.(ts-[A-Za-z0-9_-]+)/g)) {
    assert.equal(match[1], 'ts-stat__value', `浏览器表面引入了新类：${match[1]}`)
  }
})

test('浏览器表面：color-scheme 由 tokens.css 输出', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'dist/design/styles/tianshu-original/assets.json'), 'utf8'))
  const tokens = readFileSync(join(root, 'dist/design/styles/tianshu-original', manifest.tokens), 'utf8')
  assert.ok(tokens.includes('color-scheme: light'), '缺少 color-scheme: light')
})

test('浏览器表面：深色风格输出 color-scheme: dark', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'dist/design/styles/tianshu-inkstone/assets.json'), 'utf8'))
  const tokens = readFileSync(join(root, 'dist/design/styles/tianshu-inkstone', manifest.tokens), 'utf8')
  if (tokens.includes('.dark {')) assert.ok(tokens.includes('color-scheme: dark'), '有深色块时缺少 color-scheme: dark')
})
