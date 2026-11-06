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

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
}

/** 按数值判断一个 IPv4 是否落在禁止段。 */
function ipv4IntBlocked(value: number): boolean {
  for (const { base, bits } of BLOCKED_V4) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if ((value & mask) === (base & mask)) return true
  }
  return false
}

function ipv4Blocked(ip: string): boolean {
  const value = v4ToInt(ip)
  // 解析不出来就当作不安全（fail-closed）。
  return value === null ? true : ipv4IntBlocked(value)
}

/**
 * 解析 IPv6 文本为 8 个 16 位组（支持 `::` 压缩、尾部内嵌 IPv4、`%zone`）。
 * 无法解析返回 null。**任何形式都归一到整数数组再判断，不做字符串前缀匹配**，
 * 否则 `::ffff:7f00:1` 这类十六进制写法的映射地址会绕过点分十进制判定。
 *
 * 尾部内嵌 IPv4（`::ffff:8.8.8.8`）先转成两个十六进制组再统一解析——若直接按 `:`
 * 切分，`::ffff:` 会留下空组导致解析失败（fail-closed 会把公网地址也一起拒掉）。
 */
function parseV6(raw: string): number[] | null {
  let text = raw.trim().replace(/^\[|\]$/g, '').split('%')[0]!
  if (!text.includes(':')) return null
  const v4Tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (v4Tail) {
    const n = v4ToInt(v4Tail[2]!)
    if (n === null) return null
    text = `${v4Tail[1]!}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const sides = text.split('::')
  if (sides.length > 2) return null
  const toGroups = (s: string): number[] | null => {
    if (s === '') return []
    const out: number[] = []
    for (const g of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null
      out.push(parseInt(g, 16))
    }
    return out
  }
  const left = toGroups(sides[0]!)
  if (left === null) return null
  if (sides.length === 1) {
    // 没有 `::` 压缩：必须刚好 8 组。
    return left.length === 8 ? left : null
  }
  const right = toGroups(sides[1]!)
  if (right === null) return null
  const fill = 8 - left.length - right.length
  if (fill < 0) return null
  return [...left, ...Array<number>(fill).fill(0), ...right]
}

/** 由高 32 位与低 32 位拼出的内嵌 IPv4 是否被禁。 */
function embeddedV4Blocked(hi: number, lo: number): boolean {
  return ipv4IntBlocked(((hi << 16) | lo) >>> 0)
}

/**
 * 按实际 IP 值判断 IPv6 是否禁止直连。
 * 覆盖：未指定/回环、IPv4-mapped（`::ffff:`，点分与十六进制两种写法）、
 * IPv4-compatible（`::x`）、IPv4-translated、NAT64（`64:ff9b::/96`）、
 * 6to4（`2002::/16`）、Teredo（`2001:0::/32`）、ULA / 链路本地 / site-local /
 * 多播 / 文档段。解析失败一律视为不安全（fail-closed）。
 */
function ipv6Blocked(raw: string): boolean {
  const g = parseV6(raw)
  if (!g) return true
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number]
  // 低位前缀全零：涵盖了未指定 `::`、回环 `::1`、IPv4-mapped `::ffff:a.b.c.d`
  // 与 IPv4-compatible `::a.b.c.d`（两者内嵌 IPv4 都在 g6:g7）。
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    return ipv4IntBlocked((((g6 << 16) | g7) >>> 0))
  }
  // NAT64 64:ff9b::/96（以及 64:ff9b:1::/48）
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return embeddedV4Blocked(g6, g7)
  }
  // 6to4 2002::/16：内嵌的 IPv4 在 g1:g2
  if (g0 === 0x2002) return embeddedV4Blocked(g1, g2)
  // Teredo 2001:0000::/32：服务端地址（g2:g3）与客户端地址（g6:g7）都取反
  if (g0 === 0x2001 && g1 === 0) {
    const server = ((~((g2 << 16) | g3)) & 0xffffffff) >>> 0
    const client = ((~((g6 << 16) | g7)) & 0xffffffff) >>> 0
    if (ipv4IntBlocked(server) || ipv4IntBlocked(client)) return true
  }
  // 唯一本地 fc00::/7、链路本地 fe80::/10、site-local fec0::/10、多播 ff00::/8
  if ((g0 & 0xfe00) === 0xfc00) return true
  if ((g0 & 0xffc0) === 0xfe80) return true
  if ((g0 & 0xffc0) === 0xfec0) return true
  if ((g0 & 0xff00) === 0xff00) return true
  // 文档段 2001:db8::/32、基准段 2001:2::/48
  if (g0 === 0x2001 && g1 === 0x0db8) return true
  if (g0 === 0x2001 && g1 === 0x0002 && g2 === 0) return true
  return false
}

/** 判断一个 IP 字面量是否属于禁止直连的范围。非 IP 返回 true（当作不安全）。 */
export function isBlockedIp(raw: string): boolean {
  const value = String(raw).trim().replace(/^\[|\]$/g, '').split('%')[0]!
  const family = isIP(value)
  if (family === 4) return ipv4Blocked(value)
  if (family === 6) return ipv6Blocked(value)
  return true
}

/**
 * 校验 URL 是否允许抓取：仅 http(s)、无内嵌凭据、主机解析出的所有 IP 均不得是内网/回环。
 * 返回解析到的地址（供连接时钉住，防 rebinding）。
 *
 * 映射地址（`::ffff:7f00:1` 等）在 isBlockedIp 里已按实际 IP 值归类；这里额外做的是
 * **连接固定**：只钉一个已核验的地址，并保留其地址族，避免连接时再做一次解析。
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
    // URL 主机的 IPv6 是一切形式的映射地址的入口；把它规范成实际地址族再钉住。
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
    // Node 的 autoSelectFamily（默认开启）调用 lookup 时带 `all: true`，并期望回调返回
    // **地址数组**；此时回调里塞 `(null, address, family)` 会让 Node 报
    // `Invalid IP address: undefined`（地址参数为 undefined）。因此按 opts.all 分支。
    const pinnedLookup = (
      _hostname: string,
      opts: { all?: boolean } | undefined,
      callback: (...args: unknown[]) => void,
    ): void => {
      // 忽略再次解析，直接返回已核验的地址（防 TOCTOU / DNS rebinding）。
      if (opts?.all) {
        callback(null, [{ address: target.address, family: target.family }])
        return
      }
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
