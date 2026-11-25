/**
 * 声明集合的共享访问：避免规则模块与引擎互相 import（循环依赖）。
 */
import type { CssDeclaration } from '../cssParse.js'
import type { RuleContext } from './types.js'

/** 所有规则共享的声明集合（样式表 + 内联）。 */
export function allDeclarations(ctx: RuleContext): CssDeclaration[] {
  return [...ctx.blocks.flatMap((b) => b.decls), ...ctx.inlineDecls]
}
