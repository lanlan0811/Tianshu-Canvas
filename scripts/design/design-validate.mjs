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

export function validateInteractions(interactionsDoc, interactionsCss, interactionsJs, manifest, errors, warnings) {
  if (interactionsDoc?.schema !== 1) errors.push('interactions.schema 必须是 1')
  const expected = 23
  const list = interactionsDoc?.interactions ?? []
  if (list.length !== expected) errors.push(`交互条目必须为 ${expected} 个，当前 ${list.length}`)

  const defined = definedClasses(interactionsCss)
  const allClasses = new Set()
  const ids = new Set()
  const rootAttrs = new Set()
  for (const entry of list) {
    if (!entry.id || !entry.rootAttr) errors.push(`交互缺少 id/rootAttr：${JSON.stringify(entry.id)}`)
    if (ids.has(entry.id)) errors.push(`交互 id 重复：${entry.id}`)
    ids.add(entry.id)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id ?? '')) errors.push(`交互 id 不合法：${entry.id}`)
    if (rootAttrs.has(entry.rootAttr)) errors.push(`交互 rootAttr 重复：${entry.rootAttr}`)
    rootAttrs.add(entry.rootAttr)
    if (!/^data-ts-[a-z0-9-]+$/.test(entry.rootAttr ?? '')) errors.push(`交互 ${entry.id} 的 rootAttr 必须是 data-ts-*：${entry.rootAttr}`)
    if (typeof entry.requiresScript !== 'boolean') errors.push(`交互 ${entry.id} 的 requiresScript 必须是布尔`)
    if (!entry.skeletonHtml || String(entry.skeletonHtml).trim() === '') errors.push(`交互 ${entry.id} 缺少 skeletonHtml`)
    if (!Array.isArray(entry.classes) || entry.classes.length === 0) {
      errors.push(`交互 ${entry.id} 缺少 classes`)
      continue
    }
    for (const className of entry.classes) {
      if (!className.startsWith('ts-')) errors.push(`交互 ${entry.id} 的类名必须以 ts- 开头：${className}`)
      if (allClasses.has(className) && !(entry.reused ?? []).includes(className)) {
        errors.push(`交互类名重复：${className}`)
      }
      allClasses.add(className)
      // 复用自组件目录的类在 components.css 里定义，不在本文件要求。
      const isReused = (entry.reused ?? []).includes(className)
      if (!isReused && !defined.has(className)) errors.push(`交互类在 interactions.css 中没有定义：.${className}`)
    }
    // 复用自组件目录的类不在本文件定义，但必须存在于全局契约。
    for (const className of entry.reused ?? []) {
      if (!entry.classes.includes(className)) errors.push(`交互 ${entry.id} 的 reused 类 ${className} 必须同时出现在 classes 中`)
      if (!manifest.componentClasses.includes(className)) {
        errors.push(`交互 ${entry.id} 复用了一个组件目录里不存在的类：${className}`)
      }
    }
    for (const match of String(entry.skeletonHtml).matchAll(CLASS_ATTR)) {
      for (const cls of (match[1] ?? match[2] ?? '').split(/\s+/).filter(Boolean)) {
        if (cls.startsWith('ts-') && !allClasses.has(cls) && !manifest.componentClasses.includes(cls)) {
          errors.push(`交互 ${entry.id} 的骨架使用了未声明的类：${cls}`)
        }
      }
    }
    auditForbidden(`交互 ${entry.id}`, String(entry.skeletonHtml), errors)
  }

  for (const name of cssVars(interactionsCss)) {
    if (!manifest.vars.includes(name)) errors.push(`interactions.css 使用了未定义的变量：${name}`)
  }
  auditForbidden('interactions.css', interactionsCss, errors)

  // 运行时禁用的浏览器能力（在画布沙箱与导出站里都会失败）。
  const forbiddenApis = [
    ['fetch', /\bfetch\s*\(/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['localStorage', /\blocalStorage\b/],
    ['sessionStorage', /\bsessionStorage\b/],
    ['document.cookie', /document\s*\.\s*cookie/],
  ]
  for (const [label, pattern] of forbiddenApis) {
    if (pattern.test(interactionsJs)) errors.push(`interactions.js 使用了沙箱禁用的能力：${label}`)
  }
  if (/https?:\/\//.test(interactionsJs)) errors.push('interactions.js 含外链 URL')
  if (/<\/script/i.test(interactionsJs)) errors.push('interactions.js 含 </script（内联注入会截断脚本）')
  if (/<script|<style/i.test(interactionsJs)) errors.push('interactions.js 含 <script/<style 标签')

  // 交互独有类 = 交互清单里声明、但组件目录没有的类；复用的组件类不重复登记。
  const componentSet = new Set(manifest.componentClasses)
  const ownClasses = [...allClasses].filter((c) => !componentSet.has(c))
  return { allClasses, ownClasses, ids: [...ids], rootAttrs: [...rootAttrs] }
}
/**
 * 组件状态契约校验：每个组件声明欠哪些状态，就必须在 components.css 里找到对应选择器。
 *
 * 状态一律用伪类 / 属性驱动，因此这里只查「选择器里是否同时出现 base 类与该状态的标记」：
 *   hover → `:hover`、focus → `:focus` 或 `:focus-visible`、active → `:active`、
 *   disabled → `:disabled` 或 `[disabled]` 或 `[aria-disabled]`、loading → `[aria-busy`、
 *   error → `[aria-invalid`、success/error 也接受 `--success` / `--danger` 变体类。
 *
 * 另做 ts- 前缀单向守卫：components.css 里出现、但不在声明类集合里的 ts-* 类一律报错，
 * 防止偷偷新增只有 CSS 没有契约的状态类。
 */
const STATE_MARKERS = {
  hover: [':hover'],
  focus: [':focus-visible', ':focus'],
  active: [':active'],
  disabled: [':disabled', '[disabled]', '[aria-disabled'],
  loading: ['[aria-busy'],
  error: ['[aria-invalid', '--danger', '--error'],
  success: ['--success'],
}
const ALL_STATES = ['default', 'hover', 'focus', 'active', 'disabled', 'loading', 'error', 'success']

/** 扫 CSS 里所有规则的选择器文本（不解析嵌套语义，够用即可）。 */
function selectorTexts(css) {
  const out = []
  let depth = 0
  let start = 0
  let quote = ''
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (quote) {
      if (ch === quote && css[i - 1] !== '\\') quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '{') {
      if (depth === 0) out.push(css.slice(start, i).trim())
      depth++
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1)
      if (depth === 0) start = i + 1
    }
  }
  return out.filter((s) => s.length > 0 && !s.startsWith('@'))
}

