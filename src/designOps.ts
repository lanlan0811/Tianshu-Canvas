/**
 * 项目级设计风格操作：锁定、切换、解绑。
 *
 * 切换语义：只替换「可用的 token 与组件实现」，不会把页面里的裸 hex 改写成 var()。
 * 遵守技能写的页面自动换肤；自由发挥时期写的裸值保持不变，由 canvas_check_style 指出。
 * 解绑（free）不剥离旧样式块，避免页面突然失去样式；新页面不再注入。
 */
import { InvalidInputError } from './ids.js'
import { backfillNavigation } from './navigation.js'
import type { ResolvedStyle } from './design.js'
import { injectDesign, resolveDesignStyle, designStyleExists, designStyleSummary } from './design.js'
import {
  projectIssue,
  readPageHtml,
  readProject,
  writePageHtml,
  writeProject,
  type ProjectDesign,
  withProjectTransaction,
  type ProjectTransaction,
} from './project.js'

export interface StyleChangeResult {
  styleId: string | null
  name: string | null
  pagesUpdated: number
  missingIcons: string[]
  scriptIcons: string[]
  warnings: string[]
}

export function currentStyleId(cwd: string, tx?: ProjectTransaction): string | null {
  return readProject(cwd, tx).design?.styleId ?? null
}

export function applyProjectStyle(cwd: string, styleId: string | null, tx?: ProjectTransaction, preparedStyle?: ResolvedStyle): StyleChangeResult {
  if (!tx) return withProjectTransaction(cwd, (transaction) => applyProjectStyle(cwd, styleId, transaction, preparedStyle))
  if (styleId !== null && !preparedStyle && !designStyleExists(cwd, styleId)) {
    throw new InvalidInputError(`未知的设计风格：${styleId}。可用 canvas_style（action=list）查看可选风格。`)
  }
  // 与 setViewport 同策略：项目文件损坏时不做破坏性写入。
  if (projectIssue(cwd, tx)) {
    throw new InvalidInputError('project.json 已损坏或含无效条目，请先修复后再切换设计风格。')
  }

  const project = readProject(cwd, tx)
  if (styleId === null) {
    delete project.design
  } else {
    const design: ProjectDesign = { styleId, updatedAt: Date.now() }
    project.design = design
  }

  const missing = new Set<string>()
  const scriptIcons = new Set<string>()
  let pagesUpdated = 0
  const now = Date.now()
  // 解绑（styleId=null）不重写页面：已有样式块保留，避免页面突然失去样式。
  if (styleId !== null) {
    for (const node of project.nodes) {
      const html = readPageHtml(cwd, node.id, tx)
      if (html === null || html.trim() === '') continue
      const injected = injectDesign(html, styleId, cwd, preparedStyle)
      for (const name of injected.missingIcons) missing.add(name)
      for (const name of injected.scriptIcons) scriptIcons.add(name)
      if (injected.html === html) continue
      writePageHtml(cwd, node.id, injected.html, tx)
      node.htmlRev = Math.max(now, (node.htmlRev ?? 0) + 1)
      pagesUpdated++
    }
  }

  writeProject(cwd, project, tx)
  const navigation = backfillNavigation(cwd, tx)
  return {
    styleId,
    name: styleId === null ? null : (preparedStyle?.summary.name ?? designStyleSummary(cwd, styleId)?.name ?? styleId),
    pagesUpdated,
    missingIcons: [...missing],
    scriptIcons: [...scriptIcons],
    warnings: navigation.warnings,
  }
}

/** 取一份模板，组装成可直接交给 canvas_upsert_page 的完整 HTML。 */
export function templateDocument(cwd: string, styleId: string, templateId: string): { html: string; device: string; name: string } | null {
  const style = resolveDesignStyle(cwd, styleId)
  if (!style) return null
  const template = style.templates[templateId]
  if (!template) return null
  const html =
    '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8" />\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    `  <title>${template.name}</title>\n</head>\n<body>\n` +
    `${template.html.trim()}\n</body>\n</html>\n`
  return { html, device: template.device, name: template.name }
}

/** 取一个交互模式的骨架与用法说明（供 canvas_style action=interaction）。 */
export function interactionDocument(cwd: string, styleId: string, interactionId: string): {
  name: string
  category: string
  requiresScript: boolean
  rootAttr: string
  requiredStructure: string[]
  requiredAttrs: string[]
  api: string
  classes: string[]
  skeletonHtml: string
} | null {
  const style = resolveDesignStyle(cwd, styleId)
  if (!style) return null
  const entry = style.interactions.catalog[interactionId]
  if (!entry) return null
  return {
    name: entry.name,
    category: entry.category,
    requiresScript: entry.requiresScript,
    rootAttr: entry.rootAttr,
    requiredStructure: entry.requiredStructure ?? [],
    requiredAttrs: entry.requiredAttrs ?? [],
    api: entry.api ?? '',
    classes: entry.classes ?? [],
    skeletonHtml: entry.skeletonHtml ?? '',
  }
}
