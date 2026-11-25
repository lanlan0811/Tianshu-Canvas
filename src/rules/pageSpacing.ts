/**
 * 页面级间距规则：间距单调。
 *
 * 收集 padding / margin / gap 的像素值（0 与 ≥200px 排除，rem ×16），
 * 按 4px 分箱；样本 ≥10、某值 >60%、不同正值 ≤3 时判定单调。
 */
import { allDeclarations } from './decls.js'
import type { RuleContext, RuleFinding } from './types.js'

const SPACING_PROP_RE = /^(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$/

function pxValuesOf(value: string): number[] {
  const out: number[] = []
  for (const token of value.split(/[\s,]+/)) {
    const v = token.trim()
    if (!v || v === '0' || v.includes('var(') || v.includes('calc(')) continue
    const px = /^(-?\d*\.?\d+)px$/i.exec(v)
    if (px) {
      const n = Number(px[1])
      if (n > 0 && n < 200) out.push(n)
      continue
    }
    const rem = /^(-?\d*\.?\d+)rem$/i.exec(v)
    if (rem) {
      const n = Number(rem[1]) * 16
      if (n > 0 && n < 200) out.push(n)
    }
  }
  return out
}

export function checkMonotonousSpacing(ctx: RuleContext): RuleFinding[] {
  const bins = new Map<number, number>()
  let samples = 0
  let firstOffset = -1
  for (const decl of allDeclarations(ctx)) {
    if (!SPACING_PROP_RE.test(decl.prop)) continue
    for (const px of pxValuesOf(decl.value)) {
      const bin = Math.round(px / 4) * 4
      bins.set(bin, (bins.get(bin) ?? 0) + 1)
      samples++
      if (firstOffset < 0) firstOffset = decl.offset
    }
  }
  if (samples < 10 || bins.size > 3) return []
  const sorted = [...bins.entries()].sort((a, b) => b[1] - a[1])
  const [dominantBin, dominantCount] = sorted[0]!
  if (dominantBin === 0) return []
  if (dominantCount / samples <= 0.6) return []
  return [
    {
      rule: 'monotonous-spacing',
      offset: Math.max(0, firstOffset),
      message: `页面 ${samples} 处间距里 ${dominantCount} 处都是 ${dominantBin}px，没有节奏；相关元素用小间距归组，区块之间用大间距分开`,
      severity: 'warning',
    },
  ]
}
