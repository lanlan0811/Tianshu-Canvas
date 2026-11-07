/**
 * 设计系统反抽取：抽取结果必须能通过严格 token 契约校验（一次通过），
 * 且确定性（同输入同输出）、缺键补齐、对比度达标。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { installFakeSdk } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
installFakeSdk()
const { extractTokens } = await import(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
// 直接引构建期的纯校验函数（与 createCustomStyle 用的是同一套）。
const { validateTokens } = await import(pathToFileURL(join(root, 'scripts', 'design', 'design-validate.mjs')).href)

const SAMPLE = `
  body { background: #f7f7f8; color: #222222; font-family: Inter, sans-serif; }
  .btn { background: #0066ff; color: #ffffff; border-radius: 8px; padding: 12px 20px; font-weight: 600; }
  .card { background: #ffffff; border: 1px solid #e5e5e5; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  h1 { font-size: 32px; font-weight: 700; }
  p { font-size: 14px; color: #666666; }
  .ok { color: #15803d; } .warn { color: #b45309; } .err { color: #dc2626; } .info { color: #1d4ed8; }
`

function validate(tokens, id, errorsOut) {
  const errors = []
  const warnings = []
  const t = { ...tokens, schema: 'tianshu-design-tokens/1', id, version: 1 }
  validateTokens(t, id, errors, warnings)
  if (errorsOut) errorsOut.push(...errors)
  return { errors, warnings }
}

test('抽取结果一次通过严格 token 契约校验', async () => {
  const result = await extractTokens({ source: SAMPLE })
  const errors = []
  validate(result.tokens, 'extract1', errors)
  assert.deepEqual(errors, [], `契约校验失败：\n${errors.join('\n')}`)
})

test('抽取是确定性的（同输入同输出）', async () => {
  const a = await extractTokens({ source: SAMPLE })
  const b = await extractTokens({ source: SAMPLE })
  assert.equal(JSON.stringify(a.tokens), JSON.stringify(b.tokens))
})

test('空输入也能产出通过校验的默认设计系统（缺键补齐）', async () => {
  const result = await extractTokens({ source: '/* 没有任何可用声明 */' })
  const errors = []
  validate(result.tokens, 'extract2', errors)
  assert.deepEqual(errors, [], `契约校验失败：\n${errors.join('\n')}`)
  assert.ok(result.warnings.length > 0, '应提示未解析到 CSS')
})

test('反抽取的色值被真实采纳（品牌蓝命中）', async () => {
  const result = await extractTokens({ source: SAMPLE })
  const semantic = result.tokens.color.semantic
  const brandRef = semantic.action.primary
  const [group, step] = brandRef.split('.')
  const primitives = result.tokens.color.primitives
  assert.equal(primitives[group][step], '#0066ff')
})

test('iconStyle 默认 1.5，源码有 stroke-width 时采纳', async () => {
  const plain = await extractTokens({ source: SAMPLE })
  assert.equal(plain.iconStyle.strokeWidth, 1.5)
  const withStroke = await extractTokens({ source: '.icon { stroke-width: 1.75; }' })
  assert.equal(withStroke.iconStyle.strokeWidth, 1.75)
})

test('从 HTML 抽取：含 <style> 与内联样式', async () => {
  const html = `<!doctype html><html><head><style>
    :root { --x: 1; } body { background:#ffffff; color:#111111; }
    .a { font-size: 16px; border-radius: 10px; }
  </style></head><body style="color:#333333"></body></html>`
  const result = await extractTokens({ source: html })
  const errors = []
  validate(result.tokens, 'extract3', errors)
  assert.deepEqual(errors, [])
})

test('可用 fetchImpl 注入（URL 输入，无真实网络）', async () => {
  const result = await extractTokens({
    url: 'https://example.com/',
    fetchImpl: async () => ({
      body: Buffer.from('<style>body{background:#fafafa;color:#101010}</style>', 'utf8'),
      url: 'https://example.com/',
      contentType: 'text/html',
    }),
  })
  const errors = []
  validate(result.tokens, 'extract4', errors)
  assert.deepEqual(errors, [])
})

