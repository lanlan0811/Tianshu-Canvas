/**
 * 品牌记忆与品牌包：累加、可复现、checksum、重名拒绝、跨工作区往返。
 */
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const { api } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
const tool = (name) => api.tools.find((t) => t.name === name)
const designTool = tool('canvas_design_system')
const styleTool = tool('canvas_style')

const PAGE = `<!doctype html><html><body>
<div class="ts-app"><button class="ts-btn ts-btn--primary">新建</button>
<svg data-icon="search" class="ts-icon"></svg><span class="ts-badge">Beta</span></div>
</body></html>`

const TOKENS = JSON.parse(readFileSync(join(root, 'design-systems/styles/apple/tokens.json'), 'utf8'))

async function workspace(styleId = null) {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-brand-'))
  if (styleId) await styleTool.execute({ args: { action: 'set', style_id: styleId }, cwd, sessionId: 'test' })
  return cwd
}

async function createStyle(cwd, id) {
  const res = await designTool.execute({
    args: {
      action: 'create',
      id,
      tokens: { ...TOKENS, id },
      name: '品牌测试',
      tagline: 't',
      iconStyle: { strokeWidth: 1.75 },
      set_current: true,
    },
    cwd,
    sessionId: 'test',
  })
  assert.equal(res.isError, undefined, res.content)
}

async function codegen(cwd, target = 'react') {
  const res = await styleTool.execute({ args: { action: 'codegen', target, html: PAGE }, cwd, sessionId: 'test' })
  assert.equal(res.isError, undefined, res.content)
}

async function test(name, fn) {
  try {
    await fn()
    console.log(`✔ ${name}`)
  } catch (err) {
    console.error(`✖ ${name}`)
    throw err
  }
}

await test('记忆：多次导出用量累加，get 里能看到摘要', async () => {
  const cwd = await workspace()
  await createStyle(cwd, 'brand-a')
  await codegen(cwd)
  await codegen(cwd)
  const get = await designTool.execute({ args: { action: 'get', id: 'brand-a' }, cwd, sessionId: 'test' })
  assert.equal(get.isError, undefined, get.content)
  assert.match(get.content, /品牌记忆：1 个来源/)
  assert.match(get.content, /ts-btn×2/)
})

await test('品牌包：导出字节可复现，checksum 校验，篡改被拒', async () => {
  const cwd = await workspace()
  await createStyle(cwd, 'brand-b')
  await codegen(cwd)
  const out = join(cwd, 'packs')
  const first = await designTool.execute({ args: { action: 'export', id: 'brand-b', out_dir: out }, cwd, sessionId: 'test' })
  assert.equal(first.isError, undefined, first.content)
  const file = join(out, 'brand-b.json')
  const bytes1 = readFileSync(file, 'utf8')
  const second = await designTool.execute({ args: { action: 'export', id: 'brand-b', out_dir: out }, cwd, sessionId: 'test' })
  assert.equal(second.isError, undefined, second.content)
  assert.equal(readFileSync(file, 'utf8'), bytes1, '重复导出应字节一致（无时间戳）')
  assert.match(bytes1, /"checksum": "[0-9a-f]{64}"/)
  assert.doesNotMatch(bytes1, /updatedAt/)

  const tampered = join(out, 'tampered.json')
  writeFileSync(tampered, bytes1.replace(/"ts-btn--primary"/, '"ts-btn--danger"'), 'utf8')
  const res = await designTool.execute({ args: { action: 'import_pack', pack_path: tampered }, cwd, sessionId: 'test' })
  assert.equal(res.isError, true)
  assert.match(res.content, /checksum 不匹配/)
})

