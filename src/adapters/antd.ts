/**
 * Ant Design 适配器。
 *
 * 与 shadcn 的关键差别：AntD v5 是 **CSS-in-JS 运行时主题**（ConfigProvider），
 * 仓库里没有 theme.css 可读。因此导入分两种：
 *  - 找到 `<ConfigProvider theme={{ token: { colorPrimary, borderRadius, fontFamily } }}>`
 *    字面量 → 记为 observed；
 *  - 找不到 → 用 AntD v5 种子 token，并在返回里明确标注 **default**，不得声称已导入项目主题。
 *
 * 导出产物：`src/App.tsx`（ConfigProvider 包裹）+ `src/theme.ts` + 落地说明。
 * 布局用 AntD 的 Flex/Row/Col 与 style 对象，不输出 Tailwind 类。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CodeFile } from '../codegen.js'
import { classesOf, textOf, type HtmlNode } from '../htmlTree.js'
import { materializeTokens } from './import.js'
import type { Adapter, AdapterContext, AdapterId, Detection, ImportResult } from './types.js'

/** AntD v5 种子 token（官方默认值）。 */
const ANT_DEFAULT: Record<string, string | number> = {
  primary: '#1677ff',
  success: '#52c41a',
  warning: '#faad14',
  error: '#ff4d4f',
  info: '#1677ff',
  background: '#ffffff',
  foreground: 'rgba(0,0,0,0.88)',
  border: '#d9d9d9',
  radius: 6,
}

const SOURCE_EXT = ['.tsx', '.ts', '.jsx', '.js']

