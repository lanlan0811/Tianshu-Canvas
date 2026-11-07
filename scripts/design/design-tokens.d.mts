/**
 * `design-tokens.mjs` 的类型声明。
 *
 * 该模块是构建期与运行时共用的纯函数（无 IO），源码为 ESM `.mjs`；
 * 运行时 `src/designCustom.ts` 直接 import 它，esbuild 会把它打进 dist/index.mjs。
 * tsc 通过本文件解析类型（NodeNext 下 `.mjs` 旁边放同名 `.d.mts`）。
 *
 * 只声明运行时实际用到的导出；内部结构用宽松类型，避免与 mjs 实现漂移。
 */

export interface TokenVar {
  name: string
  value: string
}

export interface SemanticEntry {
  value: string
  primitive: string | null
}

export interface FlattenResult {
  vars: TokenVar[]
  resolvedSemantic: Record<string, SemanticEntry>
}

export interface DesignManifest {
  schema: string
  id: string
  version: number
  vars: string[]
  spacing: number[]
  radius: number[]
  fontFamilies: string[]
  iconNames: string[]
  componentClasses: string[]
  interactionClasses: string[]
  interactionIds: string[]
  resolvedSemantic: Record<string, SemanticEntry>
}

export type Tokens = Record<string, any>

export function isHex(value: unknown): boolean
export function kebab(key: string): string
export function isPrimitiveRef(value: unknown): boolean
export function resolveColor(
  tokens: Tokens,
  value: unknown,
  trail?: string[],
): { value: string; primitive?: string }
export function flattenTokens(tokens: Tokens): FlattenResult
export function hasDarkMode(tokens: Tokens): boolean
export function flattenDarkSemantic(tokens: Tokens): TokenVar[]
export function tokensToCss(tokens: Tokens): string
export function buildManifest(
  tokens: Tokens,
  options: { icons: string[]; componentClasses: string[]; interactionClasses?: string[]; interactionIds?: string[] },
): DesignManifest
export function luminance(hex: string): number
export function parseHex(hex: string): number[] | null
export function contrast(a: string, b: string): number
