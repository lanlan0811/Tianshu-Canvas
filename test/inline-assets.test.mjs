/**
 * 资源内联：data URI 生成、</script 转义、<style> 递归内联、超限跳过、相对路径需 origin。
 * 全部注入 fetchImpl，不触网。
 */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { installFakeSdk } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
installFakeSdk()
const { inlineAssets, toDataUri } = await import(pathToFileURL(join(root, 'dist', 'index.js')).href)

/** 造一个按 URL 返回固定内容的假 fetcher。 */
function fakeFetcher(byUrl) {
  return async (url) => {
    if (!(url in byUrl)) throw new Error(`未预期的请求：${url}`)
    const entry = byUrl[url]
    return { body: Buffer.from(entry.body, entry.encoding ?? 'utf8'), url, contentType: entry.type ?? 'application/octet-stream' }
  }
}

test('toDataUri：文本用 utf-8，二进制用 base64', () => {
  assert.equal(toDataUri(Buffer.from('a{b}'), 'text/css'), 'data:text/css;charset=utf-8,a%7Bb%7D')
  assert.equal(toDataUri(Buffer.from([0xff, 0x00]), 'image/png'), 'data:image/png;base64,/wA=')
})

test('<img> 外链转 data URI', async () => {
  const html = '<img src="https://cdn.example.com/a.png" alt="x">'
  const result = await inlineAssets(html, {
    fetchImpl: fakeFetcher({ 'https://cdn.example.com/a.png': { body: 'PNGDATA', type: 'image/png' } }),
  })
  assert.equal(result.inlined, 1)
  assert.match(result.html, /src="data:image\/png;base64,/)
  assert.doesNotMatch(result.html, /cdn\.example\.com/)
})

test('相对路径无 origin 时跳过并保留原引用', async () => {
  const html = '<img src="./local.png">'
  const result = await inlineAssets(html, { fetchImpl: fakeFetcher({}) })
  assert.equal(result.inlined, 0)
  assert.equal(result.skipped.length, 1)
  assert.match(result.skipped[0].reason, /未提供 origin/)
  assert.match(result.html, /\.\/local\.png/)
})

test('相对路径有 origin 时解析并内联', async () => {
  const html = '<img src="./local.png">'
  const result = await inlineAssets(html, {
    origin: 'https://site.example.com/page',
    fetchImpl: fakeFetcher({ 'https://site.example.com/local.png': { body: 'X', type: 'image/png' } }),
  })
  assert.equal(result.inlined, 1)
  assert.match(result.html, /data:image\/png;base64,/)
})

test('外部脚本内联时必须转义 </script', async () => {
  const html = '<script src="https://cdn.example.com/a.js"></script>'
  const payload = 'var s = "</script>";'
  const result = await inlineAssets(html, {
    fetchImpl: fakeFetcher({ 'https://cdn.example.com/a.js': { body: payload, type: 'text/javascript' } }),
  })
  assert.equal(result.inlined, 1)
  assert.match(result.html, /<script>var s = "<\\\/script>";<\/script>/)
  // 不能被提前终止：整段里除了结尾没有裸的 </script>
  assert.equal(result.html.split('</script>').length - 1, 1)
})

test('外链样式表内联为 <style>，并递归内联其中 url()', async () => {
  const html = '<link rel="stylesheet" href="https://cdn.example.com/a.css">'
  const css = '.a { background: url(https://cdn.example.com/bg.png); }'
  const result = await inlineAssets(html, {
    fetchImpl: fakeFetcher({
      'https://cdn.example.com/a.css': { body: css, type: 'text/css' },
      'https://cdn.example.com/bg.png': { body: 'BG', type: 'image/png' },
    }),
  })
  assert.equal(result.inlined, 2)
  assert.match(result.html, /<style>/)
  assert.match(result.html, /url\("data:image\/png;base64,/)
  assert.doesNotMatch(result.html, /cdn\.example\.com/)
})

test('style 属性里的 url() 也会内联', async () => {
  const html = '<div style="background: url(https://cdn.example.com/bg.png)"></div>'
  const result = await inlineAssets(html, {
    fetchImpl: fakeFetcher({ 'https://cdn.example.com/bg.png': { body: 'BG', type: 'image/png' } }),
  })
  assert.equal(result.inlined, 1)
  assert.match(result.html, /data:image\/png;base64,/)
})

test('单资源超限时跳过并保留原引用', async () => {
  const html = '<img src="https://cdn.example.com/big.png">'
  const result = await inlineAssets(html, {
    maxBytesPer: 2,
    fetchImpl: async (url) => {
      throw new Error(`响应超过体积上限（2 字节）：${url}`)
    },
  })
  assert.equal(result.inlined, 0)
  assert.equal(result.skipped.length, 1)
  assert.match(result.skipped[0].reason, /体积上限/)
  assert.match(result.html, /big\.png/)
})

test('iframe 等不支持的资源保留并警告', async () => {
  const html = '<iframe src="https://cdn.example.com/embed"></iframe>'
  const result = await inlineAssets(html, { fetchImpl: fakeFetcher({}) })
  assert.equal(result.inlined, 0)
  assert.ok(result.skipped.some((s) => s.ref.includes('embed')))
})
