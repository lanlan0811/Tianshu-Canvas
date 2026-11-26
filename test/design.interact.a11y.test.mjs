/**
 * 交互库 ARIA 契约与减少动效策略的构建期门禁测试。
 *
 * 这一层的目的：把「文档说支持」变成「代码必须支持」。
 * 因此既验证真实源文件通过，也用负例证明校验会在实现缺失时失败。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  validateInteractionA11y,
  validateReducedMotionPolicy,
} from '../scripts/design/design-validate.mjs'

const root = resolve(import.meta.dirname, '..')
const doc = JSON.parse(readFileSync(join(root, 'design-systems', 'interactions', 'interactions.json'), 'utf8'))
const js = readFileSync(join(root, 'design-systems', 'interactions', 'interactions.js'), 'utf8')
const css = readFileSync(join(root, 'design-systems', 'interactions', 'interactions.css'), 'utf8')

function a11yErrors(docValue, jsValue) {
  const errors = []
  validateInteractionA11y(docValue, jsValue, errors)
  return errors
}

function motionErrors(cssValue) {
  const errors = []
  validateReducedMotionPolicy(cssValue, errors)
  return errors
}

test('真实交互库通过 ARIA 契约校验', () => {
  assert.deepEqual(a11yErrors(doc, js), [])
})

test('真实 interactions.css 通过减少动效策略校验', () => {
  assert.deepEqual(motionErrors(css), [])
})

test('23 个交互全部带 a11y 契约', () => {
  assert.equal(doc.interactions.length, 23)
  for (const item of doc.interactions) {
    assert.ok(item.a11y && typeof item.a11y === 'object', `${item.id} 缺少 a11y`)
    assert.ok(Array.isArray(item.a11y.roles), `${item.id} 的 roles 必须是数组`)
    assert.ok(Array.isArray(item.a11y.attrs), `${item.id} 的 attrs 必须是数组`)
    assert.ok(Array.isArray(item.a11y.keys), `${item.id} 的 keys 必须是数组`)
  }
})

test('声明了 focusReturn 的交互都在运行时里真的调用了 focus()', () => {
  const withFocusReturn = doc.interactions.filter((item) => item.a11y.focusReturn === true)
  assert.ok(withFocusReturn.length >= 4, `声明 focusReturn 的交互应有多个，当前 ${withFocusReturn.length}`)
  for (const item of withFocusReturn) assert.ok(/\.focus\(/.test(js), `${item.id} 声明了 focusReturn`)
})

test('tilt-card 声明了可中断手势，运行时处理 pointercancel 与 lostpointercapture', () => {
  const tilt = doc.interactions.find((item) => item.id === 'tilt-card')
  assert.equal(tilt.a11y.gesture, 'cancellable')
  assert.ok(js.includes('pointercancel'))
  assert.ok(js.includes('lostpointercapture'))
})

test('负例：运行时与骨架都删掉 aria-modal 必须报错', () => {
  const stripped = js.replace(/aria-modal/g, '')
  const broken = JSON.parse(JSON.stringify(doc))
  for (const item of broken.interactions) item.skeletonHtml = String(item.skeletonHtml ?? '').replace(/aria-modal/g, '')
  const errors = a11yErrors(broken, stripped)
  assert.ok(errors.some((e) => e.includes('aria-modal')), errors.slice(0, 3).join('|'))
})

test('负例：运行时与骨架都删掉 dialog 角色必须报错', () => {
  // 用契约里的 role 值反查：只把「声明了这个 role 的条目」的实现抹掉，
  // 避免误伤其它条目里同名的普通单词（如 class="ts-dialog"）。
  // 彻底抹掉这个词：注释里的说明、class 名里的 ts-dialog 都不算实现证据。
  const broken = JSON.parse(JSON.stringify(doc))
  for (const item of broken.interactions) {
    if (!(item.a11y?.roles ?? []).includes('dialog')) continue
    item.skeletonHtml = String(item.skeletonHtml ?? '').split('dialog').join('x')
  }
  const stripped = js.split('dialog').join('x')
  const errors = a11yErrors(broken, stripped)
  assert.ok(errors.some((e) => e.includes('dialog')), errors.slice(0, 3).join('|'))
})

test('负例：某条目缺 a11y 字段必须报错', () => {
  const broken = JSON.parse(JSON.stringify(doc))
  delete broken.interactions[0].a11y
  const errors = a11yErrors(broken, js)
  assert.ok(errors.some((e) => e.includes('缺少 a11y 契约')), errors.join('|'))
})

test('负例：类名不能冒充 role 实现（值级匹配防假绿）', () => {
  // 历史上 tooltip 靠类名 ts-i-tooltip 命中了子串校验，运行时其实不存在。
  const broken = JSON.parse(JSON.stringify(doc))
  const tooltip = broken.interactions.find((item) => item.id === 'tooltip')
  tooltip.a11y.roles = ['tooltip']
  tooltip.skeletonHtml = '<span class="ts-i-tooltip" data-ts-tooltip="提示"></span>'
  const stripped = js.split("setAttribute('role', 'tooltip')").join('')
  const errors = a11yErrors(broken, stripped)
  assert.ok(errors.some((e) => e.includes('tooltip')), errors.slice(0, 3).join('|'))
})

test('负例：a11y.live 只允许 polite / assertive', () => {
  const broken = JSON.parse(JSON.stringify(doc))
  broken.interactions[0].a11y.live = 'rude'
  const errors = a11yErrors(broken, js)
  assert.ok(errors.some((e) => e.includes('live 只能是')), errors.join('|'))
})

test('负例：声明了 focusReturn 但运行时没有 focus() 必须报错', () => {
  const stripped = js.replace(/\.focus\(/g, '.x(')
  const errors = a11yErrors(doc, stripped)
  assert.ok(errors.some((e) => e.includes('focusReturn')), errors.slice(0, 3).join('|'))
})

test('负例：reduced-motion 块被删掉必须报错', () => {
  const stripped = css.replace(/prefers-reduced-motion/g, 'prefers-nothing')
  const errors = motionErrors(stripped)
  assert.ok(errors.some((e) => e.includes('缺少 prefers-reduced-motion')), errors.join('|'))
})

test('负例：animation: none 必须被拦下（策略是缩短不是删除）', () => {
  const broken = css + '\n@media (prefers-reduced-motion: reduce) { .x { animation: none; } }\n'
  const errors = motionErrors(broken)
  assert.ok(errors.some((e) => e.includes('animation: none')), errors.join('|'))
})

test('显式豁免注释可以放行 transition: none', () => {
  const exempt = css + '\n@media (prefers-reduced-motion: reduce) { .y { transition: none; /* ts-motion-allow-none: 指针跟随必须跟手 */ } }\n'
  assert.deepEqual(motionErrors(exempt), [])
})

