/**
 * Token 处理的纯函数：变量命名、解析、CSS 与 manifest 生成、对比度计算。
 * 只在构建期使用（Node 侧运行时读的是生成好的 dist/design 产物）。
 */

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export function isHex(value) {
  return typeof value === 'string' && HEX.test(value.trim())
}

/** camelCase / PASCAL 转 kebab；数字段保持原样。 */
export function kebab(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

/** 语义值是否可以解析成原色引用（"组.步"）。 */
export function isPrimitiveRef(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9]*\.[A-Za-z0-9]+$/.test(value)
}

/** 解析语义色：返回 { value, primitive? }，primitive 为 "组.步"。 */
export function resolveColor(tokens, value, trail = []) {
  if (isPrimitiveRef(value)) {
    const [group, step] = value.split('.')
    const prim = tokens?.color?.primitives?.[group]?.[step]
    if (prim === undefined) {
      throw new Error(`语义色引用无法解析：${value}（在 ${trail.join('.')}）`)
    }
    return { value: prim, primitive: value }
  }
  if (isHex(value) || /^rgba?\(|^hsla?\(|^transparent$/.test(value)) {
    return { value }
  }
  throw new Error(`无法识别的颜色值：${JSON.stringify(value)}（在 ${trail.join('.')}）`)
}

/** 展平成 "路径 -> CSS 变量名" 映射；顺序严格按源文件声明顺序。 */
export function flattenTokens(tokens) {
  const vars = []
  const resolvedSemantic = {}

  const push = (name, value) => {
    if (!name.startsWith('--ts-')) throw new Error(`变量必须以 --ts- 开头：${name}`)
    vars.push({ name, value })
  }

  const primitives = tokens.color.primitives
  for (const group of Object.keys(primitives)) {
    for (const step of Object.keys(primitives[group])) {
      const value = primitives[group][step]
      if (!isHex(value)) throw new Error(`原色必须是 hex：color.primitives.${group}.${step} = ${value}`)
      push(`--ts-color-${kebab(group)}-${kebab(step)}`, value)
    }
  }

  const semantic = tokens.color.semantic
  for (const group of Object.keys(semantic)) {
    for (const name of Object.keys(semantic[group])) {
      const raw = semantic[group][name]
      const { value, primitive } = resolveColor(tokens, raw, ['color', 'semantic', group, name])
      const varName = `--ts-color-${kebab(group)}-${kebab(name)}`
      push(varName, value)
      resolvedSemantic[`color.${group}.${name}`] = { value, primitive: primitive ?? null }
    }
  }

  for (const name of Object.keys(tokens.font.families)) {
    push(`--ts-font-${kebab(name)}`, tokens.font.families[name])
  }
  for (const name of Object.keys(tokens.font.sizes)) {
    push(`--ts-fs-${kebab(name)}`, `${tokens.font.sizes[name]}px`)
  }
  for (const name of Object.keys(tokens.font.weights)) {
    push(`--ts-weight-${kebab(name)}`, String(tokens.font.weights[name]))
  }
  for (const name of Object.keys(tokens.font.lineHeights)) {
    push(`--ts-lh-${kebab(name)}`, String(tokens.font.lineHeights[name]))
  }
  for (const name of Object.keys(tokens.font.letterSpacing)) {
    push(`--ts-tracking-${kebab(name)}`, String(tokens.font.letterSpacing[name]))
  }

  const pxGroups = [
    ['space', '--ts-space-'],
    ['radius', '--ts-radius-'],
    ['borderWidth', '--ts-border-'],
    ['size', '--ts-size-'],
  ]
  for (const [group, prefix] of pxGroups) {
    for (const name of Object.keys(tokens[group])) {
      const n = tokens[group][name]
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
        throw new Error(`${group}.${name} 必须是非负数字`)
      }
      push(`${prefix}${kebab(name)}`, `${n}px`)
    }
  }

  for (const name of Object.keys(tokens.shadow)) {
    push(`--ts-shadow-${kebab(name)}`, String(tokens.shadow[name]))
  }
  for (const name of Object.keys(tokens.motion)) {
    push(`--ts-motion-${kebab(name)}`, String(tokens.motion[name]))
  }

  return { vars, resolvedSemantic }
}

/** 是否输出深色块：需 modes.dark 为真且提供 color.semanticDark。 */
export function hasDarkMode(tokens) {
  return tokens?.modes?.dark === true && tokens?.color?.semanticDark != null
}

/**
 * 深色语义变量：与浅色**同名**（--ts-color-组-名），只有值不同，
 * 因此共享的 components.css（全用 var(--ts-color-*)）无需任何改动。
 */
export function flattenDarkSemantic(tokens) {
  const vars = []
  const semantic = tokens?.color?.semanticDark
  if (semantic == null) return vars
  for (const group of Object.keys(semantic)) {
    for (const name of Object.keys(semantic[group])) {
      const raw = semantic[group][name]
      const { value } = resolveColor(tokens, raw, ['color', 'semanticDark', group, name])
      vars.push({ name: `--ts-color-${kebab(group)}-${kebab(name)}`, value })
    }
  }
  return vars
}

/** 生成 tokens.css（确定性：固定顺序、LF、无时间戳）。 */
export function tokensToCss(tokens) {
  const { vars } = flattenTokens(tokens)
  const lines = vars.map((v) => `  ${v.name}: ${v.value};`)
  let css = `/* 由 tokens.json 生成，请勿手改。 */\n:root {\n${lines.join('\n')}\n}\n`
  if (hasDarkMode(tokens)) {
    const darkLines = flattenDarkSemantic(tokens).map((v) => `  ${v.name}: ${v.value};`)
    css += `\n/* 深色模式：给根元素加 class="dark" 即切换。 */\n.dark {\n${darkLines.join('\n')}\n}\n`
  }
  return css
}

/** 生成运行时 manifest（注入与 lint 共用）。 */
export function buildManifest(tokens, { icons, componentClasses, interactionClasses, interactionIds }) {
  const { vars, resolvedSemantic } = flattenTokens(tokens)
  return {
    schema: 'tianshu-design-manifest/1',
    id: tokens.id,
    version: tokens.version,
    vars: vars.map((v) => v.name),
    spacing: Object.values(tokens.space),
    radius: Object.values(tokens.radius),
    fontFamilies: Object.values(tokens.font.families),
    iconNames: [...icons],
    componentClasses: [...componentClasses],
    interactionClasses: [...(interactionClasses ?? [])],
    interactionIds: [...(interactionIds ?? [])],
    resolvedSemantic,
  }
}

/** sRGB 相对亮度。 */
export function luminance(hex) {
  const rgb = parseHex(hex)
  if (!rgb) throw new Error(`无法解析颜色：${hex}`)
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function parseHex(hex) {
  if (typeof hex !== 'string') return null
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6)
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** WCAG 对比度；无法解析时返回 0。 */
export function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}
