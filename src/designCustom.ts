/**
 * 用户自定义设计系统：读写工作区 `.tianshu-canvas/library/`，并在运行时把
 * `tokens.json` + `meta.json` 编译成与内置风格同形的 {@link ResolvedStyle}。
 *
 * 为什么在这里编译：内置风格在构建期由 scripts/build-design.mjs 编到 dist/design/；
 * 自定义风格是运行时由用户（经 AI）创建的，也必须产出同样五个产物（tokens.css /
 * components.css / tokens.manifest.json / icons.json / templates.json）才能被注入与 lint
 * 复用。其中**共享资源（组件/图标/模板）直接复用内置风格的产物**——已核验
 * components.css 与 templates.json 在所有风格间字节相同，icons.json 仅 stroke 不同。
 *
 * 编译与校验复用构建期的纯函数（scripts/design/*.mjs）：它们无 IO、无状态，
 * 经 esbuild 打进 dist/index.js；类型由同名 .d.mts 提供。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { assertSafeId, InvalidInputError, isSafeId } from './ids.js'
import { assertInsideWorkspace, readTextInWorkspace, writeFileInWorkspace } from './paths.js'
import { projectDir } from './project.js'
import { buildManifest, tokensToCss, type DesignManifest } from '../scripts/design/design-tokens.mjs'
import { auditForbidden, validateTokens } from '../scripts/design/design-validate.mjs'
import type { DesignIconSet, DesignInteraction, DesignInteractionLibrary, DesignStyleSummary, DesignTemplate, ResolvedStyle } from './design.js'

export const LIBRARY_DIR_NAME = 'library'

/** 自定义风格 id 前缀，用于与内置风格区隔（也便于画布标注）。 */
export function libraryDir(cwd: string): string {
  return join(projectDir(cwd), LIBRARY_DIR_NAME)
}

export function customStyleDir(cwd: string, id: string): string {
  assertSafeId(id)
  return join(libraryDir(cwd), id)
}

