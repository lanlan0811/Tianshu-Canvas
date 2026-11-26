/**
 * 漂移检测：比较两份设计快照，回答「这次改版哪里偏离了规范」。
 *
 * 快照是纯数据（可提交、可 diff）：
 *   { styleId, vars, usedVars, classes, icons, components, hashes }
 * 四类差集：新增 / 移除 / 未使用 / 越界。
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readTextInWorkspace, writeFileInWorkspace } from '../paths.js'
import type { DesignManifest } from '../design.js'
import { loadComponentContract } from '../design/components.js'
import { STATE_MARKERS, selectorTexts } from '../../scripts/design/design-validate.mjs'
import { collectUsage } from './contract.js'

export interface DesignSnapshot {
  schemaVersion: 2
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
  /** 各页面的模式（按项目节点顺序；未声明的页面为 null）。 */
  modes: (string | null)[]
  /** 设计系统侧：各组件在 components.css 里真实有选择器的状态（不含 default）。 */
  usedStates: { component: string; states: string[] }[]
  /** 实际存在的浏览器表面标记。 */
  browserSurfaces: string[]
  /** 注入块与 manifest 的内容指纹（跨版本比较用）。 */
  hashes: { tokens: string; components: string }
  /** 仅内存标记：基线来自 schemaVersion 1 的旧快照（不落盘，见 writeSnapshot）。 */
  upgradedFromV1?: boolean
}

/** 浏览器表面清单（与 test/design.states.test.mjs 的断言同源）。 */
const BROWSER_SURFACES = [
  '::selection',
  'caret-color',
  'scrollbar-color',
  'scrollbar-width',
  '::-webkit-scrollbar-thumb',
  'text-underline-offset',
  'tabular-nums',
] as const

function hash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12)
}

/**
 * 设计系统侧的状态覆盖：对每个组件、每个声明状态，
 * 找「组件类 + 状态标记」是否出现在同一选择器里（与构建期 validateStateContract 同口径）。
 * 口径常量来自 scripts/design/design-validate.mjs，避免两套判定分叉。
 */
function collectUsedStates(componentsCss: string): { component: string; states: string[] }[] {
  let contract
  try {
    contract = loadComponentContract()
  } catch {
    /* 产物缺失不阻断漂移（例如旧 dist）：如实返回空并让调用方在报告里看到「未采集」。 */
    return []
  }
  const selectors = selectorTexts(componentsCss)
  return contract.components.map((component) => {
    const owned = component.classes.filter(Boolean)
    const states: string[] = []
    for (const state of component.states) {
      if (state === 'default') continue
      const markers = (STATE_MARKERS as Record<string, string[]>)[state]
      if (!markers) continue
      const found = selectors.some((selector) => {
        if (!owned.some((c) => selector.includes(`.${c}`))) return false
        return markers.some((marker) => selector.includes(marker))
      })
      if (found) states.push(state)
    }
    return { component: component.id, states: states.sort() }
  })
}

function collectBrowserSurfaces(componentsCss: string): string[] {
  return BROWSER_SURFACES.filter((marker) => componentsCss.includes(marker))
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
  /** 各页面模式，按 project.nodes 顺序；省略视为全部未声明。 */
  modes?: (string | null)[]
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
    schemaVersion: 2,
    styleId: input.styleId,
    vars: [...(input.manifest?.vars ?? [...vars])].sort(),
    declaredClasses: [...(input.manifest?.componentClasses ?? [...classes])].sort(),
    usedVars: [...usedVars].sort(),
    classes: [...classes].sort(),
    icons: [...icons].sort(),
    modes: input.modes ?? input.htmls.map(() => null),
    usedStates: collectUsedStates(input.componentsCss),
    browserSurfaces: collectBrowserSurfaces(input.componentsCss),
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
  /** 各页面模式是否变化（含顺序与 null）。 */
  modesChanged: boolean
  modesBefore: (string | null)[]
  modesAfter: (string | null)[]
  /** 组件状态覆盖的增减，形如 `button:hover`。 */
  statesAdded: string[]
  statesRemoved: string[]
  /** 浏览器表面的增减。 */
  surfacesAdded: string[]
  surfacesRemoved: string[]
  /** 旧版快照升级后补齐的字段（非空时报告要注明基线来自旧版）。 */
  upgradedFromV1: boolean
}

function flattenStates(entries: { component: string; states: string[] }[]): Set<string> {
  const out = new Set<string>()
  for (const entry of entries) for (const state of entry.states) out.add(`${entry.component}:${state}`)
  return out
}

export function diffSnapshots(before: DesignSnapshot, after: DesignSnapshot): DriftResult {
  const diff = (a: string[], b: string[]): string[] => {
    const set = new Set(b)
    return a.filter((x) => !set.has(x))
  }
  const added = [...diff([...after.vars, ...after.classes, ...after.icons], [...before.vars, ...before.classes, ...before.icons])]
  const removed = [...diff([...before.vars, ...before.classes, ...before.icons], [...after.vars, ...after.classes, ...after.icons])]
  const declared = new Set([...after.vars, ...after.declaredClasses])
  const statesBefore = flattenStates(before.usedStates ?? [])
  const statesAfter = flattenStates(after.usedStates ?? [])
  return {
    styleChanged: before.styleId !== after.styleId,
    added: added.sort(),
    removed: removed.sort(),
    unused: after.vars.filter((v) => !new Set(after.usedVars).has(v)),
    unknown: [...new Set([...after.usedVars, ...after.classes])].filter((x) => !declared.has(x)).sort(),
    tokensChanged: before.hashes.tokens !== after.hashes.tokens,
    componentsChanged: before.hashes.components !== after.hashes.components,
    modesChanged: JSON.stringify(before.modes ?? []) !== JSON.stringify(after.modes ?? []),
    modesBefore: before.modes ?? [],
    modesAfter: after.modes ?? [],
    statesAdded: [...statesAfter].filter((x) => !statesBefore.has(x)).sort(),
    statesRemoved: [...statesBefore].filter((x) => !statesAfter.has(x)).sort(),
    surfacesAdded: [...(after.browserSurfaces ?? [])].filter((x) => !(before.browserSurfaces ?? []).includes(x)).sort(),
    surfacesRemoved: [...(before.browserSurfaces ?? [])].filter((x) => !(after.browserSurfaces ?? []).includes(x)).sort(),
    upgradedFromV1: before.upgradedFromV1 === true,
  }
}

