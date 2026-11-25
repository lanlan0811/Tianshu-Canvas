/**
 * 颜色计算（零依赖）：解析 CSS 颜色、取通道/明度/彩度、判定奶油色与中性灰。
 *
 * 只做规则需要的判定，不追求完整色彩管理：支持 #hex、rgb()/rgba()、hsl()/hsla()、
 * oklch()/oklab()（用于判定彩度与色相带）。无法解析（var()、currentColor、
 * color-mix 等）一律返回 null，由调用方弃权，绝不猜。
 */

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** #rgb / #rgba / #rrggbb / #rrggbbaa */
export function parseHex(value: string): Rgba | null {
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(value.trim())
  if (!m) return null
  const hex = m[1]!.toLowerCase()
  if (hex.length === 3 || hex.length === 4) {
    const r = parseInt(hex[0]! + hex[0]!, 16)
    const g = parseInt(hex[1]! + hex[1]!, 16)
    const b = parseInt(hex[2]! + hex[2]!, 16)
    const a = hex.length === 4 ? parseInt(hex[3]! + hex[3]!, 16) / 255 : 1
    return { r, g, b, a }
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }
  return null
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function to255(n: number, scale = 255): number {
  return Math.round(clamp01(n / scale) * 255)
}

/** rgb()/rgba()；支持数字与百分比通道。 */
export function parseRgbFunction(value: string): Rgba | null {
  const m = /^rgba?\(([^)]+)\)$/i.exec(value.trim())
  if (!m) return null
  const body = m[1]!
  // 现代语法用 / 分隔 alpha
  const [channels, alphaPart] = body.includes('/') ? (body.split('/') as [string, string]) : [body, '']
  const parts = channels.split(/[\s,]+/).filter(Boolean)
  if (parts.length < 3) return null
  const channel = (raw: string): number | null => {
    if (raw.endsWith('%')) return to255(Number(raw.slice(0, -1)), 100)
    const n = Number(raw)
    return Number.isFinite(n) ? Math.round(Math.min(255, Math.max(0, n))) : null
  }
  const r = channel(parts[0]!)
  const g = channel(parts[1]!)
  const b = channel(parts[2]!)
  if (r === null || g === null || b === null) return null
  let a = 1
  const alphaRaw = alphaPart || parts[3]
  if (alphaRaw !== undefined && alphaRaw !== '') {
    const n = alphaRaw.trim().endsWith('%') ? Number(alphaRaw.trim().slice(0, -1)) / 100 : Number(alphaRaw.trim())
    if (Number.isFinite(n)) a = clamp01(n)
  }
  return { r, g, b, a }
}

/** hsl()/hsla() → RGB；用于把"紫 260–310"这类色相判据统一到 RGB。 */
export function parseHslFunction(value: string): Rgba | null {
  const m = /^hsla?\(([^)]+)\)$/i.exec(value.trim())
  if (!m) return null
  const body = m[1]!
  const [channels, alphaPart] = body.includes('/') ? (body.split('/') as [string, string]) : [body, '']
  const parts = channels.split(/[\s,]+/).filter(Boolean)
  if (parts.length < 3) return null
  const h = Number(parts[0]!.replace(/deg$/i, ''))
  const s = Number(parts[1]!.replace('%', '')) / 100
  const l = Number(parts[2]!.replace('%', '')) / 100
  if (![h, s, l].every(Number.isFinite)) return null
  const a = alphaPart ? (alphaPart.trim().endsWith('%') ? Number(alphaPart.trim().slice(0, -1)) / 100 : Number(alphaPart.trim())) : 1
  return { ...hslToRgb(h, s, l), a: Number.isFinite(a) ? clamp01(a) : 1 }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const mm = l - c / 2
  let rgb: [number, number, number]
  if (hue < 60) rgb = [c, x, 0]
  else if (hue < 120) rgb = [x, c, 0]
  else if (hue < 180) rgb = [0, c, x]
  else if (hue < 240) rgb = [0, x, c]
  else if (hue < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return { r: Math.round((rgb[0] + mm) * 255), g: Math.round((rgb[1] + mm) * 255), b: Math.round((rgb[2] + mm) * 255) }
}

