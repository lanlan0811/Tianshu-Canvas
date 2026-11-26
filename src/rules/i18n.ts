/**
 * i18n 类规则：RTL 物理方向属性、固定宽度文本容器、复数拼接、西文数字。
 *
 * 判据来源：impeccable skill/reference/harden.md（i18n 段）与 audit.md（RTL 检测范围）。
 * 这里只做源码级可证的部分；字形等价与 ZWNJ 属存储层，写在
 * skills/reference/i18n-hardening.md，不做自动检测。
 */
import { allDeclarations } from './decls.js'
import { decodeEntities } from './textMath.js'
import type { RuleContext, RuleFinding } from './types.js'

const LOGICAL_HINT: Record<string, string> = {
  'margin-left': 'margin-inline-start',
  'margin-right': 'margin-inline-end',
  'padding-left': 'padding-inline-start',
  'padding-right': 'padding-inline-end',
  'border-left': 'border-inline-start',
  'border-right': 'border-inline-end',
  'border-left-width': 'border-inline-start-width',
  'border-right-width': 'border-inline-end-width',
  'border-left-color': 'border-inline-start-color',
  'border-right-color': 'border-inline-end-color',
  'border-top-left-radius': 'border-start-start-radius',
  'border-top-right-radius': 'border-start-end-radius',
  'border-bottom-left-radius': 'border-end-start-radius',
  'border-bottom-right-radius': 'border-end-end-radius',
}

