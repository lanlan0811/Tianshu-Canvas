/**
 * 页面间跳转：slug 解析、外链过滤、写入时规范化、前向引用补齐、歧义报错。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installFakeSdk, loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
installFakeSdk()
const mod = await import(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
const { titleSlug, parseNavRef, resolveNavRef, rewriteNavLinks } = mod

// --- slug 算法（确定性） ---
assert.equal(titleSlug('Detail Page'), 'detail-page')
assert.equal(titleSlug(' 产品 详情 '), '产品-详情')
assert.equal(titleSlug('A/B:C'), 'a-b-c')
assert.equal(titleSlug(''), '')
assert.equal(titleSlug('  --  '), '')
assert.equal(titleSlug('a--b'), 'a-b')

// --- 外链 / 锚点 / scheme → null（原样放过） ---
assert.equal(parseNavRef('https://x.com/a.html', null), null)
assert.equal(parseNavRef('//cdn/x.js', null), null)
assert.equal(parseNavRef('#top', null), null)
assert.equal(parseNavRef('mailto:a@b.c', null), null)
assert.equal(parseNavRef('javascript:void(0)', null), null)
assert.equal(parseNavRef('', ''), null)
assert.deepEqual(parseNavRef('detail.html', null), { dataNav: null, href: 'detail.html' })
assert.deepEqual(parseNavRef(null, 'page-abc'), { dataNav: 'page-abc', href: null })

// --- resolveNavRef 优先级：data-nav > 精确 id > slug ---
const pages = [
  { id: 'page-aaa', title: '首页' },
  { id: 'page-bbb', title: '详情' },
]
assert.equal(resolveNavRef({ dataNav: 'page-bbb', href: null }, pages).target, 'page-bbb')
assert.equal(resolveNavRef({ dataNav: null, href: 'page-aaa.html' }, pages).target, 'page-aaa')
assert.equal(resolveNavRef({ dataNav: null, href: '详情.html' }, pages).target, 'page-bbb')
assert.equal(resolveNavRef({ dataNav: null, href: 'nope.html' }, pages).target, null)
// 歧义：两个同名 title
const dup = [
  { id: 'page-1', title: '详情' },
  { id: 'page-2', title: '详情' },
]
const amb = resolveNavRef({ dataNav: null, href: '详情.html' }, dup)
assert.equal(amb.target, null)
assert.deepEqual(amb.ambiguous.sort(), ['page-1', 'page-2'])

// --- rewriteNavLinks：跳过 script/style/注释，data-nav 补 href ---
const html = [
  '<html><head><style>.a{background:url(href="详情.html")}</style></head><body>',
  '<script>var s = \'<a href="详情.html">x</a>\';</script>',
  '<!-- <a href="详情.html">c</a> -->',
  '<a href="详情.html">去详情</a>',
  '<a data-nav="page-aaa">回首页</a>',
  '<a href="https://x.com/a.html">外链</a>',
  '<a href="#top">锚点</a>',
  '</body></html>',
].join('\n')
const res = rewriteNavLinks(html, pages, '')
assert.equal(res.rewritten, 2, '只应改写正文里的两处可解析链接')
assert.ok(res.html.includes('<a href="page-bbb.html">去详情</a>'), 'slug 应改写成 id.html')
assert.ok(res.html.includes('<a data-nav="page-aaa" href="page-aaa.html">回首页</a>'), 'data-nav 应补 href')
assert.ok(res.html.includes('href="https://x.com/a.html"'), '外链原样')
assert.ok(res.html.includes('href="#top"'), '锚点原样')
assert.ok(res.html.includes('url(href="详情.html")'), 'style 内不改写')
assert.ok(res.html.includes('<a href="详情.html">x</a>'), 'script 内不改写')
assert.ok(res.html.includes('<!-- <a href="详情.html">c</a> -->'), '注释内不改写')

// --- 写入路径：前向引用补齐 + 歧义报错 ---
const cwd = mkdtempSync(join(tmpdir(), 'tsc-nav-'))
const call = (name, args) => tools[name].execute({ input: args, cwd })
const read = (id) => readFileSync(join(cwd, '.tianshu-canvas', 'pages', `${id}.html`), 'utf8')
try {
  await call('canvas_style', { action: 'set', style_id: 'apple' })

  // 前向引用：先写首页链到「详情」，此时目标页还不存在
  const a = await call('canvas_upsert_page', {
    title: '首页',
    html: '<html><head></head><body><a href="详情.html">去详情</a></body></html>',
  })
  const idA = a.content.match(/id=([\w-]+)/)[1]
  assert.ok(/未匹配到页面/.test(a.content), '应提示未解析的前向引用')
  assert.ok(read(idA).includes('href="详情.html"'), '未解析时原样保留')

  // 建目标页 → 应自动补齐 A
  const b = await call('canvas_upsert_page', {
    title: '详情',
    html: `<html><head></head><body><a data-nav="${idA}">回首页</a></body></html>`,
  })
  const idB = b.content.match(/id=([\w-]+)/)[1]
  assert.ok(/已补齐/.test(b.content), '应报告补齐')
  assert.ok(read(idA).includes(`href="${idB}.html"`), 'A 的前向引用应被补齐为 id')
  assert.ok(read(idB).includes(`data-nav="${idA}"`) && read(idB).includes(`href="${idA}.html"`))

  // 未命中（永不解析）→ 成功 + 提示
  const miss = await call('canvas_upsert_page', {
    title: '孤立页',
    html: '<html><head></head><body><a href="nope.html">x</a></body></html>',
  })
  assert.ok(!miss.isError, miss.content)
  assert.ok(/未匹配到页面/.test(miss.content))

  // 歧义：再加一个同名「详情」页，引用该 slug → isError 且列出候选
  await call('canvas_upsert_page', { title: '详情', html: '<html><head></head><body>x</body></html>' })
  const ambWrite = await call('canvas_upsert_page', {
    title: '另一页',
    html: '<html><head></head><body><a href="详情.html">x</a></body></html>',
  })
  assert.equal(ambWrite.isError, true, '歧义链接应报错')
  assert.ok(/命中多个页面/.test(ambWrite.content))
  console.log('OK nav: slug/外链过滤/规范化/前向补齐/歧义 全部通过')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
