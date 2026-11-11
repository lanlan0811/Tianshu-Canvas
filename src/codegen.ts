/**
 * Deterministic Web export. HTML values always remain data, never JavaScript expressions.
 * Complex DOM behavior requires React state and event handlers supplied by the implementer.
 */
import { declarations } from './cssParse.js'
import { parseHtml, findElement, walkElements, type HtmlNode } from './htmlTree.js'

export interface CodeFile { name: string; content: string; language: string }
const ATTR_MAP: Record<string, string> = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', colspan: 'colSpan', rowspan: 'rowSpan',
  readonly: 'readOnly', maxlength: 'maxLength', minlength: 'minLength', autofocus: 'autoFocus',
  autocomplete: 'autoComplete', cellpadding: 'cellPadding', cellspacing: 'cellSpacing',
  contenteditable: 'contentEditable', crossorigin: 'crossOrigin', datetime: 'dateTime', enctype: 'encType',
  formaction: 'formAction', frameborder: 'frameBorder', srcset: 'srcSet', usemap: 'useMap',
  novalidate: 'noValidate', spellcheck: 'spellCheck', acceptcharset: 'acceptCharset', httpequiv: 'httpEquiv',
  inputmode: 'inputMode', formactiontarget: 'formActionTarget', formnovalidate: 'formNoValidate',
  allowfullscreen: 'allowFullScreen', playsinline: 'playsInline', controlslist: 'controlsList',
}
const BOOLEAN_ATTRS = new Set(['disabled','checked','readonly','required','multiple','selected','autofocus','hidden','open','default','async','defer','novalidate','formnovalidate','controls','loop','muted','autoplay','playsinline','allowfullscreen'])
const NUMERIC_ATTRS = new Set(['colspan','rowspan','maxlength','minlength','tabindex','size','rows','cols','start','span'])
const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'])
const SVG_ATTRS: Record<string, string> = {
  viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', 'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin', 'stroke-miterlimit': 'strokeMiterlimit',
  'stroke-opacity': 'strokeOpacity', 'fill-opacity': 'fillOpacity', 'fill-rule': 'fillRule', 'clip-rule': 'clipRule',
  'clip-path': 'clipPath', 'stroke-dasharray': 'strokeDasharray', 'stroke-dashoffset': 'strokeDashoffset',
  'text-anchor': 'textAnchor', 'font-size': 'fontSize', 'font-family': 'fontFamily', 'font-weight': 'fontWeight',
  'dominant-baseline': 'dominantBaseline', 'alignment-baseline': 'alignmentBaseline', 'vector-effect': 'vectorEffect',
  'xlink:href': 'xlinkHref', 'xml:space': 'xmlSpace', 'stop-color': 'stopColor', 'stop-opacity': 'stopOpacity',
  gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', patternunits: 'patternUnits',
  patterncontentunits: 'patternContentUnits', patterntransform: 'patternTransform', markerwidth: 'markerWidth',
  markerheight: 'markerHeight', refx: 'refX', refy: 'refY', textlength: 'textLength', lengthadjust: 'lengthAdjust',
  clippathunits: 'clipPathUnits', filterunits: 'filterUnits', primitiveunits: 'primitiveUnits',
}
const SVG_TAGS: Record<string, string> = { clippath: 'clipPath', lineargradient: 'linearGradient', radialgradient: 'radialGradient', foreignobject: 'foreignObject', textpath: 'textPath' }
const camelCase = (name: string): string => name.replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
const literal = (value: string): string => "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + "'"
const attributeText = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const text = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')

