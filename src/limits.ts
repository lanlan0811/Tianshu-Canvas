/** Storage limits apply to final UTF-8 bytes, after every HTML transformation. */
import { InvalidInputError } from './ids.js'

export const MAX_HTML_BYTES = 8 * 1024 * 1024
export const MAX_PAGE_COUNT = 1000

export class HtmlSizeLimitError extends InvalidInputError {
  readonly code = 'HTML_SIZE_LIMIT'
  constructor(readonly bytes: number) {
    super(`页面最终 HTML 为 ${bytes} 字节，超过 8 MiB（${MAX_HTML_BYTES} 字节）限制；请减少内联资源或页面内容后重试。`)
    this.name = 'HtmlSizeLimitError'
  }
}

export class PageCountLimitError extends InvalidInputError {
  readonly code = 'PAGE_COUNT_LIMIT'
  constructor() {
    super(`项目最多允许 ${MAX_PAGE_COUNT} 页；请先删除不再需要的页面后重试。`)
    this.name = 'PageCountLimitError'
  }
}

export function assertHtmlSize(html: string | Buffer): void {
  const bytes = typeof html === 'string' ? Buffer.byteLength(html, 'utf8') : html.byteLength
  if (bytes > MAX_HTML_BYTES) throw new HtmlSizeLimitError(bytes)
}

/** Legacy over-limit projects may retain or reduce their existing page count. */
export function assertPageCount(count: number, previousCount = 0): void {
  if (count > MAX_PAGE_COUNT && count > previousCount) throw new PageCountLimitError()
}
