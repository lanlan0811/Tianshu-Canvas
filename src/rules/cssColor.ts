/**
 * 颜色类规则：AI 配色、奶油底、彩色底上的灰字、渐变文字、径向光晕。
 */
import { channelSpread, colorsIn, hueOf, isCreamColor, isNeutralGray, parseColor, PURPLE_TELL_HEXES, relativeLuminance, saturationOf, type Rgba } from './colorMath.js'
import { declarationOf, originalValue } from './cssShared.js'
import { allDeclarations } from './decls.js'
import type { RuleContext, RuleFinding } from './types.js'

/** 当前风格的品牌色是否本身就是 tell 色（避免误报自有风格）。 */
function styleBrandIsTell(ctx: RuleContext): boolean {
  if (!ctx.manifest) return false
  const entry = ctx.manifest.resolvedSemantic?.['color.action.primary']
  if (!entry?.value) return false
  const c = parseColor(entry.value)
  if (!c) return false
  const hex = [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')
  if (PURPLE_TELL_HEXES.has(hex)) return true
  const hue = hueOf(c)
  return channelSpread(c) >= 30 && hue >= 260 && hue <= 310
}

/** 当前风格的画布底色是否本来就是奶油色（inkstone / original / saffron / claude）。 */
function styleCanvasIsCream(ctx: RuleContext): boolean {
  if (!ctx.manifest) return false
  const entry = ctx.manifest.resolvedSemantic?.['color.bg.canvas']
  if (!entry?.value) return false
  const c = parseColor(entry.value)
  return c ? isCreamColor(c) : false
}

/** 紫 / 青 tell 色带判定。 */
function isTellColor(c: Rgba): boolean {
  if (channelSpread(c) < 30) return false
  const hue = hueOf(c)
  const sat = saturationOf(c)
  const purple = hue >= 260 && hue <= 310 && sat >= 50
  const cyan = hue >= 170 && hue <= 197 && sat >= 40
  return purple || cyan
}

export function checkAiPalette(ctx: RuleContext): RuleFinding[] {
  if (styleBrandIsTell(ctx)) return []
  const out: RuleFinding[] = []
  const seen = new Set<string>()
  const pageDecls = allDeclarations(ctx)
  for (const decl of pageDecls) {
    if (decl.value.includes('var(')) continue
    // 只看用于颜色/背景/边框/渐变的声明。
    const relevant = /^(?:color|background(?:-color|-image)?|border(?:-[a-z]+)*(?:-color)?|fill|stroke)$/.test(decl.prop)
    if (!relevant) continue
    for (const m of decl.value.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
      const hex = m[1]!.toLowerCase()
      const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
      if (!PURPLE_TELL_HEXES.has(full)) continue
      const key = `${decl.offset}:${full}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        rule: 'ai-color-palette',
        offset: decl.offset,
        message: `AI 生成界面的典型配色 #${full}（紫罗兰/靛蓝系）；从主题本身取材建立配色`,
        severity: 'warning',
      })
      break
    }
    // 渐变里的青/紫 tell 带：≥半数色标落在带内才报。
    if (/gradient\(/i.test(decl.value)) {
      const stops = colorsIn(decl.value)
      if (stops.length >= 2) {
        const tell = stops.filter((c) => isTellColor(c))
        if (tell.length >= Math.ceil(stops.length / 2)) {
          out.push({
            rule: 'ai-color-palette',
            offset: decl.offset,
            message: '渐变的主色落在青绿/紫罗兰 tell 带；这类渐变是 AI 生成界面最明显的痕迹',
            severity: 'warning',
          })
        }
      }
    }
  }
  return out
}

/** 页面根背景色：取 html / body / :root 的 background(-color)。 */
export function checkCreamPalette(ctx: RuleContext): RuleFinding[] {
  if (styleCanvasIsCream(ctx)) return []
  for (const block of ctx.blocks) {
    if (!/(?:^|,)\s*(?:html|body|:root)\b/i.test(block.selector)) continue
    for (const prop of ['background', 'background-color'] as const) {
      const decl = declarationOf(block.decls, prop)
      if (!decl) continue
      const c = parseColor(decl.value.split(/\s+/)[0] ?? '')
      if (!c) continue
      if (isCreamColor(c)) {
        return [
          {
            rule: 'cream-palette',
            offset: decl.offset,
            message: `奶油/米色页面底色 rgb(${c.r}, ${c.g}, ${c.b}) 是"有品味的 AI 页面"的默认选择；换成来自明确配色的背景`,
            severity: 'advisory',
          },
        ]
      }
    }
  }
  return []
}