/** 在工作区里找 ConfigProvider theme 字面量。 */
function findConfigProvider(cwd: string): { file: string; text: string } | null {
  const candidates = ['src/App.tsx', 'src/App.jsx', 'src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'app/layout.tsx', 'src/app/layout.tsx', 'app/providers.tsx']
  for (const rel of candidates) {
    const abs = join(cwd, rel)
    if (!existsSync(abs)) continue
    const text = readFileSync(abs, 'utf8')
    if (text.includes('ConfigProvider') && text.includes('theme')) return { file: rel, text }
  }
  return null
}

function readLiteral(text: string): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  const tokenBlock = /token\s*:\s*\{([\s\S]*?)\}/.exec(text)
  if (!tokenBlock) return out
  const body = tokenBlock[1]!
  for (const m of body.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*(['"])([^'"]+)\2/g)) {
    out[m[1]!] = m[3]!
  }
  for (const m of body.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*(-?[\d.]+)\b/g)) {
    out[m[1]!] = Number(m[2])
  }
  return out
}

function readPackage(cwd: string): Record<string, any> | null {
  const file = join(cwd, 'package.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>
  } catch {
    return null
  }
}

function walkFiles(dir: string, depth: number, out: string[]): void {
  if (depth <= 0) return
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[]
  try {
    entries = require('node:fs').readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(abs, depth - 1, out)
    else if (entry.isFile() && SOURCE_EXT.some((ext) => entry.name.endsWith(ext)) && /(?:^|[\\/])(?:src|app|pages)[\\/]/.test(abs)) out.push(abs)
  }
}

export const antdAdapter: Adapter = {
  id: 'antd' as AdapterId,

  detect(cwd: string): Detection | null {
    const pkg = readPackage(cwd)
    if (!pkg) return null
    const hasAntd = Boolean(pkg.dependencies?.antd ?? pkg.devDependencies?.antd)
    if (!hasAntd) return null
    const evidence = ['package.json 依赖 antd']
    const provider = findConfigProvider(cwd)
    if (provider) evidence.push(`ConfigProvider 主题在 ${provider.file}`)
    return { id: 'antd', evidence }
  },

  importTokens(cwd: string, sourcePath?: string): ImportResult {
    let source: string | null = null
    let literal: Record<string, string | number> = {}
    if (sourcePath) {
      const abs = sourcePath.startsWith(cwd) ? sourcePath : join(cwd, sourcePath)
      if (!existsSync(abs)) throw new Error(`找不到主题文件：${sourcePath}`)
      const text = readFileSync(abs, 'utf8')
      literal = readLiteral(text)
      source = sourcePath
    } else {
      const provider = findConfigProvider(cwd)
      if (provider) {
        literal = readLiteral(provider.text)
        source = provider.file
      }
      if (Object.keys(literal).length === 0) {
        const files: string[] = []
        walkFiles(cwd, 3, files)
        for (const file of files) {
          const text = readFileSync(file, 'utf8')
          if (!text.includes('ConfigProvider')) continue
          const found = readLiteral(text)
          if (Object.keys(found).length > 0) {
            literal = found
            source = file.slice(cwd.length + 1).replace(/\\/g, '/')
            break
          }
        }
      }
    }

    const observed = source !== null && Object.keys(literal).length > 0
    /** AntD token 名 → 值；同时接受简化名（primary）与官方名（colorPrimary）。 */
    const value = (key: string): string | number => {
      const aliases: Record<string, string[]> = {
        primary: ['colorPrimary', 'primary'],
        success: ['colorSuccess', 'success'],
        warning: ['colorWarning', 'warning'],
        error: ['colorError', 'error'],
        info: ['colorInfo', 'info'],
        background: ['colorBgBase', 'background'],
        foreground: ['colorTextBase', 'foreground'],
        border: ['colorBorder', 'border'],
        radius: ['borderRadius', 'radius'],
      }
      for (const name of aliases[key] ?? [key]) {
        const v = literal[name]
        if (v !== undefined) return v
      }
      return ANT_DEFAULT[key]!
    }

    const colors: Record<string, string> = {
      background: String(value('background')),
      foreground: String(value('foreground')),
      primary: String(value('primary')),
      'primary-foreground': '#ffffff',
      success: String(value('success')),
      warning: String(value('warning')),
      destructive: String(value('error')),
      'destructive-foreground': '#ffffff',
      border: String(value('border')),
      muted: '#f5f5f5',
      'muted-foreground': 'rgba(0,0,0,0.45)',
      ring: String(value('primary')),
    }

    const result = materializeTokens(
      { colors, radii: { DEFAULT: Number(value('radius')) } },
      {
        templateId: 'minimalist',
        builtinDir: this.builtinDir!,
        name: '项目主题（Ant Design）',
        tagline: observed ? '从 ConfigProvider 主题导入' : 'AntD v5 默认种子 token',
      },
    )

    const warnings = [...result.warnings]
    const observedList = observed ? result.observed.map((p) => `config:${p}`) : []
    const inferredList = observed ? result.inferred : [...result.inferred, ...result.observed]
    if (!observed) {
      warnings.unshift(
        '没有在仓库里找到 ConfigProvider 的 theme.token 字面量：本次使用 AntD v5 **默认种子 token**（不是项目实际主题）。' +
          '如需真实主题，请用 source_path 指向含 ConfigProvider 的文件。',
      )
    } else {
      warnings.unshift(`主题来源：${source}。只读取了字面量，未执行仓库代码。`)
    }

    return {
      tokens: result.tokens,
      iconStyle: { strokeWidth: 1.5 },
      name: '项目主题（Ant Design）',
      tagline: observed ? '从 ConfigProvider 主题导入' : 'AntD v5 默认种子 token',
      observed: observedList,
      inferred: inferredList,
      warnings,
    }
  },

  mapHtml(nodes: HtmlNode[], ctx: AdapterContext): CodeFile[] {
    const used = new Set<string>()
    const body = renderNodes(nodes, ctx, used)
    const antComponents = [...used].filter((n) => !['Flex', 'Row', 'Col'].includes(n)).sort()
    const antImport = antComponents.length ? `import { ${antComponents.join(', ')} } from 'antd'` : ''
    const page = `// 由 Tianshu-Canvas 生成（风格：${ctx.styleName}）。\n'use client'\n\nimport React from 'react'\n${antImport}\nimport { theme } from './theme'\n\nexport default function App() {\n  return (\n    <ConfigProvider theme={theme}>\n${indent(body, 6)}\n    </ConfigProvider>\n  )\n}\n`.replace('import { theme } from', 'import { theme } from')

    // ConfigProvider 必须在 components 里导入。
    const pageWithProvider = page.replace(/import \{ ([^}]*) \} from 'antd'/, (_m, list: string) =>
      `import { ConfigProvider, ${list.trim().startsWith('ConfigProvider') ? list.trim().slice('ConfigProvider,'.length).trim() : list.trim()} } from 'antd'`,
    )
    const finalPage = used.size === 0 || !pageWithProvider.includes('from \'antd\'')
      ? page.replace("import { theme } from './theme'", "import { ConfigProvider } from 'antd'\nimport { theme } from './theme'")
      : pageWithProvider.replace("import { theme } from './theme'", "import { theme } from './theme'")

    return [
      { name: 'src/App.tsx', content: finalPage, language: 'tsx' },
      { name: 'src/theme.ts', content: renderTheme(ctx), language: 'ts' },
      { name: 'README.md', content: renderReadme(ctx), language: 'markdown' },
    ]
  },
}

// 适配器实例上的构建目录由注册表注入（见 types.ts 的 Adapter.builtinDir）。

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