/** 提取文本里引用的 --ts-* 变量名。 */
function collectVars(text: string): Set<string> {
  const out = new Set<string>()
  for (const match of text.matchAll(/var\(\s*(--ts-[A-Za-z0-9-]+)/g)) out.add(match[1]!)
  return out
}

/**
 * 库的内容指纹：把每个风格的 tokens.json/meta.json 的内容哈希拼起来。
 * 用内容而非 mtime——Windows 的 mtime 粒度较粗，同秒内连续写入会被漏掉。
 */
export function stampLibrary(cwd: string): string {
  const dir = libraryDir(cwd)
  if (!existsSync(dir)) return ''
  const hash = createHash('sha1')
  const ids = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  for (const id of ids) {
    if (!isSafeId(id)) continue
    hash.update(id)
    for (const file of ['tokens.json', 'meta.json']) {
      const abs = join(dir, id, file)
      try {
        hash.update(existsSync(abs) ? readTextInWorkspace(cwd, abs, `${id}/${file}`) : '\0')
      } catch {
        // 指向工作区外的链接：按不可信内容处理，不把它读进来。
        hash.update('\0')
      }
    }
  }
  return hash.digest('hex')
}

/** 读 JSON；`cwd` 给出时按工作区边界校验（library 内的文件都是工作区数据）。 */
function readJson(file: string, label: string, cwd?: string): unknown {
  try {
    return JSON.parse(cwd ? readTextInWorkspace(cwd, file, label) : readFileSync(file, 'utf8'))
  } catch (err) {
    throw new InvalidInputError(`${label} 不是合法 JSON：${(err as Error).message}`)
  }
}

/** 共享资源：从任一内置风格的产物读取（跨风格字节相同，见模块头注释）。 */
function sharedAssets(builtinDir: string, builtinId: string, iconStyle: DesignIconSet['stroke']): {
  componentsCss: string
  templates: Record<string, DesignTemplate>
  icons: DesignIconSet
  interactions: DesignInteractionLibrary
} {
  const dir = join(builtinDir, 'styles', builtinId)
  const componentsCss = readFileSync(join(dir, 'components.css'), 'utf8')
  const templates = readJson(join(dir, 'templates.json'), 'templates.json') as Record<string, DesignTemplate>
  const raw = readJson(join(dir, 'icons.json'), 'icons.json') as { viewBox: string; icons: Record<string, string> }
  const interactions = readInteractionLibrary(dir)
  return { componentsCss, templates, icons: { viewBox: raw.viewBox, stroke: iconStyle, icons: raw.icons }, interactions }
}

/** 读取内置风格的交互库产物（与 design.ts 的同名逻辑一致，避免循环依赖而各自实现）。 */
function readInteractionLibrary(dir: string): DesignInteractionLibrary {
  const empty: DesignInteractionLibrary = { css: '', js: '', catalog: {}, rootAttrs: [] }
  try {
    const doc = readJson(join(dir, 'interactions.json'), 'interactions.json') as { interactions?: DesignInteraction[]; bindings?: DesignInteractionLibrary['bindings'] }
    const catalog: Record<string, DesignInteraction> = {}
    const rootAttrs: string[] = []
    for (const entry of doc.interactions ?? []) {
      catalog[entry.id] = entry
      if (entry.rootAttr) rootAttrs.push(entry.rootAttr)
    }
    return {
      css: readFileSync(join(dir, 'interactions.css'), 'utf8'),
      js: readFileSync(join(dir, 'interactions.js'), 'utf8'),
      catalog,
      rootAttrs,
      bindings: doc.bindings ?? [],
    }
  } catch {
    return empty
  }
}

/** 校验：自定义 token 必须覆盖共享 CSS（组件/交互）与模板里引用的全部 --ts-* 变量。 */
function assertCoversSharedVars(manifest: DesignManifest, componentsCss: string, templates: Record<string, DesignTemplate>, interactionsCss: string, errors: string[]): void {
  const known = new Set(manifest.vars)
  const needed = collectVars(componentsCss)
  for (const v of collectVars(interactionsCss)) needed.add(v)
  for (const tpl of Object.values(templates)) for (const v of collectVars(tpl.html)) needed.add(v)
  const missing = [...needed].filter((v) => !known.has(v))
  if (missing.length) {
    errors.push(`tokens 缺少共享组件/模板/交互所需的变量（会样式悬空）：${missing.slice(0, 8).join('、')}${missing.length > 8 ? ` 等 ${missing.length} 个` : ''}`)
  }
}

export interface CustomCreateOptions {
  overwrite?: boolean
  /** 内置风格 id 集合，用于禁止覆盖内置风格。 */
  builtinIds: string[]
}

export interface CustomCreateResult {
  id: string
  summary: DesignStyleSummary
  warnings: string[]
}

/** 从 library 读出所有自定义风格的展示摘要（跳过损坏项，不抛错）。 */
export function loadCustomSummaries(cwd: string, builtinDir: string): DesignStyleSummary[] {
  const dir = libraryDir(cwd)
  if (!existsSync(dir)) return []
  const out: DesignStyleSummary[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isSafeId(entry.name)) continue
    try {
      out.push(compileCustomStyle(cwd, entry.name, builtinDir).summary)
    } catch {
      /* 单个风格损坏不影响其它风格；list 时会被跳过 */
    }
  }
  return out
}

/** 自定义风格是否存在。 */
export function customStyleExists(cwd: string, id: string): boolean {
  return isSafeId(id) && existsSync(join(libraryDir(cwd), id, 'tokens.json'))
}

/** 把 library/<id> 的 tokens.json + meta.json 编译成 ResolvedStyle。 */
export function compileCustomStyle(cwd: string, id: string, builtinDir: string): ResolvedStyle {
  const dir = customStyleDir(cwd, id)
  const tokensFile = join(dir, 'tokens.json')
  const metaFile = join(dir, 'meta.json')
  if (!existsSync(tokensFile) || !existsSync(metaFile)) {
    throw new InvalidInputError(`自定义设计系统不存在：${id}`)
  }
  // library/<id>/ 及两个文件都是工作区数据：读前按边界校验，链接越界即拒绝。
  const tokens = readJson(tokensFile, `${id}/tokens.json`, cwd) as Record<string, any>
  const meta = readJson(metaFile, `${id}/meta.json`, cwd) as Record<string, any>

  const iconStyle = meta.iconStyle as DesignIconSet['stroke']
  const contract = sharedContract(builtinDir)
  const shared = sharedAssets(builtinDir, contract.builtinId, iconStyle)
  const manifest = buildManifest(tokens, {
    icons: contract.iconNames,
    componentClasses: contract.componentClasses,
    interactionClasses: contract.interactionClasses,
    interactionIds: contract.interactionIds,
  })

  const templates = shared.templates
  const summary: DesignStyleSummary = {
    id,
    name: String(meta.name ?? id),
    tagline: String(meta.tagline ?? ''),
    description: String(meta.description ?? ''),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    swatches: Array.isArray(meta.swatches) ? meta.swatches.map(String) : [],
    fonts: (tokens.font?.families ?? {}) as Record<string, string>,
    iconStyle,
    counts: {
      icons: manifest.iconNames.length,
      components: contract.componentCount,
      templates: Object.keys(templates).length,
      interactions: Object.keys(shared.interactions.catalog).length,
    },
    templates: Object.entries(templates).map(([tid, t]) => ({ id: tid, name: t.name, device: t.device })),
    interactions: Object.values(shared.interactions.catalog).map((it) => ({
      id: it.id,
      name: it.name,
      category: it.category,
      requiresScript: it.requiresScript,
    })),
  }

  return {
    summary,
    tokensCss: tokensToCss(tokens),
    componentsCss: shared.componentsCss,
    manifest,
    icons: shared.icons,
    templates,
    interactions: shared.interactions,
  }
}