/** 页面是否声明了 RTL：只看 <html> / <body> 的 dir，lang 不推方向。 */
function declaresRtl(html: string): boolean {
  return /<(?:html|body)\b[^>]*\bdir\s*=\s*["']?rtl["'\s>]/i.test(html)
}

/**
 * RTL 物理方向属性：只在 dir="rtl" 的页面触发。
 * text-align / float / left|right 定位同样是物理方向，一并检查。
 */
export function checkRtlPhysicalDirection(ctx: RuleContext): RuleFinding[] {
  if (!declaresRtl(ctx.html)) return []
  const findings: RuleFinding[] = []
  const seen = new Set<string>()
  const add = (offset: number, message: string): void => {
    const key = `${offset}:${message}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({ rule: 'rtl-physical-direction', offset, message, severity: 'warning' })
  }
  for (const decl of allDeclarations(ctx)) {
    const hint = LOGICAL_HINT[decl.prop]
    if (hint) {
      add(decl.offset, `${decl.prop} 是物理方向属性；RTL 页面改用逻辑属性 ${hint}`)
      continue
    }
    if (decl.prop === 'text-align' && /^(?:left|right)\b/i.test(decl.value.trim())) {
      add(decl.offset, `text-align: ${decl.value.trim()} 在 RTL 下方向相反；改用 start / end`)
      continue
    }
    if (decl.prop === 'float' && /^(?:left|right)\b/i.test(decl.value.trim())) {
      add(decl.offset, `float: ${decl.value.trim()} 在 RTL 下方向相反；改用 inline-start / inline-end`)
      continue
    }
    if ((decl.prop === 'left' || decl.prop === 'right') && !decl.value.includes('var(')) {
      /* left:50% + translateX(-50%) 是方向无关的居中写法，豁免。 */
      const percentCentered = /^\s*50%\s*$/.test(decl.value)
      if (percentCentered) continue
      add(decl.offset, `${decl.prop}: ${decl.value.trim()} 是物理定位；RTL 页面改用 inset-inline-start / inset-inline-end`)
    }
  }
  return findings
}

/** 文本型选择器：这些元素上的固定 width 会随翻译长度溢出。 */
const TEXT_SELECTOR = /(?:^|[\s,>+~])(?:button|a|label|h[1-6]|\.ts-btn|\.ts-tab|\.ts-nav__link|\.ts-badge|\.ts-input|\.ts-select)(?=$|[\s,.:[>+~#])/

/**
 * 固定宽度文本容器：文本型选择器上写死 width 且无 min-width/max-width 兜底。
 * 德语常比英语长 30%，需要 30–40% 的空间预算。
 */
export function checkFixedTextWidth(ctx: RuleContext): RuleFinding[] {
  const findings: RuleFinding[] = []
  for (const block of ctx.blocks) {
    if (!TEXT_SELECTOR.test(block.selector)) continue
    const width = block.decls.find((d) => d.prop === 'width')
    if (!width) continue
    if (!/^\d*\.?\d+(?:px|rem|em)$/.test(width.value.trim())) continue
    const hasFallback = block.decls.some((d) => d.prop === 'min-width' || d.prop === 'max-width')
    if (hasFallback) continue
    findings.push({
      rule: 'fixed-text-width',
      offset: width.offset,
      message: `文本容器 ${block.selector} 固定 width: ${width.value.trim()}；翻译后（德语常长 30%）会溢出，改用 padding + 内容自适应，并预留 30–40% 空间`,
      severity: 'advisory',
    })
  }
  return findings
}

/** 复数拼接：`${n} item${n !== 1 ? 's' : ''}` 式三元拼接。 */
const PLURAL_PATTERNS = [
  /\$\{[^}]*\}\s*[^`$]{0,20}\$\{[^}]*!==?\s*1[^}]*\?[^}:]*:[^}]*\}/,
  /\$\{[^}]*\}\s*[^`$]{0,20}\$\{[^}]*===\s*1[^}]*\?[^}:]*:[^}]*\}/,
  /\+\s*\(\s*[A-Za-z_$][\w$]*\s*!==?\s*1\s*\?/,
]

/** 复数拼接：只扫页面内联脚本（已从 masked 中屏蔽，所以用原文）。 */
export function checkPluralConcat(ctx: RuleContext): RuleFinding[] {
  const findings: RuleFinding[] = []
  for (const match of ctx.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1] ?? ''
    const base = (match.index ?? 0) + match[0].indexOf('>') + 1
    for (const pattern of PLURAL_PATTERNS) {
      const hit = pattern.exec(body)
      if (!hit) continue
      findings.push({
        rule: 'plural-concat',
        offset: base + (hit.index ?? 0),
        message: '用三元拼接英文复数（item/items）在多语言下是错的；改用 ICU 复数规则或 Intl.PluralRules',
        severity: 'advisory',
      })
      break
    }
  }
  return findings
}

/** RTL 语系：这些语言的正文通常使用本地数字系统。 */
const RTL_LANGS = new Set(['ar', 'fa', 'ur', 'ps', 'ckb', 'he', 'yi', 'ug', 'sd', 'dv'])

function pageLang(html: string): string {
  const match = /<html\b[^>]*\blang\s*=\s*["']?([A-Za-z-]+)/i.exec(html)
  return (match?.[1] ?? '').toLowerCase().split('-')[0] ?? ''
}

/**
 * 西文数字：RTL 语系页面正文里直接写 ASCII 数字。
 * fa-IR 用 ۰-۹、ar-SA 用 ٠-٩；日期还需 Jalali / Hijri 历。
 */
export function checkWesternDigitsRtl(ctx: RuleContext): RuleFinding[] {
  const lang = pageLang(ctx.html)
  if (!RTL_LANGS.has(lang)) return []
  /* 只看正文：样式表（buildContext 保留原文）与脚本里的数字都不算用户可见文案。 */
  const bodyOnly = ctx.html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  const text = decodeEntities(bodyOnly.replace(/<[^>]+>/g, ' '))
  const hit = /\d/.exec(text)
  if (!hit) return []
  const offset = bodyOnly.indexOf(hit[0])
  return [
    {
      rule: 'western-digits-rtl',
      offset: Math.max(0, offset),
      message: `页面 lang="${lang}" 属 RTL 语系，正文里的 ASCII 数字应交给 Intl.NumberFormat（fa-IR 为 ۰-۹、ar-SA 为 ٠-٩）；日期还需 Jalali / Hijri 历`,
      severity: 'advisory',
    },
  ]
}
