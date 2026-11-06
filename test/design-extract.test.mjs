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
const { extractTokens } = await import(pathToFileURL(join(root, 'dist', 'index.js')).href)
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
  const mod = await import(pathToFileURL(join(root, 'dist', 'index.js')).href)
  const api = await mod.default.activate({ log: { debug() {}, warn() {} } })
  return Object.fromEntries(api.tools.map((t) => [t.name, t]))
}
