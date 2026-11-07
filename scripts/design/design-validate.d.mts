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

export { buildManifest }
