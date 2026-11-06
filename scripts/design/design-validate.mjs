/**
 * 设计系统构建期校验。纯函数，返回 { errors, warnings }，由 build-design.mjs 决定是否中断。
 */
import { buildManifest, contrast, flattenDarkSemantic, flattenTokens, isHex, isPrimitiveRef, kebab, parseHex } from './design-tokens.mjs'

const FORBIDDEN = [
  'library-consumption',
  'soloDesignConsumption',
  'uikit-plan',
  'preview-contract',
  'readOrder',
  '.trae-cn',
  'dl_builtin',
  'fill-html-head',
  'solo-design',
  '--trae-',
  '--doubao-',
  '--claude-',
  '--apple-',
  '--google-',
]

const REQUIRED_SEMANTIC = {
  bg: ['canvas', 'surface', 'raised', 'sunken', 'inverse'],
  text: ['primary', 'secondary', 'muted', 'inverse', 'link'],
  border: ['default', 'strong', 'subtle', 'focus'],
  action: [
    'primary',
    'primaryHover',
    'primaryText',
    'secondary',
    'secondaryHover',
    'secondaryText',
    'ghostHover',
    'danger',
    'dangerText',
  ],
  status: ['success', 'successBg', 'warning', 'warningBg', 'danger', 'dangerBg', 'info', 'infoBg'],
  chart: ['1', '2', '3', '4', '5'],
  overlay: ['scrim'],
}

const CSS_VAR = /var\(\s*(--ts-[A-Za-z0-9-]+)/g
const TS_CLASS = /\bts-[A-Za-z0-9_-]+/g
const CLASS_ATTR = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const DATA_ICON = /data-icon\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const TAG_RESOURCE =
  /<(?:script|img|link|iframe|video|audio|source|embed|object)\b[^>]*?\b(?:src|href|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
const CSS_RESOURCE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi
const INLINE = /^(?:data:|blob:|about:|#)/i
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ALLOWED_ICON_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g'])

export function findBlockedResources(html) {
  const found = new Set()
  for (const pattern of [TAG_RESOURCE, CSS_RESOURCE]) {
    pattern.lastIndex = 0
    for (const match of html.matchAll(pattern)) {
      const value = match.slice(1).find((g) => g !== undefined)?.trim()
      if (value && !INLINE.test(value)) found.add(value)
    }
  }
  return [...found]
}

function pushIf(condition, errors, message) {
  if (condition) errors.push(message)
}

/** 检查生成的任意文本里是否残留被禁用的痕迹。 */
export function auditForbidden(label, text, errors) {
  for (const token of FORBIDDEN) {
    if (text.includes(token)) errors.push(`${label}：出现被禁用的标识 ${token}`)
  }
  if (/https?:\/\//.test(text)) errors.push(`${label}：出现外链 URL`)
}

/**
 * 尺度必须严格递增。既查键也查值：
 * 键名是数字档位（0/1/2/…），但 JS 会把整数键自动升序排列，
 * 只查键永远查不出乱序；真正的错误（如两档都写成 4）只体现在**值**上。
 */
function checkMonotonic(label, record, errors) {
  const keys = Object.keys(record)
  const nums = keys.map((k) => Number(k))
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) {
    errors.push(`${label}：键必须是非负数字（可排序）`)
    return
  }
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] <= nums[i - 1]) errors.push(`${label}：键必须严格递增（${keys[i - 1]} -> ${keys[i]}）`)
  }
  for (let i = 1; i < keys.length; i++) {
    const prev = record[keys[i - 1]]
    const cur = record[keys[i]]
    if (typeof prev !== 'number' || typeof cur !== 'number') continue
    if (cur <= prev) errors.push(`${label}：值必须严格递增（${keys[i - 1]}=${prev} -> ${keys[i]}=${cur}）`)
  }
}

/** 圆角用命名档位（none/sm/.../full），按声明顺序校验数值递增（full 是哨兵值，不参与）。 */
function checkRadius(record, errors) {
  const entries = Object.entries(record)
  let prev = -Infinity
  for (const [key, value] of entries) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      errors.push(`tokens.radius.${key} 必须是非负数字`)
      continue
    }
    if (key === 'full') continue
    if (value <= prev) errors.push(`tokens.radius.${key} 必须大于前一档（${prev}）`)
    prev = value
  }
}

