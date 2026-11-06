/**
 * 契约测试：清单合法性 + 握手（名称与描述）一致 + 返回形状。
 * 断言的是**构建产物** dist/index.mjs（CI 先 build），而非源码。
 * 描述必须与清单逐字一致：官方套件（sample.test.mjs）按 { name, description } 深比较。
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
assert.ok(typeof manifest.version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version), 'version 必须是稳定 SemVer')
assert.ok(typeof manifest.description === 'string' && manifest.description.length >= 1, 'description 必填')
assert.equal(manifest.entry, 'dist/index.mjs', 'entry 必须指向构建产物')
assert.ok(Array.isArray(manifest.capabilities) && manifest.capabilities.includes('tools'), 'capabilities 必须含 tools')
// 官方打包器硬要求：没有 engines.tianshu 直接拒绝打包。
assert.ok(typeof manifest.engines?.tianshu === 'string' && manifest.engines.tianshu.length > 0, 'engines.tianshu 必须声明')
assert.deepEqual(Object.keys(manifest.permissions).sort(), ['fs', 'net', 'shell'], '权限只声明 fs/net/shell')
assert.equal(manifest.permissions.shell, true, '会启动浏览器/子进程，shell 权限必须如实声明')

const declaredTools = manifest.contributes.tools.map((t) => t.name)
for (const t of manifest.contributes.tools) {
  assert.match(t.name, /^[a-z][a-z0-9_]*$/, `工具名必须是 snake_case: ${t.name}`)
  assert.ok(typeof t.description === 'string' && t.description.length >= 1, `工具缺少 description: ${t.name}`)
  assert.ok([...t.description].length <= 200, `工具描述不得超过 200 字: ${t.name}（${[...t.description].length}）`)
}
assert.equal(new Set(declaredTools).size, declaredTools.length, '工具名重复')
for (const skill of manifest.contributes.skills ?? []) {
  assert.ok(readFileSync(join(root, skill, 'SKILL.md'), 'utf8').length > 0, `声明的 skill 必须有 SKILL.md: ${skill}`)
}

// ---- 入口品牌 + id 一致 + 握手 ----
const { def, api } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
assert.ok(def[TPI_BRAND], '入口不是 TPI 定义')
assert.equal(def.id, manifest.id, 'defineTianshuPlugin.id 与 manifest.id 不一致')

const declared = [...declaredTools].sort()
const activated = (api.tools ?? []).map((t) => t.name).sort()
assert.deepEqual(activated, declared, `握手失败: declared=${declared} activated=${activated}`)

// 官方套件按 { name, description } 深比较：描述必须逐字一致。
assert.deepEqual(
  api.tools.map(({ name, description }) => ({ name, description })),
  manifest.contributes.tools.map(({ name, description }) => ({ name, description })),
  '运行时工具描述必须与清单完全一致',
)

// ---- 工具对象形状 ----
for (const t of api.tools) {
  assert.ok(typeof t.name === 'string', 'tool.name 缺失')
  assert.ok(typeof t.description === 'string', `tool.description 缺失: ${t.name}`)
  assert.ok(t.inputSchema && typeof t.inputSchema === 'object', `tool.inputSchema 缺失: ${t.name}`)
  assert.equal(typeof t.execute, 'function', `tool.execute 缺失: ${t.name}`)
  assert.ok(['true', 'false'].includes(String(t.concurrencySafe)), `concurrencySafe 必须是布尔: ${t.name}`)
  assert.ok(Number.isInteger(t.timeoutMs) && t.timeoutMs > 0, `timeoutMs 必须是正整数: ${t.name}`)
  assert.equal(t.inputSchema.additionalProperties, false, `inputSchema 应拒绝额外参数: ${t.name}`)
  // pathParams 只能指向真实存在的参数；路径类参数必须声明访问模式。
  const props = t.inputSchema.properties ?? {}
  for (const [param, mode] of Object.entries(t.pathParams ?? {})) {
    assert.ok(['read', 'write'].includes(mode), `pathParams.${param} 必须是 read/write: ${t.name}`)
    assert.ok(Object.hasOwn(props, param), `pathParams 声明了不存在的参数 ${param}: ${t.name}`)
  }
  for (const param of Object.keys(props)) {
    if (/^(?:.*_path|path|file|file_path|out_dir|dir)$/.test(param)) {
      assert.ok(Object.hasOwn(t.pathParams ?? {}, param), `路径参数未声明访问模式: ${t.name}.${param}`)
    }
  }
}

console.log(`OK 契约: ${declared.length} 个工具握手一致（名称 + 描述）-> ${activated.join(', ')}`)

