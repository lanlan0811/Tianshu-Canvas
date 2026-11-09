/**
 * 官方发行前自检（对应开发套件 `npm run plugin -- validate` 的本地静态部分）。
 *
 * 校验项都来自官方约束，任何一条不过都意味着 ZIP 会被平台拒绝：
 *  - 清单字段：TPI 1.0、kind、id 规则、稳定 SemVer、engines.tianshu 必填（打包器硬要求）；
 *  - 工具声明：snake_case、≤64 字、描述 ≤200 字、不重名、声明 tools 能力；
 *  - 入口：包内相对路径、UTF-8、.js/.mjs/.cjs（本项目固定 dist/index.mjs）；
 *  - 包内容：不含依赖目录/锁文件/native 二进制，路径段符合 ZIP 规则；
 *  - 握手：activate 返回的工具名与清单完全一致，描述逐字一致（官方示例按
 *    { name, description } 深比较）；
 *  - 路径参数：声明了 pathParams 的参数必须真实存在于 inputSchema。
 *
 * 只做静态检查，不启动宿主；真实行为由 npm test 覆盖。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalize } from 'json-canonicalize'
import semver from 'semver'
import { z } from 'zod'

const root = resolve(import.meta.dirname, '..')
const executedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
const errors = []
const fail = (message) => errors.push(message)

const RESERVED_COMPONENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const BLOCKED_COMPONENT = /^(?:node_modules|\.git|\.npmrc|\.env(?:\..*)?|npm-shrinkwrap\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i
const NATIVE_EXTENSION = /\.(?:node|dll|dylib|so(?:\.\d+)*|exe|msi|com|a|o|obj|lib|wasm)$/i
const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])
const PACKAGE_INSTALL_FIELDS = new Set([
  'dependencies', 'devdependencies', 'peerdependencies', 'optionaldependencies', 'bundleddependencies',
  'bundledependencies', 'scripts', 'workspaces', 'gypfile', 'bin', 'config', 'packagemanager',
])

// ---- 用户实际会发行进 ZIP 的内容（与 scripts/pack-plugin.mjs 的清单保持一致）----
// 验收文档一卷只附本版：旧版记录对应的是旧原包，不能当作新版验收材料打包。
export const PACKAGE_ENTRIES = ['tianshu.plugin.json', 'dist', 'skills', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'docs/windows-acceptance-0.9.1.md']

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function validateArtifactPath(path) {
  const parts = path.split('/')
  if (path.length > 512 || parts.length > 32) return `路径过长或层级过深：${path}`
  for (const part of parts) {
    if (!/^[A-Za-z0-9_.@+ -]{1,128}$/.test(part)) return `非法路径段「${part}」（${path}）`
    if (/[ .]$/.test(part) || part.startsWith(' ')) return `路径段不得以空格或点结尾：${path}`
    if (RESERVED_COMPONENT.test(part)) return `系统保留名：${path}`
    if (BLOCKED_COMPONENT.test(part)) return `打包内容不得包含 ${part}：${path}`
  }
  return null
}

// ---- 清单 schema（镜像官方 artifacts.ts 的严格子集）----
const coreSchema = z.string().min(1).max(200).refine((v) => semver.validRange(v) !== null, '非法 SemVer 范围')
const versionSchema = z.string().max(32).regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/).refine((v) => {
  const parsed = semver.parse(v)
  return parsed !== null && parsed.raw === parsed.version && parsed.prerelease.length === 0
}, '需要不带构建元数据的稳定 SemVer')

const manifestSchema = z.strictObject({
  $tpi: z.literal('1.0'),
  kind: z.literal('tianshu.plugin'),
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .refine((v) => !v.endsWith('.') && !RESERVED_COMPONENT.test(v) && v.toLowerCase() !== 'xiaosi-axiom'),
  displayName: z.string().min(1).max(64),
  version: versionSchema,
  description: z.string().min(1).max(500),
  runtime: z.literal('agent').default('agent'),
  entry: z.string().min(1),
  capabilities: z.array(z.enum(['tools', 'storage', 'account', 'embeddings', 'sidePathLLM', 'promptContext', 'transcripts', 'log'])),
  contributes: z.strictObject({
    tools: z.array(z.strictObject({
      name: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, '工具名必须 snake_case'),
      description: z.string().min(1).max(200),
    })).default([]),
    lifecycle: z.array(z.enum(['turnStart', 'turnEnd', 'toolEnd', 'sessionEnd'])).default([]),
    skills: z.array(z.string().min(1)).optional(),
    commands: z.array(z.string().min(1)).optional(),
  }),
  permissions: z.strictObject({ fs: z.boolean().optional(), net: z.boolean().optional(), shell: z.boolean().optional() }).default({}),
  engines: z.strictObject({ tianshu: coreSchema.optional() }).optional(),
})

async function main() {
  // ---- 1. 清单 ----
  const manifestBytes = readFileSync(join(root, 'tianshu.plugin.json'))
  const parsedManifest = manifestSchema.safeParse(JSON.parse(manifestBytes.toString('utf8')))
  if (!parsedManifest.success) {
    for (const issue of parsedManifest.error.issues) fail(`清单 ${issue.path.join('.') || '(root)'}：${issue.message}`)
  }
  const manifest = parsedManifest.data

  if (manifest) {
    if (!manifest.engines?.tianshu) fail('清单缺少 engines.tianshu（官方打包器要求声明天枢核心版本范围）')
    const names = manifest.contributes.tools.map((t) => t.name)
    if (names.length === 0 && manifest.contributes.lifecycle.length === 0) fail('agent 插件至少要贡献一个工具或一个生命周期阶段')
    if (names.length > 0 && !manifest.capabilities.includes('tools')) fail('声明了工具就必须在 capabilities 中列出 tools')
    if (new Set(names).size !== names.length) fail('工具名重复')

    // 2. 入口
    const entryPath = manifest.entry
    const entryIssue = validateArtifactPath(entryPath)
    if (entryIssue) fail(entryIssue)
    const entryAbs = join(root, entryPath)
    if (!existsSync(entryAbs)) {
      fail(`入口不存在：${entryPath}（先跑 npm run build）`)
    } else {
      if (!JS_EXTENSIONS.has(extname(entryPath))) fail(`入口必须是 .js/.mjs/.cjs：${entryPath}`)
      const bytes = readFileSync(entryAbs)
      if (bytes.length === 0) fail(`入口为空：${entryPath}`)
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        fail(`入口不是合法 UTF-8：${entryPath}`)
      }
    }

    // 3. 声明的 skills / commands 必须真实存在
    for (const skill of manifest.contributes.skills ?? []) {
      const issue = validateArtifactPath(skill)
      if (issue) fail(issue)
      else if (!existsSync(join(root, skill, 'SKILL.md'))) fail(`声明的 skill 缺少 SKILL.md：${skill}`)
    }

    // 4. 发行内容体积与文件类型
    let files = 0
    let total = 0
    const walk = (rel) => {
      const abs = join(root, rel)
      if (!existsSync(abs)) return
      if (statSync(abs).isFile()) {
        files += 1
        total += statSync(abs).size
        const issue = validateArtifactPath(rel)
        if (issue) fail(issue)
        if (NATIVE_EXTENSION.test(rel)) fail(`不得包含原生二进制：${rel}`)
        if (rel.toLowerCase().endsWith('package.json')) {
          const pkg = JSON.parse(readFileSync(abs, 'utf8'))
          for (const key of Object.keys(pkg)) {
            if (PACKAGE_INSTALL_FIELDS.has(key.toLowerCase())) fail(`包内 package.json 不得声明 ${key}`)
          }
        }
        return
      }
      for (const name of readdirSync(abs)) walk(`${rel}/${name}`)
    }
    for (const rel of PACKAGE_ENTRIES) walk(rel)
    if (files > 2048) fail(`文件数 ${files} 超过 2048`)
    const expanded = total
    if (expanded > 64 * 1024 * 1024) fail(`解包体积 ${expanded} 超过 64 MiB`)

    // 5. 握手：工具名 + 描述逐字一致
    if (existsSync(entryAbs)) {
      globalThis.__tianshuTPI = Object.freeze({
        version: '1.0',
        defineTianshuPlugin: (spec) => Object.freeze({ id: spec.id, activate: spec.activate, [Symbol.for('tianshu.tpi.plugin/v1')]: { tpi: '1.0' } }),
      })
      try {
        const mod = await import(`${pathToFileURL(entryAbs).href}?check=${Date.now()}`)
        const def = mod.default ?? mod.plugin
        if (!def) fail('入口没有默认导出 TPI 定义')
        else if (def.id !== manifest.id) fail(`入口 id（${def.id}）与清单（${manifest.id}）不一致`)
        else {
          const api = await def.activate({ tpiVersion: '1.0', pluginId: manifest.id, cwd: root, isWorker: false, log: { debug() {}, warn() {} } })
          const activated = (api.tools ?? []).map(({ name, description }) => ({ name, description }))
          const declared = manifest.contributes.tools.map(({ name, description }) => ({ name, description }))
          const byName = new Map(activated.map((t) => [t.name, t]))
          for (const tool of declared) {
            const runtime = byName.get(tool.name)
            if (!runtime) fail(`握手失败：清单声明了 ${tool.name}，入口未提供`)
            else if (runtime.description !== tool.description) {
              fail(`工具 ${tool.name} 的描述与清单不一致（loader 不校验，但官方套件按 {name, description} 深比较）`)
            }
          }
          for (const tool of activated) {
            if (!declared.some((t) => t.name === tool.name)) fail(`握手失败：入口多出未声明的工具 ${tool.name}`)
          }

          // 6. 工具对象形状 + pathParams 指向真实参数
          for (const tool of api.tools ?? []) {
            if (!tool.inputSchema || typeof tool.inputSchema !== 'object') fail(`工具 ${tool.name} 缺少 inputSchema`)
            if (Object.prototype.hasOwnProperty.call(tool, 'timeoutMs') && !(Number.isInteger(tool.timeoutMs) && tool.timeoutMs > 0)) {
              fail(`工具 ${tool.name} 的 timeoutMs 必须是正整数`)
            }
            const props = tool.inputSchema?.properties ?? {}
            for (const [param, mode] of Object.entries(tool.pathParams ?? {})) {
              if (mode !== 'read' && mode !== 'write') fail(`工具 ${tool.name}：pathParams.${param} 必须是 read 或 write`)
              if (!Object.hasOwn(props, param)) fail(`工具 ${tool.name}：pathParams 声明了不存在的参数 ${param}`)
            }
            // 声明为路径类参数却没写访问模式，宿主就不会做路径守卫。
            const pathLike = /^(?:.*_path|path|file|file_path|out_dir|dir)$/
            for (const param of Object.keys(props)) {
              if (pathLike.test(param) && !Object.hasOwn(tool.pathParams ?? {}, param)) {
                fail(`工具 ${tool.name}：参数 ${param} 看起来是路径，但未在 pathParams 中声明访问模式`)
              }
            }
          }
        }
      } catch (err) {
        fail(`加载入口失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // 7. 发行摘要（供人工核对与 CI 记录）
    if (errors.length === 0) {
      console.log(`OK 插件自检：${manifest.id}@${manifest.version} · ${manifest.contributes.tools.length} 个工具`)
      console.log(`  入口：${manifest.entry}`)
      console.log(`  权限摘要：${digest(canonicalize(manifest.permissions))}`)
      console.log(`  兼容：core=${manifest.engines.tianshu} tpi=${manifest.$tpi}`)
      console.log(`  打包文件：${files} 个，解包 ${(expanded / 1024).toFixed(1)} KiB`)
    }
  }

  if (errors.length > 0) {
    console.error(`插件自检失败（${errors.length} 项）：`)
    for (const message of errors) console.error(`  - ${message}`)
    process.exitCode = 1
  }

}

if (executedDirectly) await main()
