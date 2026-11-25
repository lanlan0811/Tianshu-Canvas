/**
 * 工艺规则的公共类型与上下文。
 *
 * 规则分两类：
 *  - slop：AI 生成界面的套路（紫蓝渐变、奶油底、侧色条、pill 上方的 eyebrow…）
 *  - quality：通用质量问题（行高过紧、正文字号过小、间距单调…）
 *
 * engine 表示规则需要的输入层级：
 *  - source：只读 HTML/CSS 文本（零浏览器，确定性）
 *  - render：需要真实渲染后的几何（走 Puppeteer 通道）
 */
import type { SurfaceMode } from '../modes.js'
import type { CssDeclaration, CssRuleBlock, InlineStyleBlock } from '../cssParse.js'
import type { DesignManifest } from '../design.js'

export type RuleCategory = 'slop' | 'quality'
export type RuleSeverity = 'warning' | 'advisory'
export type RuleEngineKind = 'source' | 'render'
/** 模式画像：on 正常、advisory 降级为建议、off 不跑。 */
export type ModeRuleState = 'on' | 'advisory' | 'off'

export interface RuleDef {
  /** kebab-case；与 impeccable 同名便于溯源。 */
  id: string
  category: RuleCategory
  severity: RuleSeverity
  engine: RuleEngineKind
  name: string
  description: string
  fix: string
  /** 按页面模式覆盖；未列出的模式使用默认（on）。 */
  modes?: Partial<Record<SurfaceMode, ModeRuleState>>
  /** 溯源：判据来源（impeccable 仓库相对路径）。 */
  origin: string
  /** 未锁定风格（自由发挥）时是否运行。 */
  free: boolean
}

/** 一条工艺发现的原始形态（行号由 lint 层补）。 */
export interface RuleFinding {
  rule: string
  offset: number
  message: string
  severity: RuleSeverity
}

/** 一次 lint 里所有规则共享的上下文（构建一次，避免重复解析）。 */
export interface RuleContext {
  /** 原始 HTML（未掩码）。 */
  html: string
  /** 掩码后的 HTML：脚本 / 注释 / 注入块 / url() / data: 均为等长空白。 */
  masked: string
  /** 全部 `<style>` 与 `style="..."` 的规则块。 */
  blocks: CssRuleBlock[]
  /** 所有带 style 属性的元素上下文。 */
  inlineBlocks: InlineStyleBlock[]
  /** 内联 style 展开后的声明（带元素上下文，供按标签/角色判定）。 */
  inlineDecls: CssDeclaration[]
  /** 当前风格 manifest；未锁定风格时为 null。 */
  manifest: DesignManifest | null
  mode: SurfaceMode | null
}

export type RuleCheck = (ctx: RuleContext) => RuleFinding[]
