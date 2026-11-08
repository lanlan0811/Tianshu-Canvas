/**
 * 适配器导入测试：shadcn/Tailwind 与 Ant Design 的 token 导入。
 * 断言的是构建产物（dist/index.mjs），与其它测试一致。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
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

async function test(name, optionsOrFn, maybeFn) {
  const options = typeof optionsOrFn === 'function' ? {} : optionsOrFn
  const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn
  if (options.skip) {
    console.log(`↷ ${name}（跳过：${options.skip}）`)
    return
  }
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

// ---------------------------------------------------------------------------
// 回归（技术反馈 0.8.2）：自动导入不得读取工作区外文件
// ---------------------------------------------------------------------------

/** 外部文件里的哨兵色；出现在返回结果里即视为越界读取。 */
const SECRET = '#7f00ff'
const SECRET_CSS = `:root{--primary:${SECRET};--background:#ffffff;--foreground:#111111;--radius:0.75rem}`

function canSymlink() {
  const b = mkdtempSync(join(tmpdir(), 'tsc-probe-'))
  try {
    symlinkSync(join(b, 'x'), join(b, 'y'), 'file')
    return true
  } catch {
    return false
  } finally {
    rmSync(b, { recursive: true, force: true })
  }
}

const CAN_SYMLINK = canSymlink()
const skipIfNoSymlink = CAN_SYMLINK ? false : '当前环境不允许创建符号链接（Windows 需开发者模式或管理员）'

/** 建工作区 + 工作区外的私有主题文件；返回 { base, cwd, outside }。 */
function leakWorkspace() {
  const base = mkdtempSync(join(tmpdir(), 'tsc-leak-'))
  const cwd = join(base, 'workspace')
  const outside = join(base, 'outside')
  mkdirSync(cwd, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'private-theme.css'), SECRET_CSS, 'utf8')
  return { base, cwd, outside }
}

/** 断言 import 的返回值里不含外部哨兵色（即没有读到工作区外的文件）。 */
async function assertNoLeak(cwd, args, label) {
  const res = await importStyle(cwd, { id: 'probe', dry_run: true, ...args })
  const leaked = String(res.content).toLowerCase().includes(SECRET.slice(1))
  assert.equal(leaked, false, `${label}：外部文件内容进入了返回结果`)
}

