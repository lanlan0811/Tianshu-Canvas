/**
 * golden 逐字节基线：canvas_check_style 的报告文本一旦变化就必须有人复核。
 *
 * 证据边界：只覆盖内联 HTML 分支（label 固定「直接检查传入的 HTML」），
 * 页面 id / 标题 / 模式这些非确定性来源一律不传入。渲染级报告不在 golden 范围内。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const goldenDir = join(root, 'test', 'golden', 'check-style')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)

const CASES = ['clean', 'detector-mixed', 'deferred-only', 'style-drift', 'truncated', 'unused-ignore']

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

/** 取文件首行注释里的输入指纹（`<!-- input-sha256: <hex> -->`）。 */
function recordedHash(html) {
  return /<!--\s*input-sha256:\s*([0-9a-f]{64})\s*-->/.exec(html)?.[1] ?? null
}

/** 去掉指纹注释后的正文；指纹本身不参与哈希，避免自指。 */
function bodyWithoutHash(html) {
  return html.replace(/<!--\s*input-sha256:\s*[0-9a-f]{64}\s*-->\n?/, '')
}

const HINT = '若要更新基线，先用 canvas_check_style 人工复核输出，再改 golden；禁止仅为让测试通过而重录。'

function firstDiff(actual, expected) {
  const a = actual.split('\n')
  const b = expected.split('\n')
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) return `第 ${i + 1} 行：\n  实际：${a[i] ?? '(缺失)'}\n  期望：${b[i] ?? '(缺失)'}`
  }
  return '(无差异)'
}

for (const name of CASES) {
  test(`golden：${name} 的报告与基线逐字节一致`, { timeout: 120000 }, async () => {
    const file = join(goldenDir, `${name}.html`)
    const html = readFileSync(file, 'utf8')
    const golden = readFileSync(join(goldenDir, `${name}.golden.txt`), 'utf8')

    const expectedHash = recordedHash(html)
    assert.ok(expectedHash, `${name}.html 缺少 input-sha256 注释`)
    const actualHash = sha256(bodyWithoutHash(html))
    assert.equal(actualHash, expectedHash, `${name}.html 的输入被改动但没重录基线。${HINT}`)

    const cwd = mkdtempSync(join(tmpdir(), 'tsc-golden-'))
    try {
      const res = await tools.canvas_check_style.execute({ input: { html, style_id: 'tianshu-original' }, cwd })
      assert.ok(!res.isError, res.content)
      assert.equal(res.content, golden, `报告与基线不一致：\n${firstDiff(res.content, golden)}\n${HINT}`)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
}

test('golden：报告确定性（同一输入连续两次完全相同）', { timeout: 120000 }, async () => {
  const html = readFileSync(join(goldenDir, 'detector-mixed.html'), 'utf8')
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-golden-det-'))
  try {
    const once = await tools.canvas_check_style.execute({ input: { html, style_id: 'tianshu-original' }, cwd })
    const twice = await tools.canvas_check_style.execute({ input: { html, style_id: 'tianshu-original' }, cwd })
    assert.equal(once.content, twice.content)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('golden：输入被篡改时 sha256 校验先失败（防悄悄换输入）', () => {
  const html = readFileSync(join(goldenDir, 'clean.html'), 'utf8')
  const tampered = html.replace('<h1>干净页面</h1>', '<h1>改过的标题</h1>')
  assert.notEqual(sha256(bodyWithoutHash(tampered)), recordedHash(html))
})