export function validateStateContract(components, componentsCss, errors) {
  const declared = new Set(components?.sharedClasses ?? [])
  for (const component of components?.components ?? []) {
    for (const className of component.classes ?? []) declared.add(className)
  }

  // 1) states 必须是合法状态名，且 default 恰好一次。
  for (const component of components?.components ?? []) {
    const states = component.states
    if (!Array.isArray(states) || states.length === 0) {
      errors.push(`组件 ${component.id} 缺少 states 声明`)
      continue
    }
    for (const state of states) {
      if (!ALL_STATES.includes(state)) errors.push(`组件 ${component.id} 的 states 含未知状态：${state}`)
    }
    if (states.filter((s) => s === 'default').length !== 1) {
      errors.push(`组件 ${component.id} 的 states 必须恰好包含一次 default`)
    }
  }

  // 2) 每个欠的状态都要在 CSS 里找到「该组件的某个类 + 状态标记」的选择器。
  //    状态可能挂在子类上（tabs 的 ts-tab、nav 的 ts-nav__link），所以用组件的全部声明类。
  const selectors = selectorTexts(componentsCss)
  for (const component of components?.components ?? []) {
    const owned = (component.classes ?? []).filter((c) => Boolean(c))
    if (owned.length === 0) continue
    for (const state of component.states ?? []) {
      if (state === 'default') continue
      const markers = STATE_MARKERS[state]
      if (!markers) continue
      const found = selectors.some((selector) => {
        const touchesComponent = owned.some((c) => selector.includes(`.${c}`))
        if (!touchesComponent) return false
        return markers.some((marker) => selector.includes(marker))
      })
      if (!found) errors.push(`组件 ${component.id} 声明了 ${state} 状态，但 components.css 里没有对应选择器`)
    }
  }

  // 3) ts- 前缀单向守卫：CSS 里出现的 ts-* 类必须已在 components.json 声明。
  const used = new Set()
  for (const match of componentsCss.matchAll(/\.(ts-[A-Za-z0-9_-]+)/g)) used.add(match[1])
  for (const className of used) {
    if (!declared.has(className)) {
      errors.push(`components.css 使用了未声明的 ts- 类：${className}（状态请用伪类/属性表达，不要新增状态类）`)
    }
  }
}

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
    const ia = new Set(first.manifest.interactionClasses ?? [])
    const ib = new Set(style.manifest.interactionClasses ?? [])
    const im = [...ia].filter((v) => !ib.has(v))
    const ie = [...ib].filter((v) => !ia.has(v))
    if (im.length || ie.length) {
      errors.push(`风格 ${style.id} 的交互类与 ${first.id} 不一致：缺 ${im.slice(0, 5).join(', ') || '无'}；多 ${ie.slice(0, 5).join(', ') || '无'}`)
    }
    const la = new Set(first.manifest.interactionIds ?? [])
    const lb = new Set(style.manifest.interactionIds ?? [])
    const lm = [...la].filter((v) => !lb.has(v))
    const le = [...lb].filter((v) => !la.has(v))
    if (lm.length || le.length) {
      errors.push(`风格 ${style.id} 的交互 id 与 ${first.id} 不一致：缺 ${lm.join(', ') || '无'}；多 ${le.join(', ') || '无'}`)
    }
  }
}

