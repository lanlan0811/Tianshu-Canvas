/**
 * 页面 id 生成与校验。
 *
 * id 同时用作：项目 JSON 的节点 id、页面 HTML 的文件名、以及 URL 段 `/page/:id`。
 * 因此必须严格校验，防止路径穿越。
 */
import { randomUUID } from 'node:crypto'

/** 合法的 id：字母数字下划线连字符，1–64 位。 */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** 调用方输入不合法（HTTP 400）；其它异常都视为服务端故障（HTTP 500）。 */
export class InvalidInputError extends Error {}

export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id)
}

export function assertSafeId(id: unknown): asserts id is string {
  if (!isSafeId(id)) throw new InvalidInputError(`invalid page id: ${String(id)}`)
}

/** 生成形如 `page-3f2a91c4` 的页面 id。 */
export function newPageId(): string {
  return 'page-' + randomUUID().replace(/-/g, '').slice(0, 8)
}

/** 生成形如 `cmt-3f2a91c4` 的批注 id。 */
export function newCommentId(): string {
  return 'cmt-' + randomUUID().replace(/-/g, '').slice(0, 8)
}
