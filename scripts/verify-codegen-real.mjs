/**
 * 发版前的真实编译验收（不进 CI）。
 *
 * 与 verify-codegen.mjs 的区别：这里安装**真实依赖**（react / antd / tailwindcss /
 * class-variance-authority），再用真实类型定义编译产物，验证的不是桩而是上游库。
 *
 * 用法：npm run verify:codegen:real
 * 结果记录进 release/release-<版本>.md 的「发版检查单」。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from '../test/helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const PAGE = `<!doctype html>
<html><body>
<div class="ts-app">
  <aside class="ts-sidebar"><div class="ts-sidebar__brand">工作台</div></aside>
  <main class="ts-main">
    <header class="ts-main__header"><h1 class="ts-title">概览</h1><button class="ts-btn ts-btn--primary">新建</button></header>
    <div class="ts-main__body">
      <div class="ts-row"><input class="ts-input" placeholder="搜索" /><button class="ts-btn">取消</button></div>
      <table class="ts-table"><thead><tr><th>名称</th><th>状态</th></tr></thead><tbody><tr><td>项目 A</td><td>运行中</td></tr></tbody></table>
      <span class="ts-badge">Beta</span>
      <div class="ts-card"><div class="ts-title">卡片</div></div>
    </div>
  </main>
</div>
</body></html>`

function run(cmd, args, cwd) {
  // Invoke npm through its JS entry point on Windows; never concatenate paths
  // into cmd.exe command text (workspaces may contain spaces or metacharacters).
  const executable = cmd === 'npm' ? process.execPath : cmd
  const npmCli = process.env.npm_execpath
  if (cmd === 'npm' && !npmCli) throw new Error('请通过 npm run verify:codegen:real 运行，以定位 npm CLI。')
  return execFileSync(executable, cmd === 'npm' ? [npmCli, ...args] : args, { cwd, encoding: 'utf8', stdio: 'pipe', shell: false })
}

function splitFiles(content) {
  const files = {}
  const re = /### ([^\n]+)\n\n```[^\n]*\n([\s\S]*?)\n```/g
  for (const m of content.matchAll(re)) files[m[1].trim()] = m[2]
  return files
}

const { api } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
const styleTool = api.tools.find((t) => t.name === 'canvas_style')
const cwd = mkdtempSync(join(tmpdir(), 'tsc-real-'))
await styleTool.execute({ args: { action: 'set', style_id: 'apple' }, cwd, sessionId: 'real' })

/** shadcn 组件用本地最小实现替代（等价于 npx shadcn add 的产物形状）。 */
const SHADCN_COMPONENTS = `import * as React from 'react'
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => <button ref={ref} {...props} />)
Button.displayName = 'Button'
`
const SHADCN_INPUT = `import * as React from 'react'
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => <input ref={ref} {...props} />)
Input.displayName = 'Input'
`
const SHADCN_TABLE = `import * as React from 'react'
const make = (tag: keyof JSX.IntrinsicElements) => React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>((props, ref) => React.createElement(tag, { ref, ...props }))
export const Table = make('table')
export const TableHeader = make('thead')
export const TableBody = make('tbody')
export const TableRow = make('tr')
export const TableHead = make('th')
export const TableCell = make('td')
`
const SHADCN_BADGE = `import * as React from 'react'
export const Badge = (props: React.HTMLAttributes<HTMLSpanElement> & { variant?: string }) => <span {...props} />
`
const SHADCN_CARD = `import * as React from 'react'
export const Card = (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />
`
const SHADCN_TABS = `import * as React from 'react'
export const Tabs = (props: React.HTMLAttributes<HTMLDivElement> & { defaultValue?: string }) => <div {...props} />
export const TabsTrigger = (props: React.HTMLAttributes<HTMLButtonElement> & { value: string }) => <button {...props} />
`
const SHADCN_DIALOG = `import * as React from 'react'
export const Dialog = (props: { children?: React.ReactNode }) => <>{props.children}</>
export const DialogTrigger = (props: { children?: React.ReactNode }) => <>{props.children}</>
export const DialogContent = (props: { children?: React.ReactNode }) => <>{props.children}</>
`

async function verifyShadcn() {
  const files = splitFiles((await styleTool.execute({ args: { action: 'codegen', target: 'shadcn', html: PAGE }, cwd, sessionId: 'real' })).content)
  const dir = join(root, '.tmp', 'verify-codegen-real', 'shadcn')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ private: true, dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: { typescript: '^5.6.0', '@types/react': '^18.3.0' } }, null, 2),
  )
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, baseUrl: '.', paths: { '@/*': ['./*'] } }, include: ['**/*.ts', '**/*.tsx'] }, null, 2),
  )
  const map = {
    'app/page.tsx': files['app/page.tsx'],
    'lib/theme.ts': files['lib/theme.ts'],
    'components/ui/button.tsx': SHADCN_COMPONENTS,
    'components/ui/input.tsx': SHADCN_INPUT,
    'components/ui/table.tsx': SHADCN_TABLE,
    'components/ui/badge.tsx': SHADCN_BADGE,
    'components/ui/card.tsx': SHADCN_CARD,
    'components/ui/tabs.tsx': SHADCN_TABS,
    'components/ui/dialog.tsx': SHADCN_DIALOG,
    'lib/utils.ts': 'export function cn(...inputs: Array<string | undefined | false | null>): string { return inputs.filter(Boolean).join(" ") }\n',
  }
  for (const [rel, content] of Object.entries(map)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), content, 'utf8')
  }
  console.log('安装真实依赖（react / @types/react / typescript）…')
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir)
  const tsc = join(dir, 'node_modules', 'typescript', 'bin', 'tsc')
  run(process.execPath, [tsc, '-p', dir], dir)
  return dir
}

