/**
 * 从真实代码库导入主题 → token 契约的共享底座。
 *
 * 核心难点：token 契约要求**覆盖内置风格的全部变量名**（designCustom.ts 的
 * assertCoversSharedVars 会逐项检查），而真实仓库只会提供其中一小部分。
 * 因此这里的策略是：
 *   1. 以一份内置风格为模板（形状 + 全部键）；
 *   2. 用仓库观测到的颜色/尺度覆盖模板；
 *   3. 从主色推导剩余的语义色（hover、链接、状态色）；
 *   4. 逐项记录 observed / inferred，绝不把推断冒充导入。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseColor, toCssColor, toHex } from './color.js'
import type { DesignManifest } from '../design.js'
import { parseCssVars } from '../codegen/platforms.js'

export interface ColorSlot {
  /** 契约路径，如 `action.primary`。 */
  path: string
  value: string
  source: 'observed' | 'inferred'
}

export type PrimitiveGroup = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

export interface ImportedTheme {
  /** 观测到的颜色（可以是 primitives 或 semantic 的引用/字面值）。 */
  colors: Record<string, string>
  /** 观测到的尺度（px）。 */
  radii?: Record<string, number>
  space?: Record<string, number>
  fontSizes?: Record<string, number>
  fontFamilies?: { sans?: string; display?: string; mono?: string }
  shadows?: Record<string, string>
}

export interface ImportContext {
  /** 用来取形状与缺省值的内置风格 id。 */
  templateId: string
  builtinDir: string
  name: string
  tagline: string
  /** 是否允许从主色推导缺失语义色（默认 true）。 */
  derive?: boolean
}

export interface MaterializeResult {
  tokens: Record<string, any>
  observed: string[]
  inferred: string[]
  warnings: string[]
}

const HEX_LIKE = /^(?:#|rgb|hsl|oklch|oklab)/i

/**
 * 读取内置风格作为模板。
 *
 * 构建产物里只有 tokens.css + tokens.manifest.json（源码 tokens.json 不随发行包分发），
 * 因此从「变量清单 + CSS 值」反推回 token 结构：
 *  - 语义色用 manifest.resolvedSemantic 的 primitive 引用还原；
 *  - 原色从对应 --ts-color-* 变量取；
 *  - 尺度量去掉 px 转数字，字体族/阴影/动效保留原字符串。
 * 结果保证变量名集合与内置风格完全一致（自定义风格契约要求）。
 */
export function readBuiltinTemplate(builtinDir: string, templateId: string): Record<string, any> {
  const styleDir = join(builtinDir, 'styles', templateId)
  const cssFile = join(styleDir, 'tokens.css')
  const manifestFile = join(styleDir, 'tokens.manifest.json')
  if (!existsSync(cssFile) || !existsSync(manifestFile)) {
    throw new Error(`内置风格模板缺失：${styleDir}`)
  }
  const css = readFileSync(cssFile, 'utf8')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as DesignManifest
  const vars = parseCssVars(css)
  const num = (name: string): number => parseFloat(String(vars[name] ?? '0'))
  const str = (name: string, fallback = ''): string => String(vars[name] ?? fallback)

  const semantic: Record<string, Record<string, string>> = {}
  const primitives: Record<string, Record<string, string>> = {}
  for (const [path, entry] of Object.entries(manifest.resolvedSemantic)) {
    const [, group, name] = path.split('.') as [string, string, string]
    if (entry.primitive) {
      const [pg, ps] = entry.primitive.split('.') as [string, string]
      primitives[pg] = { ...(primitives[pg] ?? {}), [ps]: str(`--ts-color-${pg}-${ps}`, entry.value) }
      semantic[group] = { ...(semantic[group] ?? {}), [name]: entry.primitive }
    } else {
      semantic[group] = { ...(semantic[group] ?? {}), [name]: entry.value }
    }
  }

  const pick = (prefix: string): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const name of Object.keys(vars)) {
      if (name.startsWith(prefix)) out[name.slice(prefix.length)] = vars[name]!
    }
    return out
  }
  const px = (prefix: string): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(pick(prefix))) out[k] = parseFloat(v)
    return out
  }
  const raw = (prefix: string): Record<string, string> => pick(prefix)

  const sizeKeys: Record<string, string> = {}
  for (const v of manifest.vars) {
    if (v.startsWith('--ts-size-')) sizeKeys[v.slice('--ts-size-'.length)] = v
  }

  return {
    schema: 'tianshu-design-tokens/1',
    id: templateId,
    version: 1,
    modes: { light: true, dark: /\.dark\s*\{/.test(css) },
    color: { primitives, semantic },
    font: {
      families: raw('--ts-font-'),
      sizes: px('--ts-fs-'),
      weights: px('--ts-weight-'),
      lineHeights: px('--ts-lh-'),
      letterSpacing: raw('--ts-tracking-'),
    },
    space: px('--ts-space-'),
    radius: px('--ts-radius-'),
    borderWidth: px('--ts-border-'),
    shadow: raw('--ts-shadow-'),
    size: px('--ts-size-'),
    motion: raw('--ts-motion-'),
  }
}

