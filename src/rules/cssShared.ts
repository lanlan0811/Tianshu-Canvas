/**
 * 规则实现共用的 CSS 值解析小工具（不是通用解析器，只覆盖规则需要的形态）。
 */
import type { CssDeclaration } from '../cssParse.js'

export interface ParsedBorderSide {
  width: number
  style: string
  color: string
}

/** 解析 `border-left: 2px solid #333` 这类简写；无法解析返回 null。 */
export function parseBorderSide(value: string): ParsedBorderSide | null {
  if (value.includes('var(')) return null
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  let width = 3 // medium
  let style = 'none'
  const colors: string[] = []
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (/^-?\d*\.?\d+px$/.test(lower) || lower === 'thin' || lower === 'medium' || lower === 'thick') {
      width = lower === 'thin' ? 1 : lower === 'medium' ? 3 : lower === 'thick' ? 5 : Number(lower.replace('px', ''))
    } else if (['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset'].includes(lower)) {
      style = lower
    } else {
      colors.push(part)
    }
  }
  // 只写宽度（border-left: 2px）时按浏览器默认 solid + currentColor 处理。
  if (style === 'none' && colors.length === 0 && width > 0) style = 'solid'
  if (style === 'none' || style === 'hidden') return { width: 0, style, color: colors.join(' ') }
  return { width, style, color: colors.join(' ') }
}

export function isTransparentish(value: string): boolean {
  return /\btransparent\b/i.test(value) || /rgba?\([^)]*,\s*0(?:\.0+)?\s*\)/i.test(value)
}

/** 只取 px 字面量（`0` 也接受）；其余单位返回 null。 */
export function pxOf(value: string): number | null {
  const v = value.trim()
  if (v === '0') return 0
  const m = /^(-?\d*\.?\d+)px$/i.exec(v)
  return m ? Number(m[1]) : null
}

export function declarationOf(decls: CssDeclaration[], prop: string): CssDeclaration | undefined {
  return decls.find((d) => d.prop === prop)
}

/**
 * 取声明的原始值（未掩码）。
 *
 * lint 层在解析前把 `url(...)` 与 `data:` 抹成等长空白；需要判断"这里有没有图片"
 * 的规则必须回读原文，否则掩码会让证据消失。掩码保持长度，可以直接按 offset 切片。
 */
export function originalValue(ctx: { html: string }, decl: CssDeclaration): string {
  return ctx.html.slice(decl.offset, decl.offset + decl.raw.length)
}

/** 取某属性的全部声明（简写与展开同时存在时，展开优先）。 */
export function declarationsOf(decls: CssDeclaration[], props: readonly string[]): CssDeclaration[] {
  return decls.filter((d) => props.includes(d.prop))
}

/** 是否中性色（灰/黑/白）：用于排除「中性边框不算强调」。 */
export function isNeutralColorValue(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v === 'currentcolor' || v === 'inherit') return false
  if (/\b(?:black|white|gray|grey|silver|transparent)\b/.test(v)) return true
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)
  if (hex) {
    const h = hex[1]!
    const full = h.length === 3 || h.length === 4 ? h.split('').map((c) => c + c).join('') : h
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    return Math.max(r, g, b) - Math.min(r, g, b) <= 12
  }
  const rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v)
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    return Math.max(r, g, b) - Math.min(r, g, b) <= 12
  }
  return false
}