/** 同块：彩色背景 + 中性灰文字。 */
export function checkGrayOnColor(ctx: RuleContext): RuleFinding[] {
  const out: RuleFinding[] = []
  for (const block of ctx.blocks) {
    const bgDecl = declarationOf(block.decls, 'background-color') ?? declarationOf(block.decls, 'background')
    const fgDecl = declarationOf(block.decls, 'color')
    if (!bgDecl || !fgDecl) continue
    const bg = parseColor(bgDecl.value.split(/\s+/)[0] ?? '')
    const fg = parseColor(fgDecl.value.split(/\s+/)[0] ?? '')
    if (!bg || !fg) continue
    if (bg.a < 0.5) continue
    if (channelSpread(bg) < 12) continue
    if (!isNeutralGray(fg)) continue
    if (fg.r >= 240 && fg.g >= 240 && fg.b >= 240) continue // 近白是正确做法
    out.push({
      rule: 'gray-on-color',
      offset: fgDecl.offset,
      message: '彩色背景上用灰色文字会发灰发脏；改用该背景色的更深色调，或用近白色',
      severity: 'warning',
    })
  }
  return out
}

/** 渐变文字：background-clip:text + 多色渐变（单色渐变是填充，不算）。 */
export function checkGradientText(ctx: RuleContext): RuleFinding[] {
  const out: RuleFinding[] = []
  for (const block of ctx.blocks) {
    const clip = block.decls.find((d) => /^(?:-webkit-)?background-clip$/.test(d.prop))
    if (!clip || !/\btext\b/i.test(clip.value)) continue
    const image = block.decls.find((d) => /^background(?:-image)?$/.test(d.prop))
    if (!image || !/gradient\(/i.test(image.value)) continue
    const stops = colorsIn(image.value)
    // 单色斜坡（逐通道差 ≤12）= 纯色填充，不是渐变文字。
    if (stops.length >= 2) {
      const first = stops[0]!
      const oneColour = stops.every(
        (c) => Math.abs(c.r - first.r) <= 12 && Math.abs(c.g - first.g) <= 12 && Math.abs(c.b - first.b) <= 12,
      )
      if (oneColour) continue
    }
    out.push({
      rule: 'gradient-text',
      offset: block.selectorOffset,
      message: '标题/文字使用渐变色填充；渐变色是装饰而非表意，改用纯色，强调靠字重与字号',
      severity: 'warning',
    })
  }
  return out
}

/** 暗底页面上的装饰性径向光晕。 */
export function checkRadialHalo(ctx: RuleContext): RuleFinding[] {
  const dark = pageIsDark(ctx)
  if (!dark) return []
  const out: RuleFinding[] = []
  const seen = new Set<string>()
  for (const decl of allDeclarations(ctx)) {
    // 掩码会把 url(...) 抹掉，判断"有没有图片"必须回读原文。
    const original = originalValue(ctx, decl)
    if (!/radial-gradient\(/i.test(original)) continue
    if (/repeating-radial-gradient\(/i.test(original)) continue
    if (/url\(/i.test(original)) continue
    const fn = /radial-gradient\((.*)\)/is.exec(decl.value)?.[1]
    if (!fn) continue
    const stops = colorsIn(fn)
    if (stops.length < 2) continue
    const first = stops[0]!
    const last = stops[stops.length - 1]!
    if (first.a < 0.7) continue
    if (last.a > 0.05) continue
    if (channelSpread(first) < 24) continue
    // 带 px 尺寸的小圆点不是光晕。
    if (/(?:^|[\s,(])(?:\d{1,2})px/.test(fn)) continue
    const key = String(decl.offset)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      rule: 'radial-halo',
      offset: decl.offset,
      message: '暗底上叠加饱和色径向光晕；这是"暗色+发光"套路的渐变版本，改用纯色或轻微偏移的底色',
      severity: 'advisory',
    })
  }
  return out
}

function pageIsDark(ctx: RuleContext): boolean {
  for (const block of ctx.blocks) {
    if (!/(?:^|,)\s*(?:html|body|:root)\b/i.test(block.selector)) continue
    const decl = declarationOf(block.decls, 'background-color') ?? declarationOf(block.decls, 'background')
    if (!decl) continue
    const c = parseColor(decl.value.split(/\s+/)[0] ?? '')
    if (c && c.a > 0.5) return relativeLuminance(c) < 0.1
  }
  return false
}
