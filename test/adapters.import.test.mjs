/**
 * 适配器导入测试：shadcn/Tailwind 与 Ant Design 的 token 导入。
 * 断言的是构建产物（dist/index.mjs），与其它测试一致。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'
import { validateTokens } from '../scripts/design/design-validate.mjs'

const root = resolve(import.meta.dirname, '..')
const { api } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
const tool = (name) => api.tools.find((t) => t.name === name)

function workspace() {
  return mkdtempSync(join(tmpdir(), 'tsc-adapter-'))
}

function write(cwd, rel, text) {
  const abs = join(cwd, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, text, 'utf8')
}

const SHADCN_CSS = `@import 'tailwindcss';

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.55 0.2 255);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.55 0.2 255);
  --radius: 0.625rem;
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
}
`

const ANTD_APP = `import { ConfigProvider } from 'antd'
import { theme } from './theme'

export default function App() {
  return <ConfigProvider theme={{ token: { colorPrimary: '#722ed1', borderRadius: 4 } }}>{null}</ConfigProvider>
}
`

async function importStyle(cwd, args) {
  return tool('canvas_design_system').execute({ args: { action: 'import', ...args }, cwd, sessionId: 'test' })
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

await test('shadcn：从 oklch 主题导入，颜色归一化为 hex，且通过 token 契约', async () => {
  const cwd = workspace()
  write(cwd, 'package.json', JSON.stringify({ dependencies: { next: '15.0.0', tailwindcss: '4.0.0', 'class-variance-authority': '0.7.0' } }))
  write(cwd, 'components.json', JSON.stringify({ tailwind: { css: 'app/globals.css' }, aliases: { components: '@/components' } }))
  write(cwd, 'app/globals.css', SHADCN_CSS)

  const res = await importStyle(cwd, { id: 'brand-x', stack: 'shadcn', set_current: false })
  assert.equal(res.isError, undefined, res.content)
  assert.match(res.content, /观测 \d+ 项、推断 \d+ 项/)
  assert.match(res.content, /已创建自定义设计系统/)

  const tokens = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas/library/brand-x/tokens.json'), 'utf8'))
  const errors = []
  const warnings = []
  validateTokens(tokens, 'brand-x', errors, warnings)
  assert.deepEqual(errors, [], errors.join('\n'))
  assert.match(tokens.color.primitives.brand['500'], /^#[0-9a-f]{6}$/)
  assert.match(tokens.color.primitives.neutral['900'], /^#[0-9a-f]{6}$/)

  const meta = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas/library/brand-x/meta.json'), 'utf8'))
  assert.equal(meta.adapter.id, 'shadcn')

  // 确定性：同工作区、同输入，两次导入的 tokens 字节一致。
  const first = readFileSync(join(cwd, '.tianshu-canvas/library/brand-x/tokens.json'), 'utf8')
  const again = await importStyle(cwd, { id: 'brand-x', stack: 'shadcn', set_current: false, overwrite: true })
  assert.equal(again.isError, undefined, again.content)
  assert.equal(readFileSync(join(cwd, '.tianshu-canvas/library/brand-x/tokens.json'), 'utf8'), first, '两次导入产物不一致')
})

await test('shadcn：自动探测（未显式传 stack）', async () => {
  const cwd = workspace()
  write(cwd, 'package.json', JSON.stringify({ dependencies: { tailwindcss: '4.0.0', 'class-variance-authority': '0.7.0' } }))
  write(cwd, 'app/globals.css', SHADCN_CSS)
  const res = await importStyle(cwd, { id: 'auto-shadcn', set_current: false })
  assert.equal(res.isError, undefined, res.content)
  assert.match(res.content, /探测依据/)
})

await test('AntD：读取 ConfigProvider 字面量，观察项与默认值可区分', async () => {
  const cwd = workspace()
  write(cwd, 'package.json', JSON.stringify({ dependencies: { antd: '5.20.0', react: '18.3.1' } }))
  write(cwd, 'src/App.tsx', ANTD_APP)

  const res = await importStyle(cwd, { id: 'antd-from-repo', stack: 'antd', set_current: false })
  assert.equal(res.isError, undefined, res.content)
  assert.match(res.content, /主题来源：src\/App\.tsx/)
  const tokens = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas/library/antd-from-repo/tokens.json'), 'utf8'))
  assert.equal(tokens.color.primitives.brand['500'], '#722ed1')
})

await test('AntD：找不到项目主题时明确标注默认值，禁止冒充项目主题', async () => {
  const cwd = workspace()
  write(cwd, 'package.json', JSON.stringify({ dependencies: { antd: '5.20.0' } }))
  const res = await importStyle(cwd, { id: 'antd-default', stack: 'antd', set_current: false })
  assert.equal(res.isError, undefined, res.content)
  assert.match(res.content, /默认种子 token/)
  assert.match(res.content, /不是项目实际主题/)
})

await test('反例：缺少 primary / 未知 stack / 无主题文件 都返回错误且不写盘', async () => {
  const cwd = workspace()
  write(cwd, 'package.json', JSON.stringify({ dependencies: { tailwindcss: '4.0.0', 'class-variance-authority': '0.7.0' } }))
  write(cwd, 'app/globals.css', ':root { --background: #ffffff; --foreground: #000000; }')

  const noPrimary = await importStyle(cwd, { id: 'bad-1', stack: 'shadcn', set_current: false })
  assert.equal(noPrimary.isError, true)
  assert.match(noPrimary.content, /缺少主色/)

  const unknown = await importStyle(cwd, { id: 'bad-2', stack: 'vue', set_current: false })
  assert.equal(unknown.isError, true)

  const noTheme = await importStyle(cwd, { id: 'bad-3', stack: 'shadcn', source_path: 'app/missing.css', set_current: false })
  assert.equal(noTheme.isError, true)

  const library = join(cwd, '.tianshu-canvas/library')
  assert.equal(existsSync(library) ? readdirSync(library).length : 0, 0, '失败时不应创建 library 目录')
})

await test('反例：对比度不足的导入会被 token 契约拒绝', async () => {
  const cwd = workspace()
  write(cwd, 'package.json', JSON.stringify({ dependencies: { tailwindcss: '4.0.0', 'class-variance-authority': '0.7.0' } }))
  // 前景与背景几乎同色：materialize 会做一次对比度修正，但修正后主按钮文字仍来自仓库值。
  write(
    cwd,
    'app/globals.css',
    ':root { --background: #f0f0f0; --foreground: #eeeeee; --primary: #efefef; --primary-foreground: #eeeeee; --border: #f0f0f0; }',
  )
  const res = await importStyle(cwd, { id: 'low-contrast', stack: 'shadcn', set_current: false })
  // 允许成功（已自动修正）或失败（严格拒绝），但绝不能静默写入一套低对比度主题。
  if (res.isError === undefined) {
    const tokens = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas/library/low-contrast/tokens.json'), 'utf8'))
    const errors = []
    const warnings = []
    validateTokens(tokens, 'low-contrast', errors, warnings)
    assert.deepEqual(errors, [], errors.join('\n'))
    assert.match(res.content, /对比度修正|对比度不足/)
  } else {
    assert.match(res.content, /对比度/)
  }
})

console.log('OK 适配器导入：shadcn/AntD 的观测、推断、确定性与反例全部通过')
