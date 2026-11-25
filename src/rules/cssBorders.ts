/**
 * 边框类规则：侧色条（side-tab）、圆角上的强调边框（border-accent-on-rounded）。
 *
 * 两者都需要「同一规则块内」的相关性判断，因此走 ruleBlocks。
 */
import { declarationOf, isNeutralColorValue, isTransparentish, parseBorderSide, pxOf } from './cssShared.js'
import type { RuleFinding, RuleContext } from './types.js'

const SIDE_PROPS = [
  { prop: 'border-left', side: 'left' },
  { prop: 'border-right', side: 'right' },
  { prop: 'border-inline-start', side: 'left' },
  { prop: 'border-inline-end', side: 'right' },
] as const

const OPPOSITE = [
  { prop: 'border-left', other: ['border-right', 'border-top', 'border-bottom', 'border-block-start', 'border-block-end', 'border-inline-end'] },
  { prop: 'border-right', other: ['border-left', 'border-top', 'border-bottom', 'border-block-start', 'border-block-end', 'border-inline-start'] },
  { prop: 'border-inline-start', other: ['border-inline-end', 'border-top', 'border-bottom', 'border-block-start', 'border-block-end', 'border-left'] },
  { prop: 'border-inline-end', other: ['border-inline-start', 'border-top', 'border-bottom', 'border-block-start', 'border-block-end', 'border-right'] },
] as const

const CIRCLE_TAGS = new Set(['hr'])

export function checkBorders(ctx: RuleContext): RuleFinding[] {
  const out: RuleFinding[] = []
  for (const block of ctx.blocks) {
    const radius = radiusPx(block.decls)
    // 完整四边框：任何一边都不算侧色条。
    const uniform = hasUniformBorder(block.decls)
    for (const { prop, side } of SIDE_PROPS) {
      const decl = declarationOf(block.decls, prop)
      if (!decl) continue
      const parsed = parseBorderSide(decl.value)
      if (!parsed || parsed.width < 1 || parsed.width > 12) continue
      if (isTransparentish(decl.value)) continue
      // 其余三边必须明显更细（0 或 ≤1px），或本边 ≥2× 其余最大边。
      const others = OPPOSITE.find((o) => o.prop === prop)!.other
      const otherWidths = others
        .map((p) => declarationOf(block.decls, p))
        .filter((d): d is NonNullable<typeof d> => Boolean(d))
        .map((d) => parseBorderSide(d.value)?.width ?? 0)
      const maxOther = otherWidths.length ? Math.max(...otherWidths) : 0
      const isBar = maxOther === 0 || maxOther <= 1 || parsed.width >= maxOther * 2
      if (!isBar || uniform) continue
      // 必须是圆角盒子；4px 起步才看得出「圆角 + 侧条」的冲突。
      if (radius < 4) continue
      // 圆形（徽章、头像）上的单侧边框是弧，不是色条。
      if (looksLikeCircle(block.selector, block.decls)) continue
      out.push({
        rule: 'side-tab',
        offset: block.selectorOffset,
        message: `圆角盒子上的单侧色条（${side} ${parsed.width}px + 圆角 ${radius}px）；改用整圈描边、背景色深浅，或在前面放图标/标签`,
        severity: 'warning',
      })
      break
    }

    // 上/下强调边框 + 圆角
    for (const prop of ['border-top', 'border-bottom'] as const) {
      const decl = declarationOf(block.decls, prop)
      if (!decl) continue
      const parsed = parseBorderSide(decl.value)
      if (!parsed || parsed.width < 2) continue
      if (isTransparentish(decl.value)) continue
      // 中性色边框是分隔线，不是强调色。
      if (isNeutralColorValue(parsed.color)) continue
      if (radius <= 0) continue
      if (uniform) continue
      if (CIRCLE_TAGS.has(block.selector)) continue
      out.push({
        rule: 'border-accent-on-rounded',
        offset: block.selectorOffset,
        message: `圆角 ${radius}px 上叠 ${parsed.width}px 的${prop === 'border-top' ? '上' : '下'}强调边框；边框与圆角互相冲突，去掉其中一个`,
        severity: 'warning',
      })
      break
    }
  }
  return out
}

function radiusPx(decls: RuleContext['blocks'][number]['decls']): number {
  for (const d of decls) {
    if (!/^border(?:-[a-z]+)*-radius$/.test(d.prop)) continue
    const values = d.value
      .split(/[\s/]+/)
      .map((v) => pxOf(v))
      .filter((n): n is number => n !== null && n > 0)
    if (values.length) return Math.max(...values)
  }
  return 0
}

/** 四边宽度一致且都 >0 → 完整边框（框，不是色条）。 */
function hasUniformBorder(decls: RuleContext['blocks'][number]['decls']): boolean {
  const widths = ['border-top', 'border-right', 'border-bottom', 'border-left']
    .map((prop) => {
      const d = declarationOf(decls, prop)
      return d ? parseBorderSide(d.value)?.width ?? null : null
    })
  if (widths.some((w) => w === null)) return false
  const first = widths[0]!
  return first > 1 && widths.every((w) => w === first)
}

/** 圆形判定：选择器或声明暗示 50%/9999px 圆角，或 aspect-ratio 接近 1 且圆角很大。 */
function looksLikeCircle(selector: string, decls: RuleContext['blocks'][number]['decls']): boolean {
  const radiusDecl = decls.find((d) => /^border(?:-[a-z]+)*-radius$/.test(d.prop))
  if (!radiusDecl) return false
  const raw = radiusDecl.value
  if (/\b50%/.test(raw) || /\b9999px/.test(raw) || /\b999px/.test(raw)) return true
  const aspect = declarationOf(decls, 'aspect-ratio')
  if (aspect && /^\s*1(\s*\/\s*1)?\s*$/.test(aspect.value)) {
    const px = radiusPx(decls)
    if (px >= 40) return true
  }
  // 类名暗示：avatar / badge / dot / pill 通常是胶囊或圆
  return /\b(avatar|dot|pill|circle|badge)\b/i.test(selector)
}
