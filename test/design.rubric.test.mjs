/**
 * UX 评审量表的构建期校验与产物测试。
 *
 * 量表是评分的唯一真源：缺一条分数档、少一个 persona 红旗，代理就会在评审时
 * 凭空发明判据。因此这里既验证真实量表能通过，也用负例证明校验真的会拦。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { validateRubric } from '../scripts/design/design-validate.mjs'

const root = resolve(import.meta.dirname, '..')
const sourceFile = join(root, 'design-systems', 'rubrics', 'ux-review.json')
const distFile = join(root, 'dist', 'design', 'rubrics', 'ux-review.json')

function loadSource() {
  return JSON.parse(readFileSync(sourceFile, 'utf8'))
}

function errorsOf(doc) {
  const errors = []
  validateRubric(doc, errors)
  return errors
}

test('真实量表通过校验', () => {
  assert.deepEqual(errorsOf(loadSource()), [])
})

test('量表已构建到 dist/design/rubrics/', () => {
  assert.equal(existsSync(distFile), true, '先跑 npm run build')
  const built = JSON.parse(readFileSync(distFile, 'utf8'))
  assert.equal(built.schema, 1)
  assert.equal(built.heuristics.length, 10)
})

test('量表内容：10 条启发式各 5 档、8 项认知负荷、5 个 persona、9 项审美下限', () => {
  const doc = loadSource()
  assert.equal(doc.heuristics.length, 10)
  for (const heuristic of doc.heuristics) assert.equal(heuristic.levels.length, 5, heuristic.id)
  assert.equal(doc.cognitiveLoad.items.length, 8)
  assert.equal(doc.personas.length, 5)
  assert.equal(doc.craftFloor.length, 9)
  assert.deepEqual(doc.interpretive, [7, 10])
  assert.deepEqual(
    doc.severity.map((s) => s.id),
    ['P0', 'P1', 'P2', 'P3'],
  )
})

test('量表内容：硬禁令与默认值分开，硬禁令只有 eyebrow', () => {
  const doc = loadSource()
  assert.equal(doc.refuse.hardBans.length, 1)
  assert.equal(doc.refuse.hardBans[0].id, 'eyebrow')
  assert.equal(doc.refuse.defaults.length >= 10, true)
})

test('量表内容：评分档位按百分比递减且末档为 0', () => {
  const doc = loadSource()
  const mins = doc.bands.map((b) => b.min)
  assert.deepEqual(mins, [...mins].sort((a, b) => b - a))
  assert.equal(mins[mins.length - 1], 0)
})

test('负例：缺一条启发式的分数档必须报错', () => {
  const doc = loadSource()
  doc.heuristics[3].levels = doc.heuristics[3].levels.slice(0, 4)
  const errors = errorsOf(doc)
  assert.ok(errors.some((e) => e.includes('5 个分数档')), errors.join('|'))
})

test('负例：启发式数量不足必须报错', () => {
  const doc = loadSource()
  doc.heuristics.pop()
  assert.ok(errorsOf(doc).some((e) => e.includes('启发式必须为 10 条')))
})

test('负例：persona 少于 3 条红旗必须报错', () => {
  const doc = loadSource()
  doc.personas[0].redFlags = doc.personas[0].redFlags.slice(0, 2)
  assert.ok(errorsOf(doc).some((e) => e.includes('redFlags 至少 3 条')))
})

test('负例：mapping 引用不存在的 persona 必须报错', () => {
  const doc = loadSource()
  doc.personaMap[0].personas = ['nobody']
  assert.ok(errorsOf(doc).some((e) => e.includes('不存在的 persona')))
})

test('负例：严重度缺 P3 必须报错', () => {
  const doc = loadSource()
  doc.severity = doc.severity.filter((s) => s.id !== 'P3')
  assert.ok(errorsOf(doc).some((e) => e.includes('严重度缺少 P3')))
})

test('负例：审美下限少一项必须报错', () => {
  const doc = loadSource()
  doc.craftFloor.pop()
  assert.ok(errorsOf(doc).some((e) => e.includes('审美下限必须为 9 项')))
})

test('负例：评分档位顺序颠倒必须报错', () => {
  const doc = loadSource()
  doc.bands = [
    { min: 50, label: '可接受' },
    { min: 90, label: '优秀' },
    { min: 0, label: '严重' },
  ]
  assert.ok(errorsOf(doc).some((e) => e.includes('严格递减')))
})

test('负例：硬禁令清空必须报错（不允许把禁令降级为默认值）', () => {
  const doc = loadSource()
  doc.refuse.hardBans = []
  assert.ok(errorsOf(doc).some((e) => e.includes('hardBans 至少 1 条')))
})

test('负例：n/a 允许集合超过两条必须报错', () => {
  const doc = loadSource()
  doc.interpretive = [7, 10, 9]
  assert.ok(errorsOf(doc).some((e) => e.includes('最多允许两条')))
})