await test('品牌包：跨工作区导入后 token 与使用记忆恢复，重名默认拒绝', async () => {
  const source = await workspace()
  await createStyle(source, 'brand-c')
  await codegen(source)
  const out = join(source, 'packs')
  await designTool.execute({ args: { action: 'export', id: 'brand-c', out_dir: out }, cwd: source, sessionId: 'test' })
  const packFile = join(out, 'brand-c.json')

  const target = await workspace()
  const res = await designTool.execute({ args: { action: 'import_pack', pack_path: packFile }, cwd: target, sessionId: 'test' })
  assert.equal(res.isError, undefined, res.content)
  assert.match(res.content, /已导入品牌包/)
  assert.ok(existsSync(join(target, '.tianshu-canvas/library/brand-c/tokens.json')))
  assert.ok(existsSync(join(target, '.tianshu-canvas/library/brand-c/meta.json')))

  // 导入后编译出的 tokens 与源工作区一致（视觉一致的强约束）。
  const manifestA = JSON.parse(readFileSync(join(source, '.tianshu-canvas/library/brand-c/tokens.json'), 'utf8'))
  const manifestB = JSON.parse(readFileSync(join(target, '.tianshu-canvas/library/brand-c/tokens.json'), 'utf8'))
  assert.deepEqual(manifestB, manifestA)

  const again = await designTool.execute({ args: { action: 'import_pack', pack_path: packFile }, cwd: target, sessionId: 'test' })
  assert.equal(again.isError, true)
  assert.match(again.content, /已存在/)

  const overwrite = await designTool.execute({ args: { action: 'import_pack', pack_path: packFile, overwrite: true }, cwd: target, sessionId: 'test' })
  assert.equal(overwrite.isError, undefined, overwrite.content)
})

await test('品牌包：内置风格不能导出；缺字段/坏 JSON 给出可读错误', async () => {
  const cwd = await workspace()
  const builtin = await designTool.execute({ args: { action: 'export', id: 'apple' }, cwd, sessionId: 'test' })
  assert.equal(builtin.isError, true)
  assert.match(builtin.content, /内置风格/)

  const bad = join(cwd, 'bad.json')
  writeFileSync(bad, '{not json', 'utf8')
  const badRes = await designTool.execute({ args: { action: 'import_pack', pack_path: bad }, cwd, sessionId: 'test' })
  assert.equal(badRes.isError, true)
  assert.match(badRes.content, /不是合法 JSON/)

  const missing = join(cwd, 'missing.json')
  writeFileSync(missing, JSON.stringify({ schemaVersion: 1, id: 'x' }), 'utf8')
  const missingRes = await designTool.execute({ args: { action: 'import_pack', pack_path: missing }, cwd, sessionId: 'test' })
  assert.equal(missingRes.isError, true)
  assert.match(missingRes.content, /缺少 tokens/)
})

await test('删除风格同步清理品牌记忆（不留悬空引用）', async () => {
  const cwd = await workspace()
  await createStyle(cwd, 'brand-d')
  await codegen(cwd)
  const memoryFile = join(cwd, '.tianshu-canvas/memory/brand.json')
  assert.ok(existsSync(memoryFile))
  assert.ok(JSON.parse(readFileSync(memoryFile, 'utf8')).styles['brand-d'])
  await designTool.execute({ args: { action: 'remove', id: 'brand-d' }, cwd, sessionId: 'test' })
  const after = JSON.parse(readFileSync(memoryFile, 'utf8'))
  assert.equal(after.styles['brand-d'], undefined)
})

await test('记忆文件损坏时降级为空记忆，不影响其它功能', async () => {
  const cwd = await workspace()
  await createStyle(cwd, 'brand-e')
  mkdirSync(join(cwd, '.tianshu-canvas/memory'), { recursive: true })
  writeFileSync(join(cwd, '.tianshu-canvas/memory/brand.json'), '{broken', 'utf8')
  await codegen(cwd)
  const get = await designTool.execute({ args: { action: 'get', id: 'brand-e' }, cwd, sessionId: 'test' })
  assert.equal(get.isError, undefined, get.content)
  const healed = JSON.parse(readFileSync(join(cwd, '.tianshu-canvas/memory/brand.json'), 'utf8'))
  assert.equal(healed.schemaVersion, 1)
})

await test('canvas_get_state 展示品牌记忆摘要', async () => {
  const cwd = await workspace()
  await createStyle(cwd, 'brand-f')
  await codegen(cwd)
  const state = await tool('canvas_get_state').execute({ args: {}, cwd, sessionId: 'test' })
  assert.match(state.content, /品牌记忆：1 个来源/)
})

void rmSync
void copyFileSync
console.log('OK 品牌记忆：累加、可复现、checksum、跨工作区往返与清理全部通过')