const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * UX 评审量表校验：结构完整性 + 判据齐全。
 *
 * 量表是评分的唯一真源，任何一条启发式缺分数档、persona 缺红旗，
 * 都会让代理在评审时凭空发明判据，所以一律当错误处理。
 */
export function validateRubric(doc, errors) {
  if (!doc || typeof doc !== 'object') {
    errors.push('评级量表缺失或不是对象')
    return
  }
  if (doc.schema !== 1) errors.push(`评级量表 schema 必须为 1，当前 ${doc.schema}`)

  const heuristics = Array.isArray(doc.heuristics) ? doc.heuristics : []
  if (heuristics.length !== 10) errors.push(`启发式必须为 10 条，当前 ${heuristics.length}`)
  const ids = new Set()
  for (const [index, item] of heuristics.entries()) {
    const label = `启发式 #${index + 1}`
    if (!item || typeof item !== 'object') {
      errors.push(`${label} 不是对象`)
      continue
    }
    if (typeof item.id !== 'string' || !KEBAB_ID.test(item.id)) errors.push(`${label} id 非法：${item.id}`)
    else if (ids.has(item.id)) errors.push(`${label} id 重复：${item.id}`)
    else ids.add(item.id)
    for (const key of ['name', 'ask']) {
      if (typeof item[key] !== 'string' || !item[key].trim()) errors.push(`${label} 缺少 ${key}`)
    }
    if (!Array.isArray(item.checkFor) || item.checkFor.length < 3) errors.push(`${label}（${item.id}）的 checkFor 至少 3 条`)
    if (!Array.isArray(item.levels) || item.levels.length !== 5) {
      errors.push(`${label}（${item.id}）必须有 5 个分数档（0–4），当前 ${Array.isArray(item.levels) ? item.levels.length : 0}`)
    } else if (item.levels.some((level) => typeof level !== 'string' || !level.trim())) {
      errors.push(`${label}（${item.id}）存在空的分数档`)
    }
  }

  const interpretive = Array.isArray(doc.interpretive) ? doc.interpretive : []
  for (const index of interpretive) {
    if (!Number.isInteger(index) || index < 1 || index > 10) errors.push(`interpretive 里的序号必须落在 1–10：${index}`)
  }
  if (interpretive.length > 2) errors.push('最多允许两条启发式可标记 n/a（interpretive）')

  const bands = Array.isArray(doc.bands) ? doc.bands : []
  if (bands.length < 3) errors.push('评分档位至少 3 档')
  let previous = Number.POSITIVE_INFINITY
  for (const band of bands) {
    if (!Number.isFinite(band?.min) || band.min < 0 || band.min > 100) errors.push(`评分档位 min 非法：${band?.min}`)
    else if (band.min >= previous) errors.push(`评分档位必须按 min 严格递减：${band.min} 出现在 ${previous} 之后`)
    else previous = band.min
    if (typeof band?.label !== 'string' || !band.label.trim()) errors.push('评分档位缺少 label')
  }
  if (bands.length && bands[bands.length - 1]?.min !== 0) errors.push('评分档位的最后一档必须是 min: 0')
  if (typeof doc.benchmark !== 'string' || !doc.benchmark.trim()) errors.push('缺少 benchmark 校准说明')

  const load = doc.cognitiveLoad
  const loadItems = Array.isArray(load?.items) ? load.items : []
  if (loadItems.length !== 8) errors.push(`认知负荷清单必须为 8 项，当前 ${loadItems.length}`)
  for (const item of loadItems) {
    for (const key of ['id', 'name', 'ask', 'failure']) {
      if (typeof item?.[key] !== 'string' || !item[key].trim()) errors.push(`认知负荷项缺少 ${key}：${item?.id ?? '(无 id)'}`)
    }
  }
  const loadBands = Array.isArray(load?.bands) ? load.bands : []
  if (loadBands.length < 2) errors.push('认知负荷至少 2 个档位')
  for (const band of loadBands) {
    if (!Number.isInteger(band?.max) || band.max < 0) errors.push(`认知负荷档位 max 非法：${band?.max}`)
  }

  const personas = Array.isArray(doc.personas) ? doc.personas : []
  if (personas.length !== 5) errors.push(`persona 必须为 5 个，当前 ${personas.length}`)
  const personaIds = new Set()
  for (const persona of personas) {
    if (typeof persona?.id !== 'string' || !KEBAB_ID.test(persona.id)) errors.push(`persona id 非法：${persona?.id}`)
    else if (personaIds.has(persona.id)) errors.push(`persona id 重复：${persona.id}`)
    else personaIds.add(persona.id)
    if (typeof persona?.name !== 'string' || !persona.name.trim()) errors.push(`persona 缺少 name：${persona?.id}`)
    if (typeof persona?.profile !== 'string' || !persona.profile.trim()) errors.push(`persona 缺少 profile：${persona?.id}`)
    for (const key of ['questions', 'redFlags']) {
      if (!Array.isArray(persona?.[key]) || persona[key].length < 3) errors.push(`persona ${persona?.id} 的 ${key} 至少 3 条`)
    }
  }

  const personaMap = Array.isArray(doc.personaMap) ? doc.personaMap : []
  if (personaMap.length < 4) errors.push('界面类型 → persona 映射至少 4 行')
  for (const row of personaMap) {
    if (typeof row?.type !== 'string' || !row.type.trim()) errors.push('persona 映射缺少 type')
    const list = Array.isArray(row?.personas) ? row.personas : []
    if (list.length < 1) errors.push(`persona 映射「${row?.type}」没有指派 persona`)
    for (const id of list) {
      if (!personaIds.has(id)) errors.push(`persona 映射「${row?.type}」引用了不存在的 persona：${id}`)
    }
  }

  const severity = Array.isArray(doc.severity) ? doc.severity : []
  const severityIds = severity.map((item) => item?.id)
  for (const id of ['P0', 'P1', 'P2', 'P3']) {
    if (!severityIds.includes(id)) errors.push(`严重度缺少 ${id}`)
  }
  for (const item of severity) {
    for (const key of ['id', 'name', 'desc', 'action']) {
      if (typeof item?.[key] !== 'string' || !item[key].trim()) errors.push(`严重度 ${item?.id ?? '(无 id)'} 缺少 ${key}`)
    }
  }

  const questions = Array.isArray(doc.specificityQuestions) ? doc.specificityQuestions : []
  if (questions.length < 2) errors.push('设计特异性自检问题至少 2 条')

  const floor = Array.isArray(doc.craftFloor) ? doc.craftFloor : []
  if (floor.length !== 9) errors.push(`审美下限必须为 9 项，当前 ${floor.length}`)
  for (const item of floor) {
    if (typeof item?.id !== 'string' || !item.id.trim()) errors.push('审美下限项缺少 id')
    if (typeof item?.check !== 'string' || !item.check.trim()) errors.push(`审美下限项 ${item?.id ?? '(无 id)'} 缺少 check`)
  }

  const refuse = doc.refuse ?? {}
  const hardBans = Array.isArray(refuse.hardBans) ? refuse.hardBans : []
  const defaults = Array.isArray(refuse.defaults) ? refuse.defaults : []
  if (hardBans.length < 1) errors.push('refuse.hardBans 至少 1 条（硬禁令必须显式存在）')
  if (defaults.length < 5) errors.push('refuse.defaults 至少 5 条')
}

export { buildManifest }