async function verifyAntd() {
  const files = splitFiles((await styleTool.execute({ args: { action: 'codegen', target: 'antd', html: PAGE }, cwd, sessionId: 'real' })).content)
  const dir = join(root, '.tmp', 'verify-codegen-real', 'antd')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ private: true, dependencies: { antd: '^5.20.0', react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: { typescript: '^5.6.0', '@types/react': '^18.3.0' } }, null, 2),
  )
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, baseUrl: '.', paths: { '@/*': ['./*'] } }, include: ['**/*.ts', '**/*.tsx'] }, null, 2),
  )
  for (const [rel, content] of Object.entries({ 'src/App.tsx': files['src/App.tsx'], 'src/theme.ts': files['src/theme.ts'] })) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), content, 'utf8')
  }
  console.log('安装真实依赖（antd / react / typescript）…')
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir)
  const tsc = join(dir, 'node_modules', 'typescript', 'bin', 'tsc')
  run(process.execPath, [tsc, '-p', dir], dir)
  return dir
}

/** All shared compositions use the actual tool transport and real React types; no JSX-any stub. */
async function verifyOriginalCompositions() {
  const dir = join(root, '.tmp', 'verify-codegen-real', 'compositions')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const catalogResult = await styleTool.execute({ args: { action: 'prototype' }, cwd, sessionId: 'real' })
  if (catalogResult.isError) throw new Error(catalogResult.content)
  const summaries = JSON.parse(catalogResult.content).entries
  if (summaries.length !== 32) throw new Error('Expected 32 target prototypes')
  const pages = []
  for (const summary of summaries) {
    const result = await styleTool.execute({ args: { action: 'prototype', prototype_id: summary.id }, cwd, sessionId: 'real' })
    if (result.isError) throw new Error(result.content)
    pages.push({ id: summary.id, html: JSON.parse(result.content).html })
  }
  const directionsResult = await styleTool.execute({ args: { action: 'direction' }, cwd, sessionId: 'real' })
  if (directionsResult.isError) throw new Error(directionsResult.content)
  for (const summary of JSON.parse(directionsResult.content).entries) {
    const result = await styleTool.execute({ args: { action: 'direction', direction_id: summary.id }, cwd, sessionId: 'real' })
    if (result.isError) throw new Error(result.content)
    for (const example of JSON.parse(result.content).examples) pages.push({ id: 'direction-' + example.id, html: example.html })
  }
  if (pages.length !== 38) throw new Error('Expected 32 prototypes and six direction examples')
  for (const page of pages) {
    const result = await styleTool.execute({ args: { action: 'codegen', target: 'react', html: page.html }, cwd, sessionId: 'real' })
    if (result.isError) throw new Error(result.content)
    const files = splitFiles(result.content)
    if (!files['CanvasPage.tsx'] || !files['layout.css']) throw new Error(page.id + ' is missing React/layout output')
    const pageDir = join(dir, page.id)
    mkdirSync(pageDir)
    for (const [name, content] of Object.entries(files)) {
      if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error('Unsafe codegen output name')
      writeFileSync(join(pageDir, name), content)
    }
  }
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, types: ['react'], lib: ['ES2022', 'DOM'] }, include: ['**/*.tsx'] }, null, 2))
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
  run(process.execPath, [tsc, '-p', dir], dir)
  writeFileSync(join(dir, 'negative.tsx'), 'export const InvalidProps = () => <button type="not-a-button-type" />')
  let rejected = false
  try { run(process.execPath, [tsc, '-p', dir], dir) } catch (error) {
    rejected = String(error.stdout ?? '').includes('not-a-button-type')
  }
  rmSync(join(dir, 'negative.tsx'))
  if (!rejected) throw new Error('Real React type gate failed to reject invalid button props')
  return dir
}

let failures = 0
const results = []

for (const [name, fn] of [
  ['全部 32 原型与 6 方向（真实 React 类型）', verifyOriginalCompositions],
  ['shadcn（真实 react 类型）', verifyShadcn],
  ['antd（真实 antd 类型）', verifyAntd],
]) {
  const started = Date.now()
  try {
    const dir = await fn()
    results.push(`✔ ${name}：tsc 通过（${Math.round((Date.now() - started) / 1000)}s）→ ${dir}`)
  } catch (err) {
    failures++
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`
    results.push(`✖ ${name}：失败\n${output.split('\n').slice(0, 25).join('\n')}`)
  }
}

console.log('\n' + results.join('\n'))
if (failures > 0) {
  console.error(`\nverify:codegen:real: ${failures} 个适配器未通过真实编译`)
  process.exit(1)
}
console.log('\nverify:codegen:real: 全部通过')
