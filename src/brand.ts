/**
 * 品牌记忆：把「这个项目长这样」沉淀成跨会话、跨页面的长期上下文。
 *
 * 存 `.tianshu-canvas/memory/brand.json`（工作区内，随 .tianshu-canvas/ 一起被 gitignore）。
 * 与 project.json 分开的原因：inspectProject 只重建已知字段，未知顶层字段会被写回时丢弃。
 *
 * 原则：
 *  - 记忆是**可推导数据的缓存**，不参与设计系统校验，坏了可以删；
 *  - updatedAt 只用于展示，不参与 checksum 与任何 diff 比较（保证品牌包可复现）；
 *  - 品牌包是可移植的单 JSON，导出 → 换机器 → 导入后视觉一致。
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { customStyleDir, libraryDir } from './designCustom.js'
import { projectDir } from './project.js'
import { readTextInWorkspace, writeFileAtomic, writeFileInWorkspace } from './paths.js'
import { stableHash } from './adapters/color.js'

export function memoryDir(cwd: string): string {
  return join(projectDir(cwd), 'memory')
}

export function memoryFile(cwd: string): string {
  return join(memoryDir(cwd), 'brand.json')
}

export interface StyleMemory {
  usage: {
    /** 组件类 → 使用次数。 */
    components: Record<string, number>
    /** 图标名 → 使用次数。 */
    icons: Record<string, number>
    /** 变量名 → 使用次数。 */
    tokens: Record<string, number>
  }
  /** 审计命中记录：规则 → { 次数, 最近一次是什么时候（仅供展示） }。 */
  checks: Record<string, { count: number; lastSeen: string }>
  /** 数据来源。 */
  sources: { kind: 'extract' | 'create' | 'codegen' | 'audit' | 'import'; ref: string }[]
}

export interface BrandMemory {
  schemaVersion: 1
  /** 仅供展示，不参与 checksum。 */
  updatedAt: string | null
  styles: Record<string, StyleMemory>
}

const EMPTY: BrandMemory = { schemaVersion: 1, updatedAt: null, styles: {} }

function emptyStyleMemory(): StyleMemory {
  return { usage: { components: {}, icons: {}, tokens: {} }, checks: {}, sources: [] }
}

/** 读记忆；文件不存在或损坏都返回空记忆（记忆不是权威数据）。 */
export function readMemory(cwd: string): BrandMemory {
  const file = memoryFile(cwd)
  if (!existsSync(file)) return { ...EMPTY, styles: {} }
  try {
    const parsed = JSON.parse(readTextInWorkspace(cwd, file, '品牌记忆')) as BrandMemory
    if (parsed.schemaVersion !== 1 || typeof parsed.styles !== 'object' || parsed.styles === null) {
      return { ...EMPTY, styles: {} }
    }
    return parsed
  } catch {
    return { ...EMPTY, styles: {} }
  }
}

function writeMemory(cwd: string, memory: BrandMemory): void {
  // 品牌记忆是隐式写入：走统一边界 + 独占随机临时文件，不跟随被预置的叶子链接。
  writeFileInWorkspace(cwd, memoryFile(cwd), JSON.stringify(memory, null, 2).replace(/\r\n/g, '\n') + '\n', '品牌记忆')
}