await test('自动导入：components.json 指向工作区外（相对越界）时拒绝读取', async () => {
  const { base, cwd } = leakWorkspace()
  try {
    write(cwd, 'package.json', JSON.stringify({ dependencies: { tailwindcss: '^3' } }))
    write(cwd, 'components.json', JSON.stringify({ tailwind: { css: '../outside/private-theme.css' } }))
    await assertNoLeak(cwd, { stack: 'shadcn' }, 'components.json 相对越界')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

await test('自动导入：components.json 指向工作区外（绝对路径）时拒绝读取', async () => {
  const { base, cwd, outside } = leakWorkspace()
  try {
    write(cwd, 'package.json', JSON.stringify({ dependencies: { tailwindcss: '^3' } }))
    write(cwd, 'components.json', JSON.stringify({ tailwind: { css: join(outside, 'private-theme.css') } }))
    await assertNoLeak(cwd, { stack: 'shadcn' }, 'components.json 绝对越界')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

await test('自动导入：app/globals.css 为符号链接时拒绝读取', { skip: skipIfNoSymlink }, async () => {
  const { base, cwd, outside } = leakWorkspace()
  try {
    mkdirSync(join(cwd, 'app'), { recursive: true })
    symlinkSync(join(outside, 'private-theme.css'), join(cwd, 'app', 'globals.css'), 'file')
    await assertNoLeak(cwd, { stack: 'shadcn' }, 'globals.css 为符号链接')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

await test('自动导入：tailwind.config.js 为符号链接时拒绝读取', { skip: skipIfNoSymlink }, async () => {
  const { base, cwd, outside } = leakWorkspace()
  try {
    write(cwd, 'app/globals.css', ':root{}')
    symlinkSync(join(outside, 'private-theme.css'), join(cwd, 'tailwind.config.js'), 'file')
    await assertNoLeak(cwd, { stack: 'shadcn' }, 'tailwind.config.js 为符号链接')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

await test('自动导入：AntD 的 src/App.tsx 为符号链接时拒绝读取', { skip: skipIfNoSymlink }, async () => {
  const { base, cwd, outside } = leakWorkspace()
  try {
    mkdirSync(join(cwd, 'src'), { recursive: true })
    writeFileSync(join(outside, 'App.tsx'), `<ConfigProvider theme={{ token: { colorPrimary: '${SECRET}', borderRadius: 8 } }} />`, 'utf8')
    symlinkSync(join(outside, 'App.tsx'), join(cwd, 'src', 'App.tsx'), 'file')
    write(cwd, 'package.json', JSON.stringify({ dependencies: { antd: '^5' } }))
    await assertNoLeak(cwd, { stack: 'antd' }, 'src/App.tsx 为符号链接')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

await test('自动导入：候选目录为目录联接（junction）时拒绝读取', { skip: skipIfNoSymlink }, async () => {
  const { base, cwd, outside } = leakWorkspace()
  try {
    mkdirSync(join(outside, 'app'), { recursive: true })
    writeFileSync(join(outside, 'app', 'globals.css'), SECRET_CSS, 'utf8')
    symlinkSync(join(outside, 'app'), join(cwd, 'app'), 'junction')
    await assertNoLeak(cwd, { stack: 'shadcn' }, 'app/ 为目录联接')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

await test('自动导入：工作区内的正常主题仍可读取（加固误伤回归）', async () => {
  const cwd = workspace()
  write(cwd, 'package.json', JSON.stringify({ dependencies: { tailwindcss: '^3' } }))
  write(cwd, 'components.json', JSON.stringify({ tailwind: { css: 'app/globals.css' } }))
  write(cwd, 'app/globals.css', SECRET_CSS)
  const res = await importStyle(cwd, { id: 'ok-theme', stack: 'shadcn', set_current: false })
  assert.equal(res.isError, undefined, res.content)
  const tokens = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas/library/ok-theme/tokens.json'), 'utf8'))
  assert.equal(tokens.color.primitives.brand['500'], SECRET, '工作区内的主色应被正常读取')
})

// ---------------------------------------------------------------------------
// 回归（技术反馈 0.8.3）：候选样式文件必须「存在且可安全读取」才算命中
// ---------------------------------------------------------------------------

/** 反馈文档里的最小主题；主色用于断言读取到的确实是这一份。 */
const FEEDBACK_CSS = `:root {
  --primary: #136ace;
  --background: #ffffff;
  --foreground: #000000;
  --primary-foreground: #ffffff;
}
`

const CSS_CANDIDATES = ['app/globals.css', 'src/app/globals.css', 'styles/globals.css', 'src/styles/globals.css', 'src/index.css', 'index.css']

function shadcnWorkspace() {
  const cwd = workspace()
  write(cwd, 'package.json', JSON.stringify({ dependencies: { tailwindcss: '^3', 'class-variance-authority': '^0.7' } }))
  return cwd
}

function importedBrand(cwd, id) {
  const tokens = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas/library', id, 'tokens.json'), 'utf8'))
  return tokens.color.primitives.brand['500']
}

await test('0.8.3 缺陷回归：仅有 src/index.css 时 dry_run 导入成功且不落盘', async () => {
  const cwd = shadcnWorkspace()
  write(cwd, 'src/index.css', FEEDBACK_CSS)
  const res = await importStyle(cwd, { id: 'audit', stack: 'shadcn', dry_run: true })
  assert.equal(res.isError, undefined, res.content)
  assert.equal(existsSync(join(cwd, '.tianshu-canvas/library')), false, 'dry_run 不得落盘')
})

for (const candidate of CSS_CANDIDATES) {
  await test(`候选路径：仅有 ${candidate} 时，显式 stack 与自动探测都能导入`, async () => {
    const cwd = shadcnWorkspace()
    write(cwd, candidate, FEEDBACK_CSS)

    const explicit = await importStyle(cwd, { id: 'explicit', stack: 'shadcn', set_current: false })
    assert.equal(explicit.isError, undefined, explicit.content)
    assert.equal(importedBrand(cwd, 'explicit'), '#136ace')

    const auto = await importStyle(cwd, { id: 'auto', set_current: false })
    assert.equal(auto.isError, undefined, auto.content)
    assert.match(auto.content, new RegExp(`样式文件 ${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.equal(importedBrand(cwd, 'auto'), '#136ace')
  })
}

await test('候选顺序：components.json 指定的安全 CSS 优先于默认候选', async () => {
  const cwd = shadcnWorkspace()
  write(cwd, 'components.json', JSON.stringify({ tailwind: { css: './styles/globals.css' } }))
  write(cwd, 'app/globals.css', ':root{--primary:#ff0000;--background:#ffffff;--foreground:#000000;--primary-foreground:#ffffff}')
  write(cwd, 'styles/globals.css', FEEDBACK_CSS)
  const res = await importStyle(cwd, { id: 'prefer', stack: 'shadcn', set_current: false })
  assert.equal(res.isError, undefined, res.content)
  assert.equal(importedBrand(cwd, 'prefer'), '#136ace', '应读取 components.json 指定的那份')
})

await test('候选跳过：前面缺失/越界/非普通文件时不阻断后面的安全候选', async () => {
  const { base, cwd, outside } = leakWorkspace()
  try {
    write(cwd, 'package.json', JSON.stringify({ dependencies: { tailwindcss: '^3', 'class-variance-authority': '^0.7' } }))
    write(cwd, 'components.json', JSON.stringify({ tailwind: { css: '../outside/private-theme.css' } }))
    // 默认候选第一位被目录占住（非普通文件），最后一份是正常主题。
    mkdirSync(join(cwd, 'app', 'globals.css'), { recursive: true })
    write(cwd, 'styles/globals.css', FEEDBACK_CSS)
    if (CAN_SYMLINK) {
      mkdirSync(join(cwd, 'src'), { recursive: true })
      symlinkSync(join(outside, 'private-theme.css'), join(cwd, 'src', 'index.css'), 'file')
    }

    const res = await importStyle(cwd, { id: 'fallback', stack: 'shadcn', dry_run: true })
    assert.equal(res.isError, undefined, res.content)
    assert.match(res.content, /#136ace/i)
    assert.equal(String(res.content).toLowerCase().includes(SECRET.slice(1)), false, '外部主题不得进入结果')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

await test('全部候选缺失：明确失败，不创建主题也不改动已有主题', async () => {
  const cwd = shadcnWorkspace()
  write(cwd, '.tianshu-canvas/library/existing/tokens.json', '{"keep":true}')
  const res = await importStyle(cwd, { id: 'existing', stack: 'shadcn', set_current: false })
  assert.equal(res.isError, true)
  assert.match(res.content, /没有找到可导入的主题/)
  assert.equal(readFileSync(join(cwd, '.tianshu-canvas/library/existing/tokens.json'), 'utf8'), '{"keep":true}')
  assert.deepEqual(readdirSync(join(cwd, '.tianshu-canvas/library')), ['existing'])
})

await test('重复导入：同一输入产物字节一致；默认不覆盖已有用户主题', async () => {
  const cwd = shadcnWorkspace()
  write(cwd, 'app/globals.css', FEEDBACK_CSS)
  const first = await importStyle(cwd, { id: 'repeat', stack: 'shadcn', set_current: false })
  assert.equal(first.isError, undefined, first.content)
  const bytes = readFileSync(join(cwd, '.tianshu-canvas/library/repeat/tokens.json'), 'utf8')

  const noOverwrite = await importStyle(cwd, { id: 'repeat', stack: 'shadcn', set_current: false })
  assert.equal(noOverwrite.isError, true, '未传 overwrite 时不得替换已有主题')
  assert.equal(readFileSync(join(cwd, '.tianshu-canvas/library/repeat/tokens.json'), 'utf8'), bytes)

  const again = await importStyle(cwd, { id: 'repeat', stack: 'shadcn', set_current: false, overwrite: true })
  assert.equal(again.isError, undefined, again.content)
  assert.equal(readFileSync(join(cwd, '.tianshu-canvas/library/repeat/tokens.json'), 'utf8'), bytes, '同一输入两次导入应一致')
})

await test('并发替换：读取期间候选被换成指向工作区外的链接，不泄露外部内容', { skip: skipIfNoSymlink }, async () => {
  const base = mkdtempSync(join(tmpdir(), 'tsc-race-'))
  const cwd = join(base, 'workspace')
  const outside = join(base, 'outside')
  mkdirSync(join(cwd, 'app'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  const safeCss = join(base, 'safe.css')
  const secretCss = join(outside, 'private-theme.css')
  writeFileSync(safeCss, FEEDBACK_CSS, 'utf8')
  writeFileSync(secretCss, SECRET_CSS, 'utf8')
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { tailwindcss: '^3', 'class-variance-authority': '^0.7' } }))
  writeFileSync(join(cwd, 'app', 'globals.css'), FEEDBACK_CSS, 'utf8')

  const { Worker } = await import('node:worker_threads')
  const worker = new Worker(
    `import { unlinkSync, symlinkSync, writeFileSync } from 'node:fs'
     import { parentPort } from 'node:worker_threads'
     const [, , link, safe, secret] = process.argv
     let stop = false
     parentPort.on('message', () => { stop = true })
     while (!stop) {
       try {
         try { unlinkSync(link) } catch {}
         symlinkSync(secret, link, 'file')
         try { unlinkSync(link) } catch {}
         writeFileSync(link, safe)
       } catch { /* Windows 上文件被占用时 unlink/建链会失败，下一轮重试 */ }
     }
    `,
    { eval: true, argv: ['-', join(cwd, 'app', 'globals.css'), readFileSync(safeCss, 'utf8'), secretCss] },
  )
  try {
    let leaks = 0
    let hits = 0
    let misses = 0
    for (let i = 0; i < 60; i++) {
      const res = await importStyle(cwd, { id: 'race', stack: 'shadcn', dry_run: true })
      const text = String(res.content)
      if (text.toLowerCase().includes(SECRET.slice(1))) leaks++
      else if (res.isError === undefined) hits++
      else misses++
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(leaks, 0, '并发替换期间读到了工作区外的内容')
    assert.ok(hits + misses === 60)
    assert.ok(hits > 0, '并发替换不应让正常读取全部失败（加固不得误伤）')
    console.log(`  ↳ 并发替换 60 次：命中工作区主题 ${hits}、按缺失跳过 ${misses}、泄露 0`)
  } finally {
    worker.postMessage('stop')
    await worker.terminate()
    rmSync(base, { recursive: true, force: true })
  }
})

console.log('OK 适配器导入：shadcn/AntD 的观测、推断、确定性、反例与工作区边界全部通过')
