/**
 * 设计 → 生产代码（确定性转换，零新增依赖）。
 *
 * 三个 Web 目标：React + TSX、CSS 变量 + 无框架 HTML、Tailwind。
 * 多端（iOS/Android/小程序）见 codegen/platforms.ts：插件只出**主题/Token 文件 + 设计规格**，
 * 页面代码由 AI 按规格编写（HTML→原生非确定性、必然有损）。
 *
 * HTML→JSX 用手写标签层解析（不引入 DOM 库）：覆盖常见 HTML 子集即可，
 * 依赖复杂 DOM 的产物应提示人工校对。局限见 htmlToJsx 注释。
 */

export interface CodeFile {
  /** 相对产物根的文件名。 */
  name: string
  content: string
  language: string
}

// ---------------------------------------------------------------------------
// HTML → JSX
// ---------------------------------------------------------------------------

/** 需要改名的 HTML 属性 → JSX。 */
const ATTR_MAP: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  minlength: 'minLength',
  autofocus: 'autoFocus',
  autocomplete: 'autoComplete',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
  contenteditable: 'contentEditable',
  crossorigin: 'crossOrigin',
  datetime: 'dateTime',
  enctype: 'encType',
  formaction: 'formAction',
  frameborder: 'frameBorder',
  srcset: 'srcSet',
  usemap: 'useMap',
  novalidate: 'noValidate',
  spellcheck: 'spellCheck',
}

/** 值恒为真的布尔属性（JSX 可简写）。 */
const BOOLEAN_ATTRS = new Set([
  'disabled', 'checked', 'readonly', 'required', 'multiple', 'selected', 'autofocus', 'hidden', 'open', 'default', 'async', 'defer',
])

/** 自闭合的空元素。 */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

const SVG_ATTRS: Record<string, string> = {
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'fill-rule': 'fillRule',
  'clip-rule': 'clipRule',
  'clip-path': 'clipPath',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'text-anchor': 'textAnchor',
  'font-size': 'fontSize',
  'font-family': 'fontFamily',
  'font-weight': 'fontWeight',
  'xlink:href': 'xlinkHref',
  'xml:space': 'xmlSpace',
  'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity',
  'preserveaspectratio': 'preserveAspectRatio',
}

function camelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** `style="a: b; c: d"` → `{{ a: 'b', c: 'd' }}`（属性名驼峰、值加引号）。 */
function styleToObject(value: string): string {
  const entries = value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf(':')
      if (idx < 0) return null
      const prop = camelCase(part.slice(0, idx).trim())
      const val = part.slice(idx + 1).trim().replace(/'/g, "\\'")
      return `${prop}: '${val}'`
    })
    .filter((e): e is string => e !== null)
  return `{{ ${entries.join(', ')} }}`
}

function attrsToJsx(rawAttrs: string): string {
  const parts: string[] = []
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  for (const match of rawAttrs.matchAll(attrRe)) {
    const rawName = match[1]!
    const value = match[2] ?? match[3] ?? match[4]
    const lower = rawName.toLowerCase()
    if (lower.startsWith('on') && value !== undefined) continue // 内联事件处理器不迁移
    const name = ATTR_MAP[lower] ?? SVG_ATTRS[lower] ?? (rawName.includes('-') || rawName.includes(':') ? rawName : camelCase(rawName))
    if (value === undefined) {
      if (BOOLEAN_ATTRS.has(lower)) parts.push(name)
      else parts.push(`${name}={true}`)
      continue
    }
    if (lower === 'style') {
      parts.push(`style=${styleToObject(value)}`)
      continue
    }
    if (lower === 'class') {
      parts.push(`${name}="${value}"`)
      continue
    }
    // 含表达式字符的值用 {} 包裹；否则保持字符串（用双引号，内部双引号转义）。
    if (/[{}]/.test(value)) parts.push(`${name}={${value}}`)
    else parts.push(`${name}="${value.replace(/"/g, '&quot;')}"`)
  }
  return parts.length ? ' ' + parts.join(' ') : ''
}

/**
 * HTML → JSX。
 * 覆盖：属性改名/驼峰、style 字符串→对象、void 元素自闭合、布尔属性、SVG 属性驼峰、
 * 文本里的 `{`/`}` 转义。
 * 局限：不处理内联 `<script>`（React 需 dangerouslySetInnerHTML）、不解析 JSX 表达式、
 * 复杂嵌套/畸形 HTML 依赖人工校对；`<style>` 会被保留为注释提示。
 */
