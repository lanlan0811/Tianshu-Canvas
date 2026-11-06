/**
 * PNG 解码与像素 diff 单测（零依赖实现）。
 */
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const { decodePng, encodePng, diffPng } = await import(pathToFileURL(join(root, 'src', 'audit', 'png.ts')).href)

test('编码 → 解码 往返，像素值一致', () => {
  const png = encodePng(4, 3, [10, 20, 30, 255])
  const img = decodePng(png)
  assert.equal(img.width, 4)
  assert.equal(img.height, 3)
  assert.equal(img.channels, 4)
  assert.deepEqual([...img.data.subarray(0, 4)], [10, 20, 30, 255])
})

test('相同图像 score=1、无 bbox', () => {
  const a = decodePng(encodePng(10, 10, [1, 2, 3, 255]))
  const b = decodePng(encodePng(10, 10, [1, 2, 3, 255]))
  const diff = diffPng(a, b)
  assert.equal(diff.changed, 0)
  assert.equal(diff.score, 1)
  assert.equal(diff.bbox, null)
})

test('单像素变化：检出且 bbox 精确到该像素', () => {
  const width = 8
  const png = encodePng(width, 4, [255, 255, 255, 255])
  // 把 (3,2) 改成黑色（每行 1 字节 filter + 4 字节像素）。
  const stride = width * 4 + 1
  const rawAt = stride * 2 + 1 + 3 * 4
  for (let i = 0; i < 3; i++) png[png.length - 0] // no-op，保持引用
  // 重新构造：用 encodePng 的布局直接改原始像素不现实，改为生成两张再比较。
  const a = decodePng(encodePng(width, 4, [255, 255, 255, 255]))
  const b = decodePng(encodePng(width, 4, [255, 255, 255, 255]))
  const idx = (2 * width + 3) * 4
  b.data[idx] = 0
  b.data[idx + 1] = 0
  b.data[idx + 2] = 0
  const diff = diffPng(a, b)
  assert.equal(diff.changed, 1)
  assert.deepEqual(diff.bbox, { x: 3, y: 2, width: 1, height: 1 })
  assert.ok(diff.score < 1)
  void rawAt
})

test('阈值内的小差异被忽略（抗锯齿容忍）', () => {
  const a = decodePng(encodePng(4, 4, [100, 100, 100, 255]))
  const b = decodePng(encodePng(4, 4, [100, 100, 100, 255]))
  b.data[0] = 105
  assert.equal(diffPng(a, b, { threshold: 8 }).changed, 0)
  assert.equal(diffPng(a, b, { threshold: 2 }).changed, 1)
})

test('忽略区域不参与比较', () => {
  const a = decodePng(encodePng(6, 6, [0, 0, 0, 255]))
  const b = decodePng(encodePng(6, 6, [0, 0, 0, 255]))
  // 前 3 个像素的 RGB 改为白（alpha 本来就是 255）→ 3 个像素变化。
  for (let i = 0; i < 3; i++) {
    const at = i * 4
    b.data[at] = 255
    b.data[at + 1] = 255
    b.data[at + 2] = 255
  }
  const full = diffPng(a, b)
  assert.equal(full.changed, 3)
  const ignored = diffPng(a, b, { ignore: [{ x: 0, y: 0, width: 6, height: 6 }] })
  assert.equal(ignored.changed, 0)
})

test('尺寸不一致给出可读错误', () => {
  const a = decodePng(encodePng(4, 4))
  const b = decodePng(encodePng(5, 4))
  assert.throws(() => diffPng(a, b), /尺寸不一致/)
})

test('非 PNG 输入被拒绝', () => {
  assert.throws(() => decodePng(Buffer.from('not a png')), /不是 PNG/)
})
