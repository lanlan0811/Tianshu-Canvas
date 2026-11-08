/**
 * shadcn/Tailwind 适配器。
 *
 * 导入：读 `components.json` + `globals.css`（或 tailwind.config）里的主题变量，
 * 统一归一化为 token 契约。shadcn 新版把颜色写成 `oklch()`，旧版写成
 * `hsl(var(--primary))` 的裸三元组，两种都要支持。
 *
 * 导出：按 design-systems 的 `ts-*` 组件契约选择 shadcn 组件（Button / Input /
 * Table / Card / Badge …），其余类名改写为 Tailwind utility；产物是
 * `app/page.tsx` + `lib/theme.ts` + `tailwind.theme.css` + 落地说明。
 */

import { join } from 'node:path'
import type { CodeFile } from '../codegen.js'
import { readConfined } from '../paths.js'
import { classesOf, parseHtml, textOf, walkElements, type HtmlNode } from '../htmlTree.js'
import { materializeTokens } from './import.js'
import { toHex } from './color.js'
import type { Adapter, AdapterContext, AdapterId, Detection, ImportResult } from './types.js'

const TS_RANK: Record<string, string> = {
  'ts-btn': 'button',
  'ts-btn--primary': 'button-primary',
  'ts-btn--secondary': 'button-secondary',
  'ts-btn--ghost': 'button-ghost',
  'ts-btn--danger': 'button-danger',
  'ts-btn--icon': 'button-icon',
  'ts-input': 'input',
  'ts-select': 'select',
  'ts-card': 'card',
  'ts-badge': 'badge',
  'ts-table': 'table',
  'ts-tabs': 'tabs',
  'ts-tab': 'tab',
  'ts-modal': 'modal',
  'ts-sidebar': 'sidebar',
  'ts-main': 'main',
  'ts-app': 'app',
}

/** `ts-*` → Tailwind utility；未命中的类被丢弃（不把内部类名带进产物）。 */
const TS_UTILITY: Record<string, string> = {
  'ts-container': 'mx-auto w-full max-w-screen-lg',
  'ts-main__header': 'flex items-center justify-between border-b px-6 py-4',
  'ts-main__body': 'flex-1 overflow-auto p-6',
  'ts-sidebar__brand': 'px-4 py-5 text-lg font-semibold',
  'ts-sidebar__nav': 'flex flex-col gap-1 px-2',
  'ts-sidebar__item': 'rounded-md px-3 py-2 text-sm hover:bg-muted',
  'ts-sidebar__item--active': 'bg-muted font-medium',
  'ts-stack': 'flex flex-col gap-4',
  'ts-row': 'flex items-center gap-3',
  'ts-grid': 'grid gap-4',
  'ts-muted': 'text-muted-foreground',
  'ts-title': 'text-lg font-semibold',
  'ts-subtitle': 'text-sm text-muted-foreground',
  'ts-divider': 'my-4 h-px w-full bg-border',
  'ts-icon': 'h-4 w-4 shrink-0',
}

function hasDep(pkg: Record<string, any>, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name])
}

/** 读工作区内的 JSON（`package.json` / `components.json` 等自动发现文件），越界或链接一律当不存在。 */
function readJsonInWorkspace(cwd: string, rel: string): Record<string, any> | null {
  const text = readConfined(cwd, join(cwd, rel))
  if (text === null) return null
  try {
    return JSON.parse(text) as Record<string, any>
  } catch {
    return null
  }
}

function readPackage(cwd: string): Record<string, any> | null {
  return readJsonInWorkspace(cwd, 'package.json')
}

/** 读 components.json 的 aliases / tailwind css 路径。 */
function readComponentsJson(cwd: string): Record<string, any> | null {
  return readJsonInWorkspace(cwd, 'components.json')
}

/** 解析出的样式文件：路径 + 已安全读取的内容（不再按裸路径二次读取）。 */
interface ResolvedCss {
  path: string
  text: string
}