function styleOf(node: HtmlNode): Record<string, string | number> {
  const style: Record<string, string | number> = {}
  for (const c of classesOf(node)) {
    if (c === 'ts-row') style.display = 'flex'
    else if (c === 'ts-grid') style.display = 'grid'
    else if (c === 'ts-stack') style.flexDirection = 'column'
    else if (c === 'ts-muted') style.color = 'var(--ts-color-text-muted)'
  }
  const inline = node.attrs.find((a) => a.name === 'style')?.value
  if (inline) {
    for (const decl of inline.split(';')) {
      const [k, v] = decl.split(':')
      if (k && v) style[k.trim()] = v.trim()
    }
  }
  return style
}

function renderAttrs(node: HtmlNode, extraStyle?: Record<string, string | number>): string {
  const out: string[] = []
  const style = { ...styleOf(node), ...(extraStyle ?? {}) }
  if (Object.keys(style).length) {
    out.push(
      `style={{ ${Object.entries(style)
        .map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${typeof v === 'number' ? v : `'${String(v).replace(/'/g, "\\'")}'`}`)
        .join(', ')} }}`,
    )
  }
  for (const attr of node.attrs) {
    if (['class', 'style'].includes(attr.name)) continue
    if (attr.name.startsWith('data-ts') || attr.name.startsWith('on')) continue
    if (['id', 'href', 'src', 'alt', 'type', 'placeholder', 'value', 'name', 'role', 'title', 'aria-label', 'disabled', 'checked', 'readonly', 'required', 'target', 'rel'].includes(attr.name)) {
      if (attr.value === '' && ['disabled', 'checked', 'readonly', 'required'].includes(attr.name)) out.push(attr.name)
      else out.push(`${attr.name}="${attr.value}"`)
    }
  }
  return out.length ? ' ' + out.join(' ') : ''
}

function roleOf(node: HtmlNode): string | null {
  const classes = classesOf(node)
  // 最具体的变体优先（ts-btn--primary 先于 ts-btn）。
  for (const c of classes) if (c.startsWith('ts-btn--')) return c
  for (const c of classes) {
    if (c === 'ts-btn') return c
    if (['ts-card', 'ts-badge', 'ts-tabs', 'ts-tab', 'ts-modal', 'ts-select', 'ts-input', 'ts-table', 'ts-app', 'ts-sidebar', 'ts-main'].includes(c)) return c
  }
  return null
}

function renderNodes(nodes: HtmlNode[], ctx: AdapterContext, used: Set<string>): string {
  return pageElements(nodes).map((n) => renderNode(n, ctx, used)).join('\n')
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

function renderChildren(node: HtmlNode, ctx: AdapterContext, used: Set<string>): string {
  const children = node.children.filter((c) => c.type === 'element' || (c.type === 'text' && c.text.trim()))
  return children.map((c) => (c.type === 'text' ? escapeText(c.text.trim()) : renderNode(c, ctx, used))).join('\n')
}

function renderNode(node: HtmlNode, ctx: AdapterContext, used: Set<string>): string {
  const role = roleOf(node)
  const child = renderChildren(node, ctx, used)
  const inner = child ? `\n${indent(child, 2)}\n` : ''

  if (node.tag === 'table' || role === 'ts-table') return renderTable(node, ctx, used)

  if (role?.startsWith('ts-btn')) {
    used.add('Button')
    const type = role === 'ts-btn--primary' ? ' type="primary"' : role === 'ts-btn--ghost' ? ' type="text"' : role === 'ts-btn--danger' ? ' danger' : ''
    return `<Button${type}${renderAttrs(node)}>${child ? inner : textOf(node)}</Button>`
  }

  if (node.tag === 'button') {
    used.add('Button')
    return `<Button${renderAttrs(node)}>${child ? inner : escapeText(textOf(node))}</Button>`
  }

  if (node.tag === 'input' && (node.attrs.find((a) => a.name === 'type')?.value ?? 'text') !== 'hidden') {
    used.add('Input')
    return `<Input${renderAttrs(node)} />`
  }

  if (node.tag === 'select' || role === 'ts-select') {
    used.add('Select')
    const options = node.children
      .filter((c): c is HtmlNode => c.type === 'element' && c.tag === 'option')
      .map((o) => {
        const value = o.attrs.find((a) => a.name === 'value')?.value ?? textOf(o)
        return `{ value: '${value.replace(/'/g, "\\'")}', label: '${textOf(o).replace(/'/g, "\\'")}' }`
      })
    return `<Select${renderAttrs(node)} options={[${options.join(', ')}]} style={{ minWidth: 160 }} />`
  }

  if (role === 'ts-card') {
    used.add('Card')
    return `<Card${renderAttrs(node)}>${child ? inner : ''}</Card>`
  }

  if (role === 'ts-badge') {
    used.add('Tag')
    return `<Tag${renderAttrs(node)}>${child ? inner : escapeText(textOf(node))}</Tag>`
  }

  if (role === 'ts-tabs') {
    used.add('Tabs')
    const tabs = node.children.filter((c): c is HtmlNode => c.type === 'element' && classesOf(c).includes('ts-tab'))
    const items = tabs
      .map((t, i) => `{ key: 'tab-${i}', label: '${textOf(t).replace(/'/g, "\\'")}', children: null }`)
      .join(', ')
    return `<Tabs items={[${items}]} />`
  }

  if (role === 'ts-modal') {
    used.add('Modal')
    return `<Modal open title="${textOf(node).slice(0, 40)}">${child ? inner : ''}</Modal>`
  }

  if (role === 'ts-app') return `<div${renderAttrs(node, { minHeight: '100vh' })}>${child ? inner : ''}</div>`
  if (role === 'ts-sidebar') return `<aside${renderAttrs(node, { width: 240 })}>${child ? inner : ''}</aside>`
  if (role === 'ts-main') return `<main${renderAttrs(node, { flex: 1, padding: 24 })}>${child ? inner : ''}</main>`

  if (VOID_HTML.has(node.tag)) return `<${node.tag}${renderAttrs(node)} />`
  if (!child) return `<${node.tag}${renderAttrs(node)} />`
  return `<${node.tag}${renderAttrs(node)}>${inner}</${node.tag}>`
}

