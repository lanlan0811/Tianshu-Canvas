/**
 * 生成官方发行 ZIP（对应开发套件 `npm run plugin -- pack` 的等价物）。
 *
 * 为什么要自己打包：官方套件位于 .claude/（被 gitignore，CI 拿不到），而平台要的三个根文件
 * 必须一个字节不差 —— 所以按官方 artifacts.ts 的规则在仓库内实现：
 *  - 只打包运行所需内容（PACKAGE_ENTRIES），绝不打包 node_modules / 锁文件 / 测试；
 *  - xiaosi.release.json：JCS 规范化，permission_digest = sha256(JCS(manifest.permissions))；
 *  - xiaosi.contents.json：其余每个文件的相对路径 → 小写 SHA-256；
 *  - 固定 mtime + 只存储不压缩，保证同一份源码产出同一份 ZIP。
 *
 * 官方套件在场时可再用它复核：
 *   npm run plugin -- validate <out.zip> --lane official_reviewed
 *
 * 用法：
 *   node scripts/pack-plugin.mjs <out.zip> --release-id <id> --publisher-id <id> \
 *     --source-commit <40/64 位小写 git 哈希> [--platforms win32-x64]
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buffer } from 'node:stream/consumers'
import { parseArgs } from 'node:util'
import { canonicalize } from 'json-canonicalize'
import yazl from 'yazl'
import { PACKAGE_ENTRIES } from './check-plugin.mjs'

const root = resolve(import.meta.dirname, '..')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const PLATFORM_PATTERN = /^(?:win32|darwin|linux)-(?:x64|arm64)$/

function usage(message) {
  if (message) console.error(message)
  console.error('用法：node scripts/pack-plugin.mjs <out.zip> --release-id <id> --publisher-id <id> --source-commit <hash> [--platforms csv]')
  process.exit(1)
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'release-id': { type: 'string' },
    'publisher-id': { type: 'string' },
    'source-commit': { type: 'string' },
    platforms: { type: 'string', default: 'win32-x64' },
  },
  allowPositionals: true,
})

const [output] = positionals
if (!output || positionals.length !== 1) usage('必须给出且只给出一个输出路径。')
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(values['release-id'] ?? '')) usage('--release-id 需 8–80 位，字母数字/_/-。')
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(values['publisher-id'] ?? '')) usage('--publisher-id 不合法。')
if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(values['source-commit'] ?? '')) usage('--source-commit 必须是 40 或 64 位小写 Git 提交哈希。')
const platforms = [...new Set(values.platforms.split(',').map((p) => p.trim()))].sort()
if (platforms.length === 0 || platforms.some((p) => !PLATFORM_PATTERN.test(p))) usage('--platforms 只接受 win32/darwin/linux 与 x64/arm64 的组合。')
if (existsSync(output)) usage(`输出路径已存在：${output}（每次打包请用新文件名）`)

// ---- 收集内容（官方只收运行所需文件）----
const files = new Map()
const walk = (rel) => {
  const abs = join(root, rel)
  const info = lstatSync(abs)
  if (info.isSymbolicLink()) throw new Error(`不得打包符号链接：${rel}`)
  if (info.isDirectory()) {
    for (const name of readdirSync(abs)) walk(`${rel}/${name}`)
    return
  }
  files.set(rel, readFileSync(abs))
}
for (const rel of PACKAGE_ENTRIES) {
  if (!existsSync(join(root, rel))) throw new Error(`缺少打包内容：${rel}（先跑 npm run build）`)
  walk(rel)
}
if (files.size + 2 > 2048) throw new Error('文件数超过 2048')

const manifest = JSON.parse(files.get('tianshu.plugin.json').toString('utf8'))
if (!manifest.engines?.tianshu) throw new Error('清单缺少 engines.tianshu')

files.set('xiaosi.release.json', Buffer.from(canonicalize({
  schema: 'xiaosi.release/1',
  release_id: values['release-id'],
  publisher_id: values['publisher-id'],
  plugin_id: manifest.id,
  version: manifest.version,
  runtime: 'agent',
  channel: 'stable',
  compatibility: { core: manifest.engines.tianshu, tpi: '1.0', platforms },
  data_schema: 1,
  migration_kind: 'none',
  permission_digest: sha256(canonicalize(manifest.permissions)),
  source_commit: values['source-commit'],
})))
files.set('xiaosi.contents.json', Buffer.from(canonicalize({
  schema: 'xiaosi.contents/1',
  files: Object.fromEntries([...files].map(([path, data]) => [path, sha256(data)])),
})))

// ---- 写 ZIP：固定时间戳 + 只存储，保证可复现 ----
const zip = new yazl.ZipFile()
const mtime = new Date(2000, 0, 1, 0, 0, 0)
for (const path of [...files.keys()].sort()) {
  zip.addBuffer(files.get(path), path, { mtime, mode: 0o100644, forceDosTimestamp: true, compress: false })
}
zip.end()
const bytes = await buffer(zip.outputStream)
writeFileSync(output, bytes, { flag: 'wx' })

console.log(`已生成 ${output}`)
console.log(`  plugin=${manifest.id} version=${manifest.version} release=${values['release-id']}`)
console.log(`  platforms=${platforms.join(',')}  files=${files.size}  bytes=${bytes.length}  sha256=${sha256(bytes)}`)