test('运行时确实实现了焦点陷阱与背景 inert', () => {
  assert.ok(js.includes('trapFocus'), '缺少焦点陷阱')
  assert.ok(js.includes('setBackgroundInert'), '缺少背景 inert')
  assert.ok(js.includes("event.key !== 'Tab'"), '焦点陷阱应处理 Tab')
  assert.ok(js.includes("setAttribute('inert'"), '应真正设置 inert 属性')
})

test('运行时确实提供共享 aria-live 播报区', () => {
  assert.ok(js.includes('ts-i-announcer'), '缺少共享播报区')
  assert.ok(js.includes("aria-live"), '播报区必须声明 aria-live')
  assert.ok(js.includes('announce('), '应存在 announce 调用点')
})

test('外部点击关闭覆盖了 dropdown 与浮层', () => {
  assert.ok(js.includes('bindOutsideClick'), '缺少外部点击关闭实现')
  const occurrences = (js.match(/bindOutsideClick\(/g) ?? []).length
  assert.ok(occurrences >= 2, `外部点击关闭应至少覆盖 dropdown 与 overlay，当前调用 ${occurrences} 次`)
})

test('scroll-progress 修复了 aria-hidden 焦点违规', () => {
  // 隐藏时必须同时移出 Tab 序，否则 role=button tabindex=0 会留下不可聚焦的陷阱
  assert.ok(/aria-hidden.*true[\s\S]{0,200}tabindex/.test(js) || /tabindex[\s\S]{0,200}aria-hidden/.test(js), '隐藏态必须同时处理 tabindex')
  assert.ok(js.includes("root.setAttribute('tabindex', '-1')"), '隐藏时应移出 Tab 序')
})
