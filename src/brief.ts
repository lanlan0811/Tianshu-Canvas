/** Page-local design intent. Confirmation is a user action, never inferred from HTML. */
import { InvalidInputError, assertSafeId } from './ids.js'
import { projectIssue, readProject, writeProject, withProjectTransaction, type ProjectTransaction } from './project.js'

export const DIRECTION_IDS = ['editorial-narrative', 'product-evidence', 'brand-poster'] as const
export type DirectionId = typeof DIRECTION_IDS[number]

/** Stable public IDs, deliberately independent of style IDs and private reference names. */
export const BRIEF_PROTOTYPE_IDS = [
  'product-story', 'editorial-casebook', 'product-showcase', 'saas-landing', 'pricing-reference', 'resource-catalog',
  'admin-list-tabs', 'admin-list', 'admin-detail', 'admin-detail-tabs', 'admin-detail-sidebar', 'admin-metrics', 'admin-create',
  'editorial-operations', 'executive-briefing', 'training-operations', 'monitoring-console', 'hard-edge-analytics',
  'metrics-workspace', 'campaign-operations', 'neutral-analytics', 'deployment-console', 'developer-dashboard',
  'business-analytics', 'operations-overview', 'ai-workspace', 'knowledge-workspace', 'mobile-content', 'mobile-reading',
  'developer-workbench', 'workspace-settings', 'implementation-brief',
] as const

export interface ConfirmedDirection {
  directionId: DirectionId
  reason: string
  /** Server-generated timestamp of the original explicit selection; copying keeps it. */
  confirmedAt: number
}

export interface PageBrief {
  version: 1
  audience?: string
  purpose?: string
  proposition?: string
  primaryAction?: string
  evidence?: string[]
  assets?: string[]
  brandConstraints?: string[]
  prototypeId?: string
  /** Draft direction; its presence alone is not user approval. */
  directionId?: DirectionId
  confirmedDirection?: ConfirmedDirection
  updatedAt: number
}

const TEXT_FIELDS = ['audience', 'purpose', 'proposition', 'primaryAction'] as const
const LIST_FIELDS = ['evidence', 'assets', 'brandConstraints'] as const
const CONTENT_KEYS = [...TEXT_FIELDS, ...LIST_FIELDS, 'prototypeId', 'directionId']
const MAX_TEXT = 2000
const MAX_ITEMS = 20
const MAX_TOTAL = 16000

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new InvalidInputError(`${label}必须是普通对象。`)
  }
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new InvalidInputError(`${label}含未知字段：${key}`)
  }
}

function text(value: unknown, label: string, required = false): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT || (required && value.trim() === '')) {
    throw new InvalidInputError(`${label}必须是${required ? '非空' : ''}字符串，且不超过 ${MAX_TEXT} 字。`)
  }
  return value.trim()
}

function direction(value: unknown): DirectionId {
  if (typeof value !== 'string' || !DIRECTION_IDS.includes(value as DirectionId)) {
    throw new InvalidInputError(`未知视觉方向：${String(value)}`)
  }
  return value as DirectionId
}

function content(input: Record<string, unknown>): Partial<PageBrief> {
  const out: Partial<PageBrief> = {}
  for (const key of TEXT_FIELDS) if (Object.hasOwn(input, key)) out[key] = text(input[key], key)
  for (const key of LIST_FIELDS) {
    if (!Object.hasOwn(input, key)) continue
    const value = input[key]
    if (!Array.isArray(value) || value.length > MAX_ITEMS) {
      throw new InvalidInputError(`${key}必须是最多 ${MAX_ITEMS} 项的字符串数组。`)
    }
    out[key] = Array.from(value, (item) => text(item, key, true))
  }
  if (Object.hasOwn(input, 'directionId')) out.directionId = direction(input.directionId)
  if (Object.hasOwn(input, 'prototypeId')) {
    if (typeof input.prototypeId !== 'string' || !BRIEF_PROTOTYPE_IDS.includes(input.prototypeId as typeof BRIEF_PROTOTYPE_IDS[number])) {
      throw new InvalidInputError(`未知页面原型：${String(input.prototypeId)}`)
    }
    out.prototypeId = input.prototypeId
  }
  return out
}

