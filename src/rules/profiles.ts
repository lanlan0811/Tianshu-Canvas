/**
 * 模式画像：按页面模式决定每条工艺规则的开关。
 *
 * 未在 `modes` 中声明的模式使用默认（on）；`advisory` 表示降级为建议。
 */
import type { SurfaceMode } from '../modes.js'
import { RULES } from './registry.js'
import type { ModeRuleState, RuleDef } from './types.js'

export function ruleStateFor(rule: RuleDef, mode: SurfaceMode | null): ModeRuleState {
  if (!mode) return 'on'
  return rule.modes?.[mode] ?? 'on'
}

/** 在给定模式下实际要运行的规则（off 的被排除）。 */
export function activeRules(mode: SurfaceMode | null): RuleDef[] {
  return RULES.filter((rule) => rule.engine === 'source' && ruleStateFor(rule, mode) !== 'off')
}

/** 该规则在该模式下是否降级为 advisory。 */
export function degradesToAdvisory(rule: RuleDef, mode: SurfaceMode | null): boolean {
  return ruleStateFor(rule, mode) === 'advisory'
}
