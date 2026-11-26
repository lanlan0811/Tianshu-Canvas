/**
 * 规则命中实测（自建语料 + 构造缺陷语料）。
 *
 * 两部分：
 *  1. 干净语料：32 个原创原型 + 12 份方向示例。命中 = 误报候选，必须逐条人工判读。
 *  2. 构造缺陷语料：每条规则的 4 份 flag fixture。命中 = 真阳，用来测召回。
 *
 * 这不是 impeccable 的 DELTAS.md 那种真实站点语料——本项目没有外部语料，
 * 所以这份数字只能回答「规则在我们自己的页面上会不会炸」，不能直接外推。
 * 用法：node scripts/rule-precision.mjs [--json <path>]
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadPlugin } from '../test/helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const jsonFlag = process.argv.indexOf('--json')
const jsonOut = jsonFlag > 0 ? process.argv[jsonFlag + 1] : null

function compose(resource) {
  const css = resource.css.replace(/<\/style/gi, '<\\/style')
  return `<!doctype html><html lang="${resource.language}"><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0">${resource.html}</body></html>`
}

/** 语料：编译后的原型与方向示例，合成完整文档。 */
function loadCorpus() {
  const items = []
  const prototypeIndex = JSON.parse(readFileSync(join(root, 'dist/design/prototypes/index.json'), 'utf8'))
  for (const summary of prototypeIndex.prototypes) {
    const resource = JSON.parse(readFileSync(join(root, 'dist/design/prototypes', `${summary.id}.json`), 'utf8'))
    items.push({ id: summary.id, kind: 'prototype', html: compose(resource) })
  }
  const directionIndex = JSON.parse(readFileSync(join(root, 'dist/design/directions/index.json'), 'utf8'))
  for (const summary of directionIndex.directions) {
    const direction = JSON.parse(readFileSync(join(root, 'dist/design/directions', `${summary.id}.json`), 'utf8'))
    for (const example of direction.examples) {
      const category = example.prototypeId ? 'prototypes' : 'directions'
      const resource = JSON.parse(readFileSync(join(root, 'dist/design', category, `${example.resourceId}.json`), 'utf8'))
      items.push({ id: `direction-${example.id}`, kind: 'direction-example', html: compose(resource) })
    }
  }
  return items
}

/** 从报告文本里数某条规则的命中条数（与 test/rules.fixtures.test.mjs 同口径）。 */
function countHits(text, ruleId) {
  const pattern = new RegExp('^\\d+\\. \\[' + ruleId + '(?:·建议)?\\]', 'gm')
  return [...text.matchAll(pattern)].length
}

const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist/index.mjs')).href)
const corpus = loadCorpus()
const ruleIds = [...readFileSync(join(root, 'src/rules/registry.ts'), 'utf8').matchAll(/^ {4}id: '([a-z0-9-]+)',/gm)].map((m) => m[1])
const corpusHash = createHash('sha256').update(corpus.map((item) => item.id + '\n' + item.html).join('\n')).digest('hex').slice(0, 16)

/**
 * 每条规则可以有自己的 fixture 风格（meta.json 的 styleId）。
 * 例如 overused-font 的「品牌字体豁免」这类阴性样本只有在 manifest 的品牌字体
 * 恰好是被判定为烂大街的字体时才成立；硬编码 tianshu-original 会把它误判成误报。
 */
function styleFor(ruleId) {
  const file = join(root, 'test/fixtures/rules', ruleId, 'meta.json')
  try {
    const meta = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof meta.styleId === 'string') return meta.styleId
  } catch { /* 没有 meta.json 时用默认风格 */ }
  return 'tianshu-original'
}

async function run(html, ruleId, styleId = 'tianshu-original') {
  const res = await tools.canvas_check_style.execute({ input: { html, rules: ruleId, style_id: styleId }, cwd: root })
  if (res.isError) throw new Error(`${ruleId}: ${res.content}`)
  return res.content
}

