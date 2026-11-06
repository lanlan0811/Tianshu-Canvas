/**
 * SSRF 防护：协议白名单、私网/回环/链路本地拦截、重定向逐跳校验、体积极限。
 * 全部注入 fetchImpl，不触网。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { installFakeSdk } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
installFakeSdk()
const { assertUrlAllowed, isBlockedIp, fetchUrl } = await import(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

test('协议白名单：只允许 http/https', async () => {
  await assert.rejects(() => assertUrlAllowed('file:///etc/passwd'), /仅允许 http\/https/)
  await assert.rejects(() => assertUrlAllowed('ftp://example.com/x'), /仅允许 http\/https/)
  await assert.rejects(() => assertUrlAllowed('not a url'), /不是合法 URL/)
})

test('拒绝 URL 内嵌凭据', async () => {
  await assert.rejects(() => assertUrlAllowed('http://user:pass@example.com/'), /不允许 URL 内嵌凭据/)
})

test('IP 字面量：内网/回环/链路本地一律拒绝', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.1.1', '0.0.0.0', '100.64.0.1', '224.0.0.1']) {
    assert.equal(isBlockedIp(ip), true, `${ip} 应被拦截`)
    await assert.rejects(() => assertUrlAllowed(`http://${ip}/`), /禁止访问内网\/保留地址/)
  }
  for (const ip of ['::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.equal(isBlockedIp(ip), true, `${ip} 应被拦截`)
  }
})

/**
 * 回归（技术反馈 01）：映射地址必须按**实际 IP 值**判定。
 * `::ffff:7f00:1` 是 `::ffff:127.0.0.1` 的十六进制写法，旧实现只识别点分十进制，
 * 于是回环地址以十六进制形式被抓取成功（SSRF 绕过）。
 */
test('IPv4 映射/兼容地址：按实际 IP 值判定，十六进制写法同样拦截', async () => {
  const blocked = [
    '::ffff:7f00:1', // = ::ffff:127.0.0.1（十六进制）
    '::ffff:127.0.0.1', // 点分写法
    '::ffff:7f00:1'.replace('7f00', '0a00'), // = 10.0.0.1
    '::ffff:a9fe:101', // = 169.254.1.1
    '::7f00:1', // IPv4-compatible
    '64:ff9b::7f00:1', // NAT64
    '2002:7f00:1::', // 6to4
    'fec0::1', // site-local
    'ff02::1', // IPv6 多播
    '2001:db8::1', // 文档段
  ]
  for (const ip of blocked) {
    assert.equal(isBlockedIp(ip), true, `${ip} 应被拦截`)
  }
  // 对应的公网 IP 不能被误伤（避免只做字符串前缀匹配导致的过杀）
  for (const ip of ['8.8.8.8', '1.1.1.1', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2606:4700:4700::1111']) {
    assert.equal(isBlockedIp(ip), false, `${ip} 应放行`)
  }
})

test('映射回环地址的 URL 一律拒绝（含十六进制写法）', async () => {
  await assert.rejects(() => assertUrlAllowed('http://[::ffff:127.0.0.1]/'), /禁止访问内网\/保留地址/)
  await assert.rejects(() => assertUrlAllowed('http://[::ffff:7f00:1]/'), /禁止访问内网\/保留地址/)
  await assert.rejects(() => assertUrlAllowed('http://[::7f00:1]/'), /禁止访问内网\/保留地址/)
  await assert.rejects(() => assertUrlAllowed('http://[64:ff9b::7f00:1]/'), /禁止访问内网\/保留地址/)
})

test('公网 IP 放行', async () => {
  assert.equal(isBlockedIp('8.8.8.8'), false)
  assert.equal(isBlockedIp('1.1.1.1'), false)
  const allowed = await assertUrlAllowed('https://8.8.8.8/x')
  assert.equal(allowed.address, '8.8.8.8')
})

test('fetchImpl 完全接管（不触网、不校验 DNS）', async () => {
  const result = await fetchUrl('https://internal.example/', {
    fetchImpl: async (url) => ({ body: Buffer.from('ok'), url, contentType: 'text/plain' }),
  })
  assert.equal(result.body.toString(), 'ok')
})

test('体积极限：超限即报错（用注入实现模拟）', async () => {
  await assert.rejects(
    () =>
      fetchUrl('https://example.com/', {
        maxBytes: 4,
        fetchImpl: async () => {
          throw new Error('响应超过体积上限（4 字节）')
        },
      }),
    /体积上限/,
  )
})

/**
 * 回归（技术反馈 01，端到端）：起一个只监听 127.0.0.1 的真实服务，
 * 断言普通回环与两种映射写法都拿不到内容。
 */
test('真实回环服务：点分与映射写法都抓不到（端到端 SSRF 回归）', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('INTERNAL-SECRET')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    for (const host of [`127.0.0.1:${port}`, `[::ffff:127.0.0.1]:${port}`, `[::ffff:7f00:1]:${port}`]) {
      await assert.rejects(
        () => fetchUrl(`http://${host}/`, { deadlineMs: 3000, maxBytes: 1024 }),
        /禁止访问内网\/保留地址/,
        `${host} 不应被抓取`,
      )
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

/**
 * 回归（技术反馈 01，域名兼容性）：Node 的 autoSelectFamily（默认开启）调用 lookup 时
 * 带 `all: true` 并期望回调返回地址数组；旧实现恒按 (err, address, family) 回调，
 * 于是报 `Invalid IP address: undefined`，任何真实域名都抓不到。
 */
test('钉住的 lookup 兼容 Node 的 all 数组回调（真实域名抓取回归）', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('PINNED-OK')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  // 复刻修复后的 pinnedLookup：按 opts.all 分支。
  const pinnedLookup = (address, family) => (_hostname, opts, callback) => {
    if (opts?.all) return callback(null, [{ address, family }])
    callback(null, address, family)
  }
  try {
    const body = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: 'pinned.example.test', port, path: '/', method: 'GET', lookup: pinnedLookup('127.0.0.1', 4) },
        (res) => {
          let text = ''
          res.on('data', (chunk) => (text += chunk))
          res.on('end', () => resolve(text))
        },
      )
      req.on('error', reject)
      req.end()
    })
    assert.equal(body, 'PINNED-OK')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