function styleToObject(value: string): string {
  const parsed = declarations(value)
  const entries = parsed.map(({ prop, value: val }) => {
    const key = prop.startsWith('--') ? prop : camelCase(prop)
    return (/^[A-Za-z_$][\w$]*$/.test(key) ? key : literal(key)) + ': ' + literal(val)
  })
  const custom = parsed.some(({ prop }) => prop.startsWith('--'))
  return '{{ ' + entries.join(', ') + ' }' + (custom ? ' as CSSProperties' : '') + '}'
}
function attrsToJsx(node: HtmlNode): string {
  const parts: string[] = []
  const used = new Set<string>()
  for (const attr of node.attrs) {
    const lower = attr.name
    if (used.has(lower)) continue
    used.add(lower)
    if (lower.startsWith('on') || lower === 'srcdoc') continue
    if (['href','src','action','formaction','xlink:href'].includes(lower) && /^[\s\u0000-\u0020]*(?:javascript|vbscript):/i.test(attr.value.replace(/[\t\r\n]/g, ''))) continue
    const name = ATTR_MAP[lower] ?? SVG_ATTRS[lower] ?? lower
    if (lower === 'style') { parts.push('style=' + styleToObject(attr.value)); continue }
    if (BOOLEAN_ATTRS.has(lower)) { parts.push(name); continue }
    if (NUMERIC_ATTRS.has(lower) && /^-?\d+$/.test(attr.value)) { parts.push(name + '={' + Number(attr.value) + '}'); continue }
    // Quoted JSX attribute values are literals, including braces and apparent JS code.
    parts.push(name + '="' + attributeText(attr.value) + '"')
  }
  return parts.length ? ' ' + parts.join(' ') : ''
}
function renderNode(node: HtmlNode): string {
  if (node.type === 'text') return text(node.text)
  if (['script','style','head','title','meta','link','base'].includes(node.tag)) return ''
  if (node.tag === 'html' || node.tag === 'body') return node.children.map(renderNode).join('')
  const tag = SVG_TAGS[node.tag] ?? node.tag
  const attrs = attrsToJsx(node)
  return '<' + tag + attrs + (VOID_TAGS.has(node.tag) ? ' />' : '>' + node.children.map(renderNode).join('') + '</' + tag + '>')
}
/** HTML is parsed as data; comments and executable scripts are omitted. No source expression is evaluated. */
export function htmlToJsx(html: string): string {
  const parsed = parseHtml(html)
  const body = findElement(parsed, (node) => node.tag === 'body')
  return (body ? body.children : parsed).map(renderNode).join('').replace(/\n{3,}/g, '\n\n').trim()
}
function pageCss(html: string): string {
  const styles: string[] = []
  walkElements(parseHtml(html), (node) => {
    if (node.tag === 'style') styles.push(node.children.map((child) => child.text).join(''))
  })
  return styles.join('\n\n').replace(/\r\n/g, '\n')
}
/** Preserve page-specific layout in a separate stylesheet, including original prototype scope selectors. */
export function toReactComponent(pageHtml: string, componentName = 'CanvasPage'): CodeFile[] {
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(componentName)) throw new Error('React component name must be an uppercase identifier.')
  const jsx = htmlToJsx(pageHtml)
  const css = pageCss(pageHtml)
  const component = "/**\n * 由天枢画布生成。tokens.css / components.css 提供设计系统；layout.css 保留页面布局。\n * 静态结构导出：原型脚本和内联事件未迁移；Tab、筛选、分页等需接入 React 状态和事件。\n */\nimport type { CSSProperties } from 'react'\nimport './tokens.css'\nimport './components.css'\nimport './layout.css'\n\nexport default function " + componentName + "() {\n  return (\n    <>\n      " + jsx + "\n    </>\n  )\n}\n"
  return [{ name: componentName + '.tsx', content: component, language: 'tsx' }, { name: 'layout.css', content: css, language: 'css' }]
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
    .map(([k, v]) => `        ${literal(k)}: ${literal(v)},`)
    .join('\n')
  const families = Object.entries(input.fontFamilies)
    .map(([k, v]) => `        ${literal(k)}: [${v.split(',').map((f) => literal(f.trim().replace(/^['"]|['"]$/g, ''))).join(', ')}],`)
    .join('\n')
  const fontSizes = Object.entries(input.fontSizes)
    .map(([k, v]) => `        ${literal(k)}: ${literal(String(v) + 'px')},`)
    .join('\n')
  const spacing = input.spacing.map((v) => `        ${literal(String(v))}: ${literal(String(v) + 'px')},`).join('\n')
  const radius = input.radius
    .filter((v) => v < 9999)
    .map((v) => `        ${literal('ts-' + v)}: ${literal(String(v) + 'px')},`)
    .join('\n')
  const shadows = Object.entries(input.shadows)
    .map(([k, v]) => `        ${literal(k)}: ${literal(v)},`)
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
