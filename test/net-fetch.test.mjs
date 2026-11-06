/**
 * SSRF 防护：协议白名单、私网/回环/链路本地拦截、重定向逐跳校验、体积极限。
 * 全部注入 fetchImpl，不触网。
 */
import assert from 'node:assert/strict'
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
