/**
 * 风格检查的准确性回归：多值写法、命名色和现代色函数要报；
 * 选择器、注释、data-* 属性和 emoji 不能造成误报；无法检查时不能显示“通过”。
 */
import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

const check = (input) => tools.canvas_check_style.execute({ input, cwd: process.cwd() })
const lint = async (css) => (await check({ html: `<style>${css}</style>`, style_id: 'claude' })).content

test('多值写法：逐个检查像素值', async () => {
  const out = await lint('.a{padding:13px 7px}.b{border-radius:7px 7px 0 0}.c{margin:0 auto 13px}')
  assert.match(out, /间距 13px/)
  assert.match(out, /间距 7px/)
  assert.match(out, /圆角 7px/)
  assert.match(out, /汇总：.*spacing 3/, out)
})

test('多值写法：负值按绝对值，var 和 calc 不误报', async () => {
  const onScale = await lint('.a{margin:-8px;padding:8px 16px}')
  assert.match(onScale, /0 处/, onScale)
  const dynamic = await lint('.a{padding:calc(13px + 1px)}.b{margin:var(--ts-space-8) 16px}')
  assert.match(dynamic, /0 处/, dynamic)
})

test('命名色和现代色函数都要报', async () => {
  for (const css of [
    '.a{color:red}',
    '.a{border:1px solid black}',
    '.a{background:linear-gradient(to right, white, navy)}',
    '.a{background:oklch(0.5 0.1 200)}',
    '.a{color:hwb(0 0% 0%)}',
    '.a{color:color(display-p3 1 0 0)}',
  ]) {
    assert.match(await lint(css), /\[color\]/, css)
  }
})

test('不是颜色的写法不误报', async () => {
  for (const css of [
    '.a{color:transparent}',
    '.a{color:currentColor}',
    '.a{color:inherit}',
    '.a{color:var(--ts-color-text)}',
    '.a{background:var(--ts-color-red)}',
    '.a{font-family:var(--ts-font-sans)}',
    '.red{display:block}',
    '#face{display:block}#add{display:block}',
    '/* color:#fff; padding:13px */ .a{display:block}',
  ]) {
    const out = await lint(css)
    assert.doesNotMatch(out, /\[(color|spacing)\]/, `${css} -> ${out}`)
  }
})

test('data-style 属性不当作样式', async () => {
  const res = await check({ html: '<div data-style="#abcabc;padding:13px"></div>', style_id: 'claude' })
  assert.match(res.content, /0 处/, res.content)
})

test('emoji 不影响掩码位置', async () => {
  const css = '<style>.a{background:url(x#abc.png)}.b{color:#123456}</style>'
  const plain = await check({ html: css, style_id: 'claude' })
  const withEmoji = await check({ html: `<p>${'😀'.repeat(60)}</p>${css}`, style_id: 'claude' })
  const summary = (t) => t.match(/汇总：(.*)/)?.[1]
  assert.equal(summary(withEmoji.content), summary(plain.content))
  assert.doesNotMatch(withEmoji.content, /裸色值 #abc\b/)
})

test('free 只检查资源，并如实说明', async () => {
  const res = await check({ html: '<style>.a{color:#123456}</style>', style_id: 'free' })
  assert.ok(!res.isError, res.content)
  assert.match(res.content, /未锁定风格/)
  assert.match(res.content, /仅检查资源引用/)
  assert.doesNotMatch(res.content, /free（free）/)
})

test('未知风格报错，不能显示通过', async () => {
  const lintRes = await check({ html: '<style>.a{color:#123456}</style>', style_id: 'nope' })
  assert.equal(lintRes.isError, true)
  assert.match(lintRes.content, /未知的设计风格：nope/)
  const getRes = await tools.canvas_style.execute({ input: { action: 'get', style_id: 'nope' }, cwd: process.cwd() })
  assert.equal(getRes.isError, true)
})
