/** Original page compositions. Kept separate from the legacy two-template contract. */
import { mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { auditForbidden, findBlockedResources, buildManifest } from './design/design-validate.mjs'

const ID = /^[a-z][a-z0-9-]{0,63}$/
const DIRECTIONS = ['editorial-narrative', 'product-evidence', 'brand-poster']
const text = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const json = (p) => JSON.parse(text(p))
const write = (p, value) => { mkdirSync(resolve(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(value, null, 2) + '\n') }

function safeFile(root, name) {
  const file = join(root, name)
  const rel = relative(realpathSync(root), realpathSync(file))
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`原型资源超出源目录：${name}`)
  return file
}

export function validatePrototypeResource(meta, html, css, contract) {
  const errors = []
  if (!ID.test(meta.id)) errors.push('原型 id 无效')
  for (const key of ['name', 'category', 'description', 'language']) if (typeof meta[key] !== 'string' || !meta[key].trim()) errors.push(`${key} 缺失`)
  if (!['zh-CN', 'en'].includes(meta.language)) errors.push('示例语言必须为 zh-CN 或 en')
  for (const key of ['contentRequirements', 'responsive', 'interactions', 'variants', 'designDecisions']) if (!Array.isArray(meta[key]) || !meta[key].length || meta[key].some(v => typeof v !== 'string' || !v.trim())) errors.push(`${key} 必须是非空字符串数组`)
  auditForbidden(meta.id, html + css + JSON.stringify(meta), errors)
  if (/<(?:script|style|html|head|body|base|meta|iframe|frame|frameset|embed|object|link|foreignObject)\b/i.test(html)) errors.push('原型正文只能是无脚本、无样式的 body 片段')
  // These resource/navigation channels are not covered by the legacy src/url()
  // scanner. Reject them explicitly rather than relying on the iframe CSP to
  // hide a non-self-contained resource during a successful render.
  if (/\b(?:srcset|imagesrcset|poster|ping)\s*=/i.test(html)) errors.push('原型不得包含候选图片、媒体封面或导航追踪资源')
  for (const link of html.matchAll(/\b(?:href|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) if (!(link[1] ?? link[2] ?? link[3]).startsWith('#')) errors.push('原型链接仅允许页内锚点')
  if (/\bsrcdoc\s*=|<input\b[^>]*\btype\s*=\s*["']?file\b/i.test(html)) errors.push('原型不得请求文件或嵌套文档能力')
  if (/\bon[a-z]+\s*=|(?:href|src|action|formaction)\s*=\s*["']?\s*(?:javascript:|data:text\/html|https?:|\/\/)/i.test(html)) errors.push('原型不得包含事件处理器或外部导航')
  if (findBlockedResources(html + '<style>' + css + '</style>').length) errors.push('原型资源必须自包含')
  if (/url\s*\(|@import|expression\s*\(|<\/style/i.test(css)) errors.push('原型 CSS 不允许资源载入或可执行内容')
  if (!html.includes(`data-ts-prototype="${meta.id}"`)) errors.push('缺少匹配的原型根节点')
  if (!/演示|demo/i.test(html)) errors.push('原创示例须明确标注演示内容')
  // All rules are rooted here before compilation, including nested media rules.
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    const selector = rule[1].trim()
    if (selector.startsWith('@media') || selector.startsWith('@supports')) continue
    if (selector.split(',').some(s => !/^:scope(?=$|[\s.:[>#])/.test(s.trim()) || /[+~]/.test(s))) errors.push(`CSS 选择器越界：${selector}`)
  }
  for (const m of (html + css).matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)) if (!contract.vars.has(m[1])) errors.push(`未声明 token：${m[1]}`)
  const classes = [...new Set([...html.matchAll(/class=["']([^"']*)["']/g)].flatMap(m => m[1].split(/\s+/)).filter(Boolean))]
  for (const cls of classes) if (!cls.startsWith('tp-') && !contract.classes.has(cls)) errors.push(`未登记类：${cls}`)
  for (const m of html.matchAll(/data-icon=["']([^"']+)["']/g)) if (!contract.icons.has(m[1])) errors.push(`未登记图标：${m[1]}`)
  for (const m of html.matchAll(/\b(data-ts-[a-z-]+)/g)) if (m[1] !== 'data-ts-prototype' && !contract.attrs.has(m[1])) errors.push(`未登记交互属性：${m[1]}`)
  if (errors.length) throw new Error(`原型 ${meta.id} 校验失败：\n${[...new Set(errors)].join('\n')}`)
  return { ...meta, classes, html, css: css.replace(/:scope/g, `[data-ts-prototype="${meta.id}"]`) }
}

export function buildPrototypeLibrary(root, dist) {
  const source = join(root, 'design-systems')
  const prototypeRoot = join(source, 'prototypes')
  const tokens = json(join(source, 'styles', 'tianshu-original', 'tokens.json'))
  const components = json(join(source, 'components', 'components.json'))
  const interactions = json(join(source, 'interactions', 'interactions.json'))
  const bindings = json(join(source, 'interactions', 'bindings.json'))
  const icons = json(join(source, 'icons', 'core.json'))
  const contract = {
    vars: new Set(buildManifest(tokens, { icons: [], componentClasses: [] }).vars),
    classes: new Set([...(components.sharedClasses ?? []), ...components.components.flatMap(c => c.classes ?? []), ...interactions.interactions.flatMap(i => i.classes), ...(interactions.sharedClasses ?? [])]),
    icons: new Set(Object.keys(icons.icons)),
    attrs: new Set([...text(join(source, 'interactions', 'interactions.json')).matchAll(/data-ts-[a-z-]+/g)].map(m => m[0])),
  }
  // Supplemental bindings extend existing declared interactions, not executable page code.
  for (const binding of bindings.bindings) for (const attr of [binding.rootAttr, ...binding.attributes]) contract.attrs.add(attr)
  const shared = text(safeFile(prototypeRoot, 'shared.css'))
  const index = json(safeFile(prototypeRoot, 'index.json'))
  if (index.schemaVersion !== 1 || !Array.isArray(index.prototypes)) throw new Error('原型清单契约无效')
  const seen = new Set()
  const summaries = []
  const resources = new Map()
  for (const id of index.prototypes) {
    if (!ID.test(id) || seen.has(id)) throw new Error(`原型清单重复或无效：${id}`)
    seen.add(id)
    const dir = safeFile(prototypeRoot, id)
    const meta = json(safeFile(dir, 'meta.json'))
    if (meta.id !== id) throw new Error(`原型目录与 id 不符：${id}`)
    const compiled = validatePrototypeResource(meta, text(safeFile(dir, 'body.html')), shared + '\n' + text(safeFile(dir, 'layout.css')), contract)
    resources.set(id, compiled)
    write(join(dist, 'design', 'prototypes', `${id}.json`), compiled)
    summaries.push({ id, name: meta.name, category: meta.category, description: meta.description, language: meta.language, variants: meta.variants })
  }
  const disk = readdirSync(prototypeRoot, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  if (disk.some(id => !seen.has(id))) throw new Error('存在未登记原型目录')
  write(join(dist, 'design', 'prototypes', 'index.json'), { schemaVersion: 1, prototypes: summaries })
  const directionRoot = join(source, 'directions')
  const directions = json(safeFile(directionRoot, 'index.json')).directions
  if (JSON.stringify(directions.map(d => d.id)) !== JSON.stringify(DIRECTIONS)) throw new Error('方向必须完整且顺序稳定')
  for (const direction of directions) {
    if (direction.examples.length !== 2 || !direction.examples.some(e => e.language === 'zh-CN') || !direction.examples.some(e => e.language === 'en')) throw new Error(`方向 ${direction.id} 需要中英两份原创示例`)
    for (const example of direction.examples) {
      if (example.prototypeId) {
        if (!resources.has(example.prototypeId)) throw new Error('方向示例指向缺失原型')
        if (resources.get(example.prototypeId).language !== example.language) throw new Error('方向示例语言与原型不符')
        example.resourceId = example.prototypeId
      } else {
        const dir = safeFile(directionRoot, example.id)
        const meta = json(safeFile(dir, 'meta.json'))
        if (meta.id !== example.id || meta.language !== example.language) throw new Error('方向示例身份或语言不符')
        const compiled = validatePrototypeResource(meta, text(safeFile(dir, 'body.html')), shared + '\n' + text(safeFile(dir, 'layout.css')), contract)
        write(join(dist, 'design', 'directions', `${example.id}.json`), compiled)
        example.resourceId = example.id
      }
    }
    write(join(dist, 'design', 'directions', `${direction.id}.json`), direction)
  }
  write(join(dist, 'design', 'directions', 'index.json'), { schemaVersion: 1, directions: directions.map(({examples, ...summary}) => ({ ...summary, exampleCount: examples.length })) })
  return { prototypes: summaries.length, directions: directions.length, examples: directions.reduce((n,d) => n + d.examples.length, 0) }
}