// ---------------------------------------------------------------------------
// 共享契约（取自内置风格产物，按 builtinDir 缓存）
// ---------------------------------------------------------------------------

interface SharedContract {
  builtinId: string
  componentClasses: string[]
  iconNames: string[]
  /** 交互库独有类与交互 id（自定义风格复用，不扩展）。 */
  interactionClasses: string[]
  interactionIds: string[]
  /** 组件数量（= 内置 catalog 的 counts.components，与类名数量不同）。 */
  componentCount: number
}

const sharedContractCache = new Map<string, SharedContract>()

/**
 * 内置风格的共享契约：取 index.json 的第一套风格作为代表
 * （组件类集合与图标集合对全部风格相同，见模块头注释）。
 */
function sharedContract(builtinDir: string): SharedContract {
  const cached = sharedContractCache.get(builtinDir)
  if (cached) return cached
  const index = readJson(join(builtinDir, 'index.json'), 'design/index.json') as {
    styles: Array<{ id: string; counts?: { components?: number } }>
  }
  const builtinId = index.styles[0]?.id
  if (!builtinId) throw new Error('设计系统构建产物缺失：dist/design/index.json 没有风格')
  const dir = join(builtinDir, 'styles', builtinId)
  const manifest = readJson(join(dir, 'tokens.manifest.json'), 'tokens.manifest.json') as DesignManifest
  const icons = readJson(join(dir, 'icons.json'), 'icons.json') as { icons: Record<string, string> }
  const value: SharedContract = {
    builtinId,
    componentClasses: manifest.componentClasses,
    iconNames: Object.keys(icons.icons),
    interactionClasses: manifest.interactionClasses ?? [],
    interactionIds: manifest.interactionIds ?? [],
    componentCount: index.styles[0]?.counts?.components ?? 0,
  }
  sharedContractCache.set(builtinDir, value)
  return value
}

/** 测试用：清空共享契约缓存（产物被替换后需重新读取）。 */
export function resetSharedContractCache(): void {
  sharedContractCache.clear()
}

// ---------------------------------------------------------------------------
// create / remove
// ---------------------------------------------------------------------------

function writeJsonAtomic(cwd: string, file: string, value: unknown): void {
  // 自定义设计系统产物走统一边界：library/ 自身或其叶子被预置成链接时拒绝。
  writeFileInWorkspace(cwd, file, JSON.stringify(value, null, 2).replace(/\r\n/g, '\n') + '\n')
}

/**
 * 创建（或覆盖）一套自定义风格。
 * 校验全部通过后才写盘；任何错误抛 InvalidInputError，消息为逐条中文。
 */