/**
 * 回归（技术反馈 0.8.1 阻断项二）：反抽取的实际请求面比「用户给的那个 URL」大得多。
 * 它还会抓取页面里 `<link rel=stylesheet>` 引用的外部样式表（最多 3 个），
 * 这些样式表**可以位于其它主机**；相对路径按页面 URL 解析。说明文案必须与此相符。
 */
test('URL 反抽取：会抓取最多 3 个外部样式表，含跨站与相对路径', async () => {
  const html = `<html><head>
    <link rel="stylesheet" href="/local.css">
    <link rel="stylesheet" href="https://cdn.other.example/lib.css">
    <link rel="stylesheet" href="../up.css">
    <link rel="stylesheet" href="/fourth.css">
  </head><body><style>body{color:#123456;background:#fafafa}</style></body></html>`
  const requests = []
  const css = '.x{color:#123456;background:#fafafa;font-size:14px}'
  await extractTokens({
    url: 'https://site.example.com/dir/page.html',
    fetchImpl: async (url) => {
      requests.push(url)
      return url.includes('page.html')
        ? { body: Buffer.from(html, 'utf8'), url, contentType: 'text/html' }
        : { body: Buffer.from(css, 'utf8'), url, contentType: 'text/css' }
    },
  })
  assert.equal(requests[0], 'https://site.example.com/dir/page.html', '首个请求是用户给出的页面')
  // 相对路径按页面 URL 解析；跨站样式表照抓；最多 3 个（第四个被截断）。
  assert.deepEqual(requests.slice(1), [
    'https://site.example.com/local.css',
    'https://cdn.other.example/lib.css',
    'https://site.example.com/up.css',
  ])
  assert.ok(!requests.some((u) => u.includes('fourth.css')), '超出 3 个的样式表不再抓取')
  assert.ok(requests.some((u) => u.startsWith('https://cdn.other.example/')), '跨站样式表确实被请求')
})

test('URL 反抽取：请求携带目标 URL 的路径与查询参数（不得当作私密）', async () => {
  const requests = []
  await extractTokens({
    url: 'https://site.example.com/a/b/page.html?theme=dark&token=NOT-SECRET',
    fetchImpl: async (url) => {
      requests.push(url)
      return { body: Buffer.from('<style>body{color:#222;background:#fff}</style>', 'utf8'), url, contentType: 'text/html' }
    },
  })
  assert.ok(
    requests[0].includes('?theme=dark&token=NOT-SECRET'),
    '查询参数会随请求发出（说明必须提示不要把敏感信息放进 URL）',
  )
  assert.ok(requests[0].includes('/a/b/page.html'), '路径同样会随请求发出')
})

test('action=extract 端到端：dry_run 不落盘，正式执行落盘 tokens.json/meta.json', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-extract-e2e-'))
  try {
    const tools = await loadTools()
    await tools.canvas_open.execute({ args: { port: 0 }, cwd, sessionId: 't' })

    const dry = await tools.canvas_design_system.execute({
      args: { action: 'extract', id: 'fromsite', source: SAMPLE, dry_run: true },
      cwd,
      sessionId: 't',
    })
    assert.ok(!dry.isError, dry.content)
    assert.match(dry.content, /dry_run/)
    assert.ok(!existsSync(join(cwd, '.tianshu-canvas', 'library', 'fromsite')), 'dry_run 不应落盘')

    const real = await tools.canvas_design_system.execute({
      args: { action: 'extract', id: 'fromsite', source: SAMPLE, set_current: false },
      cwd,
      sessionId: 't',
    })
    assert.ok(!real.isError, real.content)
    const dir = join(cwd, '.tianshu-canvas', 'library', 'fromsite')
    assert.ok(existsSync(join(dir, 'tokens.json')), '应写入 tokens.json')
    assert.ok(existsSync(join(dir, 'meta.json')), '应写入 meta.json')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

async function loadTools() {
  const { installFakeSdk } = await import('./helpers/host.mjs')
  installFakeSdk()
  const mod = await import(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const api = await mod.default.activate({ log: { debug() {}, warn() {} } })
  return Object.fromEntries(api.tools.map((t) => [t.name, t]))
}
