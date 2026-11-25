/**
 * 排版与动效类规则：烂大街字体、回弹缓动。
 */
import { declarationOf } from './cssShared.js'
import { allDeclarations } from './decls.js'
import type { RuleContext, RuleFinding } from './types.js'

/**
 * impeccable 的 OVERUSED_FONTS（17 个），拼写归一：去空格/连字符/下划线后比较，
 * 因此 `GeistSans`、`geist-sans`、`Geist Sans` 视为同一个。
 */
const OVERUSED_FONTS = [
  'inter',
  'roboto',
  'opensans',
  'lato',
  'montserrat',
  'arial',
  'helvetica',
  'fraunces',
  'instrumentsans',
  'instrumentserif',
  'geist',
  'geistsans',
  'geistmono',
  'monasans',
  'plusjakartasans',
  'spacegrotesk',
  'recoleta',
]

function squash(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, '').replace(/^['"]|['"]$/g, '')
}

/** 当前风格声明的字体族（品牌字体豁免用）。 */
function styleFamilies(ctx: RuleContext): Set<string> {
  const out = new Set<string>()
  for (const stack of ctx.manifest?.fontFamilies ?? []) {
    for (const part of stack.split(',')) {
      const name = squash(part.trim())
      if (name) out.add(name)
    }
  }
  return out
}

export function checkOverusedFont(ctx: RuleContext): RuleFinding[] {
  const brand = styleFamilies(ctx)
  const out: RuleFinding[] = []
  for (const decl of allDeclarations(ctx)) {
    if (decl.prop !== 'font-family') continue
    if (decl.value.includes('var(')) continue
    for (const part of decl.value.split(',')) {
      const raw = part.trim().replace(/^['"]|['"]$/g, '')
      if (!raw) continue
      const name = squash(raw)
      if (!OVERUSED_FONTS.includes(name)) continue
      if (brand.has(name)) break // 当前风格的品牌字体，不报
      out.push({
        rule: 'overused-font',
        offset: decl.offset,
        message: `字体 ${raw} 被 AI 生成的页面反复使用，已失去辨识度；换一个贴合主题的字体，或使用风格字体栈`,
        severity: 'warning',
      })
      break
    }
  }
  return out
}

/** 回弹/弹性缓动：cubic-bezier 的 y 超出 [0,1]，或 keyword 含 bounce/elastic/back。 */
export function checkBounceEasing(ctx: RuleContext): RuleFinding[] {
  const out: RuleFinding[] = []
  for (const decl of allDeclarations(ctx)) {
    if (!/^(?:transition|animation)(?:-timing-function)?$/.test(decl.prop)) continue
    if (decl.value.includes('var(')) continue
    const timing = /\b(?:bounce|elastic)\b/i.test(decl.value)
    let overshoot = false
    for (const m of decl.value.matchAll(/cubic-bezier\(\s*([^)]+)\)/gi)) {
      const nums = (m[1] ?? '').split(',').map((v) => Number(v.trim()))
      if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) continue
      const [, y1, , y2] = nums as [number, number, number, number]
      if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) overshoot = true
    }
    if (!timing && !overshoot) continue
    out.push({
      rule: 'bounce-easing',
      offset: decl.offset,
      message: '回弹/弹性缓动显得过时；真实物体是平滑减速的，改用指数 ease-out（如 cubic-bezier(.16,1,.3,1)）',
      severity: 'advisory',
    })
  }
  return out
}

/** 供其他规则复用：取某块里的某个属性。 */
export { declarationOf }
