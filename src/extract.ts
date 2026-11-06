/**
 * 设计系统反抽取：从已有 HTML/CSS（或一个 URL）反推出一套能满足**严格 token 契约**的
 * 设计系统，直接交给 createCustomStyle 校验并写盘。
 *
 * 为什么落在插件侧做：token 契约有 116 个变量、含对比度与尺度递增校验，让模型「凭感觉」
 * 手写极易失败；确定性映射 + 缺键补齐 + 对比度后处理才能保证一次通过 validateTokens。
 *
 * 设计原则：
 *  - **确定性**：同输入必须同输出（不依赖 Math.random / 时间 / 对象遍历顺序）。
 *  - **可观测优先**：能从源码读到的值标 `observed`，补出来的标 `synthesized`，如实上报。
 *  - **契约优先**：键集合固定镜像契约，样本不足时用内置确定性回退值，绝不产出缺键。
 */
import { existsSync, readFileSync } from 'node:fs'
import { contrast, parseHex } from '../scripts/design/design-tokens.mjs'
import { declarations, styleSegments, SPACING_PROPS, RADIUS_PROP } from './cssParse.js'
import { findBlockedResources } from './resources.js'
import { fetchText, type FetchOptions } from './netFetch.js'

export interface ExtractInput {
  /** 内联 HTML 或 CSS 文本（最高优先）。 */
  source?: string
  /** 工作区内文件绝对路径（已过路径守卫）。 */
  file?: string
  /** 远程 URL（SSRF 安全抓取）。 */
  url?: string
  /** 测试注入。 */
  fetchImpl?: FetchOptions['fetchImpl']
}

export interface ExtractResult {
  tokens: Record<string, unknown>
  iconStyle: { strokeWidth: number; linecap: string; linejoin: string }
  /** 人读报告（分组一行）。 */
  report: string[]
  warnings: string[]
  observed: number
  synthesized: number
}

// ---------------------------------------------------------------------------
// 契约键集合（镜像 scripts/design/design-validate.mjs；顺序固定以保证确定性）
// ---------------------------------------------------------------------------

const NEUTRAL_KEYS = ['0', '50', '100', '200', '300', '500', '700', '900'] as const
const BRAND_KEYS = ['100', '300', '500', '600', '700'] as const
const STATUS_KEYS = ['50', '500'] as const
const STATUS_GROUPS = ['success', 'warning', 'danger', 'info'] as const

const SEMANTIC = {
  bg: ['canvas', 'surface', 'raised', 'sunken', 'inverse'],
  text: ['primary', 'secondary', 'muted', 'inverse', 'link'],
  border: ['default', 'strong', 'subtle', 'focus'],
  action: ['primary', 'primaryHover', 'primaryText', 'secondary', 'secondaryHover', 'secondaryText', 'ghostHover', 'danger', 'dangerText'],
  status: ['success', 'successBg', 'warning', 'warningBg', 'danger', 'dangerBg', 'info', 'infoBg'],
  chart: ['1', '2', '3', '4', '5'],
  overlay: ['scrim'],
} as const

const SPACE_KEYS = ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16'] as const
const RADIUS_KEYS = ['none', 'sm', 'md', 'lg', 'xl', 'full'] as const
const SIZE_KEYS = ['controlSm', 'controlMd', 'controlLg', 'iconSm', 'iconMd', 'iconLg', 'containerSm', 'containerMd', 'containerLg', 'sidebar'] as const

/** 内置确定性回退值（不含任何被禁标识）。 */
const FALLBACK = {
  neutral: ['#ffffff', '#fafafa', '#f4f4f5', '#e4e4e7', '#d4d4d8', '#71717a', '#3f3f46', '#18181b'],
  brand500: '#2563eb',
  status: { success: '#15803d', warning: '#b45309', danger: '#dc2626', info: '#1d4ed8' } as Record<string, string>,
  fontSizes: [11, 12, 14, 17, 21, 26, 34, 48],
  space: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64],
  radius: [0, 6, 10, 14, 20, 9999],
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.04)',
    md: '0 4px 16px rgba(0,0,0,0.08)',
    lg: '0 12px 40px rgba(0,0,0,0.12)',
  } as Record<string, string>,
  families: {
    sans: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    display: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  } as Record<string, string>,
}

