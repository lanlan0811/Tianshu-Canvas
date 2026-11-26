/**
 * 颜色计算与规则注册表的单元测试（纯函数，零浏览器）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const apiDir = mkdtempSync(join(tmpdir(), 'tsc-rules-unit-'))
await build({
  stdin: {
    contents: "export * from './src/rules/colorMath.ts'; export * from './src/rules/registry.ts'; export * from './src/rules/ignores.ts'; export * from './src/rules/profiles.ts';",
    resolveDir: root,
  },
  outfile: join(apiDir, 'rules.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'silent',
})
const m = await import(pathToFileURL(join(apiDir, 'rules.mjs')).href)
test.after(() => rmSync(apiDir, { recursive: true, force: true }))

test('解析 hex（3/4/6/8 位）与 alpha', () => {
  assert.deepEqual(m.parseHex('#fff'), { r: 255, g: 255, b: 255, a: 1 })
  assert.deepEqual(m.parseHex('#0f08'), { r: 0, g: 255, b: 0, a: 136 / 255 })
  assert.deepEqual(m.parseHex('#336699'), { r: 0x33, g: 0x66, b: 0x99, a: 1 })
  assert.equal(m.parseHex('#xyz'), null)
})

test('解析 rgb / hsl / oklch', () => {
  assert.deepEqual(m.parseRgbFunction('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30, a: 1 })
  assert.deepEqual(m.parseRgbFunction('rgba(10, 20, 30, 0.5)'), { r: 10, g: 20, b: 30, a: 0.5 })
  assert.deepEqual(m.parseRgbFunction('rgb(10 20 30 / 40%)'), { r: 10, g: 20, b: 30, a: 0.4 })
  const red = m.parseHslFunction('hsl(0, 100%, 50%)')
  assert.deepEqual(red, { r: 255, g: 0, b: 0, a: 1 })
  const oklch = m.parseOklchFunction('oklch(62.8% 0.2577 29.23)')
  assert.ok(oklch && oklch.r > 200 && oklch.g < 80, JSON.stringify(oklch))
})

test('不可解析的颜色一律弃权（var / currentColor / color-mix）', () => {
  assert.equal(m.parseColor('var(--x)'), null)
  assert.equal(m.parseColor('currentColor'), null)
  assert.equal(m.parseColor('color-mix(in srgb, red, blue)'), null)
})

test('奶油色判据', () => {
  assert.equal(m.isCreamColor(m.parseHex('#f4f1ea')), true)
  assert.equal(m.isCreamColor(m.parseHex('#faf9f5')), false, '暖差 5 未达 6 的下限')
  assert.equal(m.isCreamColor(m.parseHex('#ffffff')), false, '纯白不是奶油')
  assert.equal(m.isCreamColor(m.parseHex('#f0f0f0')), false, '中性灰不是奶油')
  assert.equal(m.isCreamColor(m.parseHex('#1a1a1a')), false)
})

test('中性灰与通道极差', () => {
  assert.equal(m.isNeutralGray(m.parseHex('#808080')), true)
  assert.equal(m.isNeutralGray(m.parseHex('#8b8b8e')), true)
  assert.equal(m.isNeutralGray(m.parseHex('#7c3aed')), false)
  assert.equal(m.channelSpread(m.parseHex('#7c3aed')), 0xed - 0x3a)
})

test('色相与饱和度', () => {
  const purple = m.parseHex('#7c3aed')
  assert.ok(m.hueOf(purple) > 255 && m.hueOf(purple) < 290, String(m.hueOf(purple)))
  assert.ok(m.saturationOf(purple) > 60)
  assert.equal(m.saturationOf(m.parseHex('#808080')), 0)
})

test('相对亮度：白 1、黑 0', () => {
  assert.equal(m.relativeLuminance(m.parseHex('#ffffff')), 1)
  assert.equal(m.relativeLuminance(m.parseHex('#000000')), 0)
})

test('九个 tell 色被识别', () => {
  for (const hex of ['7c3aed', '8b5cf6', 'a855f7', '6366f1', '667eea']) {
    assert.equal(m.PURPLE_TELL_HEXES.has(hex), true, hex)
  }
})

test('colorsIn 按出现顺序取色', () => {
  const colors = m.colorsIn('linear-gradient(90deg, #db2777, rgb(124 58 237), oklch(62.8% 0.2577 29.23))')
  assert.equal(colors.length, 3)
  assert.deepEqual(colors[0], { r: 0xdb, g: 0x27, b: 0x77, a: 1 })
})

test('注册表：id 唯一、kebab、必要字段非空', () => {
  const ids = new Set()
  for (const rule of m.RULES) {
    assert.match(rule.id, /^[a-z][a-z0-9-]*$/, rule.id)
    assert.equal(ids.has(rule.id), false, `重复 id：${rule.id}`)
    ids.add(rule.id)
    assert.ok(['slop', 'quality'].includes(rule.category), rule.id)
    assert.ok(['warning', 'advisory'].includes(rule.severity), `${rule.id} 的 severity 不能是 error`)
    assert.ok(['source', 'render'].includes(rule.engine), rule.id)
    assert.ok(rule.name.length > 0 && rule.description.length > 0 && rule.fix.length > 0, rule.id)
    assert.ok(rule.origin.length > 0, rule.id)
    for (const state of Object.values(rule.modes ?? {})) {
      assert.ok(['on', 'advisory', 'off'].includes(state), `${rule.id}: ${state}`)
    }
  }
})

test('注册表：源码级规则都有 fixture 目录', async () => {
  const { existsSync } = await import('node:fs')
  for (const rule of m.RULES.filter((r) => r.engine === 'source')) {
    assert.ok(existsSync(join(root, 'test', 'fixtures', 'rules', rule.id)), `缺少 fixture：${rule.id}`)
  }
})

test('注册表：immediate 档只收机械可判的规则（防止悄悄放水）', () => {
  const immediate = m.RULES.filter((r) => r.tier === 'immediate').map((r) => r.id).sort()
  // 判据来自 impeccable hooks.md 的两层机制：编辑期只报「机械、无歧义、就地可改」的。
  // 改这张表必须先改 registry 注释里的理由，再更新本断言——不允许为了让某条规则「更显眼」而随手加进来。
  assert.deepEqual(immediate, ['border-accent-on-rounded', 'emoji-icon', 'gradient-text', 'gray-on-color', 'side-tab'])
  for (const rule of m.RULES) {
    assert.ok(['immediate', 'deferred'].includes(rule.tier), `${rule.id} 的 tier 非法：${String(rule.tier)}`)
  }
})

test('模式画像：read 模式关掉装饰类规则，operate 保留结构类规则', () => {
  const ids = (mode) => m.activeRules(mode).map((r) => r.id)
  assert.equal(ids('read').includes('radial-halo'), false)
  assert.equal(ids('read').includes('gradient-text'), false)
  assert.equal(ids('read').includes('marquee'), false)
  assert.equal(ids('operate').includes('side-tab'), true)
  assert.equal(ids('persuade').includes('gradient-text'), true)
  const gradient = m.RULES.find((r) => r.id === 'gradient-text')
  assert.equal(m.degradesToAdvisory(gradient, 'operate'), true)
  assert.equal(m.degradesToAdvisory(gradient, 'persuade'), false)
})

test('豁免：文件级 / 下一行 / 多规则 / all', () => {
  const html = [
    '<!-- tianshu-lint-disable side-tab -->',
    '<div class="a">x</div>',
    '<!-- tianshu-lint-disable-next-line gradient-text, overused-font -->',
    '<div class="b">y</div>',
    '<!-- tianshu-lint-disable all -->',
    '<div class="c">z</div>',
  ].join('\n')
  const set = m.parseIgnores(html)
  assert.equal(m.isIgnored(set, 'side-tab', 2), true)
  assert.equal(m.isIgnored(set, 'gradient-text', 4), true)
  assert.equal(m.isIgnored(set, 'overused-font', 4), true)
  assert.equal(m.isIgnored(set, 'emoji-icon', 2), true, '文件级 all 影响整页')
  assert.equal(m.isIgnored(set, 'emoji-icon', 6), true, 'all 生效')
  assert.equal(set.directives.length, 3)
})

test('未生效豁免被识别', () => {
  const html = '<!-- tianshu-lint-disable side-tab -->\n<div>x</div>'
  const set = m.parseIgnores(html)
  const directive = set.directives[0]
  assert.equal(m.directiveUsed(set, directive, [{ rule: 'gradient-text', line: 2 }]), false)
  assert.equal(m.directiveUsed(set, directive, [{ rule: 'side-tab', line: 2 }]), true)
})
