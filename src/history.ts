/**
 * 本地操作审计日志：.tianshu-canvas/history.jsonl（追加式，每行一个事件）。
 *
 * 设计取舍：
 *  - 在 ProjectTransaction 的提交点统一挂钩，所以所有写入口（工具与 HTTP）自动覆盖；
 *  - 变更由事务前后差异推导，调用点不需要额外传参，也不会漏掉新入口；
 *  - 只记录「何时、哪个进程、改了什么」（id/标题/字节数/字段名），不含 HTML 正文；
 *  - 无登录体系，actor 只能是 local；不能记录「谁」；
 *  - 日志失败绝不阻断业务提交，只写宿主日志；
 *  - 上限 MAX_HISTORY_BYTES，超出时保留最近记录并写一条 trimmed 标记。
 */
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from './project.js'
import { warnUser } from './host.js'

export const HISTORY_FILE = 'history.jsonl'
export const MAX_HISTORY_BYTES = 1024 * 1024

export interface HistoryChange {
  kind: string
  id?: string
  title?: string
  field?: string
  bytes?: number
  detail?: string
}

export interface HistoryEntry {
  ts: number
  pid: number
  actor: 'local'
  action: string
  changes: HistoryChange[]
}

/** history.jsonl 的绝对路径（工作区根）。 */
export function historyPath(cwd: string): string {
  return join(cwd, '.tianshu-canvas', HISTORY_FILE)
}

const MOVE_FIELDS: Array<[keyof Project['nodes'][number], string]> = [
  ['x', 'x'],
  ['y', 'y'],
  ['width', 'width'],
  ['height', 'height'],
]

/** 由事务前后模型差异推导变更列表；不含任何 HTML 正文。 */
export function diffProjects(before: Project, after: Project, htmlBytes: Map<string, number>): HistoryChange[] {
  const changes: HistoryChange[] = []
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]))
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]))

  for (const [id, node] of afterNodes) {
    const previous = beforeNodes.get(id)
    if (!previous) {
      changes.push({ kind: 'page.add', id, title: node.title, detail: node.deviceType, bytes: htmlBytes.get(id) ?? 0 })
      continue
    }
    if (previous.title !== node.title) changes.push({ kind: 'page.rename', id, title: node.title, field: 'title', detail: previous.title })
    const moved = MOVE_FIELDS.filter(([key]) => previous[key] !== node[key]).map(([, label]) => label)
    if (moved.length) changes.push({ kind: 'page.move', id, title: node.title, field: moved.join(',') })
    if (previous.htmlRev !== node.htmlRev) {
      changes.push({ kind: 'page.html', id, title: node.title, bytes: htmlBytes.get(id) ?? 0 })
    }
  }
  for (const [id, node] of beforeNodes) {
    if (!afterNodes.has(id)) changes.push({ kind: 'page.remove', id, title: node.title })
  }

  const beforeEdges = new Map(before.edges.map((edge) => [edge.id, edge]))
  const afterEdges = new Map(after.edges.map((edge) => [edge.id, edge]))
  for (const [id, edge] of afterEdges) {
    if (!beforeEdges.has(id)) changes.push({ kind: 'edge.add', id, detail: `${edge.source} -> ${edge.target}` })
  }
  for (const [id, edge] of beforeEdges) {
    if (!afterEdges.has(id)) changes.push({ kind: 'edge.remove', id, detail: `${edge.source} -> ${edge.target}` })
  }

  const beforeStyle = before.design?.styleId ?? null
  const afterStyle = after.design?.styleId ?? null
  if (beforeStyle !== afterStyle) {
    changes.push({ kind: 'style.set', id: afterStyle ?? '', field: 'styleId', detail: beforeStyle ?? '' })
  }

  const beforeComments = new Map((before.comments ?? []).map((comment) => [comment.id, comment]))
  const afterComments = new Map((after.comments ?? []).map((comment) => [comment.id, comment]))
  for (const [id, comment] of afterComments) {
    const previous = beforeComments.get(id)
    if (!previous) changes.push({ kind: 'comment.add', id, detail: comment.pageId })
    else if (previous.resolved !== comment.resolved) {
      changes.push({ kind: 'comment.resolve', id, field: 'resolved', detail: String(comment.resolved) })
    }
  }
  for (const [id, comment] of beforeComments) {
    if (!afterComments.has(id)) changes.push({ kind: 'comment.remove', id, detail: comment.pageId })
  }

  const beforeBriefs = before.pageBriefs ?? {}
  const afterBriefs = after.pageBriefs ?? {}
  for (const [id, brief] of Object.entries(afterBriefs)) {
    if (JSON.stringify(beforeBriefs[id]) !== JSON.stringify(brief)) {
      changes.push({ kind: 'brief.update', id, field: 'pageBriefs' })
    }
  }

  return changes
}

