/**
 * 漂移检测：比较两份设计快照，回答「这次改版哪里偏离了规范」。
 *
 * 快照是纯数据（可提交、可 diff）：
 *   { styleId, vars, usedVars, classes, icons, components, hashes }
 * 四类差集：新增 / 移除 / 未使用 / 越界。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DesignManifest } from '../design.js'
import { collectUsage } from './contract.js'

export interface DesignSnapshot {
  schemaVersion: 1
  styleId: string | null
  /** manifest 声明的全部变量。 */
  vars: string[]
  /** manifest 声明的全部组件类（用于判断「越界类」）。 */
  declaredClasses: string[]
  /** 页面实际使用的变量。 */
  usedVars: string[]
  /** 页面使用的组件类。 */
  classes: string[]
  icons: string[]
  /** 注入块与 manifest 的内容指纹（跨版本比较用）。 */
  hashes: { tokens: string; components: string }
}

function hash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12)
}

export function snapshotDir(cwd: string): string {
  return join(cwd, '.tianshu-canvas', 'audit')
}

export function buildSnapshot(input: {
  styleId: string | null
  htmls: string[]
  manifest: DesignManifest | null
  tokensCss: string
  componentsCss: string
  icons: string[]
}): DesignSnapshot {
  const vars = new Set<string>()
  const usedVars = new Set<string>()
  const classes = new Set<string>()
  const icons = new Set<string>()
  for (const html of input.htmls) {
    const usage = collectUsage(html, input.manifest)
    usage.vars.forEach((v) => vars.add(v))
    usage.vars.forEach((v) => usedVars.add(v))
    usage.classes.forEach((c) => classes.add(c))
    for (const m of html.matchAll(/data-icon\s*=\s*"([^"]+)"/g)) icons.add(m[1]!)
  }
  return {
    schemaVersion: 1,
    styleId: input.styleId,
    vars: [...(input.manifest?.vars ?? [...vars])].sort(),
    declaredClasses: [...(input.manifest?.componentClasses ?? [...classes])].sort(),
    usedVars: [...usedVars].sort(),
    classes: [...classes].sort(),
    icons: [...icons].sort(),
    hashes: { tokens: hash(input.tokensCss), components: hash(input.componentsCss) },
  }
}

export interface DriftResult {
  styleChanged: boolean
  /** 新增的变量/类/图标（旧快照没有）。 */
  added: string[]
  /** 移除的变量/类/图标（旧有新无）。 */
  removed: string[]
  /** 声明了但从未使用。 */
  unused: string[]
  /** 页面用了但声明里没有。 */
  unknown: string[]
  tokensChanged: boolean
  componentsChanged: boolean
}

export function diffSnapshots(before: DesignSnapshot, after: DesignSnapshot): DriftResult {
  const diff = (a: string[], b: string[]): string[] => {
    const set = new Set(b)
    return a.filter((x) => !set.has(x))
  }
  const added = [...diff([...after.vars, ...after.classes, ...after.icons], [...before.vars, ...before.classes, ...before.icons])]
  const removed = [...diff([...before.vars, ...before.classes, ...before.icons], [...after.vars, ...after.classes, ...after.icons])]
  const declared = new Set([...after.vars, ...after.declaredClasses])
  return {
    styleChanged: before.styleId !== after.styleId,
    added: added.sort(),
    removed: removed.sort(),
    unused: after.vars.filter((v) => !new Set(after.usedVars).has(v)),
    unknown: [...new Set([...after.usedVars, ...after.classes])].filter((x) => !declared.has(x)).sort(),
    tokensChanged: before.hashes.tokens !== after.hashes.tokens,
    componentsChanged: before.hashes.components !== after.hashes.components,
  }
}

/** 读快照文件；不存在返回 null。 */
export function readSnapshot(file: string): DesignSnapshot | null {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DesignSnapshot
  } catch {
    return null
  }
}

/** 原子写快照。 */
export function writeSnapshot(file: string, snapshot: DesignSnapshot): void {
  mkdirSync(join(file, '..'), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2).replace(/\r\n/g, '\n') + '\n', 'utf8')
  renameSync(tmp, file)
}

export function formatDriftReport(result: DriftResult, before: string, after: string): string {
  const lines = [`设计漂移：${before} → ${after}`]
  lines.push(`风格：${result.styleChanged ? '已更换' : '未变'} · token：${result.tokensChanged ? '已变' : '未变'} · 组件：${result.componentsChanged ? '已变' : '未变'}`)
  if (result.added.length) lines.push(`新增 ${result.added.length} 项：${result.added.slice(0, 12).join('、')}`)
  if (result.removed.length) lines.push(`移除 ${result.removed.length} 项：${result.removed.slice(0, 12).join('、')}`)
  if (result.unknown.length) lines.push(`越界 ${result.unknown.length} 项（页面用了但未声明）：${result.unknown.slice(0, 12).join('、')}`)
  if (result.unused.length) lines.push(`未使用 ${result.unused.length} 项`)
  if (!result.added.length && !result.removed.length && !result.unknown.length && !result.tokensChanged && !result.componentsChanged && !result.styleChanged) {
    lines.push('未检测到漂移。')
  }
  return lines.join('\n')
}