/**
 * 解析样式文件。`components.json` 的 `tailwind.css` 是**工作区内容**，
 * 可能写成 `../outside/x.css`；候选文件也可能是符号链接。两者都收敛到工作区内。
 *
 * 只有「在工作区内、存在、是普通文件且可安全读取」的候选才算命中：
 * `confineToWorkspace` 对**尚不存在**的路径也返回合法路径（新建文件场景），
 * 若把它当作命中就会提前选中缺失的 `app/globals.css`，让后面的候选失去机会。
 * 因此这里以 `readConfined` 是否读到内容作为命中判据，并直接返回内容。
 */
function resolveCssFile(cwd: string, components: Record<string, any> | null): ResolvedCss | null {
  const candidates: string[] = []
  const css = components?.tailwind?.css
  if (typeof css === 'string') candidates.push(css.replace(/^~\//, ''))
  candidates.push(
    'app/globals.css',
    'src/app/globals.css',
    'styles/globals.css',
    'src/styles/globals.css',
    'src/index.css',
    'index.css',
  )
  const seen = new Set<string>()
  for (const c of candidates) {
    const abs = join(cwd, c)
    if (seen.has(abs)) continue
    seen.add(abs)
    const text = readConfined(cwd, abs)
    if (text !== null) return { path: abs, text }
  }
  return null
}

/** 从 CSS 里提取 :root / .dark 的颜色声明（shadcn 约定）。 */
function readCssVars(css: string, selector: 'root' | 'dark'): Record<string, string> {
  const out: Record<string, string> = {}
  const blockRe = selector === 'root' ? /:root\s*\{([\s\S]*?)\}/g : /\.dark\s*\{([\s\S]*?)\}/g
  for (const block of css.matchAll(blockRe)) {
    for (const decl of block[1]!.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) {
      const name = decl[1]!
      const value = decl[2]!.trim()
      if (name.startsWith('--')) out[name] = value
    }
  }
  return out
}

/** shadcn 旧版把颜色存成裸三元组，配合 `hsl(var(--x))` 使用。 */
function normalizeVarValue(name: string, raw: string, css: string): string | null {
  const value = raw.trim()
  if (/^(?:#|rgb|hsl|oklch|oklab|color\()/i.test(value)) return value
  // 裸三元组：`222.2 84% 4.9%` 或 `240 10% 3.9%`
  if (/^-?[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(value)) {
    return `hsl(${value.replace(/\s+/g, ', ')})`
  }
  // `hsl(var(--x))` 形式：值本身就是三元组
  const varRef = new RegExp(`--${name.replace(/^--/, '')}\\s*:\\s*([^;]+);`).exec(css)
  if (varRef) return null
  return null
}

function collectTheme(cwd: string, components: Record<string, any> | null): { colors: Record<string, string>; radii: Record<string, number>; source: string } | null {
  const cssFile = resolveCssFile(cwd, components)
  const colors: Record<string, string> = {}
  const radii: Record<string, number> = {}
  let source = ''
  const cssText = cssFile ? cssFile.text : null
  if (cssFile) {
    const css = cssFile.text
    source = cssFile.path.slice(cwd.length + 1).replace(/\\/g, '/')
    for (const [name, raw] of Object.entries(readCssVars(css, 'root'))) {
      if (name === '--radius') {
        const m = /^([\d.]+)(rem|px)?$/.exec(raw.trim())
        if (m) {
          const n = Number(m[1])
          radii.DEFAULT = m[2] === 'px' ? n : n * 16
        }
        continue
      }
      const key = name.replace(/^--/, '')
      if (key.startsWith('ts-') || key.startsWith('font-')) continue
      const value = normalizeVarValue(name, raw, css)
      if (value) colors[key] = value
    }
  }

  // 兜底：tailwind.config 的 theme.extend.colors（只处理字面值，不执行 JS）。
  for (const file of ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs']) {
    const text = readConfined(cwd, join(cwd, file))
    if (text === null) continue
    if (!source) source = file
    for (const m of text.matchAll(/(['"]?)([a-zA-Z][a-zA-Z0-9-]*)\1\s*:\s*(['"])(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]*\)|hsl[a]?\([^)]*\)|oklch\([^)]*\))\3/g)) {
      const key = m[2]!
      const value = m[4]!
      if (!(key in colors)) colors[key] = value
    }
    for (const m of text.matchAll(/borderRadius\s*:\s*\{([\s\S]*?)\}/g)) {
      for (const kv of m[1]!.matchAll(/(['"]?)([a-zA-Z0-9]+)\1\s*:\s*['"]([\d.]+)(rem|px)['"]/g)) {
        const n = Number(kv[3])
        radii[kv[2]!] = kv[4] === 'px' ? n : n * 16
      }
    }
    break
  }

  // 再兜底：直接是 ts-* 变量（本插件自己的项目）。
  if (Object.keys(colors).length === 0 && cssText !== null) {
    for (const [name, raw] of Object.entries(readCssVars(cssText, 'root'))) {
      if (!name.startsWith('--ts-color-')) continue
      colors[name.replace(/^--ts-color-/, '')] = raw
    }
  }

  if (Object.keys(colors).length === 0) return null
  return { colors, radii, source }
}

export const shadcnAdapter: Adapter = {
  id: 'shadcn' as AdapterId,

  detect(cwd: string): Detection | null {
    const pkg = readPackage(cwd)
    const evidence: string[] = []
    if (pkg) {
      const deps = ['tailwindcss', 'class-variance-authority', 'tailwind-merge', 'clsx']
      for (const dep of deps) if (hasDep(pkg, dep)) evidence.push(`package.json 依赖 ${dep}`)
      if (hasDep(pkg, 'next')) evidence.push('package.json 依赖 next')
    }
    const components = readComponentsJson(cwd)
    if (components) evidence.push('存在 components.json')
    const cssFile = resolveCssFile(cwd, components)
    if (cssFile) evidence.push(`样式文件 ${cssFile.path.slice(cwd.length + 1).replace(/\\/g, '/')}`)
    if (evidence.length < 2) return null
    return { id: 'shadcn', evidence }
  },

  importTokens(cwd: string, sourcePath?: string): ImportResult {
    const components = readComponentsJson(cwd)
    const theme = sourcePath
      ? (() => {
          const abs = sourcePath.startsWith(cwd) ? sourcePath : join(cwd, sourcePath)
          // 工作区内的来源文件按边界校验，避免经链接读到工作区外；一次读取即校验，不存在则视为无主题。
          const css = readConfined(cwd, abs)
          if (css === null) return null
          const colors: Record<string, string> = {}
          const radii: Record<string, number> = {}
          for (const [name, raw] of Object.entries(readCssVars(css, 'root'))) {
            if (name === '--radius') {
              const m = /^([\d.]+)(rem|px)?$/.exec(raw.trim())
              if (m) radii.DEFAULT = m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16
              continue
            }
            const value = normalizeVarValue(name, raw, css)
            if (value) colors[name.replace(/^--/, '')] = value
          }
          return { colors, radii, source: sourcePath }
        })()
      : collectTheme(cwd, components)

    if (!theme) {
      throw new Error(
        '没有找到可导入的主题：未找到 components.json 指定的 CSS，也没有 app/globals.css 或 tailwind.config.*。' +
          '请用 source_path 指定样式文件。',
      )
    }

    const hasPrimary = Boolean(theme.colors.primary)
    if (!hasPrimary) {
      throw new Error(`主题缺少主色（primary）：${theme.source} 里没有 --primary 或 colors.primary。`)
    }

    // shadcn 旧版变量是裸三元组，需要判断是否真的解析出了颜色。
    const unresolved = Object.entries(theme.colors).filter(([, v]) => toHex(v) === null && !/^rgba?\(/i.test(v))
    const usable: Record<string, string> = {}
    for (const [k, v] of Object.entries(theme.colors)) {
      if (toHex(v) !== null || /^rgba?\(/i.test(v)) usable[k] = v
      else unresolved.push([k, v])
    }
    if (!usable.primary) {
      throw new Error('主题的 primary 无法解析为颜色（可能是 hsl(var(--primary)) 的间接引用，或缺少对应的三元组）。')
    }

    const result = materializeTokens(
      { colors: usable, radii: theme.radii },
      {
        templateId: 'minimalist',
        builtinDir: this.builtinDir!,
        name: '项目主题（shadcn）',
        tagline: '从现有 shadcn/Tailwind 主题导入',
      },
    )

    const warnings = [...result.warnings]
    for (const [k, v] of unresolved) warnings.push(`变量 --${k} 的值无法解析，已跳过：${v}`)

    return {
      tokens: result.tokens,
      iconStyle: { strokeWidth: 1.75 },
      name: '项目主题（shadcn）',
      tagline: '从现有 shadcn/Tailwind 主题导入',
      observed: result.observed,
      inferred: result.inferred,
      warnings,
    }
  },

  mapHtml(nodes: HtmlNode[], ctx: AdapterContext): CodeFile[] {
    const used = new Set<string>()
    const body = renderNodes(nodes, ctx, used)
    const imports = [...used]
      .sort()
      .map((name) => `import { ${name} } from '@/components/ui/${shadcnModule(name)}'`)
      .join('\n')

    const page = `// 由 Tianshu-Canvas 生成（风格：${ctx.styleName}）。\n// 建议先安装 shadcn 组件：npx shadcn@latest add button input table card badge tabs dialog dropdown-menu\n'use client'\n\nimport React from 'react'\n${imports}\n\nexport default function Page() {\n  return (\n${indent(body, 4)}\n  )\n}\n`

    const theme = renderTheme(ctx)
    const css = renderThemeCss(ctx)
    const readme = renderReadme(ctx)

    return [
      { name: 'app/page.tsx', content: page, language: 'tsx' },
      { name: 'lib/theme.ts', content: theme, language: 'ts' },
      { name: 'app/theme.css', content: css, language: 'css' },
      { name: 'README.md', content: readme, language: 'markdown' },
    ]
  },
}

// 适配器实例上的构建目录由注册表注入（见 types.ts 的 Adapter.builtinDir）。

function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

/** 组件名 → shadcn 模块（表格/标签页/弹窗的多部件从同一个模块导出）。 */
function shadcnModule(name: string): string {
  if (name.startsWith('Table')) return 'table'
  if (name.startsWith('Tabs')) return 'tabs'
  if (name.startsWith('Dialog')) return 'dialog'
  return kebab(name)
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n')
}

function escapeText(text: string): string {
  return text.replace(/[{}<>]/g, (ch) => `{${JSON.stringify(ch)}}`)
}

const VOID_HTML = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed', 'param'])

function renderAttrs(node: HtmlNode, extraClass?: string): string {
  const out: string[] = []
  const className = classesOf(node)
    .map((c) => TS_UTILITY[c])
    .filter(Boolean)
    .join(' ')
  const merged = [className, extraClass].filter(Boolean).join(' ')
  if (merged) out.push(`className="${merged}"`)
  for (const attr of node.attrs) {
    if (attr.name === 'class' || attr.name === 'style') continue
    if (attr.name.startsWith('data-ts') || attr.name.startsWith('on')) continue
    if (attr.name === 'data-icon') {
      out.push(`data-icon="${attr.value}"`)
      continue
    }
    if (attr.name === 'for') {
      out.push(`htmlFor="${attr.value}"`)
      continue
    }
    if (['id', 'href', 'src', 'alt', 'type', 'placeholder', 'value', 'name', 'role', 'title', 'aria-label', 'aria-describedby', 'colspan', 'rowspan', 'disabled', 'checked', 'readonly', 'required', 'target', 'rel'].includes(attr.name)) {
      if (attr.value === '' && ['disabled', 'checked', 'readonly', 'required'].includes(attr.name)) out.push(attr.name)
      else out.push(`${attr.name}="${attr.value}"`)
    }
  }
  return out.length ? ' ' + out.join(' ') : ''
}

function renderChildren(node: HtmlNode, ctx: AdapterContext, used: Set<string>): string {
  const children = node.children.filter((c) => c.type === 'element' || (c.type === 'text' && c.text.trim()))
  if (children.length === 0) return ''
  return children.map((c) => (c.type === 'text' ? escapeText(c.text.trim()) : renderNode(c, ctx, used))).join('\n')
}

function renderNodes(nodes: HtmlNode[], ctx: AdapterContext, used: Set<string>): string {
  const list = pageElements(nodes)
  return list.map((n) => renderNode(n, ctx, used)).join('\n')
}

/** 取页面真正要渲染的元素：跳过 head，深入 html > body。 */
function pageElements(nodes: HtmlNode[]): HtmlNode[] {
  const elements = nodes.filter((n): n is HtmlNode => n.type === 'element')
  for (const node of elements) {
    if (node.tag === 'body') return node.children.filter((c): c is HtmlNode => c.type === 'element')
    if (node.tag === 'html') return pageElements(node.children)
  }
  return elements.filter((n) => n.tag !== 'head' && n.tag !== 'meta' && n.tag !== 'title' && n.tag !== 'script' && n.tag !== 'style')
}

function pickRole(node: HtmlNode): string | null {
  const classes = classesOf(node)
  // 先找最具体的变体（ts-btn--primary 优先于 ts-btn）。
  for (const c of classes) {
    if (c.startsWith('ts-btn--') && TS_RANK[c]) return TS_RANK[c]!
  }
  for (const c of classes) {
    const role = TS_RANK[c]
    if (role) return role
  }
  return null
}

function renderNode(node: HtmlNode, ctx: AdapterContext, used: Set<string>): string {
  const role = pickRole(node)

  if (node.tag === 'table' || role === 'table') return renderTable(node, ctx, used)

  if (role?.startsWith('button')) {
    used.add('Button')
    const variant =
      role === 'button-primary' ? 'default' : role === 'button-secondary' ? 'secondary' : role === 'button-ghost' ? 'ghost' : role === 'button-danger' ? 'destructive' : undefined
    const size = role === 'button-icon' ? ' size="icon"' : ''
    const variantAttr = variant ? ` variant="${variant}"` : ''
    return `<Button${variantAttr}${size}${renderAttrs(node)}>\n${indent(renderChildren(node, ctx, used), 2)}\n</Button>`
  }

  if (node.tag === 'button') {
    used.add('Button')
    return `<Button${renderAttrs(node)}>\n${indent(renderChildren(node, ctx, used), 2)}\n</Button>`
  }

  if (node.tag === 'input' && (node.attrs.find((a) => a.name === 'type')?.value ?? 'text') !== 'hidden') {
    used.add('Input')
    return `<Input${renderAttrs(node)} />`
  }

  if (node.tag === 'select' || role === 'select') {
    used.add('Input')
    const options = node.children
      .filter((c): c is HtmlNode => c.type === 'element')
      .map((o) => `  <option value="${o.attrs.find((a) => a.name === 'value')?.value ?? textOf(o)}">${escapeText(textOf(o))}</option>`)
      .join('\n')
    return `<select${renderAttrs(node)}>\n${options ? options + '\n' : ''}</select>`
  }

  if (role === 'card') {
    used.add('Card')
    return `<Card${renderAttrs(node)}>\n${indent(renderChildren(node, ctx, used), 2)}\n</Card>`
  }

  if (role === 'badge') {
    used.add('Badge')
    return `<Badge${renderAttrs(node)}>\n${indent(renderChildren(node, ctx, used), 2)}\n</Badge>`
  }

  if (role === 'tabs') {
    used.add('Tabs')
    return `<Tabs defaultValue="tab-0">\n${indent(renderChildren(node, ctx, used), 2)}\n</Tabs>`
  }

  if (role === 'tab') {
    used.add('TabsTrigger')
    const text = textOf(node)
    return `<TabsTrigger value="tab-0">${escapeText(text)}</TabsTrigger>`
  }

  if (role === 'app') {
    return `<div${renderAttrs(node, 'min-h-screen bg-background text-foreground')}>\n${indent(renderChildren(node, ctx, used), 2)}\n</div>`
  }

  if (role === 'sidebar') {
    return `<aside${renderAttrs(node, 'w-60 shrink-0 border-r bg-card')}>\n${indent(renderChildren(node, ctx, used), 2)}\n</aside>`
  }

  if (role === 'main') {
    return `<main${renderAttrs(node, 'flex-1')}>\n${indent(renderChildren(node, ctx, used), 2)}\n</main>`
  }

  if (role === 'modal') {
    used.add('Dialog')
    used.add('DialogContent')
    used.add('DialogTrigger')
    return `<Dialog>\n${indent(renderChildren(node, ctx, used), 2)}\n</Dialog>`
  }

  // 普通标签：只保留白名单属性，类名走 utility 映射。
  const child = renderChildren(node, ctx, used)
  if (VOID_HTML.has(node.tag)) return `<${node.tag}${renderAttrs(node)} />`
  if (!child) return `<${node.tag}${renderAttrs(node)} />`
  return `<${node.tag}${renderAttrs(node)}>\n${indent(child, 2)}\n</${node.tag}>`
}

function renderTable(node: HtmlNode, ctx: AdapterContext, used: Set<string>): string {
  for (const name of ['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow']) used.add(name)
  const table = node.tag === 'table' ? node : node.children.find((c): c is HtmlNode => c.type === 'element' && c.tag === 'table') ?? node
  const headRows: HtmlNode[] = []
  const bodyRows: HtmlNode[] = []
  for (const section of table.children) {
    if (section.type !== 'element') continue
    const rows = section.tag === 'tr' ? [section] : section.children.filter((c): c is HtmlNode => c.type === 'element' && c.tag === 'tr')
    if (section.tag === 'thead' || section.tag === 'th') headRows.push(...rows)
    else bodyRows.push(...rows)
  }
  const cell = (row: HtmlNode, tag: 'th' | 'td'): string => {
    const c = row.tag === tag ? row : row.children.find((x): x is HtmlNode => x.type === 'element' && x.tag === tag)
    return c ? escapeText(textOf(c)) : ''
  }
  const head = headRows
    .map(
      (row) =>
        `<TableRow>\n${row.children
          .filter((c): c is HtmlNode => c.type === 'element' && c.tag === 'th')
          .map((th) => `  <TableHead>${escapeText(textOf(th))}</TableHead>`)
          .join('\n')}\n</TableRow>`,
    )
    .join('\n')
  const body = bodyRows
    .map(
      (row) =>
        `<TableRow>\n${row.children
          .filter((c): c is HtmlNode => c.type === 'element' && c.tag === 'td')
          .map((td) => `  <TableCell>${escapeText(textOf(td))}</TableCell>`)
          .join('\n')}\n</TableRow>`,
    )
    .join('\n')
  void cell
  return `<Table${renderAttrs(node)}>\n  <TableHeader>\n${indent(head, 4)}\n  </TableHeader>\n  <TableBody>\n${indent(body, 4)}\n  </TableBody>\n</Table>`
}

function semanticValue(ctx: AdapterContext, path: string, dark = false): string {
  const map = dark ? ctx.darkSemantic : ctx.semantic
  return map?.[`color.${path}`] ?? ctx.semantic[`color.${path}`] ?? '#000000'
}

function renderTheme(ctx: AdapterContext): string {
  const lines: string[] = []
  for (const path of Object.keys(ctx.semantic)) {
    const short = path.replace(/^color\./, '')
    lines.push(`  '${short.replace(/\./g, '-')}': '${semanticValue(ctx, short)}',`)
  }
  return `// 由 Tianshu-Canvas 生成：设计 token → shadcn CSS 变量。\n// 与 app/theme.css 保持一致；改这里请同时改 CSS。\nexport const themeVars = {\n${lines.join('\n')}\n} as const\n\nexport type ThemeVar = keyof typeof themeVars\n`
}

function renderThemeCss(ctx: AdapterContext): string {
  const m = (path: string, dark = false): string => semanticValue(ctx, path, dark)
  const root: string[] = []
  const dark: string[] = []
  root.push(`  --background: ${m('bg.canvas')};`, `  --foreground: ${m('text.primary')};`)
  root.push(`  --card: ${m('bg.surface')};`, `  --card-foreground: ${m('text.primary')};`)
  root.push(`  --popover: ${m('bg.raised')};`, `  --popover-foreground: ${m('text.primary')};`)
  root.push(`  --primary: ${m('action.primary')};`, `  --primary-foreground: ${m('action.primaryText')};`)
  root.push(`  --secondary: ${m('action.secondary')};`, `  --secondary-foreground: ${m('action.secondaryText')};`)
  root.push(`  --muted: ${m('bg.sunken')};`, `  --muted-foreground: ${m('text.muted')};`)
  root.push(`  --accent: ${m('action.ghostHover')};`, `  --accent-foreground: ${m('text.primary')};`)
  root.push(`  --destructive: ${m('action.danger')};`, `  --destructive-foreground: ${m('action.dangerText')};`)
  root.push(`  --border: ${m('border.default')};`, `  --input: ${m('border.default')};`, `  --ring: ${m('border.focus')};`)
  if (ctx.darkSemantic) {
    const d = (path: string): string => m(path, true)
    dark.push(`  --background: ${d('bg.canvas')};`, `  --foreground: ${d('text.primary')};`)
    dark.push(`  --card: ${d('bg.surface')};`, `  --card-foreground: ${d('text.primary')};`)
    dark.push(`  --primary: ${d('action.primary')};`, `  --primary-foreground: ${d('action.primaryText')};`)
    dark.push(`  --muted: ${d('bg.sunken')};`, `  --muted-foreground: ${d('text.muted')};`)
    dark.push(`  --border: ${d('border.default')};`, `  --ring: ${d('border.focus')};`)
  }
  const radius = ctx.radius.md ?? 8
  return `/* 由 Tianshu-Canvas 生成（风格：${ctx.styleName}）。 */\n@import 'tailwindcss';\n\n:root {\n${root.join('\n')}\n  --radius: ${radius}px;\n}\n${
    dark.length ? `\n.dark {\n${dark.join('\n')}\n}\n` : ''
  }\n@theme inline {\n  --color-background: var(--background);\n  --color-foreground: var(--foreground);\n  --color-card: var(--card);\n  --color-primary: var(--primary);\n  --color-primary-foreground: var(--primary-foreground);\n  --color-secondary: var(--secondary);\n  --color-muted: var(--muted);\n  --color-muted-foreground: var(--muted-foreground);\n  --color-accent: var(--accent);\n  --color-destructive: var(--destructive);\n  --color-border: var(--border);\n  --color-input: var(--input);\n  --color-ring: var(--ring);\n  --radius-md: calc(var(--radius));\n}\n`
}

function renderReadme(ctx: AdapterContext): string {
  return `# 落地说明（由 Tianshu-Canvas 生成）

1. 把 \`app/theme.css\` 合并进项目的 \`app/globals.css\`（或直接 \`@import './theme.css'\`）。
2. 安装本页用到的 shadcn 组件：\`npx shadcn@latest add button input table card badge tabs dialog\`。
3. \`app/page.tsx\` 依赖 \`@/components/ui/*\` 别名；若项目未配置 \`@/\`，请改导入路径。
4. \`lib/theme.ts\` 是同一套 token 的 JS 视图，供内联样式或图表使用。

设计风格：${ctx.styleName}。所有颜色来自主题变量，未硬编码。
`
}
