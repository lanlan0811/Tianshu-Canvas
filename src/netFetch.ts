/**
 * SSRF 安全的外网抓取。
 *
 * 插件与宿主同进程、拥有完整 Node 权限（`net:true` 只是声明），因此抓取用户/模型给的
 * 任意 URL 必须自己设防：只允许 http(s)、拒绝内网/回环/链路本地地址、把连接钉在
 * 校验过的 IP 上（防 DNS rebinding）、限制重定向跳数、限制体积与总时长。
 *
 * 设计系统反抽取（extract.ts）与资源内联（inlineAssets.ts）共用本模块。
 *
 * 测试可注入 `fetchImpl` 完全绕过网络。
 */
import { lookup as dnsLookup } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'

export class FetchError extends Error {}

/** 抓取结果：正文 + 实际使用的 URL（重定向后）+ 响应 Content-Type。 */
export interface FetchResult {
  body: Buffer
  url: string
  contentType: string | null
}

export interface FetchOptions {
  /** 单响应体积上限（字节）。超限即断开。 */
  maxBytes?: number
  /** 整体（含重定向）超时（毫秒）。 */
  deadlineMs?: number
  /** 重定向最大跳数。 */
  maxRedirects?: number
  /** 请求头。 */
  headers?: Record<string, string>
  /** 测试注入：替代真实抓取；接收已校验的 URL，返回同上结构。 */
  fetchImpl?: (url: string, options: FetchOptions) => Promise<FetchResult>
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_DEADLINE_MS = 10_000
const DEFAULT_MAX_REDIRECTS = 3

/** 私网/回环/链路本地等禁止直连的 IPv4 段（CIDR 前缀表）。 */
const BLOCKED_V4: Array<{ base: number; bits: number }> = [
  { base: 0x00000000, bits: 8 }, // 0.0.0.0/8
  { base: 0x0a000000, bits: 8 }, // 10/8
  { base: 0x64400000, bits: 10 }, // 100.64/10 (CGNAT)
  { base: 0x7f000000, bits: 8 }, // 127/8 (loopback)
  { base: 0xa9fe0000, bits: 16 }, // 169.254/16 (link-local)
  { base: 0xac100000, bits: 12 }, // 172.16/12
  { base: 0xc0000000, bits: 24 }, // 192.0.0/24
  { base: 0xc0a80000, bits: 16 }, // 192.168/16
  { base: 0xc6120000, bits: 15 }, // 198.18/15 (benchmark)
  { base: 0xe0000000, bits: 4 }, // 224/4 (multicast)
  { base: 0xf0000000, bits: 4 }, // 240/4 (reserved)
]

function v4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return NaN
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
}

function ipv4Blocked(ip: string): boolean {
  const value = v4ToInt(ip)
  if (!Number.isFinite(value)) return true
  for (const { base, bits } of BLOCKED_V4) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if ((value & mask) === (base & mask)) return true
  }
  return false
}

/** 归一化 IPv6 文本（去 `[]`、压缩形式交给统一处理）。 */
function normalizeIp(raw: string): { family: 4 | 6; ip: string } | null {
  const value = raw.trim().replace(/^\[|\]$/g, '')
  // IPv4-mapped IPv6（::ffff:1.2.3.4）按其内层 IPv4 判断。
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value)
  if (mapped) return { family: 4, ip: mapped[1]! }
  const family = isIP(value)
  if (family === 4) return { family: 4, ip: value }
  if (family === 6) return { family: 6, ip: value.toLowerCase() }
  return null
}

function ipv6Blocked(ip: string): boolean {
  const value = ip.replace(/^\[|\]$/g, '').toLowerCase()
  if (value === '::1' || value === '::') return true
  // 链路本地 fe80::/10、唯一本地 fc00::/7。
  if (/^fe[89ab]/.test(value)) return true
  if (/^f[cd]/.test(value)) return true
  // 文档/基准段 2001:db8::/32。
  if (value.startsWith('2001:db8')) return true
  // 其它一律放行（真实公网 IPv6），但经 ipv4Blocked 的映射已在前面拦下。
  return false
}

/** 判断一个 IP 字面量是否属于禁止直连的范围。非 IP 返回 true（当作不安全）。 */
export function isBlockedIp(raw: string): boolean {
  const parsed = normalizeIp(raw)
  if (!parsed) return true
  return parsed.family === 4 ? ipv4Blocked(parsed.ip) : ipv6Blocked(parsed.ip)
}

