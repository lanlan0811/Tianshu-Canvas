/**
 * 从 CHANGELOG.md 提取指定版本（tag）的发布说明，打印到 stdout。
 * 找不到对应版本段则退出码非 0（release workflow 据此失败）。
 *
 * 用法：node scripts/extract-release-notes.mjs v0.1.0
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const tag = process.argv[2]
if (!tag) {
  console.error('用法：node scripts/extract-release-notes.mjs <tag>')
  process.exit(1)
}

const file = resolve(import.meta.dirname, '..', 'CHANGELOG.md')
const text = readFileSync(file, 'utf8')
const lines = text.split(/\r?\n/)

// 支持 `## [v0.1.0]` / `## v0.1.0` / `## [0.1.0]` 三种写法
const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const bare = tag.replace(/^v/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const heading = new RegExp(`^##\\s*\\[?\\s*(v?${bare})\\s*\\]?`)
const start = lines.findIndex((l) => heading.test(l))
if (start < 0) {
  console.error(`CHANGELOG.md 中找不到版本 ${tag} 的段落`)
  process.exit(1)
}

const body = []
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s/.test(lines[i])) break
  body.push(lines[i])
}
const notes = body.join('\n').trim()
if (!notes) {
  console.error(`版本 ${tag} 的发布说明为空`)
  process.exit(1)
}
console.log(notes)