function renderTable(node: HtmlNode, ctx: AdapterContext, used: Set<string>): string {
  used.add('Table')
  const table = node.tag === 'table' ? node : node.children.find((c): c is HtmlNode => c.type === 'element' && c.tag === 'table') ?? node
  const rows: HtmlNode[] = []
  for (const section of table.children) {
    if (section.type !== 'element') continue
    if (section.tag === 'tr') rows.push(section)
    else for (const row of section.children) if (row.type === 'element' && row.tag === 'tr') rows.push(row)
  }
  const header = rows.find((r) => r.children.some((c) => c.type === 'element' && c.tag === 'th'))
  const headerCells = (header?.children ?? []).filter((c): c is HtmlNode => c.type === 'element' && c.tag === 'th')
  const bodyRows = rows.filter((r) => r !== header)
  const columns = headerCells.map((th, i) => {
    const key = `col${i}`
    return `{ title: '${textOf(th).replace(/'/g, "\\'")}', dataIndex: '${key}', key: '${key}' }`
  })
  const data = bodyRows.map((row) => {
    const cells = row.children.filter((c): c is HtmlNode => c.type === 'element' && c.tag === 'td')
    const entries = cells.map((td, i) => `col${i}: '${textOf(td).replace(/'/g, "\\'")}'`).join(', ')
    return `{ key: 'row-${bodyRows.indexOf(row)}', ${entries} }`
  })
  void ctx
  return `<Table columns={[${columns.join(', ')}]} dataSource={[${data.join(', ')}]} pagination={false}${renderAttrs(node)} />`
}

function semanticValue(ctx: AdapterContext, path: string): string {
  return ctx.semantic[`color.${path}`] ?? '#000000'
}

function renderTheme(ctx: AdapterContext): string {
  const m = (path: string): string => semanticValue(ctx, path)
  const radius = ctx.radius.md ?? 6
  const sans = ctx.vars['--ts-font-sans'] ?? 'system-ui'
  return `// 由 Tianshu-Canvas 生成（风格：${ctx.styleName}）。\n// 所有颜色集中在这里，页面代码不硬编码色值。\nimport type { ThemeConfig } from 'antd'\n\nexport const theme: ThemeConfig = {\n  token: {\n    colorPrimary: '${m('action.primary')}',\n    colorSuccess: '${m('status.success')}',\n    colorWarning: '${m('status.warning')}',\n    colorError: '${m('action.danger')}',\n    colorInfo: '${m('status.info')}',\n    colorBgBase: '${m('bg.surface')}',\n    colorTextBase: '${m('text.primary')}',\n    colorBorder: '${m('border.default')}',\n    borderRadius: ${radius},\n    fontFamily: ${JSON.stringify(sans)},\n  },\n}\n`
}

function renderReadme(ctx: AdapterContext): string {
  return `# 落地说明（由 Tianshu-Canvas 生成）

1. \`npm i antd\`（v5）。
2. \`src/theme.ts\` 已按设计 token 生成 ConfigProvider 主题；如需改动，只改这里。
3. \`src/App.tsx\` 用 \`<ConfigProvider theme={theme}>\` 包裹页面。
4. 页面里的颜色全部来自主题 token，未写死色值；自定义样式请用 \`theme.useToken()\`。

设计风格：${ctx.styleName}。
`
}