function bounded(brief: PageBrief): PageBrief {
  const count = TEXT_FIELDS.reduce((n, key) => n + (brief[key]?.length ?? 0), 0) +
    LIST_FIELDS.reduce((n, key) => n + (brief[key]?.reduce((sum, item) => sum + item.length, 0) ?? 0), 0) +
    (brief.confirmedDirection?.reason.length ?? 0)
  if (count > MAX_TOTAL) throw new InvalidInputError(`页面简报总内容不能超过 ${MAX_TOTAL} 字；不要存储完整对话。`)
  return brief
}

/** Strict parser for persisted optional data; invalid data is reported by projectIssue. */
export function normalizeStoredPageBrief(value: unknown): PageBrief | null {
  try {
    const input = record(value, '页面简报')
    keys(input, [...CONTENT_KEYS, 'version', 'updatedAt', 'confirmedDirection'], '页面简报')
    if (input.version !== 1 || typeof input.updatedAt !== 'number' || !Number.isFinite(input.updatedAt) || input.updatedAt < 0) return null
    const result: PageBrief = { ...content(input), version: 1, updatedAt: input.updatedAt }
    if (Object.hasOwn(input, 'confirmedDirection')) {
      const confirmed = record(input.confirmedDirection, '确认方向')
      keys(confirmed, ['directionId', 'reason', 'confirmedAt'], '确认方向')
      const id = direction(confirmed.directionId)
      if (typeof confirmed.confirmedAt !== 'number' || !Number.isFinite(confirmed.confirmedAt) || confirmed.confirmedAt < 0 || result.directionId !== id) return null
      result.confirmedDirection = { directionId: id, reason: text(confirmed.reason, '确认理由', true), confirmedAt: confirmed.confirmedAt }
    }
    return bounded(result)
  } catch {
    return null
  }
}

function existingProject(cwd: string, pageId: string, tx?: ProjectTransaction) {
  assertSafeId(pageId)
  if (projectIssue(cwd, tx)) throw new InvalidInputError('project.json 已损坏或含无效条目，请先修复后再读写页面简报。')
  const project = readProject(cwd, tx)
  if (!project.nodes.some((node) => node.id === pageId)) throw new InvalidInputError(`节点不存在：${pageId}`)
  return project
}

export function readPageBrief(cwd: string, pageId: string): PageBrief | null {
  return existingProject(cwd, pageId).pageBriefs?.[pageId] ?? null
}

/** Partial update. Only confirmation:{confirmed:true,directionId,reason} creates approval. */
export function savePageBrief(cwd: string, pageId: string, value: unknown, tx?: ProjectTransaction): PageBrief {
  if (!tx) return withProjectTransaction(cwd, (transaction) => savePageBrief(cwd, pageId, value, transaction))
  const project = existingProject(cwd, pageId, tx)
  const input = record(value, '页面简报更新')
  keys(input, [...CONTENT_KEYS, 'confirmation'], '页面简报更新')
  if (Object.keys(input).length === 0) throw new InvalidInputError('页面简报更新不能为空。')
  const patch = content(input)
  const now = Date.now()
  const previous = project.pageBriefs?.[pageId]
  const next: PageBrief = { ...previous, ...patch, version: 1, updatedAt: now }
  if (Object.hasOwn(patch, 'directionId') && next.confirmedDirection?.directionId !== patch.directionId) delete next.confirmedDirection
  if (Object.hasOwn(input, 'confirmation')) {
    const selection = record(input.confirmation, '方向确认')
    keys(selection, ['confirmed', 'directionId', 'reason'], '方向确认')
    if (selection.confirmed !== true) throw new InvalidInputError('仅用户已明确选定方向时，才可传 confirmation.confirmed=true。')
    const id = direction(selection.directionId)
    if (patch.directionId && patch.directionId !== id) throw new InvalidInputError('草稿方向与本次确认方向不一致。')
    next.directionId = id
    next.confirmedDirection = { directionId: id, reason: text(selection.reason, '确认理由', true), confirmedAt: now }
  }
  bounded(next)
  project.pageBriefs = { ...project.pageBriefs, [pageId]: next }
  writeProject(cwd, project, tx)
  return next
}