// ---------------------------------------------------------------------------
// 颜色工具
// ---------------------------------------------------------------------------

interface Rgb {
  r: number
  g: number
  b: number
}

function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** 解析 #rgb/#rrggbb/#rrggbbaa 或 rgb()/rgba()/hsl()/hsla() 为 {r,g,b}。 */
export function parseColor(value: string): Rgb | null {
  const text = value.trim()
  const hex = parseHex(text)
  if (hex) return { r: hex[0]!, g: hex[1]!, b: hex[2]! }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text)
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(text)
  if (hsl) {
    const [h, s, l] = [Number(hsl[1]) / 360, Number(hsl[2]) / 100, Number(hsl[3]) / 100]
    return hslToRgb(h, s, l)
  }
  return null
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = l * 255
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number): number => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255 }
}

/** 由 rgb 求 HSL：h∈[0,1) s∈[0,1] l∈[0,1]。 */
function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6
  else if (max === gg) h = ((bb - rr) / d + 2) / 6
  else h = ((rr - gg) / d + 4) / 6
  return { h, s, l }
}

function luminanceOf(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** 把 fg 沿远离 bg 的方向推进，直到对比度达标（有限步必然收敛）。 */
function ensureContrast(fgHex: string, bgHex: string, min: number): string {
  const bgLum = luminanceOf(bgHex)
  const darken = bgLum > 0.5
  let current = parseColor(fgHex)
  if (!current) return fgHex
  for (let i = 0; i < 200; i++) {
    if (contrast(toHex(current), bgHex) >= min) break
    const step = darken ? -6 : 6
    current = { r: current.r + step, g: current.g + step, b: current.b + step }
    if (current.r <= 0 && current.g <= 0 && current.b <= 0) break
    if (current.r >= 255 && current.g >= 255 && current.b >= 255) break
  }
  return toHex(current)
}

function mix(aHex: string, bHex: string, t: number): string {
  const a = parseColor(aHex)!
  const b = parseColor(bHex)!
  return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t })
}

function darken(hex: string, amount: number): string {
  return mix(hex, '#000000', amount)
}

// ---------------------------------------------------------------------------
// 抽取
// ---------------------------------------------------------------------------

interface Candidate {
  hex: string
  weight: number
}

interface Analysis {
  colors: Candidate[]
  fontSizes: number[]
  radii: number[]
  spaces: number[]
  families: string[]
  shadows: string[]
  weights: number[]
  iconStroke: number | null
}

const COLOR_HINT = /\b(?:color|background|border|fill|stroke|shadow|outline|accent|caret)\b/i
const COLOR_FN = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/gi
/** 非全局版本：`.test()` 不会推进 lastIndex（复用全局正则会漏判）。 */
const COLOR_FN_TEST = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/i
const READABLE_SELECTOR = /(?:^|[\s,{])(?:body|html|:root|\.btn|\.button|button|\.primary|\.link|a)\b/i

/** 从一段 CSS 文本里收集候选值。`weightBoost` 用于对关键选择器加权。 */
function collectFromCss(css: string, into: Analysis, weightBoost = 1): void {
  // styleSegments 只认 <style>/style= 包裹的 CSS。纯 CSS 文本（无 HTML 外壳）会返回空，
  // 此时整段按 CSS 处理，否则 .css 文件/内联 CSS 会被当成「没有可用声明」。
  const segments = styleSegments(css)
  const sources = segments.length ? segments : [{ start: 0, text: css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) }]
  for (const segment of sources) {
    const boost = READABLE_SELECTOR.test(segment.text) ? weightBoost * 3 : weightBoost
    for (const decl of declarations(segment.text)) {
      const prop = decl.prop
      if (COLOR_HINT.test(prop) || COLOR_FN_TEST.test(decl.raw)) {
        for (const match of decl.raw.matchAll(COLOR_FN)) {
          const rgb = parseColor(match[0])
          if (rgb) into.colors.push({ hex: toHex(rgb), weight: boost })
        }
      }
      if (prop === 'font-size') {
        const px = firstPx(decl.value)
        if (px !== null) into.fontSizes.push(px)
      } else if (RADIUS_PROP.test(prop)) {
        for (const px of pxList(decl.value)) into.radii.push(px)
      } else if (SPACING_PROPS.test(prop)) {
        for (const px of pxList(decl.value)) if (px > 0) into.spaces.push(px)
      } else if (prop === 'font-family') {
        const first = decl.value.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '')
        if (first) into.families.push(decl.value.trim())
      } else if (prop === 'box-shadow' && !/url\(|@import|https?:/i.test(decl.value)) {
        into.shadows.push(decl.value)
      } else if (prop === 'font-weight') {
        const w = Number(decl.value)
        if (Number.isFinite(w) && w >= 100 && w <= 900) into.weights.push(w)
      }
      const stroke = /^stroke-width$/.test(prop) ? /([\d.]+)/.exec(decl.value) : null
      if (stroke) into.iconStroke = Number(stroke[1])
    }
  }
}