export function validateTokens(tokens, expectedId, errors, warnings) {
  if (tokens?.schema !== 'tianshu-design-tokens/1') errors.push('tokens.schema 必须是 tianshu-design-tokens/1')
  if (tokens?.id !== expectedId) errors.push(`tokens.id（${tokens?.id}）与目录（${expectedId}）不一致`)
  if (typeof tokens?.version !== 'number') errors.push('tokens.version 必须是数字')

  for (const group of ['font', 'space', 'radius', 'borderWidth', 'shadow', 'size', 'motion', 'color']) {
    if (!tokens?.[group] || typeof tokens[group] !== 'object') errors.push(`tokens.${group} 缺失`)
  }
  if (!tokens?.color?.primitives || !tokens?.color?.semantic) {
    errors.push('tokens.color 需要 primitives 与 semantic')
    return null
  }

  for (const [group, steps] of Object.entries(tokens.color.primitives)) {
    for (const [step, value] of Object.entries(steps)) {
      if (!isHex(value)) errors.push(`原色必须是 hex：color.primitives.${group}.${step} = ${value}`)
    }
  }

  for (const [group, required] of Object.entries(REQUIRED_SEMANTIC)) {
    const actual = tokens.color.semantic[group]
    if (!actual) {
      errors.push(`缺少语义色组 color.semantic.${group}`)
      continue
    }
    for (const name of required) {
      if (actual[name] === undefined) errors.push(`缺少语义色 color.semantic.${group}.${name}`)
    }
  }
  for (const [group, entries] of Object.entries(tokens.color.semantic)) {
    for (const [name, value] of Object.entries(entries)) {
      if (isPrimitiveRef(value)) {
        const [g, s] = value.split('.')
        if (tokens.color.primitives[g]?.[s] === undefined) {
          errors.push(`语义色引用不可解析：color.semantic.${group}.${name} = ${value}`)
        }
      } else if (!isHex(value) && !/^(?:rgba?|hsla?)\(|^transparent$/.test(value)) {
        errors.push(`无法识别的颜色值：color.semantic.${group}.${name} = ${value}`)
      }
    }
  }

  const font = tokens.font ?? {}
  for (const key of ['families', 'sizes', 'weights', 'lineHeights', 'letterSpacing']) {
    if (!font[key] || Object.keys(font[key]).length === 0) errors.push(`tokens.font.${key} 不能为空`)
  }
  for (const [name, px] of Object.entries(font.sizes ?? {})) {
    if (typeof px !== 'number' || px <= 0) errors.push(`font.sizes.${name} 必须是正数`)
  }

  checkMonotonic('tokens.space', tokens.space ?? {}, errors)
  checkRadius(tokens.radius ?? {}, errors)
  for (const [k, v] of Object.entries(tokens.size ?? {})) {
    if (typeof v !== 'number' || v <= 0) errors.push(`size.${k} 必须是正数`)
  }
  for (const [k, v] of Object.entries(tokens.shadow ?? {})) {
    if (typeof v !== 'string' || /url\(|@import|https?:\/\//i.test(v)) errors.push(`shadow.${k} 含禁用内容`)
  }

  validateColorSemantics(tokens, tokens.color.semantic, '', errors, warnings)

  // 深色：结构与浅色同构时校验对比度；缺哪个组/键单独报错。
  const dark = tokens.color.semanticDark
  if (dark != null) {
    if (typeof dark !== 'object') {
      errors.push('color.semanticDark 必须是对象')
    } else {
      for (const [group, required] of Object.entries(REQUIRED_SEMANTIC)) {
        const actual = dark[group]
        if (!actual) {
          errors.push(`缺少深色语义色组 color.semanticDark.${group}`)
          continue
        }
        for (const name of required) {
          if (actual[name] === undefined) errors.push(`缺少深色语义色 color.semanticDark.${group}.${name}`)
        }
      }
      for (const [group, entries] of Object.entries(dark)) {
        for (const [name, value] of Object.entries(entries)) {
          if (isPrimitiveRef(value)) {
            const [g, s] = value.split('.')
            if (tokens.color.primitives[g]?.[s] === undefined) {
              errors.push(`深色语义色引用不可解析：color.semanticDark.${group}.${name} = ${value}`)
            }
          } else if (!isHex(value) && !/^(?:rgba?|hsla?)\(|^transparent$/.test(value)) {
            errors.push(`无法识别的深色语义色值：color.semanticDark.${group}.${name} = ${value}`)
          }
        }
      }
      validateColorSemantics(tokens, dark, '[dark] ', errors, warnings)
    }
  }

  try {
    flattenTokens(tokens)
    if (dark != null) flattenDarkSemantic(tokens)
  } catch (err) {
    errors.push(`token 展平失败：${err.message}`)
    return null
  }
  return true
}

function resolveValue(tokens, path, semantic) {
  const [group, name] = path.split('.')
  const raw = semantic?.[group]?.[name]
  if (raw === undefined) return null
  if (isPrimitiveRef(raw)) {
    const [g, s] = raw.split('.')
    return tokens.color.primitives[g]?.[s] ?? null
  }
  return raw
}

const CONTRAST_PAIRS = [
  ['text.primary', 'bg.canvas', 4.5],
  ['text.primary', 'bg.surface', 4.5],
  ['text.secondary', 'bg.canvas', 4.5],
  ['text.muted', 'bg.canvas', 3],
  ['action.primaryText', 'action.primary', 4.5],
]

/**
 * 校验一组语义色（浅色或深色）的对比度。
 * prefix 用于区分深浅（如 '[dark] '）。
 */
export function validateColorSemantics(tokens, semantic, prefix, errors, warnings) {
  if (!semantic || typeof semantic !== 'object') return
  for (const [fg, bg, min] of CONTRAST_PAIRS) {
    const fgValue = resolveValue(tokens, fg, semantic)
    const bgValue = resolveValue(tokens, bg, semantic)
    if (!fgValue || !bgValue) continue
    if (!parseHex(fgValue) || !parseHex(bgValue)) continue
    const ratio = contrast(fgValue, bgValue)
    const label = `${prefix}${fg} 对比 ${bg} = ${ratio.toFixed(2)}`
    if (ratio < min) {
      if (min >= 4.5) errors.push(`对比度不足：${label}（要求 ≥ ${min}）`)
      else warnings.push(`对比度偏低：${label}（建议 ≥ ${min}）`)
    }
  }
}

export function validateComponents(components, componentsCss, manifest, errors, warnings) {
  if (components?.schema !== 1) errors.push('components.schema 必须是 1')
  const defined = definedClasses(componentsCss)
  const allClasses = new Set()
  const ownedClasses = new Set(components?.sharedClasses ?? [])
  for (const component of components?.components ?? []) {
    for (const className of component.classes ?? []) ownedClasses.add(className)
  }
  for (const className of components?.sharedClasses ?? []) {
    if (!defined.has(className)) errors.push(`共享类在 components.css 中没有定义：.${className}`)
    allClasses.add(className)
  }
  for (const component of components?.components ?? []) {
    if (!component.id || !component.base) errors.push(`组件缺少 id/base：${JSON.stringify(component.id)}`)
    if (!Array.isArray(component.classes) || component.classes.length === 0) {
      errors.push(`组件 ${component.id} 缺少 classes`)
      continue
    }
    for (const className of component.classes) {
      if (!className.startsWith('ts-')) errors.push(`组件 ${component.id} 的类名必须以 ts- 开头：${className}`)
      if (allClasses.has(className)) errors.push(`类名重复：${className}`)
      allClasses.add(className)
      if (!defined.has(className)) errors.push(`组件类在 components.css 中没有定义：.${className}`)
    }
    if (!component.classes.includes(component.base)) errors.push(`组件 ${component.id} 的 base 不在 classes 中`)
    for (const token of component.tokens ?? []) {
      if (!tokenLooksValid(manifest, token)) warnings.push(`组件 ${component.id} 引用的 token 未知：${token}`)
    }
    for (const match of String(component.example ?? '').matchAll(CLASS_ATTR)) {
      for (const cls of (match[1] ?? match[2] ?? '').split(/\s+/).filter(Boolean)) {
        if (!ownedClasses.has(cls)) {
          errors.push(`组件 ${component.id} 的示例使用了未声明的类：${cls}`)
        }
      }
    }
    auditForbidden(`组件 ${component.id}`, String(component.example ?? ''), errors)
  }

  for (const name of cssVars(componentsCss)) {
    if (!manifest.vars.includes(name)) errors.push(`components.css 使用了未定义的变量：${name}`)
  }
  auditForbidden('components.css', componentsCss, errors)
  return allClasses
}

function isClassInGroup(cls, classes) {
  return classes.some((c) => c === cls)
}

function tokenLooksValid(manifest, token) {
  const varName = tokenToVar(token)
  return varName !== null && manifest.vars.includes(varName)
}

/** 把契约里的点路径（color.bg.canvas / font.sizes.md）映射成变量名。 */
function tokenToVar(token) {
  const parts = String(token).split('.')
  const [top, ...rest] = parts
  if (!top || rest.length === 0) return null
  if (top === 'color') return `--ts-color-${rest.map(kebab).join('-')}`
  if (top === 'font') {
    const [kind, ...name] = rest
    const prefixes = { families: 'font', sizes: 'fs', weights: 'weight', lineHeights: 'lh', letterSpacing: 'tracking' }
    const prefix = prefixes[kind]
    if (!prefix || name.length === 0) return null
    return `--ts-${prefix}-${name.map(kebab).join('-')}`
  }
  if (top === 'borderWidth') return `--ts-border-${rest.map(kebab).join('-')}`
  return `--ts-${kebab(top)}-${rest.map(kebab).join('-')}`
}

function definedClasses(css) {
  const set = new Set()
  for (const match of css.matchAll(/\.([A-Za-z0-9_-]+)/g)) set.add(match[1])
  return set
}

function cssVars(css) {
  const set = new Set()
  for (const match of css.matchAll(CSS_VAR)) set.add(match[1])
  return set
}

export function validateIcons(iconsDoc, expectedCoreNames, errors, warnings) {
  if (iconsDoc?.schema !== 1) errors.push('icons.schema 必须是 1')
  const icons = iconsDoc?.icons ?? {}
  const names = Object.keys(icons)
  if (names.length < 60 || names.length > 80) errors.push(`图标数量必须在 60–80 之间，当前 ${names.length}`)
  for (const name of names) {
    if (!ICON_NAME.test(name)) errors.push(`图标名不合法：${name}`)
    const body = icons[name]
    if (typeof body !== 'string' || body.trim() === '') {
      errors.push(`图标 ${name} 内容为空`)
      continue
    }
    if (/<script|<style|id\s*=|on[a-z]+\s*=|https?:\/\//i.test(body)) errors.push(`图标 ${name} 含禁用内容`)
    for (const tag of body.matchAll(/<\s*([a-zA-Z]+)/g)) {
      if (!ALLOWED_ICON_TAGS.has(tag[1].toLowerCase())) errors.push(`图标 ${name} 使用了不允许的标签 <${tag[1]}>`)
    }
  }
  for (const core of expectedCoreNames) {
    if (!icons[core]) errors.push(`缺少核心图标：${core}`)
  }
  const missing = names.filter((n) => !ICON_NAME.test(n))
  if (missing.length) warnings.push(`图标名格式异常：${missing.join(', ')}`)
  return names
}

export function validateTemplates(templatesDoc, templatesDir, allClasses, iconNames, manifest, componentCatalog, errors) {
  if (templatesDoc?.schema !== 1) errors.push('templates.schema 必须是 1')
  const ids = new Set()
  const iconSet = new Set(iconNames)
  for (const template of templatesDoc?.templates ?? []) {
    if (ids.has(template.id)) errors.push(`模板 id 重复：${template.id}`)
    ids.add(template.id)
    if (!template.file || !template.file.startsWith('templates/')) errors.push(`模板 ${template.id} 的 file 必须指向 templates/`)
    if (template.device !== 'desktop' && template.device !== 'tablet' && template.device !== 'mobile' && template.device !== 'free') {
      errors.push(`模板 ${template.id} 的 device 不合法：${template.device}`)
    }
    for (const component of template.components ?? []) {
      if (!component || typeof component !== 'string') errors.push(`模板 ${template.id} 的 components 不合法`)
      else if (componentCatalog && !componentCatalog.has(component)) {
        errors.push(`模板 ${template.id} 声明了不存在的组件：${component}`)
      }
    }
  }
  return { templates: templatesDoc?.templates ?? [], dir: templatesDir, allClasses, iconSet, manifest, errors }
}

export function validateTemplateHtml(label, html, template, allClasses, iconSet, manifest, componentCatalog, errors) {
  if (/<script\b/i.test(html)) errors.push(`${label}：模板不得包含 <script>`)
  if (/<style\b/i.test(html)) errors.push(`${label}：模板不得包含 <style>`)
  if (/<html\b|<!doctype/i.test(html)) errors.push(`${label}：模板必须是 body 片段`)
  for (const match of html.matchAll(CLASS_ATTR)) {
    for (const cls of (match[1] ?? match[2] ?? '').split(/\s+/).filter(Boolean)) {
      if (cls.startsWith('ts-') && !allClasses.has(cls)) errors.push(`${label}：使用了未定义的组件类 ${cls}`)
    }
  }
  for (const match of html.matchAll(DATA_ICON)) {
    const name = (match[1] ?? match[2] ?? '').trim()
    if (!iconSet.has(name)) errors.push(`${label}：图标不在目录中：${name}`)
  }
  for (const name of cssVars(html)) {
    if (!manifest.vars.includes(name)) errors.push(`${label}：使用了未定义的变量 ${name}`)
  }
  const blocked = findBlockedResources(html)
  if (blocked.length) errors.push(`${label}：存在会被 CSP 拦截的资源引用：${blocked.slice(0, 5).join(', ')}`)
  for (const component of template.components ?? []) {
    if (!componentCatalog.has(component)) {
      errors.push(`${label}：模板声明的组件 ${component} 在组件目录中找不到对应组件 id`)
    }
  }
  for (const icon of template.icons ?? []) {
    if (!iconSet.has(icon)) errors.push(`${label}：模板声明的图标不存在：${icon}`)
  }
  auditForbidden(label, html, errors)
}

/** 跨风格一致性：变量名、组件类、模板 id 必须完全一致。 */
export function validateConsistency(styles, errors) {
  const first = styles[0]
  if (!first) return
  for (const style of styles.slice(1)) {
    const a = new Set(first.manifest.vars)
    const b = new Set(style.manifest.vars)
    const missing = [...a].filter((v) => !b.has(v))
    const extra = [...b].filter((v) => !a.has(v))
    if (missing.length || extra.length) {
      errors.push(
        `风格 ${style.id} 的变量集合与 ${first.id} 不一致：缺 ${missing.slice(0, 5).join(', ') || '无'}；多 ${extra.slice(0, 5).join(', ') || '无'}`,
      )
    }
    const ca = new Set(first.componentClasses)
    const cb = new Set(style.componentClasses)
    const cm = [...ca].filter((v) => !cb.has(v))
    const ce = [...cb].filter((v) => !ca.has(v))
    if (cm.length || ce.length) {
      errors.push(`风格 ${style.id} 的组件类与 ${first.id} 不一致：缺 ${cm.slice(0, 5).join(', ') || '无'}；多 ${ce.slice(0, 5).join(', ') || '无'}`)
    }
    const ta = new Set(first.templateIds)
    const tb = new Set(style.templateIds)
    const tm = [...ta].filter((v) => !tb.has(v))
    const te = [...tb].filter((v) => !ta.has(v))
    if (tm.length || te.length) {
      errors.push(`风格 ${style.id} 的模板 id 与 ${first.id} 不一致：缺 ${tm.join(', ') || '无'}；多 ${te.join(', ') || '无'}`)
    }
  }
}

export { buildManifest }