const clean = []
for (const ruleId of ruleIds) {
  let files = 0
  let findings = 0
  const hitIds = []
  const styleId = styleFor(ruleId)
  for (const item of corpus) {
    const text = await run(item.html, ruleId, styleId)
    const count = countHits(text, ruleId)
    if (count > 0) { files++; findings += count; hitIds.push(item.id) }
  }
  clean.push({ ruleId, files, findings, hitIds })
}

/**
 * 阴性语料：每条规则的 5 份 pass fixture。
 * 它们按判据写成「不该命中」的形态，命中即误报——这是本仓库能拿到的最接近
 * 「真实世界误报率」的代理指标（仍不是外部站点语料）。
 */
const falsePositives = []
for (const ruleId of ruleIds) {
  const dir = join(root, 'test/fixtures/rules', ruleId)
  const passes = readdirSync(dir).filter((f) => f.startsWith('pass-') && f.endsWith('.html')).sort()
  const styleId = styleFor(ruleId)
  let fired = 0
  const ids = []
  for (const file of passes) {
    const text = await run(readFileSync(join(dir, file), 'utf8'), ruleId, styleId)
    if (countHits(text, ruleId) > 0) { fired++; ids.push(file) }
  }
  falsePositives.push({ ruleId, passes: passes.length, fired, ids })
}

const recall = []
for (const ruleId of ruleIds) {
  const dir = join(root, 'test/fixtures/rules', ruleId)
  const flags = readdirSync(dir).filter((f) => f.startsWith('flag-') && f.endsWith('.html')).sort()
  const styleId = styleFor(ruleId)
  let fired = 0
  for (const file of flags) {
    const text = await run(readFileSync(join(dir, file), 'utf8'), ruleId, styleId)
    if (countHits(text, ruleId) > 0) fired++
  }
  recall.push({ ruleId, flags: flags.length, fired })
}

const total = corpus.length
const lines = [
  `规则命中实测：干净语料 ${total} 份（32 原型 + 12 方向示例）· 指纹 ${corpusHash}`,
  '',
  '### 干净语料（命中 = 误报候选）',
  '',
  '| 规则 | 命中文件 | 命中条数 | 命中率（文件） | 命中样本 |',
  '|---|---|---|---|---|',
]
for (const row of clean) {
  const rate = ((row.files / total) * 100).toFixed(0)
  lines.push(`| \`${row.ruleId}\` | ${row.files} | ${row.findings} | ${rate}% | ${row.hitIds.slice(0, 4).join('、') || '—'} |`)
}
lines.push('', '### 构造缺陷语料的召回（每条规则的 4 份 flag）', '', '| 规则 | flag 数 | 命中数 |', '|---|---|---|')
for (const row of recall) lines.push(`| \`${row.ruleId}\` | ${row.flags} | ${row.fired} |`)
const missed = recall.filter((row) => row.fired < row.flags)
lines.push('', missed.length === 0 ? '全部 flag fixture 均命中（召回 100%）。' : `未全命中：${missed.map((r) => `${r.ruleId}(${r.fired}/${r.flags})`).join('、')}`)
lines.push('', '### 阴性语料的误报（每条规则的 5 份 pass）', '', '| 规则 | pass 数 | 误报数 | 误报样本 |', '|---|---|---|---|')
for (const row of falsePositives) lines.push(`| \`${row.ruleId}\` | ${row.passes} | ${row.fired} | ${row.ids.join('、') || '—'} |`)
const noisy = falsePositives.filter((row) => row.fired > 0)
lines.push('', noisy.length === 0 ? '全部 pass fixture 均未命中（阴性语料零误报）。' : `有误报：${noisy.map((r) => `${r.ruleId}(${r.fired}/${r.passes})`).join('、')}`)
lines.push('', '判读与结论见 docs/rule-precision.md。')
const report = lines.join('\n')
console.log(report)

if (jsonOut) {
  const target = resolve(root, jsonOut)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify({ corpusHash, total, clean, recall, falsePositives }, null, 2) + '\n', 'utf8')
}
