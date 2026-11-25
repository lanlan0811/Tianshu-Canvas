/**
 * HTML 模式规则：emoji 当图标。
 */
import { findEmoji } from './textMath.js'
import type { RuleContext, RuleFinding } from './types.js'

/** 只查这些位置上的 emoji：按钮、链接、标题、独立的短文本（分节符）。 */
const ICON_TAG_RE = /<(button|a|h1|h2|h3|h4|summary)\b([^>]*)>([\s\S]*?)<\/\1>/gi
/** 独立短文本元素：整段只有一个 emoji 时视为分节符/图标位。 */
const SOLO_EMOJI_RE = /<(span|div|li|p|em|strong)\b([^>]*)>\s*([^<]{1,8})\s*<\/\1>/gi
const ARIA_ATTR_RE = /\b(?:aria-label|title)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi

export function checkEmojiIcon(ctx: RuleContext): RuleFinding[] {
  const out: RuleFinding[] = []
  const seen = new Set<number>()

  for (const m of ctx.masked.matchAll(ICON_TAG_RE)) {
    const attrs = m[2] ?? ''
    if (/\bdata-icon\s*=/.test(attrs)) continue // 已用图标名
    const inner = m[3] ?? ''
    const emoji = findEmoji(inner)
    if (emoji.length === 0) continue
    const offset = (m.index ?? 0) + m[0].indexOf(inner)
    if (seen.has(offset)) continue
    seen.add(offset)
    out.push({
      rule: 'emoji-icon',
      offset,
      message: `用 emoji（${emoji.map((e) => e.char).join('')}）充当图标/分节符；改用 <svg data-icon="名字" class="ts-icon">`,
      severity: 'warning',
    })
  }

  // 独立短文本元素里只有 emoji（分节符/图标位）
  for (const m of ctx.masked.matchAll(SOLO_EMOJI_RE)) {
    const attrs = m[2] ?? ''
    if (/data-icon\s*=/.test(attrs)) continue
    const text = (m[3] ?? '').trim()
    const emoji = findEmoji(text)
    if (emoji.length === 0) continue
    // 只有「整段就是 emoji」才算图标位；句子里夹一个 emoji 不算。
    if (text.replace(/\s/g, '').length > emoji.map((e) => e.char).join('').length) continue
    const offset = (m.index ?? 0) + m[0].indexOf(m[3] ?? '')
    if (seen.has(offset)) continue
    seen.add(offset)
    out.push({
      rule: 'emoji-icon',
      offset,
      message: `用 emoji（${emoji.map((e) => e.char).join('')}）充当图标/分节符；改用 <svg data-icon="名字" class="ts-icon">`,
      severity: 'warning',
    })
  }

  // aria-label / title 里的 emoji（图标按钮的可见名）
  for (const m of ctx.masked.matchAll(ARIA_ATTR_RE)) {
    const value = m[1] ?? m[2] ?? ''
    const emoji = findEmoji(value)
    if (emoji.length === 0) continue
    const offset = m.index ?? 0
    if (seen.has(offset)) continue
    seen.add(offset)
    out.push({
      rule: 'emoji-icon',
      offset,
      message: `可访问名里用了 emoji（${emoji.map((e) => e.char).join('')}）；改用图标目录里的 SVG`,
      severity: 'warning',
    })
  }
  return out
}