export function htmlToJsx(html: string): string {
  // 去掉 doctype 与 html/head/body 外壳，只保留 body 内容。
  let body = html
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  if (bodyMatch) body = bodyMatch[1]!
  else body = html.replace(/<!doctype[^>]*>/gi, '').replace(/<\/?(?:html|head)\b[^>]*>/gi, '')

  let out = ''
  let i = 0
  const tokens = /<!--[\s\S]*?-->|<\/([a-zA-Z][-a-zA-Z0-9]*)\s*>|<([a-zA-Z][-a-zA-Z0-9]*)((?:\s+[^>]*?)?)\/?>/g
  let match: RegExpExecArray | null
  while ((match = tokens.exec(body)) !== null) {
    // 标签之前的文本：转义花括号（JSX 里是表达式边界）。
    const text = body.slice(i, match.index)
    if (text) out += text.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
    i = match.index + match[0].length

    if (match[0].startsWith('<!--')) {
      out += `{/* ${match[0].slice(4, -3).trim()} */}`
      continue
    }
    if (match[1]) {
      out += `</${match[1]}>`
      continue
    }
    const tag = match[2]!
    const attrs = match[3] ?? ''
    const lower = tag.toLowerCase()
    const selfClosed = /\/>$/.test(match[0]) || VOID_TAGS.has(lower)
    out += `<${tag}${attrsToJsx(attrs)}${selfClosed ? ' />' : '>'}`
  }
  const rest = body.slice(i)
  if (rest) out += rest.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')

  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/** 生成 React 组件文件（含前导注释与 components.css 依赖说明）。 */
export function toReactComponent(pageHtml: string, componentName = 'CanvasPage'): CodeFile[] {
  const jsx = htmlToJsx(pageHtml)
  const component = `/**
 * 由天枢画布生成。样式依赖同目录的 components.css 与 tokens.css（--ts-* 变量）。
 * 注意：原型的 <style> / 内联样式无法 1:1 映射到 JSX，必要处请人工校对。
 */
import './tokens.css'
import './components.css'

export default function ${componentName}() {
  return (
    ${jsx}
  )
}
`
  return [{ name: `${componentName}.tsx`, content: component, language: 'tsx' }]
}

// ---------------------------------------------------------------------------
// CSS 变量 + 无框架 HTML
// ---------------------------------------------------------------------------

export interface StyleBundle {
  /** 由 tokens 生成的 :root/.dark 变量块。 */
  tokensCss: string
  /** 共享组件 CSS（ts-* 类）。 */
  componentsCss: string
}

/** 生成 tokens.css（直接复用构建期的确定性生成器产物）。 */
export function tokensCssFrom(tokensCss: string): string {
  return tokensCss
}

/** 无框架 HTML：把页面包装成可独立打开的 index.html + tokens.css + components.css。 */
export function toFrameworklessHtml(pageHtml: string, bundle: StyleBundle): CodeFile[] {
  const linked = pageHtml.replace(
    /<\/head\s*>/i,
    `  <link rel="stylesheet" href="./tokens.css">\n  <link rel="stylesheet" href="./components.css">\n</head>`,
  )
  const html = /<\/head\s*>/i.test(pageHtml)
    ? linked
    : `<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8">\n  <link rel="stylesheet" href="./tokens.css">\n  <link rel="stylesheet" href="./components.css">\n</head>\n<body>\n${pageHtml}\n</body>\n</html>\n`
  return [
    { name: 'index.html', content: html, language: 'html' },
    { name: 'tokens.css', content: bundle.tokensCss, language: 'css' },
    { name: 'components.css', content: bundle.componentsCss, language: 'css' },
  ]
}

// ---------------------------------------------------------------------------
// Tailwind
// ---------------------------------------------------------------------------

export interface TailwindInput {
  /** 语义色 → hex（或原色引用）。 */
  colors: Record<string, string>
  fontFamilies: Record<string, string>
  fontSizes: Record<string, string | number>
  spacing: number[]
  radius: number[]
  shadows: Record<string, string>
}

/** 生成 tailwind.config.js 的 theme.extend（确定性、键序固定）。 */
export function toTailwindConfig(input: TailwindInput): string {
  const colors = Object.entries(input.colors)
    .map(([k, v]) => `        '${k}': '${v}',`)
    .join('\n')
  const families = Object.entries(input.fontFamilies)
    .map(([k, v]) => `        ${k}: [${v.split(',').map((f) => `'${f.trim().replace(/^['"]|['"]$/g, '')}'`).join(', ')}],`)
    .join('\n')
  const fontSizes = Object.entries(input.fontSizes)
    .map(([k, v]) => `        '${k}': '${v}px',`)
    .join('\n')
  const spacing = input.spacing.map((v) => `        '${v}': '${v}px',`).join('\n')
  const radius = input.radius
    .filter((v) => v < 9999)
    .map((v) => `        'ts-${v}': '${v}px',`)
    .join('\n')
  const shadows = Object.entries(input.shadows)
    .map(([k, v]) => `        '${k}': '${v}',`)
    .join('\n')

  return `/** 由天枢画布生成：Tailwind 主题映射（值来自当前设计系统 tokens）。 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
${colors}
      },
      fontFamily: {
${families}
      },
      fontSize: {
${fontSizes}
      },
      spacing: {
${spacing}
      },
      borderRadius: {
${radius}
      },
      boxShadow: {
${shadows}
      },
    },
  },
  plugins: [],
}
`
}

/** 由 --ts-* 变量引用拼出任意值（无对应工具类时的确定性回退）。 */
export function tsVarArbitrary(prop: string, varName: string): string {
  const map: Record<string, string> = {
    padding: 'p',
    margin: 'm',
    gap: 'gap',
    borderRadius: 'rounded',
    backgroundColor: 'bg',
    color: 'text',
    borderColor: 'border',
  }
  const prefix = map[prop] ?? prop
  return `${prefix}-[var(${varName})]`
}
