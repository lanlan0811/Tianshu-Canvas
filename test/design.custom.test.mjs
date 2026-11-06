/**
 * 自定义设计系统：创建/列出/查看/删除、浅色+深色注入、lint 识别、
 * 写入前校验（对比度 / 尺度 / 变量覆盖 / id）、跨工作区隔离、幂等与解绑。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)

// 以内置风格为模板造一份完整的自定义 token（值自由、变量名与内置一致）。
const base = JSON.parse(readFileSync(join(root, 'design-systems/styles/apple/tokens.json'), 'utf8'))

/** 造一份合法的 light+dark token；mutate 可改坏某一项。 */
function makeTokens(mutate) {
  const t = structuredClone(base)
  t.modes = { light: true, dark: true }
  const dark = structuredClone(base.color.semantic)
  dark.bg.canvas = 'neutral.900'
  dark.bg.surface = 'neutral.900'
  dark.bg.raised = 'neutral.700'
  dark.bg.sunken = 'neutral.900'
  dark.bg.inverse = 'neutral.0'
  dark.text.primary = 'neutral.0'
  dark.text.secondary = 'neutral.100'
  dark.text.muted = 'neutral.300'
  dark.text.inverse = 'neutral.900'
  dark.border.default = 'neutral.700'
  dark.border.strong = 'neutral.500'
  dark.border.subtle = 'neutral.900'
  dark.action.primary = 'brand.300'
  dark.action.primaryText = 'neutral.900'
  dark.action.secondary = 'neutral.700'
  dark.action.secondaryText = 'neutral.0'
  t.color.semanticDark = dark
  mutate?.(t)
  return t
}

const meta = (over) => ({
  name: '我的品牌',
  tagline: '测试用自定义系统',
  description: '用于测试',
  tags: ['test'],
  swatches: ['#ffffff', '#1d1d1f', '#0071e3', '#8a8275'],
  iconStyle: { strokeWidth: 1.6 },
  ...over,
})

const pageFile = (cwd, id) => readFileSync(join(cwd, '.tianshu-canvas', 'pages', `${id}.html`), 'utf8')
const count = (text, needle) => text.split(needle).length - 1