/** 列出内置风格 id（用于选择最接近的模板）。 */
export function listBuiltinIds(builtinDir: string): string[] {
  const dir = join(builtinDir, 'styles')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

/** 相对亮度（WCAG），用于选前景色。 */
function luminanceOf(hex: string): number {
  const rgba = parseColor(hex)
  if (!rgba) return 0
  const [r, g, b] = [rgba.r, rgba.g, rgba.b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastOf(a: string, b: string): number {
  const la = luminanceOf(a)
  const lb = luminanceOf(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 混色：t=0 取 a，t=1 取 b。 */
function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return a
  const ch = (x: number, y: number): number => Math.round(x + (y - x) * t)
  return `#${[ch(ca.r, cb.r), ch(ca.g, cb.g), ch(ca.b, cb.b)].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/** 选取与背景对比度最高的前景（优先 dark/light 候选）。 */
function bestForeground(bg: string, candidates: string[]): string {
  let best = candidates[0] ?? '#ffffff'
  let bestRatio = 0
  for (const c of candidates) {
    const ratio = contrastOf(bg, c)
    if (ratio > bestRatio) {
      bestRatio = ratio
      best = c
    }
  }
  return best
}

/** 把值归一化为 token 可接受的形式：不透明 → #hex，半透明 → rgba()。 */
function normalize(value: string): string | null {
  if (!HEX_LIKE.test(value.trim())) return null
  return toCssColor(value)
}

/**
 * 用仓库主题实例化一份完整 token 契约。
 * 期望的 `theme.colors` 键使用 shadcn 约定（background/foreground/primary/...），
 * 由调用方（适配器）负责把自家命名映射进来。
 */
export function materializeTokens(theme: ImportedTheme, ctx: ImportContext): MaterializeResult {
  const template = readBuiltinTemplate(ctx.builtinDir, ctx.templateId)
  const tokens: Record<string, any> = JSON.parse(JSON.stringify(template))
  const observed: string[] = []
  const inferred: string[] = []
  const warnings: string[] = []
  const derive = ctx.derive !== false

  tokens.schema = 'tianshu-design-tokens/1'
  tokens.id = 'placeholder'
  tokens.version = 1

  const colors = theme.colors
  const pick = (path: string): string | undefined => {
    const raw = colors[path]
    if (raw === undefined) return undefined
    const norm = normalize(raw)
    if (!norm) {
      warnings.push(`颜色值无法解析，已忽略：${path} = ${raw}`)
      return undefined
    }
    return norm
  }

  const background = pick('background')
  const foreground = pick('foreground')
  const primary = pick('primary')
  const primaryForeground = pick('primary-foreground')
  const card = pick('card') ?? pick('popover') ?? background
  const muted = pick('muted')
  const mutedForeground = pick('muted-foreground')
  const border = pick('border')
  const input = pick('input') ?? border
  const ring = pick('ring') ?? primary
  const destructive = pick('destructive')
  const destructiveForeground = pick('destructive-foreground')

  const missingCore = [!background && 'background', !foreground && 'foreground', !primary && 'primary'].filter(Boolean)
  if (missingCore.length) {
    warnings.push(`仓库主题缺少核心颜色：${missingCore.join('、')}；这些位置将使用模板默认值。`)
  }

  const bgCanvas = background ?? (pick('secondary') as string)
  const bgSurface = card
  const textPrimary = foreground
  const actionPrimary = primary
  const actionPrimaryText = primaryForeground ?? (actionPrimary ? bestForeground(actionPrimary, ['#ffffff', '#000000']) : undefined)

  /** 写 primitive + semantic 引用，并记录来源。 */
  const setSemantic = (path: string, value: string | undefined, source: 'observed' | 'inferred', primitive?: string): void => {
    if (!value) return
    const [group, name] = path.split('.') as [string, string]
    if (primitive) {
      const [pg, ps] = primitive.split('.') as [string, string]
      tokens.color.primitives[pg] = { ...(tokens.color.primitives[pg] ?? {}), [ps]: value }
      tokens.color.semantic[group][name] = primitive
    } else {
      tokens.color.semantic[group][name] = value
    }
    ;(source === 'observed' ? observed : inferred).push(`color.${path}`)
  }

  // 中性色：观测到几个就写几个，用它们拼出 0/50/100/200/300/500/700/900。
  const neutral: Record<string, string> = { ...(template.color?.primitives?.neutral ?? {}) }
  if (background) neutral['50'] = background
  if (card) neutral['0'] = card
  if (muted) neutral['100'] = muted
  if (border) neutral['200'] = border
  if (input) neutral['300'] = input
  if (mutedForeground) neutral['500'] = mutedForeground
  if (foreground) {
    neutral['900'] = foreground
    neutral['700'] = mix(foreground, background ?? '#ffffff', 0.3)
  }
  const neutralObserved = background || foreground || muted || border
  if (neutralObserved) {
    tokens.color.primitives.neutral = neutral
    observed.push('color.primitives.neutral')
    if (!foreground) inferred.push('color.primitives.neutral.700')
    if (!mutedForeground) inferred.push('color.primitives.neutral.500')
  }

  // 品牌色：主色观测 + 其余步进由混色推导。
  if (actionPrimary) {
    tokens.color.primitives.brand = {
      100: mix(actionPrimary, '#ffffff', 0.88),
      300: mix(actionPrimary, '#ffffff', 0.5),
      500: actionPrimary,
      600: mix(actionPrimary, '#000000', 0.12),
      700: mix(actionPrimary, '#000000', 0.25),
    }
    observed.push('color.primitives.brand.500')
    inferred.push('color.primitives.brand.100', 'color.primitives.brand.300', 'color.primitives.brand.600', 'color.primitives.brand.700')
  }

  if (destructive) {
    tokens.color.primitives.danger = {
      50: mix(destructive, '#ffffff', 0.88),
      500: destructive,
    }
    observed.push('color.primitives.danger.500')
    inferred.push('color.primitives.danger.50')
  }

  // 语义映射：观测到的一律 observed，推导的进 inferred。
  setSemantic('bg.canvas', bgCanvas, background ? 'observed' : 'inferred')
  setSemantic('bg.surface', bgSurface, card ? 'observed' : 'inferred')
  if (bgSurface !== undefined) setSemantic('bg.raised', bgSurface, card ? 'observed' : 'inferred')
  setSemantic('bg.sunken', pick('secondary') ?? muted, pick('secondary') || muted ? 'observed' : 'inferred')
  if (foreground) setSemantic('bg.inverse', pick('inverse') ?? undefined, 'observed')

  setSemantic('text.primary', textPrimary, foreground ? 'observed' : 'inferred')
  setSemantic('text.secondary', mutedForeground ? mix(mutedForeground, textPrimary ?? '#000000', 0.35) : undefined, mutedForeground ? 'inferred' : 'inferred')
  setSemantic('text.muted', mutedForeground, mutedForeground ? 'observed' : 'inferred')
  setSemantic('text.inverse', pick('primary-foreground') ?? undefined, primaryForeground ? 'observed' : 'inferred')
  setSemantic('text.link', pick('link') ?? actionPrimary, colors['link'] ? 'observed' : 'inferred')

  setSemantic('border.default', border, border ? 'observed' : 'inferred')
  setSemantic('border.strong', border ? mix(border, textPrimary ?? '#000000', 0.35) : undefined, 'inferred')
  setSemantic('border.subtle', muted, muted ? 'observed' : 'inferred')
  setSemantic('border.focus', ring, ring ? 'observed' : 'inferred')

  setSemantic('action.primary', actionPrimary, primary ? 'observed' : 'inferred')
  setSemantic('action.primaryHover', actionPrimary ? mix(actionPrimary, '#000000', 0.12) : undefined, 'inferred')
  setSemantic('action.primaryText', actionPrimaryText, primaryForeground ? 'observed' : 'inferred')
  setSemantic('action.secondary', muted, muted ? 'observed' : 'inferred')
  setSemantic('action.secondaryHover', muted ? mix(muted, border ?? '#d4d4d8', 0.6) : undefined, 'inferred')
  setSemantic('action.secondaryText', textPrimary, foreground ? 'observed' : 'inferred')
  setSemantic('action.ghostHover', muted, muted ? 'observed' : 'inferred')
  setSemantic('action.danger', destructive, destructive ? 'observed' : 'inferred')
  setSemantic('action.dangerText', destructiveForeground ?? (destructive ? bestForeground(destructive, ['#ffffff', '#000000']) : undefined), destructive ? (destructiveForeground ? 'observed' : 'inferred') : 'inferred')

  // 状态色：仓库通常不提供；从主色/危险色推导，并标注 inferred。
  const success = pick('success')
  const warning = pick('warning')
  const info = pick('info')
  for (const [name, value, fallback] of [
    ['success', success, derive ? '#16a34a' : undefined],
    ['warning', warning, derive ? '#d97706' : undefined],
    ['danger', destructive, derive ? '#dc2626' : undefined],
    ['info', info, derive ? actionPrimary : undefined],
  ] as const) {
    if (!value && !fallback) continue
    const solid = value ?? fallback!
    const soft = mix(solid, '#ffffff', 0.88)
    tokens.color.primitives[name] = { 50: soft, 500: solid }
    if (value) observed.push(`color.primitives.${name}.500`)
    else inferred.push(`color.primitives.${name}`)
    tokens.color.semantic.status[`${name}`] = `${name}.500`
    tokens.color.semantic.status[`${name}Bg`] = `${name}.50`
  }

  // 圆角：观测到 --radius 就按比例生成。
  const radiusBase = theme.radii?.DEFAULT ?? theme.radii?.md
  if (radiusBase !== undefined) {
    const r = Math.round(radiusBase)
    tokens.radius = {
      none: 0,
      sm: Math.max(2, Math.round(r * 0.6)),
      md: r,
      lg: Math.round(r * 1.4),
      xl: Math.round(r * 2),
      full: 9999,
    }
    observed.push('radius.md')
    inferred.push('radius.sm', 'radius.lg', 'radius.xl')
  }
  if (theme.radii) {
    for (const [key, value] of Object.entries(theme.radii)) {
      if (key === 'none' || key === 'full' || value === undefined) continue
      if (key in tokens.radius && tokens.radius[key] === value) continue
      const target = /^\d+$/.test(key) ? key : key
      if (target in tokens.radius && theme.radii.DEFAULT !== undefined) continue
    }
  }

  if (theme.space) {
    const entries = Object.entries(theme.space)
      .filter(([, v]) => typeof v === 'number' && v >= 0)
      .sort((a, b) => (a[1] as number) - (b[1] as number))
    if (entries.length >= 3) {
      const scale = Object.keys(template.space)
      const values = entries.map(([, v]) => Math.round(v as number))
      const next: Record<string, number> = {}
      scale.forEach((key, index) => {
        next[key] = values[Math.min(index, values.length - 1)]!
      })
      // 保证严格递增（契约要求）。
      const keys = Object.keys(next)
      for (let i = 1; i < keys.length; i++) {
        const prev = next[keys[i - 1]!]!
        if (next[keys[i]!]! <= prev) next[keys[i]!] = prev + 1
      }
      tokens.space = next
      observed.push('space')
    }
  }

  if (theme.fontSizes) {
    const keys = Object.keys(template.font.sizes)
    const values = Object.values(theme.fontSizes).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b)
    if (values.length >= 3) {
      keys.forEach((key, index) => {
        tokens.font.sizes[key] = Math.round(values[Math.min(index, values.length - 1)]!)
      })
      const ks = Object.keys(tokens.font.sizes)
      for (let i = 1; i < ks.length; i++) {
        const prev = tokens.font.sizes[ks[i - 1]!]!
        if (tokens.font.sizes[ks[i]!]! <= prev) tokens.font.sizes[ks[i]!] = prev + 1
      }
      observed.push('font.sizes')
    }
  }

  for (const family of ['sans', 'display', 'mono'] as const) {
    const value = theme.fontFamilies?.[family]
    if (value) {
      tokens.font.families[family] = value
      observed.push(`font.families.${family}`)
    }
  }

  if (theme.shadows) {
    for (const key of ['sm', 'md', 'lg'] as const) {
      const value = theme.shadows[key]
      if (value) {
        tokens.font
        tokens.shadow[key] = value
        observed.push(`shadow.${key}`)
      }
    }
  }

  tokens.modes = { light: true, dark: template.modes?.dark === true }

  // 对比度兜底：正文/主按钮文字不足 4.5 时改用黑/白，并记录为推断。
  const fixContrast = (fgPath: string, bgPath: string): void => {
    const semantic = tokens.color.semantic
    const resolve = (path: string): string | null => {
      const [g, n] = path.split('.') as [string, string]
      const raw = semantic[g]?.[n]
      if (typeof raw !== 'string') return null
      if (raw.includes('.')) {
        const [pg, ps] = raw.split('.') as [string, string]
        return tokens.color.primitives[pg]?.[ps] ?? null
      }
      return raw
    }
    const fg = resolve(fgPath)
    const bg = resolve(bgPath)
    if (!fg || !bg) return
    if (contrastOf(fg, bg) >= 4.5) return
    const replacement = bestForeground(bg, ['#ffffff', '#000000'])
    const [g, n] = fgPath.split('.') as [string, string]
    semantic[g][n] = replacement
    inferred.push(`color.${fgPath}（对比度修正）`)
    warnings.push(`${fgPath} 与 ${bgPath} 对比度不足 4.5，已改为 ${replacement}`)
  }
  fixContrast('text.primary', 'bg.canvas')
  fixContrast('text.secondary', 'bg.canvas')
  fixContrast('action.primaryText', 'action.primary')

  if (!tokens.color.semanticDark) delete tokens.modes.dark

  return { tokens, observed: [...new Set(observed)], inferred: [...new Set(inferred)], warnings }
}

/** 归一化一个颜色字面值（适配器用于读取 CSS 变量时）。 */
export function normalizeColor(value: string): string | null {
  return toCssColor(value)
}

/** 判断一个值是否是可用的不透明色。 */
export function isOpaqueHex(value: string): boolean {
  return toHex(value) !== null
}
