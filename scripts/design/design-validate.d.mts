/**
 * `design-validate.mjs` 的类型声明（构建期与运行时共用的纯函数）。
 *
 * 见 `design-tokens.d.mts` 的说明；校验函数统一以 (errors, warnings) 数组收集问题，
 * 不抛错，由调用方决定如何呈现。
 */
import type { DesignManifest, Tokens } from './design-tokens.mjs'

export const REQUIRED_SEMANTIC: Record<string, string[]>

export function findBlockedResources(html: string): string[]
export function auditForbidden(label: string, text: string, errors: string[]): void

export function validateTokens(
  tokens: Tokens,
  expectedId: string,
  errors: string[],
  warnings: string[],
): boolean | null

export function validateColorSemantics(
  tokens: Tokens,
  semantic: unknown,
  prefix: string,
  errors: string[],
  warnings: string[],
): void

export function validateComponents(
  components: unknown,
  componentsCss: string,
  manifest: DesignManifest,
  errors: string[],
  warnings: string[],
): Set<string>

export function validateIcons(
  iconsDoc: unknown,
  expectedCoreNames: string[],
  errors: string[],
  warnings: string[],
): string[]

export function validateTemplates(
  templatesDoc: unknown,
  templatesDir: string,
  allClasses: Set<string>,
  iconNames: string[],
  manifest: DesignManifest | null,
  componentCatalog: Set<string>,
  errors: string[],
): { templates: any[]; dir: string; allClasses: Set<string>; iconSet: Set<string>; manifest: DesignManifest | null; errors: string[] }

export function validateTemplateHtml(
  label: string,
  html: string,
  template: { components?: string[]; icons?: string[] },
  allClasses: Set<string>,
  iconSet: Set<string>,
  manifest: DesignManifest,
  componentCatalog: Set<string>,
  errors: string[],
): void

export function validateConsistency(styles: unknown[], errors: string[]): void

export function validateInteractions(
  interactionsDoc: unknown,
  interactionsCss: string,
  interactionsJs: string,
  manifest: { vars: string[]; componentClasses: string[] },
  errors: string[],
  warnings: string[],
): { allClasses: Set<string>; ownClasses: string[]; ids: string[]; rootAttrs: string[] }

/** 状态标记口径（构建期校验与运行时漂移共用，避免两套判定分叉）。 */
export const STATE_MARKERS: Record<string, string[]>
/** 合法状态名全集。 */
export const ALL_STATES: string[]
/** 扫 CSS 里所有规则的选择器文本。 */
export function selectorTexts(css: string): string[]
/** 组件状态契约：声明必须在 components.css 里有对应选择器。 */
export function validateStateContract(components: unknown, componentsCss: string, errors: string[]): void
/** 交互库 ARIA 契约：声明必须真在运行时或骨架里出现。 */
export function validateInteractionA11y(interactionsDoc: unknown, interactionsJs: string, errors: string[]): void
/** 减少动效策略：禁止 animation/transition: none（除非显式豁免）。 */
export function validateReducedMotionPolicy(interactionsCss: string, errors: string[]): void
/** 评审量表结构校验。 */
export function validateRubric(doc: unknown, errors: string[]): void

export { buildManifest }