function firstPx(value: string): number | null {
  const list = pxList(value)
  return list.length ? list[0]! : null
}

function pxList(value: string): number[] {
  if (/calc\(/i.test(value)) return []
  const found: number[] = []
  for (const match of value.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px\b/g)) found.push(Number(match[1]))
  return found
}

/** 从 HTML 里抽 <style>/style= 与 <link rel=stylesheet> 的 href。 */
function collectFromHtml(html: string): { css: string; links: string[] } {
  const links: string[] = []
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    if (/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(match[0])) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0])
      const ref = (href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim()
      if (ref) links.push(ref)
    }
  }
  return { css: html, links }
}

/** 收集素材：返回 CSS 文本与外部样式表引用。 */
async function gather(input: ExtractInput, warnings: string[]): Promise<{ cssText: string; htmlText: string | null }> {
  let htmlText: string | null = null
  let cssText = ''
  if (typeof input.source === 'string' && input.source.trim()) {
    if (/<[a-z!/]/i.test(input.source)) htmlText = input.source
    else cssText = input.source
  } else if (input.file) {
    if (!existsSync(input.file)) throw new Error(`文件不存在：${input.file}`)
    const text = readFileSync(input.file, 'utf8')
    if (/\.css$/i.test(input.file) || !/<[a-z!/]/i.test(text)) cssText = text
    else htmlText = text
  } else if (input.url) {
    const result = await fetchText(input.url, { fetchImpl: input.fetchImpl })
    htmlText = result.text
  } else {
    throw new Error('缺少输入：请提供 source（内联 HTML/CSS）、file（文件路径）或 url。')
  }

  const parts: string[] = []
  if (cssText) parts.push(cssText)
  if (htmlText) {
    const { css, links } = collectFromHtml(htmlText)
    parts.push(css)
    // 抓取最多 3 个外部样式表（相对路径按页面 URL 解析）。
    const base = input.url
    for (const href of links.slice(0, 3)) {
      try {
        const abs = base ? new URL(href, base).toString() : href
        if (!/^https?:/i.test(abs)) continue
        const res = await fetchText(abs, { fetchImpl: input.fetchImpl })
        parts.push(res.text)
      } catch (err) {
        warnings.push(`外部样式表抓取失败：${href}（${(err as Error).message}）`)
      }
    }
  }
  return { cssText: parts.join('\n'), htmlText }
}

// ---------------------------------------------------------------------------
// 色阶构造
// ---------------------------------------------------------------------------