/** oklch(L C H / A) → 近似 sRGB；用于判定彩度与色相带。 */
export function parseOklchFunction(value: string): Rgba | null {
  const m = /^oklch\(\s*([^)]+)\)$/i.exec(value.trim())
  if (!m) return null
  const body = m[1]!
  const [channels, alphaPart] = body.includes('/') ? (body.split('/') as [string, string]) : [body, '']
  const parts = channels.split(/\s+/).filter(Boolean)
  if (parts.length < 3) return null
  const l = parts[0]!.endsWith('%') ? Number(parts[0]!.slice(0, -1)) / 100 : Number(parts[0]!)
  const c = Number(parts[1]!)
  const h = Number(parts[2]!.replace(/deg$/i, ''))
  if (![l, c, h].every(Number.isFinite)) return null
  const hr = (h * Math.PI) / 180
  const a = c * Math.cos(hr)
  const bb = c * Math.sin(hr)
  const L = l + 0.3963377774 * a + 0.2158037573 * bb
  const M = l - 0.1055613458 * a - 0.0638541728 * bb
  const S = l - 0.0894841775 * a - 1.2914855480 * bb
  const l3 = L * L * L
  const m3 = M * M * M
  const s3 = S * S * S
  const lin = [
    +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
  ]
  const gamma = (u: number): number => (u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055)
  const alpha = alphaPart ? (alphaPart.trim().endsWith('%') ? Number(alphaPart.trim().slice(0, -1)) / 100 : Number(alphaPart.trim())) : 1
  return {
    r: Math.round(clamp01(gamma(lin[0]!)) * 255),
    g: Math.round(clamp01(gamma(lin[1]!)) * 255),
    b: Math.round(clamp01(gamma(lin[2]!)) * 255),
    a: Number.isFinite(alpha) ? clamp01(alpha) : 1,
  }
}

/** 解析任意受支持的 CSS 颜色；不可解析返回 null（调用方应弃权）。 */
export function parseColor(value: string): Rgba | null {
  const v = value.trim()
  if (!v || v.includes('var(') || v.includes('currentColor') || v.includes('color-mix')) return null
  const named: Record<string, string> = {
    white: '#ffffff',
    black: '#000000',
    transparent: '#00000000',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    gray: '#808080',
    grey: '#808080',
    cream: '#fffdd0',
    beige: '#f5f5dc',
  }
  const direct = parseHex(v)
  if (direct) return direct
  const rgb = parseRgbFunction(v)
  if (rgb) return rgb
  const hsl = parseHslFunction(v)
  if (hsl) return hsl
  const oklch = parseOklchFunction(v)
  if (oklch) return oklch
  const namedHex = named[v.toLowerCase()]
  return namedHex ? parseHex(namedHex) : null
}

/** 通道极差：彩色判据的基础（≥12 视为有彩度）。 */
export function channelSpread(c: Rgba): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
}

/** HSL 色相（0–360）；灰度时返回 0。 */
export function hueOf(c: Rgba): number {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return ((h * 60) % 360 + 360) % 360
}

/** HSL 饱和度（0–100）。 */
export function saturationOf(c: Rgba): number {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return 0
  return (d / (1 - Math.abs(2 * l - 1))) * 100
}

/** WCAG 相对亮度（0–1）。 */
export function relativeLuminance(c: Rgba): number {
  const srgb = [c.r, c.g, c.b].map((v) => {
    const u = v / 255
    return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * srgb[0]! + 0.7152 * srgb[1]! + 0.0722 * srgb[2]!
}

/** 奶油/米色底判据：三通道都很亮、暖向（r≥g≥b）且暖差 6–48。 */
export function isCreamColor(c: Rgba): boolean {
  const min = Math.min(c.r, c.g, c.b)
  return min >= 209 && c.r >= c.g && c.g >= c.b && c.r - c.b >= 6 && c.r - c.b <= 48
}

/** 中性灰判据：低饱和（HSL ≤12%）且通道极差 ≤30（涵盖 Tailwind 的 slate/gray/zinc 系）。 */
export function isNeutralGray(c: Rgba): boolean {
  if (channelSpread(c) > 30) return false
  return saturationOf(c) <= 12
}

/** AI 配色判据用到的九个 tell 色（impeccable 的 PURPLE_ACCENT_HEXES）。 */
export const PURPLE_TELL_HEXES = new Set([
  '7c3aed',
  '8b5cf6',
  'a855f7',
  '9333ea',
  '7e22ce',
  '6d28d9',
  '6366f1',
  '764ba2',
  '667eea',
])

/** 取一段 CSS 值里所有可解析的颜色（按出现顺序）；`transparent` 记为 alpha 0。 */
export function colorsIn(value: string): Rgba[] {
  const out: Array<{ at: number; rgba: Rgba }> = []
  for (const m of value.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const c = parseHex(m[0])
    if (c) out.push({ at: m.index ?? 0, rgba: c })
  }
  for (const m of value.matchAll(/\b(?:rgba?|hsla?|oklch)\([^)]*\)/gi)) {
    const c = parseColor(m[0])
    if (c) out.push({ at: m.index ?? 0, rgba: c })
  }
  for (const m of value.matchAll(/\btransparent\b/gi)) {
    out.push({ at: m.index ?? 0, rgba: { r: 0, g: 0, b: 0, a: 0 } })
  }
  return out.sort((a, b) => a.at - b.at).map((entry) => entry.rgba)
}