export function createCustomStyle(
  cwd: string,
  id: unknown,
  tokensIn: unknown,
  metaIn: unknown,
  builtinDir: string,
  options: CustomCreateOptions,
): CustomCreateResult {
  if (!isSafeId(id)) {
    throw new InvalidInputError(`非法 id：${String(id)}（仅允许字母数字、下划线、连字符，1–64 位）`)
  }
  if (options.builtinIds.includes(id)) {
    throw new InvalidInputError(`id「${id}」与内置风格冲突，请换一个名字。`)
  }
  const exists = customStyleExists(cwd, id)
  if (exists && options.overwrite !== true) {
    throw new InvalidInputError(`自定义设计系统「${id}」已存在。若要覆盖，请传 overwrite=true。`)
  }
  if (!tokensIn || typeof tokensIn !== 'object' || Array.isArray(tokensIn)) {
    throw new InvalidInputError('缺少 tokens：请传入完整 tokens 对象（见工具说明）。')
  }
  const metaInObj = (metaIn && typeof metaIn === 'object' && !Array.isArray(metaIn) ? metaIn : {}) as Record<string, unknown>

  const tokens: Record<string, any> = { ...(tokensIn as Record<string, any>), schema: 'tianshu-design-tokens/1', id }
  if (typeof tokens.version !== 'number') tokens.version = 1
  if (!tokens.modes || typeof tokens.modes !== 'object') {
    tokens.modes = { light: true, dark: tokens.color?.semanticDark != null }
  }

  const iconStyle = metaInObj.iconStyle as { strokeWidth?: unknown } | undefined
  if (!iconStyle || typeof iconStyle !== 'object' || typeof iconStyle.strokeWidth !== 'number') {
    throw new InvalidInputError('缺少 meta.iconStyle.strokeWidth（数字，如 1.5 / 1.75）。')
  }

  const meta = {
    id,
    name: String(metaInObj.name ?? id),
    tagline: String(metaInObj.tagline ?? ''),
    description: String(metaInObj.description ?? ''),
    tags: Array.isArray(metaInObj.tags) ? metaInObj.tags.map(String) : [],
    swatches: Array.isArray(metaInObj.swatches) ? metaInObj.swatches.map(String) : [],
    version: tokens.version,
    iconStyle,
    license: String(metaInObj.license ?? '本项目原创配色；图标为共享的通用线性几何图形。'),
    notice: String(metaInObj.notice ?? '自定义风格；与各品牌无隶属关系。'),
    // 适配器绑定（从真实代码库导入时写入；可选，旧 library 无此字段）。
    ...(metaInObj.adapter && typeof metaInObj.adapter === 'object' ? { adapter: metaInObj.adapter } : {}),
  }

  const errors: string[] = []
  const warnings: string[] = []
  validateTokens(tokens, id, errors, warnings)
  auditForbidden('meta.json', JSON.stringify(meta), errors)

  const contract = sharedContract(builtinDir)
  const manifest =
    errors.length === 0
      ? buildManifest(tokens, {
          icons: contract.iconNames,
          componentClasses: contract.componentClasses,
          interactionClasses: contract.interactionClasses,
          interactionIds: contract.interactionIds,
        })
      : null
  if (manifest) {
    const { componentsCss, templates, interactions } = sharedAssets(builtinDir, contract.builtinId, iconStyle as DesignIconSet['stroke'])
    assertCoversSharedVars(manifest, componentsCss, templates, interactions.css, errors)
    // 与内置风格变量名集合逐项对齐（自定义值自由，但名字必须全覆盖）。
    const builtinManifest = readJson(
      join(builtinDir, 'styles', contract.builtinId, 'tokens.manifest.json'),
      'tokens.manifest.json',
    ) as DesignManifest
    const known = new Set(manifest.vars)
    const missing = builtinManifest.vars.filter((v) => !known.has(v))
    if (missing.length) {
      errors.push(`tokens 缺少内置风格的变量：${missing.slice(0, 8).join('、')}${missing.length > 8 ? ` 等 ${missing.length} 个` : ''}`)
    }
  }

  if (errors.length) {
    throw new InvalidInputError(`设计系统校验失败：\n${errors.map((e) => `  - ${e}`).join('\n')}`)
  }

  const dir = customStyleDir(cwd, id)
  writeJsonAtomic(cwd, join(dir, 'tokens.json'), tokens)
  writeJsonAtomic(cwd, join(dir, 'meta.json'), meta)

  const summary = compileCustomStyle(cwd, id, builtinDir).summary
  return { id, summary, warnings }
}

/** 删除自定义风格目录。 */
export function removeCustomStyle(cwd: string, id: unknown): void {
  if (!isSafeId(id)) throw new InvalidInputError(`非法 id：${String(id)}`)
  const dir = join(libraryDir(cwd), id)
  if (!existsSync(dir)) throw new InvalidInputError(`自定义设计系统不存在：${id}`)
  // 删除前按边界校验：library/<id> 若被预置成指向工作区外的目录联接，删它等于删外部目录。
  assertInsideWorkspace(cwd, dir, '自定义设计系统目录')
  rmSync(dir, { recursive: true, force: true })
}

