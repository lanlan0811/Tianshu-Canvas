import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')

test('AI and HTTP page mutations share immediate forward-reference backfill', async () => {
  const { tools, api } = await loadPlugin(pathToFileURL(join(root, 'dist/index.mjs')).href)
  const roots = []
  const fixture = async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'tsc-nav-entrances-'))
    roots.push(cwd)
    const call = async (name, input) => {
      const result = await tools[name].execute({ input, cwd })
      assert.ok(!result.isError, result.content)
      return result
    }
    const opened = await call('canvas_open', { port: 0 })
    const url = opened.content.split('\n').find((line) => line.startsWith('http://127.0.0.1:')).trim()
    const ws = new URL(url).searchParams.get('ws')
    const post = async (op, fields) => {
      const response = await fetch(new URL('api/nodes', url), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
        body: JSON.stringify({ ws, op, ...fields }),
      })
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }
    const path = (id) => join(cwd, '.tianshu-canvas', 'pages', `${id}.html`)
    const read = (id) => readFileSync(path(id), 'utf8')
    const project = () => JSON.parse(readFileSync(join(cwd, '.tianshu-canvas', 'project.json'), 'utf8'))
    return { cwd, call, post, path, read, project }
  }
  try {
    for (const via of ['AI', 'HTTP']) {
      const f = await fixture()
      const upsert = (input) => f.call('canvas_upsert_page', input)
      await upsert({ id: 'source', title: '来源', html: '<a href="目标.html">go</a>' })
      await upsert({ id: 'target', title: '其他', html: '<p>target</p>' })
      const rename = () => via === 'AI'
        ? upsert({ id: 'target', title: '目标' })
        : f.post('rename', { id: 'target', title: '目标' })
      await rename()
      assert.match(f.read('source'), /href="target.html"/, `${via} rename resolves existing forward reference`)
      const revision = f.project().nodes.find((node) => node.id === 'source').htmlRev
      await rename()
      assert.equal(f.project().nodes.find((node) => node.id === 'source').htmlRev, revision, `${via} repeated rename leaves source revision`)
      await upsert({ id: 'copy-source', title: '复制来源', html: '<a href="副本.html">copy</a>' })
      let duplicateId
      if (via === 'AI') {
        const duplicated = await f.call('canvas_arrange', { action: 'duplicate', id: 'target', title: '副本' })
        duplicateId = duplicated.content.match(/新 id=([\w-]+)/)[1]
      } else duplicateId = (await f.post('duplicate', { id: 'target', title: '副本' })).node.id
      assert.ok(f.read('copy-source').includes(`href="${duplicateId}.html"`), `${via} duplicate resolves its new title`)
      // External edits produce one ambiguous source; removing a duplicate must resolve it immediately.
      await upsert({ id: 'target-duplicate', title: '目标', html: '<p>duplicate</p>' })
      writeFileSync(f.path('source'), '<a href="目标.html">ambiguous</a>')
      if (via === 'AI') await f.call('canvas_arrange', { action: 'remove', id: 'target-duplicate' })
      else await f.post('remove', { id: 'target-duplicate' })
      assert.match(f.read('source'), /href="target.html"/, `${via} delete resolves newly unambiguous source`)
      // Staged style rewrites refresh the cached offsets before a later forward target.
      await upsert({ id: 'style-source', title: '换肤来源', html: '<html><head></head><body><a href="风格目标.html">style</a></body></html>' })
      await f.call('canvas_style', { action: 'set', style_id: 'apple' })
      await upsert({ id: 'style-target', title: '风格目标', html: '<p>new</p>' })
      assert.match(f.read('style-source'), /href="style-target.html"/)
    }
  } finally {
    await api.dispose()
    for (const cwd of roots) rmSync(cwd, { recursive: true, force: true })
  }
})