/** 按亮度从浅到深排序、去重的中性色。 */
function neutralRamp(colors: Candidate[]): { hex: string; observed: boolean }[] {
  const observed = new Map<string, number>()
  for (const c of colors) {
    const hsl = rgbToHsl(parseColor(c.hex)!)
    if (hsl.s < 0.12) observed.set(c.hex, (observed.get(c.hex) ?? 0) + c.weight)
  }
  const unique = [...observed.keys()].sort((a, b) => luminanceOf(b) - luminanceOf(a))
  if (unique.length >= 8) {
    // 取分位数，保证确定性。
    const picked = NEUTRAL_KEYS.map((_, i) => unique[Math.round((i * (unique.length - 1)) / (NEUTRAL_KEYS.length - 1))]!)
    return picked.map((hex) => ({ hex, observed: true }))
  }
  if (unique.length >= 2) {
    // 以最浅/最深为锚点，中间线性插值。
    const light = unique[0]!
    const dark = unique[unique.length - 1]!
    return NEUTRAL_KEYS.map((_, i) => {
      if (i === 0) return { hex: light, observed: true }
      if (i === NEUTRAL_KEYS.length - 1) return { hex: dark, observed: true }
      const t = i / (NEUTRAL_KEYS.length - 1)
      return { hex: mix(light, dark, t), observed: false }
    })
  }
  return FALLBACK.neutral.map((hex) => ({ hex, observed: false }))
}

/** 按色相带挑出状态色；缺失用回退值。 */
function pickStatus(colors: Candidate[]): Record<string, { hex: string; observed: boolean }> {
  const bands: Record<string, [number, number]> = {
    success: [80, 170],
    warning: [30, 70],
    danger: [330, 360],
    info: [180, 260],
  }
  const out: Record<string, { hex: string; observed: boolean }> = {}
  for (const group of STATUS_GROUPS) {
    const [lo, hi] = bands[group]!
    const inBand = colors.filter((c) => {
      const hsl = rgbToHsl(parseColor(c.hex)!)
      if (hsl.s < 0.2 || hsl.l > 0.8 || hsl.l < 0.15) return false
      const deg = hsl.h * 360
      return group === 'danger' ? deg >= lo || deg <= 20 : deg >= lo && deg <= hi
    })
    if (inBand.length) {
      const best = inBand.sort((a, b) => b.weight - a.weight || a.hex.localeCompare(b.hex))[0]!
      out[group] = { hex: best.hex, observed: true }
    } else {
      out[group] = { hex: FALLBACK.status[group]!, observed: false }
    }
  }
  return out
}

