/**
 * 纹理/阴影类规则：硬偏移阴影、重复渐变条纹、装饰网格底纹、跑马灯。
 */
import { parseBorderSide } from './cssShared.js'
import { allDeclarations } from './decls.js'
import type { RuleContext, RuleFinding } from './types.js'

/** 解析一条 box-shadow 层；不可解析返回 null（调用方整条声明弃权）。 */
interface ShadowLayer {
  inset: boolean
  x: number
  y: number
  blur: number
  spread: number
  color: string
}

function parseShadowLayer(layer: string): ShadowLayer | null {
  const text = layer.trim()
  if (!text) return null
  if (/\b(?:calc|var|em|rem|ch|vw|vh|%)\b/i.test(text)) return null
  const inset = /\binset\b/i.test(text)
  const lengths: number[] = []
  const colorParts: string[] = []
  for (const token of text.split(/\s+/)) {
    if (!token || token.toLowerCase() === 'inset') continue
    if (/^-?\d*\.?\d+px$/i.test(token)) lengths.push(Number(token.replace(/px$/i, '')))
    else if (token === '0') lengths.push(0)
    else colorParts.push(token)
  }
  if (lengths.length < 2 || lengths.length > 4) return null
  // 颜色必须在场且可判定（currentColor / 关键字都接受，视为已给定）。
  if (colorParts.length === 0) return null
  return {
    inset,
    x: lengths[0]!,
    y: lengths[1]!,
    blur: lengths[2] ?? 0,
    spread: lengths[3] ?? 0,
    color: colorParts.join(' '),
  }
}

/** 颜色 alpha > 0.1 近似判定：无 alpha（hex 6/rgb 3）视为 1；rgba 第 4 位 ≤0.1 视为不可见。 */
function colorAlphaAtLeast(text: string, min: number): boolean {
  const rgba = /rgba?\(\s*[\d.%\s,]*?,\s*([\d.]+)\s*\)/i.exec(text)
  if (rgba) {
    const raw = rgba[1]!.trim()
    const a = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw)
    if (!Number.isFinite(a)) return true
    return a > min
  }
  const hex = /#([0-9a-fA-F]{4}|[0-9a-fA-F]{8})\b/.exec(text)
  if (hex) {
    const h = hex[1]!
    const a = parseInt(h.length === 4 ? h[3]! + h[3]! : h.slice(6, 8), 16) / 255
    return a > min
  }
  return true
}

export function checkHardOffsetShadow(ctx: RuleContext): RuleFinding[] {
  const out: RuleFinding[] = []
  for (const decl of allDeclarations(ctx)) {
    if (decl.prop !== 'box-shadow') continue
    const raw = decl.value.trim()
    if (raw === 'none' || raw === '') continue
    const layers = raw.split(/,(?![^(]*\))/).map(parseShadowLayer)
    // 任一层不可解析 → 整条声明弃权（宁可漏报，不误报）。
    if (layers.some((l) => l === null)) continue
    for (const layer of layers as ShadowLayer[]) {
      if (layer.inset) continue
      if (layer.blur !== 0) continue
      if (layer.spread < 0) continue
      if (Math.max(Math.abs(layer.x), Math.abs(layer.y)) < 4) continue
      if (!colorAlphaAtLeast(layer.color, 0.1)) continue
      out.push({
        rule: 'hard-offset-shadow',
        offset: decl.offset,
        message: '零模糊、偏移 ≥4px 的硬阴影：确认这是不是该视觉方向的选择；不是就改用带模糊的柔和阴影或纯描边',
        severity: 'advisory',
      })
      break
    }
  }
  return out
}

