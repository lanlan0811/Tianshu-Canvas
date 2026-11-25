/**
 * 工艺规则引擎：构建一次上下文，按模式画像与忽略集跑所有源码级规则。
 *
 * 这里只做「跑规则 + 归一输出」；行号、截断、汇总由 lint 层负责。
 */
import {
  inlineStyleBlocks,
  lineIndex,
  lineOf,
  mask,
  maskUrls,
  ruleBlocks,
  styleSegments,
  type CssDeclaration,
} from '../cssParse.js'
import type { DesignManifest } from '../design.js'
import type { SurfaceMode } from '../modes.js'
import { checkBorders } from './cssBorders.js'
import { checkAiPalette, checkCreamPalette, checkGradientText, checkGrayOnColor, checkRadialHalo } from './cssColor.js'
import { checkBounceEasing, checkOverusedFont } from './cssType.js'
import { checkGridBackground, checkHardOffsetShadow, checkMarquee, checkRepeatingStripes } from './cssTexture.js'
import { allDeclarations } from './decls.js'
import { checkEmojiIcon } from './htmlPatterns.js'
import { checkAphoristicCadence, checkEmDashOveruse, checkMarketingBuzzword } from './pageCopy.js'
import { checkMonotonousSpacing } from './pageSpacing.js'
import { activeRules, degradesToAdvisory } from './profiles.js'
import { getRule } from './registry.js'
import type { RuleCheck, RuleContext, RuleFinding } from './types.js'

const CHECKS: Record<string, RuleCheck> = {
  'side-tab': checkBorders,
  'border-accent-on-rounded': checkBorders,
  'overused-font': checkOverusedFont,
  'bounce-easing': checkBounceEasing,
  'gradient-text': checkGradientText,
  'ai-color-palette': checkAiPalette,
  'cream-palette': checkCreamPalette,
  'gray-on-color': checkGrayOnColor,
  'radial-halo': checkRadialHalo,
  'hard-offset-shadow': checkHardOffsetShadow,
  'repeating-stripes-gradient': checkRepeatingStripes,
  'codex-grid-background': checkGridBackground,
  marquee: checkMarquee,
  'monotonous-spacing': checkMonotonousSpacing,
  'em-dash-overuse': checkEmDashOveruse,
  'marketing-buzzword': checkMarketingBuzzword,
  'aphoristic-cadence': checkAphoristicCadence,
  'emoji-icon': checkEmojiIcon,
}

export interface RunOptions {
  manifest: DesignManifest | null
  mode: SurfaceMode | null
  /** 只跑这些规则 id；null 表示全部。 */
  only: Set<string> | null
  /** 本次运行额外忽略的规则 id。 */
  ignore: Set<string>
}

/** 构建规则上下文：掩码、规则块、内联样式。 */
export function buildContext(html: string, manifest: DesignManifest | null, mode: SurfaceMode | null): RuleContext {
  let masked = html
    .replace(/<!--tianshu-ds:start[^>]*-->[\s\S]*?<!--tianshu-ds:end-->/g, mask)
    .replace(/<script\b[\s\S]*?<\/script>/gi, mask)
    .replace(/<!--[\s\S]*?-->/g, mask)
  masked = maskUrls(masked)
  // 只对含大括号的片段跑 ruleBlocks：那就是 <style> 体；
  // 内联 style 属性没有大括号，改由 inlineStyleBlocks 提供带元素上下文的规则块。
  const blocks = styleSegments(masked)
    .filter((segment) => segment.text.includes('{'))
    .flatMap((segment) => ruleBlocks(segment.text, segment.start))
  const inlineBlocks = inlineStyleBlocks(masked)
  const inlineDecls: CssDeclaration[] = inlineBlocks.flatMap((b) => b.decls)
  // 内联样式也作为规则块参与「同块相关性」判定，选择器用标签 + 类名。
  const inlineAsBlocks = inlineBlocks
    .filter((b) => b.decls.length > 0)
    .map((b) => ({
      selector: [b.tag, ...b.classes.map((c) => `.${c}`)].filter(Boolean).join(''),
      selectorOffset: b.offset,
      start: b.offset,
      end: b.offset,
      decls: b.decls,
      atRule: null,
    }))
  return { html, masked, blocks: [...blocks, ...inlineAsBlocks], inlineBlocks, inlineDecls, manifest, mode }
}

/**
 * 跑所有启用的源码级规则。
 *
 * 返回的 finding 已按模式降级、去重、按偏移排序；不做行号转换。
 * 一个 check 可能服务多条规则（边框类），因此按 check 去重只跑一次，
 * 再按每条 finding 自己的规则 id 过滤 / 降级。
 */
export function runSourceRules(html: string, options: RunOptions): RuleFinding[] {
  const ctx = buildContext(html, options.manifest, options.mode)
  const out: RuleFinding[] = []
  const seen = new Set<string>()
  const ran = new Set<string>()
  for (const rule of activeRules(options.mode)) {
    if (options.only && !options.only.has(rule.id)) continue
    if (options.ignore.has(rule.id)) continue
    const check = CHECKS[rule.id]
    // checks 用函数引用登记，按规则 id 反查；去重键用 id 级映射，避免同一 check 跑两次。
    if (!check || ran.has(checkKey(check))) continue
    ran.add(checkKey(check))
    for (const finding of check(ctx)) {
      const def = getRule(finding.rule)
      if (!def) continue
      if (options.only && !options.only.has(def.id)) continue
      if (options.ignore.has(def.id)) continue
      const key = `${finding.rule}:${finding.offset}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...finding, severity: degradesToAdvisory(def, options.mode) ? 'advisory' : def.severity })
    }
  }
  out.sort((a, b) => a.offset - b.offset)
  return out
}

const CHECK_KEYS = new Map<RuleCheck, string>()
function checkKey(check: RuleCheck): string {
  let key = CHECK_KEYS.get(check)
  if (!key) {
    key = check.name || String(CHECK_KEYS.size)
    CHECK_KEYS.set(check, key)
  }
  return key
}

/** 把 finding 偏移转成行号（报告用）。 */
export function withLines(html: string, findings: RuleFinding[]): Array<RuleFinding & { line: number }> {
  const index = lineIndex(html)
  return findings.map((f) => ({ ...f, line: lineOf(index, f.offset) }))
}