function pickBrand(colors: Candidate[]): { hex: string; observed: boolean } {
  const colored = colors.filter((c) => {
    const hsl = rgbToHsl(parseColor(c.hex)!)
    return hsl.s >= 0.2 && hsl.l > 0.15 && hsl.l < 0.8
  })
  if (!colored.length) return { hex: FALLBACK.brand500, observed: false }
  const best = colored.sort((a, b) => b.weight - a.weight || a.hex.localeCompare(b.hex))[0]!
  return { hex: best.hex, observed: true }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

export async function extractTokens(input: ExtractInput): Promise<ExtractResult> {
  const warnings: string[] = []
  const { cssText, htmlText } = await gather(input, warnings)
  if (!cssText.trim()) warnings.push('未从输入中解析到任何 CSS；将生成一套中性默认设计系统。')

  const analysis: Analysis = { colors: [], fontSizes: [], radii: [], spaces: [], families: [], shadows: [], weights: [], iconStroke: null }
  collectFromCss(cssText, analysis)
  if (analysis.colors.length === 0 && analysis.fontSizes.length === 0) {
    warnings.push('未解析到任何颜色或字号声明；将生成一套中性默认设计系统（可在返回的 tokens 基础上再调）。')
  }

  let observed = 0
  let synthesized = 0
  const report: string[] = []
  const mark = (isObserved: boolean): string => {
    if (isObserved) {
      observed++
      return 'observed'
    }
    synthesized++
    return 'synthesized'
  }

  // 1) 中性色阶
  const neutral = neutralRamp(analysis.colors)
  const neutralHex = neutral.map((n) => n.hex)
  for (const n of neutral) mark(n.observed)
  report.push(`neutral  ${NEUTRAL_KEYS.map((k, i) => `${k}=${neutralHex[i]}`).join(' ')}`)

  // 2) 品牌色与状态色
  const brand = pickBrand(analysis.colors)
  mark(brand.observed)
  const brandScale: Record<string, string> = {
    '100': mix(brand.hex, '#ffffff', 0.85),
    '300': mix(brand.hex, '#ffffff', 0.45),
    '500': brand.hex,
    '600': darken(brand.hex, 0.08),
    '700': darken(brand.hex, 0.18),
  }
  report.push(`brand    500=${brandScale['500']}（${brand.observed ? 'observed' : 'synthesized'}）`)

  const status = pickStatus(analysis.colors)
  const statusScale: Record<string, Record<string, string>> = {}
  for (const group of STATUS_GROUPS) {
    const base = status[group]!
    mark(base.observed)
    statusScale[group] = { '50': mix(base.hex, '#ffffff', 0.9), '500': base.hex }
  }
  report.push(`status   ${STATUS_GROUPS.map((g) => `${g}=${statusScale[g]!['500']}`).join(' ')}`)

  // 3) 深浅判定：以最高频背景倾向决定浅色/深色语义映射。
  const isDark = luminanceOf(neutralHex[NEUTRAL_KEYS.length - 1]!) > 0.4 && luminanceOf(neutralHex[0]!) < 0.25
  const lightEnd = isDark ? neutralHex[0]! : neutralHex[0]!
  const darkEnd = isDark ? neutralHex[NEUTRAL_KEYS.length - 1]! : neutralHex[NEUTRAL_KEYS.length - 1]!

  // 4) 对比度后处理：调整中性端与品牌主色，确保 semantic 达标。
  const bgCanvas = isDark ? darkEnd : lightEnd
  const bgSurface = isDark ? mix(darkEnd, '#000000', 0.15) : '#ffffff'
  const textPrimaryRaw = isDark ? mix(lightEnd, '#ffffff', 0.6) : mix(darkEnd, '#000000', 0.1)
  const textPrimary = ensureContrast(textPrimaryRaw, bgCanvas, 4.5)
  const textPrimaryFixed = ensureContrast(textPrimary, bgSurface, 4.5)
  const textSecondary = ensureContrast(mix(textPrimaryFixed, bgCanvas, 0.25), bgCanvas, 4.5)
  const textMuted = ensureContrast(mix(textPrimaryFixed, bgCanvas, 0.5), bgCanvas, 3)
  const actionPrimary = ensureContrast(brandScale['500']!, isDark ? '#111111' : '#ffffff', 4.5)

  // 5) 语义色：全部用原色引用，保证可解析。
  const primitive = (group: string, step: string): string => `${group}.${step}`
  // 把调整后的关键色写回原色阶（保持引用可解析）。
  neutralHex[NEUTRAL_KEYS.indexOf(isDark ? '900' : '0')] = isDark ? bgSurface : '#ffffff'
  neutralHex[NEUTRAL_KEYS.indexOf(isDark ? '0' : '900')] = isDark ? textPrimaryFixed : textPrimaryFixed
  neutralHex[NEUTRAL_KEYS.indexOf('700')] = textSecondary
  neutralHex[NEUTRAL_KEYS.indexOf('500')] = textMuted
  brandScale['500'] = actionPrimary
  brandScale['600'] = darken(actionPrimary, 0.08)

  // 6) 非颜色组：观测优先，不足用确定性回退（保证递增与正数）。
  const sizeRamp = analysis.fontSizes.filter((n) => n > 0).sort((a, b) => a - b)
  const uniqSizes = [...new Set(sizeRamp)]
  let sizes: number[]
  if (uniqSizes.length >= 4) {
    const picked = FALLBACK.fontSizes.map((d, i) => uniqSizes[Math.round((i * (uniqSizes.length - 1)) / (FALLBACK.fontSizes.length - 1))] ?? d)
    // 去重并保证递增。
    sizes = monotonic(picked, FALLBACK.fontSizes)
    mark(true)
  } else {
    sizes = FALLBACK.fontSizes
    mark(false)
  }
  report.push(`fontSize ${sizes.join(' ')}`)

  const radiiRaw = [...new Set(analysis.radii.filter((n) => n >= 0))].sort((a, b) => a - b)
  const radius = monotonic(
    radiiRaw.length >= 3 ? RADIUS_KEYS.map((_, i) => radiiRaw[Math.min(radiiRaw.length - 1, Math.round(((i + 1) / RADIUS_KEYS.length) * radiiRaw.length)) ] ?? FALLBACK.radius[i]!) : FALLBACK.radius,
    FALLBACK.radius,
  )
  radius[RADIUS_KEYS.length - 1] = 9999
  report.push(`radius   ${RADIUS_KEYS.map((k, i) => `${k}=${radius[i]}`).join(' ')}`)

  const spaceUnit = analysis.spaces.length ? Math.min(Math.max(Math.min(...analysis.spaces), 2), 8) : 4
  const space = FALLBACK.space.map((v, i) => (i === 0 ? 0 : Math.round((v * spaceUnit) / 4)))
  report.push(`space    ${SPACE_KEYS.map((k, i) => `${k}=${space[i]}`).join(' ')}`)

  const families = pickFamilies(analysis.families)
  const weightSet = pickWeights(analysis.weights)
  const shadow = analysis.shadows.length >= 1 ? buildShadows(analysis.shadows) : FALLBACK.shadow
  const iconStroke = analysis.iconStroke !== null ? Math.max(1, Math.min(2, analysis.iconStroke)) : 1.5

  // 7) 组装 tokens（键序固定）。
  const tokens = {
    primitiveColors: {
      neutral: zip(NEUTRAL_KEYS, neutralHex),
      brand: zip(BRAND_KEYS, BRAND_KEYS.map((k) => brandScale[k]!)),
      ...Object.fromEntries(STATUS_GROUPS.map((g) => [g, zip(STATUS_KEYS, STATUS_KEYS.map((k) => statusScale[g]![k]!))])),
    },
    semantic: buildSemantic({
      isDark,
      neutral: neutralHex,
      brand: brandScale,
      status: statusScale,
      primitive,
    }),
    font: {
      families,
      sizes: zip(FALLBACK.fontSizes.map((_, i) => ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'][i]!), sizes),
      weights: weightSet,
      lineHeights: { tight: 1.15, snug: 1.3, normal: 1.45, relaxed: 1.65 },
      letterSpacing: { tight: '-0.02em', normal: '0', wide: '0.06em' },
    },
    space: zip(SPACE_KEYS, space),
    radius: zip(RADIUS_KEYS, radius),
    borderWidth: { hairline: 1, thin: 1.5, thick: 2 },
    shadow,
    size: zip(SIZE_KEYS, [28, 36, 44, 14, 18, 22, 640, 960, 1200, 248]),
    motion: { fast: '120ms', base: '200ms', easing: 'cubic-bezier(.2,.7,.3,1)' },
  }

  // 8) 组装最终契约结构（schema/id 由 createCustomStyle 补齐）。
  const out: Record<string, unknown> = {
    color: { primitives: tokens.primitiveColors, semantic: tokens.semantic },
    font: tokens.font,
    space: tokens.space,
    radius: tokens.radius,
    borderWidth: tokens.borderWidth,
    shadow: tokens.shadow,
    size: tokens.size,
    motion: tokens.motion,
  }

  report.push(`对比度：text.primary/bg.canvas=${contrast(textPrimaryFixed, bgCanvas).toFixed(2)}，action.primaryText/action.primary=${contrast('#ffffff', actionPrimary).toFixed(2)}`)

  if (htmlText) {
    const blocked = findBlockedResources(htmlText)
    if (blocked.length) warnings.push(`源页面有 ${blocked.length} 处外链资源（不影响风格抽取，但用于原型时需内联）。`)
  }

  return {
    tokens: out,
    iconStyle: { strokeWidth: iconStroke, linecap: 'round', linejoin: 'round' },
    report,
    warnings,
    observed,
    synthesized,
  }
}

/** 保证数值严格递增（用于 space/radius）。 */
function monotonic(values: number[], fallback: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < values.length; i++) {
    const candidate = Number.isFinite(values[i]) && values[i]! > 0 ? Math.round(values[i]!) : Math.round(fallback[i] ?? i + 1)
    const prev = out[out.length - 1]
    out.push(prev === undefined || candidate > prev ? candidate : prev + Math.max(1, Math.round(candidate * 0.1)))
  }
  return out
}

function zip(keys: readonly string[], values: number[] | string[]): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  keys.forEach((k, i) => {
    out[k] = values[i]!
  })
  return out
}

function pickFamilies(observed: string[]): Record<string, string> {
  const sans = observed[0] ?? FALLBACK.families.sans!
  const monoObserved = observed.find((f) => /mono|consol|menlo|courier/i.test(f))
  return { sans, display: sans, mono: monoObserved ?? FALLBACK.families.mono! }
}

function pickWeights(observed: number[]): Record<string, number> {
  const has = (w: number): boolean => observed.some((o) => Math.abs(o - w) <= 50)
  return {
    regular: has(400) ? 400 : 400,
    medium: observed.find((o) => o >= 450 && o <= 550) ?? 500,
    semibold: observed.find((o) => o >= 560 && o <= 640) ?? 600,
    bold: observed.find((o) => o >= 650) ?? 700,
  }
}

function buildShadows(observed: string[]): Record<string, string> {
  const clean = observed.filter((s) => !/url\(|@import|https?:/i.test(s))
  const pick = (i: number): string => clean[Math.min(i, clean.length - 1)] ?? FALLBACK.shadow[['sm', 'md', 'lg'][i]!]!
  return { sm: pick(0), md: pick(1), lg: pick(2) }
}

/** 组装语义色映射；全部使用原色引用以降低解析失败风险。 */
function buildSemantic(ctx: {
  isDark: boolean
  neutral: string[]
  brand: Record<string, string>
  status: Record<string, Record<string, string>>
  primitive: (group: string, step: string) => string
}): Record<string, Record<string, string>> {
  const n = (step: string): string => ctx.primitive('neutral', step)
  const b = (step: string): string => ctx.primitive('brand', step)
  const s = (group: string, step: string): string => ctx.primitive(group, step)
  const N = ctx.neutral
  const light = (i: number): string => n(NEUTRAL_KEYS[i]!)
  const D = ctx.isDark
  return {
    bg: {
      canvas: D ? light(NEUTRAL_KEYS.length - 1) : light(0),
      surface: D ? light(NEUTRAL_KEYS.length - 2) : light(0),
      raised: D ? light(NEUTRAL_KEYS.length - 2) : light(0),
      sunken: D ? light(0) : light(2),
      inverse: D ? light(0) : light(NEUTRAL_KEYS.length - 1),
    },
    text: {
      primary: D ? light(0) : light(NEUTRAL_KEYS.length - 1),
      secondary: n('700'),
      muted: n('500'),
      inverse: D ? light(NEUTRAL_KEYS.length - 1) : light(0),
      link: b('500'),
    },
    border: {
      default: D ? light(3) : light(3),
      strong: D ? light(2) : light(4),
      subtle: D ? light(4) : light(2),
      focus: b('500'),
    },
    action: {
      primary: b('500'),
      primaryHover: b('600'),
      primaryText: D ? n('900') : n('0'),
      secondary: D ? light(2) : light(2),
      secondaryHover: D ? light(3) : light(3),
      secondaryText: D ? light(0) : light(NEUTRAL_KEYS.length - 1),
      ghostHover: b('100'),
      danger: s('danger', '500'),
      dangerText: D ? n('900') : n('0'),
    },
    status: {
      success: s('success', '500'),
      successBg: s('success', '50'),
      warning: s('warning', '500'),
      warningBg: s('warning', '50'),
      danger: s('danger', '500'),
      dangerBg: s('danger', '50'),
      info: s('info', '500'),
      infoBg: s('info', '50'),
    },
    chart: {
      '1': b('500'),
      '2': s('success', '500'),
      '3': s('warning', '500'),
      '4': s('info', '500'),
      '5': s('danger', '500'),
    },
    overlay: { scrim: 'rgba(0,0,0,0.4)' },
  }
}

/** 供测试/报告：语义键集合（镜像契约）。 */
export const EXTRACTED_SEMANTIC_KEYS = SEMANTIC