/** repeating-gradient 是否真的重复：一次画完的斜坡（首 0、末为全长）不算条纹。 */
function actuallyRepeats(value: string): boolean {
  if (!/repeating-(?:linear|radial|conic)-gradient\(/i.test(value)) return false
  const body = /repeating-(?:linear|radial|conic)-gradient\((.*)\)/is.exec(value)?.[1] ?? ''
  if (!body) return false
  if (body.includes('var(')) return true
  // 带尺寸的 radial（如 circle 20px at ...）本身就重复。
  if (/repeating-radial-gradient\(/i.test(value) && /\b\d+(?:\.\d+)?(?:px|em|rem)\b/.test(body)) return true
  // 找最后一个色标的位置：若其覆盖全长（100% / 360deg / 400grad / 1turn 或无位置），视为一次画完。
  const stopRe = /([^,()]+?)\s+(100%|360deg|400grad|1turn|turn|100vw|100vh)\s*(?=,|$)/i
  if (stopRe.test(body)) {
    const firstStopZero = /(?:^|[,(\s])(?:#|rgb|hsl|oklch|transparent|[a-z]+)[^,]*?\s+0(?:%|px|deg)?\s*(?=,|$)/i.test(body)
    if (firstStopZero) return false
  }
  return true
}

export function checkRepeatingStripes(ctx: RuleContext): RuleFinding[] {
  const out: RuleFinding[] = []
  for (const decl of allDeclarations(ctx)) {
    if (!/^(?:background|background-image)$/.test(decl.prop)) continue
    if (!actuallyRepeats(decl.value)) continue
    out.push({
      rule: 'repeating-stripes-gradient',
      offset: decl.offset,
      message: '用 repeating-gradient 画装饰性条纹；换成有意图的材质，或保持纯色',
      severity: 'advisory',
    })
  }
  return out
}

/** 装饰网格底纹：≥2 条发丝线渐变 + px 单元尺寸。 */
export function checkGridBackground(ctx: RuleContext): RuleFinding[] {
  const out: RuleFinding[] = []
  for (const block of ctx.blocks) {
    const bg = block.decls.find((d) => /^(?:background|background-image)$/.test(d.prop))
    if (!bg) continue
    if (!/linear-gradient\(/i.test(bg.value)) continue
    // 发丝线形态：`Npx, transparent Npx`、`transparent Npx, calc(100% - Npx)`，
    // 或用极细实色（1–3px）画线、其余透明（`transparent 8px, #bfdbfe 8px`）。
    const hairlines = [
      ...bg.value.matchAll(/(?:^|[,(\s])(?:\d{1,3}px\s*,\s*transparent\s+\d{1,3}px|transparent\s+\d{1,3}px\s*,\s*calc\(100%\s*-\s*\d{1,3}px\))/gi),
      ...bg.value.matchAll(/transparent\s+\d{1,3}px\s*,\s*(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))\s+\d{1,3}px/gi),
    ]
    if (hairlines.length < 2) continue
    const sizeDecl = block.decls.find((d) => d.prop === 'background-size')
    const shorthandSize = /\/\s*\d{1,3}px/i.test(bg.value)
    const pxCell = sizeDecl ? /\d{1,3}px/i.test(sizeDecl.value) : shorthandSize
    if (!pxCell) continue
    out.push({
      rule: 'codex-grid-background',
      offset: bg.offset,
      message: '用极细线性渐变叠出网格底纹；网格只留给真正的画布/地图/蓝图/测量界面',
      severity: 'advisory',
    })
  }
  return out
}

export function checkMarquee(ctx: RuleContext): RuleFinding[] {
  const out: RuleFinding[] = []
  if (/<marquee\b/i.test(ctx.masked)) {
    out.push({
      rule: 'marquee',
      offset: Math.max(0, ctx.masked.search(/<marquee\b/i)),
      message: '<marquee> 自动滚动会抢走注意力并始终藏起一半内容；让读者按自己的节奏移动',
      severity: 'advisory',
    })
  }
  for (const decl of allDeclarations(ctx)) {
    if (decl.prop !== 'animation' && decl.prop !== 'animation-name') continue
    if (!/\b(?:marquee|scroll(?:ing)?(?:-|$|\b)|ticker)\b/i.test(decl.value)) continue
    out.push({
      rule: 'marquee',
      offset: decl.offset,
      message: '自动滚动的 marquee/ticker 动画；动效只留给真正在变化的内容',
      severity: 'advisory',
    })
  }
  return out
}

/** 供其它规则复用。 */
export { parseBorderSide }
