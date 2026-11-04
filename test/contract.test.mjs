/**
 * 契约测试：清单合法性 + 握手工具名一致 + 返回形状。
 * 断言的是**构建产物** dist/index.js（CI 先 build），而非源码。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin, TPI_BRAND } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'tianshu.plugin.json'), 'utf8'))

// ---- 清单合法性（镜像 zod .strict() 的关键约束）----
assert.equal(manifest.$tpi, '1.0', '$tpi 必须是 1.0')
assert.equal(manifest.kind, 'tianshu.plugin', 'kind 必须是 tianshu.plugin')
assert.match(manifest.id, /^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'id 不合法')
assert.ok(typeof manifest.displayName === 'string' && manifest.displayName.length >= 1, 'displayName 必填')
assert.ok(typeof manifest.version === 'string' && manifest.version.length >= 1, 'version 必填')
assert.ok(typeof manifest.description === 'string' && manifest.description.length >= 1, 'description 必填')
assert.equal(manifest.entry, 'dist/index.js', 'entry 必须指向构建产物')
assert.ok(Array.isArray(manifest.capabilities) && manifest.capabilities.includes('tools'), 'capabilities 必须含 tools')

const declaredTools = manifest.contributes.tools.map((t) => t.name)
for (const t of manifest.contributes.tools) {
  assert.match(t.name, /^[a-z][a-z0-9_]*$/, `工具名必须是 snake_case: ${t.name}`)
  assert.ok(typeof t.description === 'string' && t.description.length >= 1, `工具缺少 description: ${t.name}`)
}
assert.equal(new Set(declaredTools).size, declaredTools.length, '工具名重复')

// ---- 入口品牌 + id 一致 + 握手 ----
const { def, api } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.js')).href)
assert.ok(def[TPI_BRAND], '入口不是 TPI 定义')
assert.equal(def.id, manifest.id, 'defineTianshuPlugin.id 与 manifest.id 不一致')

const declared = [...declaredTools].sort()
const activated = (api.tools ?? []).map((t) => t.name).sort()
assert.deepEqual(activated, declared, `握手失败: declared=${declared} activated=${activated}`)

// ---- 工具对象形状 ----
for (const t of api.tools) {
  assert.ok(typeof t.name === 'string', 'tool.name 缺失')
  assert.ok(typeof t.description === 'string', `tool.description 缺失: ${t.name}`)
  assert.ok(t.inputSchema && typeof t.inputSchema === 'object', `tool.inputSchema 缺失: ${t.name}`)
  assert.equal(typeof t.execute, 'function', `tool.execute 缺失: ${t.name}`)
  assert.ok(['true', 'false'].includes(String(t.concurrencySafe)), `concurrencySafe 必须是布尔: ${t.name}`)
}

console.log(`OK 契约: ${declared.length} 个工具握手一致 -> ${activated.join(', ')}`)