/**
 * 校验 URL 是否允许抓取：仅 http(s)、无内嵌凭据、主机解析出的所有 IP 均不得是内网/回环。
 * 返回解析到的地址（供连接时钉住，防 rebinding）。
 */
export async function assertUrlAllowed(rawUrl: string): Promise<{ url: URL; address: string; family: number }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new FetchError(`不是合法 URL：${rawUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError(`仅允许 http/https：${url.protocol}`)
  }
  if (url.username || url.password) {
    throw new FetchError('不允许 URL 内嵌凭据（user:pass@）。')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // 主机本身就是 IP 字面量时直接判断，不做 DNS。
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new FetchError(`禁止访问内网/保留地址：${host}`)
    return { url, address: host, family: isIP(host) }
  }
  const addresses = await resolveAll(host)
  if (addresses.length === 0) throw new FetchError(`无法解析主机：${host}`)
  for (const addr of addresses) {
    if (isBlockedIp(addr.address)) throw new FetchError(`主机 ${host} 解析到内网/保留地址：${addr.address}`)
  }
  // 钉住第一个地址；getaddrinfo 顺序稳定，且所有地址都已校验过。
  return { url, address: addresses[0]!.address, family: addresses[0]!.family }
}

function resolveAll(host: string): Promise<Array<{ address: string; family: number }>> {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { all: true }, (err, addresses) => {
      if (err) reject(new FetchError(`DNS 解析失败：${host}（${err.message}）`))
      else resolve(addresses as Array<{ address: string; family: number }>)
    })
  })
}

interface RawResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
}

/** 单次请求；连接被钉在校验过的 IP 上（自定义 lookup），禁用自动重定向。 */
function requestOnce(
  target: { url: URL; address: string; family: number },
  options: FetchOptions,
  maxBytes: number,
  signal: AbortSignal,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const isHttps = target.url.protocol === 'https:'
    const mod = isHttps ? https : http
    const pinnedLookup = (
      _hostname: string,
      _opts: unknown,
      callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
    ): void => {
      // 忽略再次解析，直接返回已校验的地址（防 TOCTOU / DNS rebinding）。
      callback(null, target.address, target.family)
    }
    const req = mod.request(
      {
        protocol: target.url.protocol,
        hostname: target.url.hostname.replace(/^\[|\]$/g, ''),
        port: target.url.port || (isHttps ? 443 : 80),
        path: target.url.pathname + target.url.search,
        method: 'GET',
        // identity：不解压，避免 gzip 炸弹。
        headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'tianshu-canvas', ...options.headers },
        lookup: pinnedLookup as unknown as http.RequestOptions['lookup'],
        ...(isHttps ? { servername: target.url.hostname.replace(/^\[|\]$/g, '') } : {}),
        signal,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBytes) {
            // 超限即断开，不在内存里继续累积。
            res.destroy(new FetchError(`响应超过体积上限（${maxBytes} 字节）`))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
        )
        res.on('error', reject)
      },
    )
    req.on('error', (err) => {
      if (signal.aborted) reject(new FetchError('抓取超时或已取消'))
      else reject(new FetchError(`请求失败：${err.message}`))
    })
    req.end()
  })
}

/**
 * 抓取 URL 的正文（跟随重定向，逐跳重新校验）。
 * 任何失败都抛 FetchError，由调用方转成用户可读的提示。
 */
export async function fetchUrl(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
  // 注入实现完全接管（含校验），便于测试与替换传输层。
  if (options.fetchImpl) return options.fetchImpl(rawUrl, options)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const deadline = options.deadlineMs ?? DEFAULT_DEADLINE_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deadline)
  timer.unref?.()
  try {
    let current = rawUrl
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const target = await assertUrlAllowed(current)
      const res = await requestOnce(target, options, maxBytes, controller.signal)
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        if (hop === maxRedirects) throw new FetchError(`重定向次数超过 ${maxRedirects} 次`)
        current = new URL(String(res.headers.location), target.url).toString()
        continue
      }
      if (res.status < 200 || res.status >= 300) {
        throw new FetchError(`HTTP ${res.status}：${target.url.toString()}`)
      }
      const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : null
      return { body: res.body, url: target.url.toString(), contentType }
    }
    throw new FetchError('重定向处理异常')
  } finally {
    clearTimeout(timer)
  }
}

/** 抓取并当作文本（utf-8）返回。 */
export async function fetchText(rawUrl: string, options: FetchOptions = {}): Promise<{ text: string; url: string; contentType: string | null }> {
  const result = await fetchUrl(rawUrl, options)
  return { text: result.body.toString('utf8'), url: result.url, contentType: result.contentType }
}
