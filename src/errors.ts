/** Public error boundary shared by tools and HTTP. */
import { InvalidInputError } from './ids.js'
import { PathBoundaryError } from './paths.js'
import { warnUser } from './host.js'
import { FetchError } from './netFetch.js'

export interface PublicError { status: number; message: string }

function redactCredentials(message: string): string {
  return message
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[凭证已隐藏]')
    .replace(/([?&](?:ws|token|secret)=)[^&#\s"']+/gi, '$1[凭证已隐藏]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[凭证已隐藏]@')
    .replace(/(https?:\/\/[^\s#]+)#[a-f0-9]{64}\b/gi, '$1#[凭证已隐藏]')
}

/** Expected validation messages may include paths supplied by filesystem helpers. */
export function redactErrorPaths(message: string): string {
  return redactCredentials(message)
    .replace(/(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/][^\r\n"'<>，。；）]*/g, '[路径已隐藏]')
    .replace(/\\\\[^\r\n"'<>，。；）]*/g, '[路径已隐藏]')
    .replace(/(^|[\s:：("'])(\/(?!\/)[^\s"'<>，。；）]+)/g, '$1[路径已隐藏]')
}

export function formatPublicError(error: unknown): PublicError {
  const err = error instanceof Error ? error : new Error(String(error))
  const code = (err as Error & { code?: unknown }).code
  if (code === 'WORKSPACE_BUSY' || err.name === 'WorkspaceBusyError') {
    return { status: 409, message: redactErrorPaths(err.message) }
  }
  if (code === 'HTML_SIZE_LIMIT' || err.name === 'HtmlSizeLimitError') {
    return { status: 413, message: redactErrorPaths(err.message) }
  }
  if (code === 'PAGE_COUNT_LIMIT') return { status: 400, message: redactErrorPaths(err.message) }
  if (error instanceof PathBoundaryError) {
    return { status: 403, message: redactErrorPaths(err.message) }
  }
  if (error instanceof InvalidInputError) {
    return { status: 400, message: redactErrorPaths(err.message) }
  }
  if (error instanceof FetchError) {
    if (/内网|保留地址/.test(err.message)) return { status: 400, message: '网络地址被拒绝：禁止访问内网/保留地址；请使用公开的 http/https 地址。' }
    if (/凭据/.test(err.message)) return { status: 400, message: '不允许 URL 内嵌凭据（user:pass@）；请移除凭据后重试。' }
    if (/合法 URL|仅允许 http/.test(err.message)) return { status: 400, message: '网络地址无效；请提供合法的 http/https URL。' }
    return { status: 400, message: '网络抓取失败；请检查公开地址、响应体积及超时后重试，详细原因见宿主日志。' }
  }
  if (err.constructor.name === 'BrowserSpawnError') {
    return { status: 500, message: '无法启动浏览器；请检查 Chrome/Edge 安装及 TIANSHU_CANVAS_BROWSER 配置后重试。' }
  }
  if (err.constructor.name === 'SandboxUnavailableError') {
    return { status: 500, message: 'Chromium 沙箱无法启动，已停止操作；请修复沙箱环境后重试，不会自动降级。' }
  }
  // These legacy adapter validations predate InvalidInputError. Limit passthrough
  // to their known validation messages; never expose arbitrary Error messages.
  if (/^(没有找到可导入的主题|主题缺少主色|主题的 primary 无法解析为颜色|未找到 Chrome\/Edge|审阅期间页面内容已变化)/.test(err.message)) {
    return { status: 400, message: redactErrorPaths(err.message) }
  }
  return { status: 500, message: '操作失败：请检查工作区文件是否被占用、权限及文件类型，修复后重试；详细原因见宿主日志。' }
}

/** Logging failures cannot make an already failed tool reject. */
export function reportError(error: unknown, operation = '操作失败'): string {
  try {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    const diagnostic = redactCredentials(detail).slice(0, 16000)
    warnUser(`${operation}：${diagnostic}`)
  } catch { /* The host logger may be unavailable. */ }
  return formatPublicError(error).message
}

/** Older export code reports browser failures as strings instead of typed errors. */
export function reportResultError(message: string): string {
  reportError(new Error(message), '导出失败')
  if (/无法启动浏览器/.test(message)) return '无法启动浏览器；请检查 Chrome/Edge 安装及 TIANSHU_CANVAS_BROWSER 配置后重试。'
  if (/沙箱/.test(message)) return 'Chromium 沙箱无法启动，已停止操作；请修复沙箱环境后重试，不会自动降级。'
  if (/未找到 Chrome\/Edge/.test(message)) return '未找到 Chrome/Edge；请安装浏览器或设置 TIANSHU_CANVAS_BROWSER 后重试。'
  return formatPublicError(new Error(message)).message
}
