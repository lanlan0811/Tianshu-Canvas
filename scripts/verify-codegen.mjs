/**
 * 适配器产物的离线编译验收（CI 用）。
 *
 * 用 `test/fixtures/codegen/stubs.d.ts` 的声明桩做严格类型检查（no any）：
 *  1. 生成 shadcn / antd 两个 target 的产物；
 *  2. 写进 .tmp/verify-codegen/ 临时目录，各配一份 tsconfig（jsx: react-jsx、strict）；
 *  3. 跑 tsc —— 必须通过；
 *  4. 反向用例：故意注入一个非法 prop / 非法 token 类型，tsc 必须失败。
 *     （证明桩不是 any 假绿）
 *
 * 不联网、不装依赖、确定性。真实依赖的编译见 verify-codegen-real.mjs（发版前手动跑）。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from '../test/helpers/host.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const outRoot = join(root, '.tmp', 'verify-codegen')
const stubs = join(root, 'test', 'fixtures', 'codegen', 'stubs.d.ts')

const PAGE = `<!doctype html>
<html><body>
<div class="ts-app">
  <aside class="ts-sidebar"><div class="ts-sidebar__brand">工作台</div></aside>
  <main class="ts-main">
    <header class="ts-main__header"><h1 class="ts-title">概览</h1><button class="ts-btn ts-btn--primary">新建</button></header>
    <div class="ts-main__body">
      <div class="ts-row"><input class="ts-input" placeholder="搜索" /><button class="ts-btn">取消</button><button class="ts-btn ts-btn--danger">删除</button></div>
      <table class="ts-table"><thead><tr><th>名称</th><th>状态</th></tr></thead><tbody><tr><td>项目 A</td><td>运行中</td></tr></tbody></table>
      <span class="ts-badge">Beta</span>
      <div class="ts-card"><div class="ts-title">卡片</div></div>
    </div>
  </main>
</div>
</body></html>`

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' })
}

function tsc(dir) {
  try {
    sh(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', dir], root)
    return { ok: true, output: '' }
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

function writeWorkspace(dir, files, extraStubs = '') {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
          lib: ['ES2022', 'DOM'],
        },
        include: ['**/*.ts', '**/*.tsx', 'stubs.d.ts'],
      },
      null,
      2,
    ),
  )
  const stubsText = readFileSync(stubs, 'utf8') + extraStubs
  writeFileSync(join(dir, 'stubs.d.ts'), stubsText)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
}

/** 从 canvas_style 的 Markdown 返回里拆出文件名 → 内容。 */
function splitFiles(content) {
  const files = {}
  const re = /### ([^\n]+)\n\n```[^\n]*\n([\s\S]*?)\n```/g
  for (const m of content.matchAll(re)) files[m[1].trim()] = m[2]
  return files
}

const { api } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
const styleTool = api.tools.find((t) => t.name === 'canvas_style')
const cwd = mkdtempSync(join(tmpdir(), 'tsc-verify-codegen-'))
await styleTool.execute({ args: { action: 'set', style_id: 'apple' }, cwd, sessionId: 'verify-codegen' })

async function generate(target) {
  const res = await styleTool.execute({ args: { action: 'codegen', target, html: PAGE }, cwd, sessionId: 'verify-codegen' })
  if (res.isError) throw new Error(`${target} 生成失败：${res.content}`)
  return splitFiles(res.content)
}

mkdirSync(outRoot, { recursive: true })
let failures = 0
const report = []

function check(name, ok, detail = '') {
  report.push(`${ok ? '✔' : '✖'} ${name}${detail ? `\n${detail}` : ''}`)
  if (!ok) failures++
}

// ---- shadcn ----
const shadcnFiles = await generate('shadcn')
const shadcnDir = join(outRoot, 'shadcn')
writeWorkspace(shadcnDir, shadcnFiles)
const shadcnResult = tsc(shadcnDir)
check('shadcn：产物通过 tsc 严格检查', shadcnResult.ok, shadcnResult.output.slice(0, 1200))

const shadcnBadDir = join(outRoot, 'shadcn-negative')
writeWorkspace(shadcnBadDir, {
  ...shadcnFiles,
  'app/page.tsx': shadcnFiles['app/page.tsx'].replace(/<Button variant="default"/, '<Button variant="nope"'),
})
const shadcnBad = tsc(shadcnBadDir)
check('shadcn：非法 variant 必须编译失败（桩非 any）', !shadcnBad.ok, shadcnBad.output.split('\n').slice(0, 3).join('\n'))

const shadcnBadThemeDir = join(outRoot, 'shadcn-theme-negative')
writeWorkspace(shadcnBadThemeDir, {
  ...shadcnFiles,
  'lib/theme.ts': shadcnFiles['lib/theme.ts'] + '\nexport const broken: number = "not-a-number"\n',
})
const shadcnThemeBad = tsc(shadcnBadThemeDir)
check('shadcn：主题文件类型错误必须被捕获', !shadcnThemeBad.ok, shadcnThemeBad.output.split('\n').slice(0, 3).join('\n'))

// ---- antd ----
const antdFiles = await generate('antd')
const antdDir = join(outRoot, 'antd')
writeWorkspace(antdDir, antdFiles)
const antdResult = tsc(antdDir)
check('antd：产物通过 tsc 严格检查', antdResult.ok, antdResult.output.slice(0, 1200))

const antdBadDir = join(outRoot, 'antd-negative')
writeWorkspace(antdBadDir, {
  ...antdFiles,
  'src/App.tsx': antdFiles['src/App.tsx'].replace(/<Button type="primary"/, '<Button type="nope"'),
})
const antdBad = tsc(antdBadDir)
check('antd：非法 Button type 必须编译失败', !antdBad.ok, antdBad.output.split('\n').slice(0, 3).join('\n'))

const antdBadThemeDir = join(outRoot, 'antd-theme-negative')
writeWorkspace(antdBadThemeDir, {
  ...antdFiles,
  'src/theme.ts': antdFiles['src/theme.ts'].replace(/borderRadius: (\d+)/, 'borderRadius: "large"'),
})
const antdThemeBad = tsc(antdBadThemeDir)
check('antd：borderRadius 类型错误必须被捕获', !antdThemeBad.ok, antdThemeBad.output.split('\n').slice(0, 3).join('\n'))

console.log(report.join('\n'))
if (failures > 0) {
  console.error(`\nverify-codegen: ${failures} 项失败`)
  process.exit(1)
}
console.log('\nverify-codegen: 全部通过（正向编译 2 项、反向拒绝 4 项）')