function workspace(prefix) {
  const cwd = mkdtempSync(join(tmpdir(), prefix))
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

const create = (cwd, id, tokens, m = meta(), extra = {}) =>
  tools.canvas_design_system.execute({ input: { action: 'create', id, tokens, ...m, ...extra }, cwd })

test('自定义设计系统：create 后 list/get 可见且标注来源', async () => {
  const { cwd, cleanup } = workspace('tsc-custom-list-')
  try {
    const created = await create(cwd, 'mybrand', makeTokens())
    assert.ok(!created.isError, created.content)
    assert.match(created.content, /已创建自定义设计系统「我的品牌」（mybrand）/)
    assert.match(created.content, /已锁定为当前项目风格/)
    assert.ok(existsSync(join(cwd, '.tianshu-canvas', 'library', 'mybrand', 'tokens.json')))
    assert.ok(existsSync(join(cwd, '.tianshu-canvas', 'library', 'mybrand', 'meta.json')))

    const list = await tools.canvas_design_system.execute({ input: { action: 'list' }, cwd })
    assert.ok(list.content.includes('mybrand'), list.content)
    assert.match(list.content, /自定义/)

    // canvas_style list 也应同时列出内置与自定义
    const styleList = await tools.canvas_style.execute({ input: { action: 'list' }, cwd })
    assert.ok(styleList.content.includes('mybrand'))
    assert.ok(styleList.content.includes('苹果风'))
    assert.match(styleList.content, /\[自定义\]/)
    assert.match(styleList.content, /\[内置\]/)

    const get = await tools.canvas_design_system.execute({ input: { action: 'get', id: 'mybrand' }, cwd })
    assert.ok(!get.isError, get.content)
    assert.match(get.content, /来源：自定义/)
    assert.match(get.content, /class="dark"/)
  } finally {
    cleanup()
  }
})

test('自定义设计系统：写入页面注入 :root 与 .dark，同名变量，幂等一块', async () => {
  const { cwd, cleanup } = workspace('tsc-custom-inject-')
  try {
    await create(cwd, 'mybrand', makeTokens())
    const html =
      '<!doctype html><html><head></head><body>' +
      '<button class="ts-btn ts-btn--primary"><svg data-icon="search" class="ts-icon"></svg>确定</button>' +
      '</body></html>'
    const added = await tools.canvas_upsert_page.execute({ input: { html, title: 'T' }, cwd })
    assert.ok(!added.isError, added.content)
    const id = added.content.match(/id=([\w-]+)/)[1]
    const page = pageFile(cwd, id)

    assert.equal(count(page, 'tianshu-ds:start'), 1, '只应有一块注入')
    assert.match(page, /:root \{/)
    assert.match(page, /\.dark \{/)
    // 同名变量：两处都出现 --ts-color-bg-canvas
    assert.ok(count(page, '--ts-color-bg-canvas') >= 2, '深色块应复写同名变量')
    assert.ok(page.includes('--ts-color-action-primary: #0071e3'), '浅色取自定义值')
    assert.match(page, /<path/, '图标应展开')

    // 再写一次仍只有一块
    await tools.canvas_upsert_page.execute({ input: { html: html.replace('确定', '取消'), id }, cwd })
    assert.equal(count(pageFile(cwd, id), 'tianshu-ds:start'), 1)
  } finally {
    cleanup()
  }
})

test('自定义设计系统：canvas_check_style 认自定义变量，越界间距仍报', async () => {
  const { cwd, cleanup } = workspace('tsc-custom-lint-')
  try {
    await create(cwd, 'mybrand', makeTokens())
    const ok = await tools.canvas_check_style.execute({
      input: { html: '<p style="color:var(--ts-color-text-primary)">x</p>', style_id: 'mybrand' },
      cwd,
    })
    assert.match(ok.content, /0 处/, ok.content)
    assert.match(ok.content, /我的品牌/, ok.content)

    const bad = await tools.canvas_check_style.execute({
      input: { html: '<style>.a{padding:13px}</style>', style_id: 'mybrand' },
      cwd,
    })
    assert.match(bad.content, /\[spacing\]/)
  } finally {
    cleanup()
  }
})

test('自定义设计系统：深色对比度不足被拒', async () => {
  const { cwd, cleanup } = workspace('tsc-custom-dark-')
  try {
    const res = await create(
      cwd,
      'mybrand',
      makeTokens((t) => {
        t.color.semanticDark.bg.canvas = 'neutral.0'
        t.color.semanticDark.text.primary = 'neutral.0'
      }),
    )
    assert.equal(res.isError, true)
    assert.match(res.content, /对比度不足/)
    assert.match(res.content, /\[dark\]/)
    assert.ok(!existsSync(join(cwd, '.tianshu-canvas', 'library', 'mybrand')), '校验失败不得落盘')
  } finally {
    cleanup()
  }
})

test('自定义设计系统：非法 id 被拒且不落盘', async () => {
  const { cwd, cleanup } = workspace('tsc-custom-id-')
  try {
    for (const id of ['Bad Id!', '../x', '', 'a'.repeat(65)]) {
      const res = await tools.canvas_design_system.execute({
        input: { action: 'create', id, tokens: makeTokens(), ...meta() },
        cwd,
      })
      assert.equal(res.isError, true, `id=${id} 应被拒`)
    }
    assert.ok(!existsSync(join(cwd, '.tianshu-canvas', 'library')), '不得创建任何目录')
  } finally {
    cleanup()
  }
})

test('自定义设计系统：与内置重名、缺 strokeWidth、覆盖语义', async () => {
  const { cwd, cleanup } = workspace('tsc-custom-clash-')
  try {
    const clash = await create(cwd, 'apple', makeTokens())
    assert.equal(clash.isError, true)
    assert.match(clash.content, /与内置风格冲突/)

    const noStroke = await tools.canvas_design_system.execute({
      input: { action: 'create', id: 'nostroke', tokens: makeTokens(), name: 'X' },
      cwd,
    })
    assert.equal(noStroke.isError, true)
    assert.match(noStroke.content, /iconStyle\.strokeWidth/)

    const ok = await create(cwd, 'mybrand', makeTokens())
    assert.ok(!ok.isError, ok.content)
    const again = await create(cwd, 'mybrand', makeTokens())
    assert.equal(again.isError, true)
    assert.match(again.content, /已存在/)
    const overwrite = await create(cwd, 'mybrand', makeTokens(), meta({ name: '改名' }), { overwrite: true })
    assert.ok(!overwrite.isError, overwrite.content)
    assert.match(overwrite.content, /改名/)
  } finally {
    cleanup()
  }
})

test('自定义设计系统：尺度非递增与缺变量被拒', async () => {
  const { cwd, cleanup } = workspace('tsc-custom-scale-')
  try {
    const dup = await create(cwd, 'dup', makeTokens((t) => { t.space['3'] = t.space['2'] }))
    assert.equal(dup.isError, true)
    assert.match(dup.content, /值必须严格递增/)

    const missing = await create(cwd, 'missing', makeTokens((t) => { delete t.size.sidebar }))
    assert.equal(missing.isError, true)
    assert.match(missing.content, /--ts-size-sidebar/)
  } finally {
    cleanup()
  }
})

test('自定义设计系统：跨工作区隔离', async () => {
  const a = workspace('tsc-custom-a-')
  const b = workspace('tsc-custom-b-')
  try {
    await create(a.cwd, 'mybrand', makeTokens())
    const listB = await tools.canvas_design_system.execute({ input: { action: 'list' }, cwd: b.cwd })
    assert.doesNotMatch(listB.content, /mybrand/)
    const styleB = await tools.canvas_style.execute({ input: { action: 'list' }, cwd: b.cwd })
    assert.doesNotMatch(styleB.content, /mybrand/)
    const setB = await tools.canvas_style.execute({ input: { action: 'set', style_id: 'mybrand' }, cwd: b.cwd })
    assert.equal(setB.isError, true)
    const getB = await tools.canvas_design_system.execute({ input: { action: 'get', id: 'mybrand' }, cwd: b.cwd })
    assert.equal(getB.isError, true)
  } finally {
    a.cleanup()
    b.cleanup()
  }
})

test('自定义设计系统：remove 删除并自动解绑，页面保留注入块', async () => {
  const { cwd, cleanup } = workspace('tsc-custom-remove-')
  try {
    await create(cwd, 'mybrand', makeTokens())
    const added = await tools.canvas_upsert_page.execute({
      input: { html: '<!doctype html><html><head></head><body><p>x</p></body></html>', title: 'T' },
      cwd,
    })
    const id = added.content.match(/id=([\w-]+)/)[1]

    const removed = await tools.canvas_design_system.execute({ input: { action: 'remove', id: 'mybrand' }, cwd })
    assert.ok(!removed.isError, removed.content)
    assert.match(removed.content, /已删除/)
    assert.match(removed.content, /已解除锁定/)
    assert.ok(!existsSync(join(cwd, '.tianshu-canvas', 'library', 'mybrand')))
    assert.equal(JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8')).design, undefined)
    assert.ok(pageFile(cwd, id).includes('--ts-color-bg-canvas'), '已注入的样式块应保留')

    const list = await tools.canvas_design_system.execute({ input: { action: 'list' }, cwd })
    assert.doesNotMatch(list.content, /mybrand/)

    // 内置不可删
    const delBuiltin = await tools.canvas_design_system.execute({ input: { action: 'remove', id: 'apple' }, cwd })
    assert.equal(delBuiltin.isError, true)
    assert.match(delBuiltin.content, /内置风格/)
  } finally {
    cleanup()
  }
})

test('自定义设计系统：get_state 显示自定义风格名', async () => {
  const { cwd, cleanup } = workspace('tsc-custom-state-')
  try {
    await create(cwd, 'mybrand', makeTokens())
    const state = await tools.canvas_get_state.execute({ input: {}, cwd })
    assert.match(state.content, /我的品牌（mybrand，已锁定）/)
  } finally {
    cleanup()
  }
})
