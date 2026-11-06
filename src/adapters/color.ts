/**
 * 颜色与稳定序列化工具（适配器 / 品牌包共用，零依赖）。
 *
 * token 契约只接受 `#hex`（对比度校验走 parseHex），但真实项目里常见 `oklch()`、
 * `hsl()`、`rgb()` 与命名的 CSS 变量值，因此导入时必须先归一化。
 * 转换按 CSS Color 4 的矩阵实现，gamma 外推时做 clamp；无法表示的颜色返回 null。
 */

import { createHash } from 'node:crypto'

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function to255(v: number): number {
  return Math.round(clamp01(v) * 255)
}

/** `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` |
/** `rgb()` / `rgba()` / `hsl()` / `hsla()` / `oklch()` / `oklab()` → RGBA；无法解析返回 null。 */
export function parseColor(input: string): Rgba | null {
  const text = input.trim().toLowerCase()
  if (!text) return null
  if (/^#[0-9a-f]{3,8}$/.test(text)) {
    let h = text.slice(1)
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    }
  }

  const fn = /^(rgba?|hsla?|oklch|oklab)\((.*)\)$/.exec(text)
  if (!fn) return null
  const name = fn[1]!
  const body = fn[2]!.replace(/\//g, ' / ')
  const parts = body.split(/[\s,]+/).filter(Boolean)
  const alphaPart = parts.includes('/') ? parts.slice(parts.indexOf('/') + 1).join('') : undefined
  const values = (alphaPart !== undefined ? parts.slice(0, parts.indexOf('/')) : parts).map((p) => p.trim()).filter(Boolean)
  const num = (p: string | undefined, percentBase = 1): number | null => {
    if (p === undefined) return null
    const m = /^(-?[0-9.]+)(%|deg)?$/.exec(p)
    if (!m) return null
    const n = Number(m[1])
    if (!Number.isFinite(n)) return null
    if (m[2] === '%') return (n / 100) * percentBase
    return n
  }
  const parseAlpha = (): number => {
    if (alphaPart === undefined) return 1
    const a = num(alphaPart, 1)
    return a === null ? 1 : clamp01(a)
  }

  if (name === 'rgb' || name === 'rgba') {
    const r = num(values[0], 255)
    const g = num(values[1], 255)
    const b = num(values[2], 255)
    if (r === null || g === null || b === null) return null
    return { r: to255(r / 255), g: to255(g / 255), b: to255(b / 255), a: parseAlpha() }
  }

  if (name === 'hsl' || name === 'hsla') {
    const h = num(values[0]) ?? 0
    const s = num(values[1], 1) ?? 0
    const l = num(values[2], 1) ?? 0
    return { ...hslToRgb(h, s, l), a: parseAlpha() }
  }

  if (name === 'oklch') {
    // L: 0–1 或百分比；C: 数值（100% = 0.4）；H: 角度。
    const l = num(values[0], 1) ?? 0
    const c = num(values[1], 0.4) ?? 0
    const h = num(values[2]) ?? 0
    return { ...oklchToRgb(l, c, h), a: parseAlpha() }
  }

  // oklab
  const l = num(values[0], 1) ?? 0
  const a = num(values[1], 0.4) ?? 0
  const b = num(values[2], 0.4) ?? 0
  return { ...oklabToRgb(l, a, b), a: parseAlpha() }
}

function hslToRgb(h: number, s: number, l: number): Pick<Rgba, 'r' | 'g' | 'b'> {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x]
  return { r: to255(r! + m), g: to255(g! + m), b: to255(b! + m) }
}

/** Oklab → 线性 sRGB（CSS Color 4 矩阵）。 */
function oklabToLinear(l: number, a: number, b: number): [number, number, number] {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const L = l_ ** 3
  const M = m_ ** 3
  const S = s_ ** 3
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ]
}

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

function toRgb(linear: [number, number, number]): Pick<Rgba, 'r' | 'g' | 'b'> {
  return {
    r: to255(linearToSrgb(linear[0])),
    g: to255(linearToSrgb(linear[1])),
    b: to255(linearToSrgb(linear[2])),
  }
}

function oklchToRgb(l: number, c: number, h: number): Pick<Rgba, 'r' | 'g' | 'b'> {
  const rad = (h * Math.PI) / 180
  return toRgb(oklabToLinear(l, c * Math.cos(rad), c * Math.sin(rad)))
}

function oklabToRgb(l: number, a: number, b: number): Pick<Rgba, 'r' | 'g' | 'b'> {
  return toRgb(oklabToLinear(l, a, b))
}

/** 归一化为 `#rrggbb`；带透明度的颜色返回 null（token 契约不表达 alpha）。 */
export function toHex(input: string): string | null {
  const rgba = parseColor(input)
  if (!rgba) return null
  if (rgba.a < 0.999) return null
  return `#${[rgba.r, rgba.g, rgba.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/** 带 alpha 的归一化：不透明用 `#rrggbb`，半透明用 `rgba(r,g,b,a)`。 */
export function toCssColor(input: string): string | null {
  const rgba = parseColor(input)
  if (!rgba) return null
  if (rgba.a >= 0.999) return toHex(input)
  return `rgba(${rgba.r},${rgba.g},${rgba.b},${Number(rgba.a.toFixed(3))})`
}

/** 稳定序列化：按 key 排序、2 空格缩进、LF 结尾。品牌包 checksum 与产物 diff 都依赖它。 */
export function stableStringify(value: unknown, indent = 0): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  const pad = '  '.repeat(indent)
  const padEnd = '  '.repeat(Math.max(0, indent - 1))
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((v) => `${pad}${stableStringify(v, indent + 1)}`).join(',\n')}\n${padEnd}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    if (entries.length === 0) return '{}'
    return `{\n${entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${stableStringify(v, indent + 1)}`).join(',\n')}\n${padEnd}}`
  }
  return 'null'
}

/** 稳定序列化后的 sha256（品牌包校验用）。 */
export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')
}
