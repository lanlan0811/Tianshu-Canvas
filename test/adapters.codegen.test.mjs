/**
 * 适配器导出测试：原型 HTML → shadcn / AntD 组件代码。
 * 重点验证「按结构选组件」而不是字符串替换（变异用例）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { api } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
const styleTool = api.tools.find((t) => t.name === 'canvas_style')
const designTool = api.tools.find((t) => t.name === 'canvas_design_system')

const PAGE = `<!doctype html>
<html><head><style>.x{color:red}</style></head>
<body>
<div class="ts-app">
  <aside class="ts-sidebar">
    <div class="ts-sidebar__brand">工作台</div>
    <nav class="ts-sidebar__nav"><a class="ts-sidebar__item ts-sidebar__item--active">概览</a></nav>
  </aside>
  <main class="ts-main">
    <header class="ts-main__header"><h1 class="ts-title">概览</h1><button class="ts-btn ts-btn--primary">新建</button></header>
    <div class="ts-main__body">
      <div class="ts-row"><input class="ts-input" placeholder="搜索" /><button class="ts-btn">取消</button></div>
      <table class="ts-table">
        <thead><tr><th>名称</th><th>状态</th></tr></thead>
        <tbody><tr><td>项目 A</td><td>运行中</td></tr></tbody>
      </table>
      <span class="ts-badge">Beta</span>
    </div>
  </main>
</div>
</body></html>`

async function withStyle() {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-codegen-'))
  const set = await styleTool.execute({ args: { action: 'set', style_id: 'apple' }, cwd, sessionId: 'test' })
  assert.equal(set.isError, undefined, set.content)
  return cwd
}

async function codegen(cwd, target, html) {
  return styleTool.execute({ args: { action: 'codegen', target, html, write_files: false }, cwd, sessionId: 'test' })
}

function fileOf(content, name) {
  const start = content.indexOf(`### ${name}`)
  assert.ok(start >= 0, `产物缺少 ${name}`)
  const fence = content.indexOf('```', start)
  const end = content.indexOf('```', fence + 3)
  return content.slice(fence + 3, end)
}

async function test(name, fn) {
  try {
    await fn()
    console.log(`✔ ${name}`)
  } catch (err) {
    console.error(`✖ ${name}`)
    throw err
  }
}

await test('shadcn：按钮/输入/表格/徽章映射为真实组件与 props', async () => {
  const cwd = await withStyle()
  const res = await codegen(cwd, 'shadcn', PAGE)
  assert.equal(res.isError, undefined, res.content)
  const page = fileOf(res.content, 'app/page.tsx')
  assert.match(page, /import \{ Button \} from '@\/components\/ui\/button'/)
  assert.match(page, /import \{ Table[^}]*\} from '@\/components\/ui\/table'/)
  assert.match(page, /<Button variant="default"/)
  assert.match(page, /<Button>/)
  assert.match(page, /<Input[^>]*placeholder="搜索"/)
  assert.match(page, /<TableHead>名称<\/TableHead>/)
  assert.match(page, /<TableCell>运行中<\/TableCell>/)
  assert.match(page, /<Badge>/)
  assert.doesNotMatch(page, /className="[^"]*\bts-/, '产物不应残留 ts- 类名')
  assert.match(page, /bg-background|text-foreground|w-60/, '应把组件类改写为 Tailwind utility')

  const css = fileOf(res.content, 'app/theme.css')
  assert.match(css, /--primary: #[0-9a-f]{6};/)
  assert.match(css, /--radius: \d+px;/)
  const theme = fileOf(res.content, 'lib/theme.ts')
  assert.match(theme, /'action-primary': '#[0-9a-f]{6}'/)
  assert.match(res.content, /README\.md/)
})

await test('shadcn：确定性（同输入两次产物一致）', async () => {
  const cwd = await withStyle()
  const a = await codegen(cwd, 'shadcn', PAGE)
  const b = await codegen(cwd, 'shadcn', PAGE)
  assert.equal(a.content, b.content)
})

await test('shadcn：变异——表格变成按钮结构时组件选择随之变化', async () => {
  const cwd = await withStyle()
  const mutated = PAGE.replace(/<table[\s\S]*?<\/table>/, '<button class="ts-btn ts-btn--danger">删除</button>')
  const res = await codegen(cwd, 'shadcn', mutated)
  const page = fileOf(res.content, 'app/page.tsx')
  assert.doesNotMatch(page, /<Table/, '没有表格结构时不应再产出 Table')
  assert.match(page, /<Button variant="destructive">/)
})

await test('AntD：组件映射 + 主题集中 + 表格 columns 来自表头', async () => {
  const cwd = await withStyle()
  const res = await codegen(cwd, 'antd', PAGE)
  assert.equal(res.isError, undefined, res.content)
  const app = fileOf(res.content, 'src/App.tsx')
  assert.match(app, /import \{ ConfigProvider, .*Button.*Table.* \} from 'antd'/)
  assert.match(app, /<ConfigProvider theme=\{theme\}>/)
  assert.match(app, /<Button type="primary"/)
  assert.match(app, /<Button>/)
  assert.match(app, /<Input placeholder="搜索" \/>/)
  assert.match(app, /<Table columns=\{\[\{ title: '名称', dataIndex: 'col0'.*\]\} dataSource=\{\[\{ key: 'row-0', col0: '项目 A', col1: '运行中' \}\]\}/)
  assert.match(app, /<Tag>/)
  assert.doesNotMatch(app, /className="[^"]*\bts-/, '产物不应残留 ts- 类名')
  assert.doesNotMatch(app, /#[0-9a-f]{6}/i, '页面代码不应硬编码颜色')

  const theme = fileOf(res.content, 'src/theme.ts')
  assert.match(theme, /colorPrimary: '#[0-9a-f]{6}'/)
  assert.match(theme, /borderRadius: \d+/)
})

await test('AntD：确定性（同输入两次产物一致）', async () => {
  const cwd = await withStyle()
  const a = await codegen(cwd, 'antd', PAGE)
  const b = await codegen(cwd, 'antd', PAGE)
  assert.equal(a.content, b.content)
})

await test('未锁定风格时 shadcn/antd 给出可读错误', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-codegen-free-'))
  const res = await codegen(cwd, 'shadcn', PAGE)
  assert.equal(res.isError, true)
  assert.match(res.content, /需要已锁定风格/)
})

void designTool
console.log('OK 适配器导出：shadcn/AntD 组件映射、确定性、变异与错误分支全部通过')
