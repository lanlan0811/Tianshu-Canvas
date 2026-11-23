/**
 * 设计系统构建产物契约：目录完整性、跨风格同构、无外链/无 Trae 绑定痕迹。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const designDir = join(root, 'dist', 'design')
const catalog = JSON.parse(readFileSync(join(designDir, 'index.json'), 'utf8'))
const STYLES = [
  'apple',
  'google',
  'claude',
  'tianshu-original',
  'barbie',
  'nerv',
  'minimalist',
  'tianshu-inkstone',
  'tianshu-vapor',
  'tianshu-saffron',
  'tianshu-aurora',
]

const FORBIDDEN = [
  'library-consumption',
  'soloDesignConsumption',
  'uikit-plan',
  'preview-contract',
  'readOrder',
  '.trae-cn',
  'dl_builtin',
  'fill-html-head',
  'solo-design',
  '--trae-',
  '--doubao-',
  '--apple-',
  '--google-',
  '--claude-',
]

function readAll(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? readAll(join(dir, entry.name)) : [join(dir, entry.name)],
  )
}

// 0.9.6 起跨风格相同的资产按内容寻址存到 dist/design/shared/；assets.json 缺失时回退旧布局。
const ASSET_DEFAULTS = {
  components: 'components.css',
  interactionsCss: 'interactions.css',
  interactionsJs: 'interactions.js',
  interactions: 'interactions.json',
  templates: 'templates.json',
  icons: 'icons.json',
  tokens: 'tokens.css',
  manifest: 'tokens.manifest.json',
}

function assetsOf(id) {
  const styleDir = join(designDir, 'styles', id)
  const manifest = join(styleDir, 'assets.json')
  const map = { ...ASSET_DEFAULTS }
  if (existsSync(manifest)) Object.assign(map, JSON.parse(readFileSync(manifest, 'utf8')))
  const resolved = {}
  for (const [key, rel] of Object.entries(map)) resolved[key] = join(styleDir, rel)
  return resolved
}

function readAsset(id, key) {
  return readFileSync(assetsOf(id)[key], 'utf8')
}

test('设计系统：清单与全部风格产物齐全', () => {
  assert.equal(catalog.schemaVersion, 1)
  assert.ok(catalog.notice.includes('无隶属'), '必须有与品牌无隶属关系的声明')
  assert.deepEqual(catalog.styles.map((s) => s.id), STYLES)
  for (const id of STYLES) {
    assert.ok(existsSync(join(designDir, 'styles', id, 'assets.json')), `缺少 ${id}/assets.json`)
    for (const [key, file] of Object.entries(assetsOf(id))) {
      assert.ok(existsSync(file), `缺少 ${id}/${key}（${file}）`)
    }
  }
  // 内容寻址：共享文件名必须是内容 sha256 前 16 位，且不堆积重复资产。
  const sharedDir = join(designDir, 'shared')
  const sharedFiles = readAll(sharedDir)
  for (const file of sharedFiles) {
    const digest = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)
    const parent = resolve(file, '..').split(/[\\/]/).at(-1)
    assert.equal(digest, parent, `共享资产目录名必须是内容 sha256 前 16 位：${file}`)
  }
  assert.ok(sharedFiles.length <= 8, `共享目录不应堆积重复资产：${sharedFiles.length} 个文件`)
})

test('设计系统：各风格的变量/组件类/模板同构', () => {
  const manifests = STYLES.map((id) =>
    JSON.parse(readFileSync(join(designDir, 'styles', id, 'tokens.manifest.json'), 'utf8')),
  )
  const base = manifests[0]
  for (const m of manifests.slice(1)) {
    assert.deepEqual([...m.vars].sort(), [...base.vars].sort(), `${m.id} 的变量集合与 ${base.id} 不一致`)
    assert.deepEqual([...m.componentClasses].sort(), [...base.componentClasses].sort())
    assert.deepEqual([...(m.interactionClasses ?? [])].sort(), [...(base.interactionClasses ?? [])].sort())
    assert.deepEqual([...(m.interactionIds ?? [])].sort(), [...(base.interactionIds ?? [])].sort())
    const templates = JSON.parse(readAsset(m.id, 'templates'))
    const baseTemplates = JSON.parse(readAsset(base.id, 'templates'))
    assert.deepEqual(Object.keys(templates).sort(), Object.keys(baseTemplates).sort())
  }
  assert.ok(base.vars.length > 80, '变量数量应覆盖颜色/字体/间距/圆角/阴影/尺寸')
  assert.equal((base.interactionIds ?? []).length, 23, '交互库应有 23 个模式')
})

test('设计系统：交互库产物受约束（23 个、无禁用能力/外链）', () => {
  assert.equal(catalog.styles[0].counts.interactions, 23)
  const interactions = JSON.parse(readAsset(STYLES[0], 'interactions'))
  assert.equal(interactions.interactions.length, 23)
  const ids = interactions.interactions.map((i) => i.id)
  assert.equal(new Set(ids).size, 23, '交互 id 不得重复')
  for (const entry of interactions.interactions) {
    assert.ok(entry.rootAttr.startsWith('data-ts-'), `交互 ${entry.id} 的 rootAttr 必须是 data-ts-*`)
    assert.ok(typeof entry.requiresScript === 'boolean')
    assert.ok(entry.skeletonHtml && entry.skeletonHtml.length > 0)
    for (const cls of entry.classes) assert.ok(cls.startsWith('ts-'), `交互 ${entry.id} 类名须 ts- 前缀`)
  }
  // 运行时禁用的浏览器能力（画布沙箱与导出站都禁用）
  const js = readAsset(STYLES[0], 'interactionsJs')
  for (const bad of [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\blocalStorage\b/, /\bsessionStorage\b/, /document\s*\.\s*cookie/, /https?:\/\//, /<\/script/i]) {
    assert.ok(!bad.test(js), `interactions.js 命中了禁用模式 ${bad}`)
  }
})

test('设计系统：图标数量与模板内容受约束', () => {
  for (const id of STYLES) {
    const icons = JSON.parse(readFileSync(join(designDir, 'styles', id, 'icons.json'), 'utf8'))
    const names = Object.keys(icons.icons)
    assert.ok(names.length >= 60 && names.length <= 80, `${id} 图标数量 ${names.length} 不在 60–80`)
    for (const name of names) assert.ok(icons.icons[name].length > 0)

    const templates = JSON.parse(readAsset(id, 'templates'))
    assert.deepEqual(Object.keys(templates).sort(), ['dashboard', 'landing'])
    for (const [key, tpl] of Object.entries(templates)) {
      assert.ok(!/<script\b|<style\b|<html\b/i.test(tpl.html), `${id}/${key} 模板不得含脚本/样式/文档标签`)
      assert.ok(!/https?:\/\//.test(tpl.html), `${id}/${key} 模板不得含外链`)
      assert.ok(tpl.html.includes('ts-'), `${id}/${key} 模板应使用组件类`)
    }
  }
})

test('设计系统：产物中没有任何 Trae 绑定痕迹', () => {
  for (const file of readAll(designDir)) {
    const text = readFileSync(file, 'utf8')
    for (const token of FORBIDDEN) {
      assert.ok(!text.includes(token), `${file} 含被禁用标识：${token}`)
    }
    assert.ok(!/https?:\/\//.test(text), `${file} 含外链 URL`)
  }
})

test('设计系统：tokens.css 只声明 --ts- 前缀变量', () => {
  for (const id of STYLES) {
    const css = readFileSync(join(designDir, 'styles', id, 'tokens.css'), 'utf8')
    for (const match of css.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)) {
      assert.ok(match[1].startsWith('--ts-'), `${id} 出现非 --ts- 变量：${match[1]}`)
    }
  }
})
