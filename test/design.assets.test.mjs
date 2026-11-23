/** 设计系统资产解析：内容寻址引用、旧布局回退与越界拒绝。 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const outDir = mkdtempSync(join(tmpdir(), 'tsc-design-assets-'))
const outFile = join(outDir, 'designAssets.mjs')
await build({ entryPoints: [join(root, 'src/designAssets.ts')], outfile: outFile, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent' })
const api = await import(pathToFileURL(outFile).href)

function fixture(assets) {
  const designRoot = mkdtempSync(join(tmpdir(), 'tsc-design-root-'))
  const styleDir = join(designRoot, 'styles', 'one')
  mkdirSync(styleDir, { recursive: true })
  for (const name of ['components.css', 'templates.json', 'interactions.json']) writeFileSync(join(styleDir, name), name)
  if (assets) writeFileSync(join(styleDir, 'assets.json'), JSON.stringify(assets))
  return { designRoot, styleDir, cleanup: () => rmSync(designRoot, { recursive: true, force: true }) }
}

test('assets.json 缺失时回退旧布局', () => {
  const ws = fixture(null)
  try {
    assert.equal(api.resolveStyleAsset(ws.styleDir, ws.designRoot, 'components'), join(ws.styleDir, 'components.css'))
    assert.deepEqual(api.styleAssets(ws.styleDir).templates, 'templates.json')
  } finally { ws.cleanup() }
})

test('assets.json 生效并解析到共享目录', () => {
  const ws = fixture({ components: '../../shared/abc/components.css' })
  try {
    assert.equal(api.resolveStyleAsset(ws.styleDir, ws.designRoot, 'components'), join(ws.designRoot, 'shared', 'abc', 'components.css'))
    // 未提供的键继续使用默认值。
    assert.equal(api.resolveStyleAsset(ws.styleDir, ws.designRoot, 'templates'), join(ws.styleDir, 'templates.json'))
  } finally { ws.cleanup() }
})

test('越界或绝对路径引用被拒绝', () => {
  for (const assets of [
    { components: '../../../../outside/components.css' },
    { components: '/etc/passwd' },
    { components: 'C:\\Windows\\win.ini' },
  ]) {
    const ws = fixture(assets)
    try {
      assert.throws(() => api.resolveStyleAsset(ws.styleDir, ws.designRoot, 'components'), /越界|绝对路径/,
        JSON.stringify(assets))
    } finally { ws.cleanup() }
  }
})

test('损坏的 assets.json 回退默认布局而不是抛错', () => {
  const ws = fixture(null)
  try {
    writeFileSync(join(ws.styleDir, 'assets.json'), '{broken')
    assert.equal(api.styleAssets(ws.styleDir).components, 'components.css')
  } finally { ws.cleanup() }
})