/** 读快照文件；不存在返回 null。旧版（schemaVersion 1）补齐新字段并标记，供报告注明。 */
export function readSnapshot(cwd: string, file: string): DesignSnapshot | null {
  if (!existsSync(file)) return null
  try {
    /* 旧快照（schemaVersion 1）没有新字段：补齐并标记，报告里必须注明基线来自旧版。 */
    const parsed = JSON.parse(readTextInWorkspace(cwd, file, '设计快照')) as {
      schemaVersion?: number
      styleId?: string | null
      vars?: string[]
      declaredClasses?: string[]
      usedVars?: string[]
      classes?: string[]
      icons?: string[]
      modes?: (string | null)[]
      usedStates?: { component: string; states: string[] }[]
      browserSurfaces?: string[]
      hashes?: { tokens: string; components: string }
    }
    const isV1 = parsed.schemaVersion === 1
    return {
      schemaVersion: 2,
      styleId: parsed.styleId ?? null,
      vars: parsed.vars ?? [],
      declaredClasses: parsed.declaredClasses ?? [],
      usedVars: parsed.usedVars ?? [],
      classes: parsed.classes ?? [],
      icons: parsed.icons ?? [],
      modes: parsed.modes ?? [],
      usedStates: parsed.usedStates ?? [],
      browserSurfaces: parsed.browserSurfaces ?? [],
      hashes: parsed.hashes ?? { tokens: '', components: '' },
      // 旧快照标记放在快照对象之外会丢失，这里用只读附加字段随对象带出。
      ...(isV1 ? { upgradedFromV1: true } : {}),
    } as DesignSnapshot
  } catch {
    return null
  }
}

/** 原子写快照（走统一边界 + 独占随机临时文件）。 */
export function writeSnapshot(cwd: string, file: string, snapshot: DesignSnapshot): void {
  writeFileInWorkspace(cwd, file, JSON.stringify(snapshot, null, 2).replace(/\r\n/g, '\n') + '\n', '设计快照')
}

const MAX_LIST = 12
const listOf = (items: string[]): string => items.slice(0, MAX_LIST).join('、') + (items.length > MAX_LIST ? ' …' : '')

function modeLabel(modes: (string | null)[]): string {
  if (modes.length === 0) return '未声明'
  return modes.map((m) => m ?? '未声明').join(' / ')
}

/**
 * 漂移报告：按严重度从高到低排（越界 > 未使用 > 移除 > 新增），
 * 模式 / 组件状态 / 浏览器表面的变化各自单列。空段不打印。
 */
export function formatDriftReport(result: DriftResult, before: string, after: string): string {
  const lines = [`设计漂移：${before} → ${after}`]
  const head = [
    `风格：${result.styleChanged ? '已更换' : '未变'}`,
    `token：${result.tokensChanged ? '已变' : '未变'}`,
    `组件：${result.componentsChanged ? '已变' : '未变'}`,
  ]
  if (result.modesChanged) head.push(`模式：${modeLabel(result.modesBefore)} → ${modeLabel(result.modesAfter)}`)
  if (result.surfacesAdded.length || result.surfacesRemoved.length) {
    head.push(`浏览器表面：+${result.surfacesAdded.length}/-${result.surfacesRemoved.length}`)
  }
  lines.push(head.join(' · '))
  if (result.upgradedFromV1) lines.push('基线来自旧版快照，已补齐新字段后比较。')

  if (result.unknown.length) lines.push(`越界 ${result.unknown.length} 项（页面用了但未声明）：${listOf(result.unknown)}`)
  if (result.unused.length) lines.push(`未使用 ${result.unused.length} 项：${listOf(result.unused)}`)
  if (result.removed.length) lines.push(`移除 ${result.removed.length} 项：${listOf(result.removed)}`)
  if (result.added.length) lines.push(`新增 ${result.added.length} 项：${listOf(result.added)}`)
  if (result.statesRemoved.length) lines.push(`丢失的组件状态 ${result.statesRemoved.length} 项：${listOf(result.statesRemoved)}`)
  if (result.statesAdded.length) lines.push(`新增的组件状态 ${result.statesAdded.length} 项：${listOf(result.statesAdded)}`)
  if (result.surfacesAdded.length) lines.push(`新增的浏览器表面：${listOf(result.surfacesAdded)}`)
  if (result.surfacesRemoved.length) lines.push(`丢失的浏览器表面：${listOf(result.surfacesRemoved)}`)

  const nothing =
    !result.added.length && !result.removed.length && !result.unknown.length && !result.unused.length &&
    !result.tokensChanged && !result.componentsChanged && !result.styleChanged && !result.modesChanged &&
    !result.statesAdded.length && !result.statesRemoved.length &&
    !result.surfacesAdded.length && !result.surfacesRemoved.length
  if (nothing) lines.push('未检测到漂移。')
  return lines.join('\n')
}