/** 从页面 HTML 统计组件/图标/变量用量。 */
export function usageFromHtml(html: string): { components: Record<string, number>; icons: Record<string, number>; tokens: Record<string, number> } {
  const components: Record<string, number> = {}
  for (const m of html.matchAll(/class\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    for (const token of (m[1] ?? m[2] ?? '').split(/\s+/)) {
      if (token.startsWith('ts-')) components[token] = (components[token] ?? 0) + 1
    }
  }
  const icons: Record<string, number> = {}
  for (const m of html.matchAll(/data-icon\s*=\s*"([^"]+)"/g)) icons[m[1]!] = (icons[m[1]!] ?? 0) + 1
  const tokens: Record<string, number> = {}
  for (const m of html.matchAll(/var\(\s*(--ts-[A-Za-z0-9-]+)/g)) tokens[m[1]!] = (tokens[m[1]!] ?? 0) + 1
  return { components, icons, tokens }
}

const now = (): string => new Date().toISOString()

function mergeCounts(target: Record<string, number>, add: Record<string, number>): void {
  for (const [key, value] of Object.entries(add)) target[key] = (target[key] ?? 0) + value
}

export interface RecordInput {
  styleId: string
  /** 本次涉及的页面 HTML。 */
  htmls?: string[]
  /** 审计命中：规则 → 次数。 */
  checks?: Record<string, number>
  source: { kind: StyleMemory['sources'][number]['kind']; ref: string }
}

/** 累加一次使用记录（幂等合并计数，不覆盖既有数据）。 */
export function recordUsage(cwd: string, input: RecordInput): BrandMemory {
  const memory = readMemory(cwd)
  const style = memory.styles[input.styleId] ?? emptyStyleMemory()
  for (const html of input.htmls ?? []) {
    const usage = usageFromHtml(html)
    mergeCounts(style.usage.components, usage.components)
    mergeCounts(style.usage.icons, usage.icons)
    mergeCounts(style.usage.tokens, usage.tokens)
  }
  const stamp = now()
  for (const [rule, count] of Object.entries(input.checks ?? {})) {
    const current = style.checks[rule] ?? { count: 0, lastSeen: stamp }
    style.checks[rule] = { count: current.count + count, lastSeen: stamp }
  }
  const key = `${input.source.kind}:${input.source.ref}`
  if (!style.sources.some((s) => `${s.kind}:${s.ref}` === key)) style.sources.push(input.source)
  memory.styles[input.styleId] = style
  memory.updatedAt = stamp
  writeMemory(cwd, memory)
  return memory
}

/** 删除某风格的记忆（风格被删除时调用，避免悬空引用）。 */
export function forgetStyle(cwd: string, styleId: string): void {
  const memory = readMemory(cwd)
  if (!(styleId in memory.styles)) return
  delete memory.styles[styleId]
  memory.updatedAt = now()
  writeMemory(cwd, memory)
}

/** 一行摘要（给 canvas_get_state / design_system get 用）。 */
export function memorySummary(cwd: string, styleId: string): string | null {
  const style = readMemory(cwd).styles[styleId]
  if (!style) return null
  const components = Object.entries(style.usage.components).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const icons = Object.entries(style.usage.icons).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const checks = Object.entries(style.checks).sort((a, b) => b[1].count - a[1].count).slice(0, 5)
  const parts = [`品牌记忆：${style.sources.length} 个来源`]
  if (components.length) parts.push(`常用组件 ${components.map(([k, v]) => `${k}×${v}`).join('、')}`)
  if (icons.length) parts.push(`常用图标 ${icons.map(([k, v]) => `${k}×${v}`).join('、')}`)
  if (checks.length) parts.push(`反复命中 ${checks.map(([k, v]) => `${k}×${v.count}`).join('、')}`)
  return parts.join('；')
}

// ---------------------------------------------------------------------------
// 品牌包（导出 / 导入）
// ---------------------------------------------------------------------------

export interface BrandPack {
  schemaVersion: 1
  id: string
  name: string
  tokens: Record<string, unknown>
  meta: Record<string, unknown>
  usage: StyleMemory['usage']
  checks: StyleMemory['checks']
  /** 除 checksum 外全部内容的稳定 hash。 */
  checksum: string
}

/** 读取自定义风格的 tokens/meta 并打包（不含时间戳，可复现）。 */
export function buildBrandPack(cwd: string, styleId: string, builtinDir: string): BrandPack {
  void builtinDir
  const dir = customStyleDir(cwd, styleId)
  const tokensFile = join(dir, 'tokens.json')
  const metaFile = join(dir, 'meta.json')
  if (!existsSync(tokensFile) || !existsSync(metaFile)) {
    throw new Error(`「${styleId}」不是自定义设计系统（内置风格不能导出为品牌包）。`)
  }
  const tokens = JSON.parse(readTextInWorkspace(cwd, tokensFile, '自定义风格 tokens')) as Record<string, unknown>
  const meta = JSON.parse(readTextInWorkspace(cwd, metaFile, '自定义风格 meta')) as Record<string, unknown>
  const memory = readMemory(cwd).styles[styleId] ?? emptyStyleMemory()
  const payload = {
    schemaVersion: 1 as const,
    id: String(meta.id ?? styleId),
    name: String(meta.name ?? styleId),
    tokens,
    meta,
    usage: memory.usage,
    checks: memory.checks,
  }
  return { ...payload, checksum: stableHash(payload) }
}

/** 校验品牌包：结构与 checksum。返回错误信息数组（空表示通过）。 */
export function verifyBrandPack(pack: unknown): string[] {
  const errors: string[] = []
  const p = pack as Partial<BrandPack>
  if (!p || typeof p !== 'object') return ['品牌包不是对象']
  if (p.schemaVersion !== 1) errors.push(`schemaVersion 必须是 1（收到 ${String(p.schemaVersion)}）`)
  if (typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.id)) errors.push('id 非法（字母数字/_/-，1–64 位）')
  if (!p.tokens || typeof p.tokens !== 'object') errors.push('缺少 tokens')
  if (!p.meta || typeof p.meta !== 'object') errors.push('缺少 meta')
  if (typeof p.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(p.checksum)) errors.push('checksum 缺失或格式非法')
  if (errors.length === 0) {
    const { checksum, ...payload } = p as BrandPack
    if (stableHash(payload) !== checksum) errors.push('checksum 不匹配：文件被修改或损坏')
  }
  return errors
}

/** 导出到文件（由调用方决定路径，默认 .tianshu-canvas/exports/<id>.json）。 */
export function exportBrandPack(cwd: string, pack: BrandPack, file: string): void {
  // 稳定序列化：同一品牌包重复导出字节一致。
  const ordered = {
    schemaVersion: pack.schemaVersion,
    id: pack.id,
    name: pack.name,
    tokens: pack.tokens,
    meta: pack.meta,
    usage: pack.usage,
    checks: pack.checks,
    checksum: pack.checksum,
  }
  const data = JSON.stringify(ordered, null, 2).replace(/\r\n/g, '\n') + '\n'
  // 工作区内走边界校验后落盘；工作区外按用户显式指定的出口路径（仍用独占随机临时文件）。
  mkdirSync(dirname(resolve(file)), { recursive: true })
  if (file.startsWith(projectDir(cwd))) writeFileInWorkspace(cwd, file, data, '品牌包')
  else writeFileAtomic(cwd, file, data)
}

/** 导入：写回 library/<id>，并恢复用量记忆。调用方负责过 validateTokens 与重名检查。 */
export function importBrandPack(cwd: string, pack: BrandPack): void {
  const dir = join(libraryDir(cwd), pack.id)
  const write = (name: string, value: unknown): void => {
    writeFileInWorkspace(cwd, join(dir, name), JSON.stringify(value, null, 2).replace(/\r\n/g, '\n') + '\n')
  }
  write('tokens.json', pack.tokens)
  write('meta.json', pack.meta)
  const memory = readMemory(cwd)
  memory.styles[pack.id] = {
    usage: pack.usage,
    checks: pack.checks,
    sources: [{ kind: 'import', ref: pack.name }],
  }
  memory.updatedAt = now()
  writeMemory(cwd, memory)
}