/** 读取现存日志并追加一行；超出上限时按行裁剪最旧记录。返回要写入的完整内容。 */
export function appendHistory(existing: string | null, entry: HistoryEntry): string {
  const lines = (existing ?? '')
    .split('\n')
    .filter((line) => line.trim().length > 0)
  const trimmedMarker = lines.find((line) => line.includes('"trimmed":true'))
  const body = lines.filter((line) => line !== trimmedMarker)
  body.push(JSON.stringify(entry))
  let output = body.join('\n') + '\n'
  if (Buffer.byteLength(output, 'utf8') <= MAX_HISTORY_BYTES) {
    return trimmedMarker ? trimmedMarker + '\n' + output : output
  }
  // 从最旧开始丢弃，直到回到上限内；保留最后一条记录。
  while (body.length > 1 && Buffer.byteLength(body.join('\n') + '\n', 'utf8') > MAX_HISTORY_BYTES) {
    body.shift()
  }
  output = body.join('\n') + '\n'
  const marker = `${JSON.stringify({ trimmed: true, ts: entry.ts, note: `日志超过 ${MAX_HISTORY_BYTES} 字节，较早记录已裁剪` })}\n`
  return marker + output
}

/** 读取现存日志文本；不存在返回 null。任何读取异常都当作「无日志」。 */
export function readHistory(cwd: string): string | null {
  const file = historyPath(cwd)
  try {
    if (!existsSync(file)) return null
    const info = lstatSync(file)
    if (!info.isFile() || info.isSymbolicLink()) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** 最近 N 条操作摘要（供 canvas_get_state 展示）；损坏行跳过。 */
export function recentHistory(cwd: string, limit = 5): HistoryEntry[] {
  const text = readHistory(cwd)
  if (!text) return []
  const entries: HistoryEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as HistoryEntry & { trimmed?: boolean }
      if (parsed.trimmed === true) continue
      if (typeof parsed.ts !== 'number' || !Array.isArray(parsed.changes)) continue
      entries.push(parsed)
    } catch { /* 损坏行不影响后续记录 */ }
  }
  return entries.slice(-limit).reverse()
}

export function formatHistoryEntry(entry: HistoryEntry): string {
  const time = new Date(entry.ts).toISOString().replace('T', ' ').slice(0, 19)
  const summary = entry.changes
    .slice(0, 4)
    .map((change) => `${change.kind}${change.id ? `(${change.id})` : ''}`)
    .join('、')
  const more = entry.changes.length > 4 ? ` 等 ${entry.changes.length} 项` : ''
  return `${time} · ${entry.action} · ${summary}${more}`
}

/** 写日志失败只进宿主日志，绝不改变业务结果。 */
export function warnHistoryFailure(error: unknown): void {
  try {
    warnUser(`操作日志写入失败（不影响本次操作）：${error instanceof Error ? error.message : String(error)}`)
  } catch { /* 宿主日志不可用也不影响业务 */ }
}
