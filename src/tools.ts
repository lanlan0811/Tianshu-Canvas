/**
 * 工具实现。与宿主解耦：只依赖 node 内置模块，可脱离天枢直接单测。
 *
 * execute 收到宿主传入的 { args, cwd, sessionId }（cwd = 会话工作区根）。
 * 返回值约定：{ content: string, isError?: boolean } —— 宿主只透传这两个字段，
 * 其它字段一律丢弃，因此 URL / id / 路径都必须写进 content 文本。
 *
 * v0.2.0：10 个工具精简为 5 个（open / upsert_page / get_state / arrange / export）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { adapterContext, detectAdapters, generateWithAdapter, getAdapter } from './adapters/registry.js'
import type { AdapterId } from './adapters/types.js'
import { auditPage, formatA11yReport } from './audit/a11y.js'
import { computeContract, formatContractReport } from './audit/contract.js'
import { launchBrowser, resolveBrowser } from './export.js'
import {
  buildSnapshot,
  diffSnapshots,
  formatDriftReport,
  readSnapshot,
  snapshotDir,
  writeSnapshot,
} from './audit/drift.js'
import { compareWithBaselines, defaultBaselineDir, formatVisualReport, writeBaselines } from './audit/visual.js'
import { reviewPage, formatReviewReport } from './audit/review.js'
import { readPageBrief, savePageBrief } from './brief.js'
import { listPrototypes, getPrototype, listDirections, getDirection } from './prototypes.js'
import { buildBrandPack, exportBrandPack, forgetStyle, importBrandPack, memorySummary, recordUsage, verifyBrandPack } from './brand.js'
import { DEFAULT_DEVICE, isDeviceType, resolveSize, type DeviceType } from './device.js'
import { isWorkerSession, warnUser } from './host.js'
import {
  designStyleExists,
  designStyleIds,
  designStyleSummary,
  designDir,
  injectDesign,
  invalidateDesignCache,
  isBuiltinStyle,
  loadDesignCatalog,
  resolveDesignStyle,
  readDesignMarker,
  stripDesign,
  type ResolvedStyle,
} from './design.js'
import {
  compileCustomStyle,
  createCustomStyle,
  customStyleExists,
  libraryDir,
  loadCustomSummaries,
  removeCustomStyle,
} from './designCustom.js'
import { applyProjectStyle, currentStyleId, interactionDocument, templateDocument } from './designOps.js'
import { extractTokens } from './extract.js'
import { inlineAssets } from './inlineAssets.js'
import { InvalidInputError, isSafeId, newPageId } from './ids.js'
import { readTextInWorkspace, writeFileAtomic, writeFileInWorkspace } from './paths.js'
import { formatLintReport, lintHtml } from './lint.js'
import { findBlockedResources } from './resources.js'
import { toReactComponent, toFrameworklessHtml, toTailwindConfig } from './codegen.js'
import { buildPlatformInput, defaultComponents, generatePlatformFiles, parseCssVars, STACKS, type PlatformStack, type PlatformTarget } from './codegen/platforms.js'
import {
  addEdge,
  autoLayoutPosition,
  duplicateNode,
  PROJECT_DIR_NAME,
  projectFile,
  projectIssue,
  readComments,
  readPageHtml,
  readProject,
  readSelection,
  removeComments,
  removeEdge,
  removeNode,
  setCommentsResolved,
  takeProjectBackup,
  upsertNode,
  writePageHtml,
  writeProject,
  withProjectTransaction,
  type Comment,
  type PageNode,
  type Project,
  type Selection,
} from './project.js'
import { rewriteNavLinks, type PageRef } from './nav.js'
import { backfillNavigation } from './navigation.js'
import { assertHtmlSize } from './limits.js'
import { currentUrl, ensureServer } from './server.js'
import { redactErrorPaths, reportError } from './errors.js'

export interface ToolCall {
  args: Record<string, unknown>
  cwd: string
  sessionId: string
}

export interface ToolResult {
  content: string
  isError?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface TpiTool {
  definition: ToolDefinition
  pathParams?: Record<string, 'read' | 'write'>
  requiresApproval?: () => boolean
  isConcurrencySafe?: () => boolean
  isEnabled?: () => boolean
  /** 宿主管理的调用预算（毫秒）；不设则由宿主默认决定。 */
  timeoutMs?: number
  execute: (call: ToolCall) => Promise<ToolResult>
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function positive(v: number | undefined): number | undefined {
  return v !== undefined && v > 0 ? Math.round(v) : undefined
}

/** 把 KB 参数换算成字节；缺省/非法时返回 undefined（由 inlineAssets 用默认值）。 */
function kbToBytes(v: unknown): number | undefined {
  const n = num(v)
  return n !== undefined && n > 0 ? Math.round(n * 1024) : undefined
}

/** 写入前若备份过有问题的项目文件，把备份路径告诉调用方（宿主只透传 content）。 */
function withBackupNotice(run: (call: ToolCall) => Promise<ToolResult>): (call: ToolCall) => Promise<ToolResult> {
  return async (call) => {
    try {
      const rawResult = await run(call)
      const result = rawResult.isError ? { ...rawResult, content: redactErrorPaths(rawResult.content) } : rawResult
      const backup = takeProjectBackup(call.cwd)
      if (!backup) return result
      return { ...result, content: `${result.content}\n注意：project.json 曾损坏或含无效条目，覆盖前已备份到 ${backup}` }
    } catch (err) {
      return { content: reportError(err), isError: true }
    }
  }
}

function scriptIconNote(names: string[]): string {
  if (names.length === 0) return ''
  return `\n注意：脚本里的图标不会展开：${names.slice(0, 8).join('、')}。请把图标写在静态 HTML 的 <template> 里，由脚本克隆使用。`
}

function navigationNotice(warnings: string[]): string {
  return warnings.length ? '\n导航提示：' + warnings.join('；') : ''
}

function projectHint(cwd: string): string {
  return `${PROJECT_DIR_NAME}/（项目文件：${projectFile(cwd)}）`
}

// ---------------------------------------------------------------------------
// canvas_open
// ---------------------------------------------------------------------------

async function canvasOpen(call: ToolCall): Promise<ToolResult> {
  const port = num(call.args.port)
  const { url } = await ensureServer(call.cwd, port ?? undefined)
  writeUrlHint(call.cwd, url)
  if (call.args.open === true) openBrowser(url)
  return {
    content:
      `画布服务已就绪。请立刻把下面这一行原样发给用户（单独一行，便于点击）：\n` +
      `${url}\n` +
      `画布链接含访问凭证，请只提供给本机的授权使用者；不要公开分享。服务关闭后旧链接失效。\n` +
      `在用户拿到链接后，用 canvas_get_state 看品牌、锁定风格和已确认简报；提炼受众、主张、证据与主行动。\n` +
      `新营销页面默认同一内容生成两个结构与排版不同的首屏供选，用户明确选择后保存 brief 并原位深化；应用按任务选 prototype。已有品牌、指定布局与风格优先。\n` +
      `工作区：${call.cwd}\n` +
      `项目文件：${projectFile(call.cwd)}\n` +
      `操作提示：空格+拖拽 或 中键拖拽 平移；Ctrl+滚轮 缩放；普通滚轮 平移。`,
  }
}

function writeUrlHint(cwd: string, url: string): void {
  // 官方约定：worker（子会话）不写用户数据，避免重复写入。
  if (isWorkerSession()) return
  try {
    // url.txt 是隐式写入：必须与页面/项目文件同源走边界保护——
    // 固定临时文件 + 跟随链接的 writeFileSync 曾被用来覆盖工作区外的文件。
    const publicUrl = new URL(url)
    publicUrl.pathname = '/'
    publicUrl.hash = ''
    writeFileInWorkspace(cwd, join(cwd, PROJECT_DIR_NAME, 'url.txt'), publicUrl.toString() + '\n', '画布地址文件')
  } catch {
    /* 目录可能尚未创建，或路径越界；都不影响画布本身可用 */
  }
}

function openBrowser(url: string): void {
  try {
    const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    // 命令不存在时走异步 error 事件，外层 try/catch 接不住，不监听会打垮宿主。
    child.on('error', (err) => {
      warnUser(`无法打开系统浏览器：${err.message}`)
    })
    child.unref()
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// canvas_upsert_page（新增 / 更新 HTML / 重命名 / 移动 / 改尺寸）
// ---------------------------------------------------------------------------

async function canvasUpsertPage(call: ToolCall): Promise<ToolResult> {
  const args = call.args
  const htmlPath = str(args.html_path)
  let html: string | undefined
  if (htmlPath) {
    if (!existsSync(htmlPath)) {
      return { content: '读取失败：原型文件不存在，请核对 html_path 后重试。', isError: true }
    }
    try {
      // 工作区内的来源文件按边界校验；工作区外（用户显式指定）只拒叶子链接。
      html = readTextInWorkspace(call.cwd, htmlPath, '原型文件')
    } catch (err) {
      return { content: `读取失败：${reportError(err)}`, isError: true }
    }
  } else {
    html = str(args.html)
  }

  const requestedId = str(args.id)
  if (requestedId && !isSafeId(requestedId)) {
    return { content: `非法 id：${requestedId}（仅允许字母数字、下划线、连字符，1–64 位）`, isError: true }
  }

  const id = requestedId ?? newPageId()

  // 资源内联（可选）：把会被 CSP 拦截的外链/相对路径抓取成 data: URI。
  // 必须在 injectDesign 之前：注入块本身无外链，先内联可让后续 blocked 提示基于最终 HTML。
  let assetNote = ''
  let workHtml = html
  if (workHtml !== undefined && args.inline_assets === true) {
    const inlineResult = await inlineAssets(workHtml, {
      origin: str(args.inline_assets_origin),
      maxBytesPer: kbToBytes(args.inline_assets_max_kb),
    })
    workHtml = inlineResult.html
    const skipped = inlineResult.skipped
    assetNote =
      `\n资源内联：成功 ${inlineResult.inlined} 项` +
      (skipped.length
        ? `，跳过 ${skipped.length} 项：\n${skipped.slice(0, 8).map((s) => `  - ${redactErrorPaths(s.ref)}（${redactErrorPaths(s.reason)}）`).join('\n')}${skipped.length > 8 ? `\n  …等 ${skipped.length} 项` : ''}`
        : '')
  }

  // 网络准备完成后才取锁，并始终使用锁内最新模型计算布局、标题、风格和导航。
  const { existing, node, rel, pageHtml, injection, navNote, backfilled, navWarnings, deviceType } = withProjectTransaction(call.cwd, (tx) => {
    const project = tx.project
    const existing = requestedId ? project.nodes.find((n) => n.id === requestedId) : undefined
    if (workHtml === undefined && !existing) {
      throw new InvalidInputError('缺少内容：请提供 html_path 或 html；仅更新标题、位置或尺寸时需传已存在的 id。')
    }
    const deviceProvided = isDeviceType(args.device_type)
    const deviceType: DeviceType = isDeviceType(args.device_type) ? args.device_type : (existing?.deviceType ?? DEFAULT_DEVICE)
    const base = existing && !deviceProvided ? { width: existing.width, height: existing.height } : resolveSize(deviceType)
    const size = { width: positive(num(args.width)) ?? base.width, height: positive(num(args.height)) ?? base.height }
    const pos = existing ?? autoLayoutPosition(call.cwd, project.nodes.length, size)
    const pageTitle = str(args.title) ?? existing?.title ?? id
    let preparedHtml = workHtml
    let navNote = ''
    if (preparedHtml !== undefined) {
      const nav = rewriteNavLinks(preparedHtml, pageRefsWith(project, { id, title: pageTitle }), '')
      if (nav.ambiguous.length) {
        const detail = nav.ambiguous.map((a) => `「${a.ref}」命中多个页面：${a.ids.join('、')}`).join('；')
        throw new InvalidInputError(`页面跳转链接存在歧义，未写入：${detail}；请改用真实页面 id 或 data-nav。`)
      }
      preparedHtml = nav.html
      if (nav.unresolved.length) navNote = `\n注意：这些链接未匹配到页面，已原样保留（若目标页稍后创建会自动补齐）：${nav.unresolved.slice(0, 8).join('、')}。`
    }
    const injection = preparedHtml !== undefined ? injectDesign(preparedHtml, project.design?.styleId ?? null, call.cwd) : null
    const pageHtml = injection ? injection.html : preparedHtml
    if (pageHtml !== undefined) assertHtmlSize(pageHtml)
    const previousHtml = existing && pageHtml !== undefined ? readPageHtml(call.cwd, id, tx) : null
    const htmlChanged = pageHtml !== undefined && pageHtml !== previousHtml
    const rel = htmlChanged ? writePageHtml(call.cwd, id, pageHtml!, tx) : (existing?.htmlPath ?? '')
    const now = Date.now()
    const node: PageNode = {
      id, type: 'page', title: pageTitle, x: num(args.x) ?? pos.x, y: num(args.y) ?? pos.y,
      width: size.width, height: size.height, deviceType, htmlPath: rel,
      htmlRev: htmlChanged ? Math.max(now, (existing?.htmlRev ?? 0) + 1) : existing?.htmlRev, createdAt: existing?.createdAt ?? now, updatedAt: now,
    }
    upsertNode(call.cwd, node, tx)
    const navigation = htmlChanged || !existing || existing.title !== pageTitle
      ? backfillNavigation(call.cwd, tx)
      : { changed: [], warnings: [] }
    return { existing, node, rel, pageHtml, injection, navNote, backfilled: navigation.changed, navWarnings: navigation.warnings, deviceType }
  })

  // 确保画布服务在跑，这样返回里一定带可点击的画布 URL（用户能看到）。
  const { url } = await ensureServer(call.cwd)
  const blocked = pageHtml !== undefined ? findBlockedResources(pageHtml) : []
  const styleLine = injection
    ? injection.injected
      ? `\n已应用设计风格「${designStyleSummary(call.cwd, injection.styleId ?? '')?.name ?? injection.styleId}」（${injection.styleId}）：注入 token/组件样式${injection.usedIcons.length ? `，内联 ${injection.usedIcons.length} 个图标` : ''}。`
      : '\n当前为自由发挥（未锁定风格）；如需统一视觉，先 canvas_style（action=set）。'
    : ''
  const missingLine = injection?.missingIcons.length
    ? `\n注意：这些图标名不在目录中，未内联：${injection.missingIcons.slice(0, 8).join('、')}${injection.missingIcons.length > 8 ? ` 等 ${injection.missingIcons.length} 个` : ''}。可用 canvas_style（action=get）查看图标清单。`
    : ''
  return {
    content:
      `${existing ? '已更新' : '已添加'}页面节点「${node.title}」（id=${id}）。\n` +
      `位置：x=${node.x}, y=${node.y}；尺寸：${node.width}×${node.height}（${deviceType}）\n` +
      (pageHtml !== undefined ? `原型文件：${join(call.cwd, rel)}\n` : `原型 HTML 未改动（仅更新了节点信息）。\n`) +
      `画布 URL：${url}\n` +
      `项目：${projectHint(call.cwd)}` +
      styleLine +
      missingLine +
      assetNote +
      navNote +
      (navWarnings.length ? `\n导航提示：${navWarnings.join('；')}` : '') +
      (backfilled.length ? `\n页面跳转：已补齐 ${backfilled.length} 个页面的前向链接（${backfilled.join('、')}）。` : '') +
      scriptIconNote(injection?.scriptIcons ?? []) +
      (blocked.length
        ? `\n注意：画布 CSP 会拦截这些外链或相对路径资源，页面里将加载不到：${blocked.slice(0, 8).map(redactErrorPaths).join('、')}${blocked.length > 8 ? ` 等 ${blocked.length} 处` : ''}。请改为内联（<style>、<script>、data: URI）或用 CSS/SVG 绘制。`
        : ''),
  }
}

/** 页面引用集合：项目现有页面 + 本次写入的页面（覆盖同 id 的旧标题）。 */
function pageRefsWith(project: Project, self: PageRef): PageRef[] {
  const refs = project.nodes.map((n) => ({ id: n.id, title: n.title }))
  const idx = refs.findIndex((r) => r.id === self.id)
  if (idx >= 0) refs[idx] = { id: self.id, title: self.title }
  else refs.push({ id: self.id, title: self.title })
  return refs
}

// ---------------------------------------------------------------------------
// canvas_get_state（页面列表 + 连线 + 选中项 + URL）
// ---------------------------------------------------------------------------

function formatSelection(selection: Selection, project: Project): string[] {
  const node = project.nodes.find((n) => n.id === selection.pageId)
  const pageTitle = node ? node.title : selection.pageId
  const lines: string[] = [
    `选中类型：${selection.kind === 'element' ? '页面内元素' : '整个页面节点'}`,
    `所属页面：${pageTitle}（id=${selection.pageId}）`,
  ]
  if (selection.kind === 'element' && selection.element) {
    const el = selection.element
    lines.push(`元素：<${el.tagName}> xpath=${el.xpath}`)
    if (el.textContent) lines.push(`文本：${el.textContent}`)
    if (el.computedStyles) {
      const keys = ['color', 'background-color', 'font-size', 'font-weight', 'padding', 'margin', 'border-radius']
      const picked = keys
        .filter((k) => el.computedStyles?.[k])
        .map((k) => `${k}: ${el.computedStyles?.[k]}`)
      if (picked.length) lines.push(`关键样式：${picked.join('；')}`)
    }
  }
  return lines
}

async function canvasGetState(call: ToolCall): Promise<ToolResult> {
  const project = readProject(call.cwd)
  const selection = readSelection(call.cwd)
  const url = currentUrl(call.cwd)
  const sections: string[] = []

  const issue = projectIssue(call.cwd)
  if (issue) sections.push(`警告：${issue}`)

  const styleId = project.design?.styleId ?? null
  if (styleId === null) {
    sections.push('设计风格：自由发挥（未锁定风格）。优先遵守品牌与内容简报；营销页面默认先出两个不同首屏供用户选择，再原位深化；应用按任务选原型。可用 canvas_style direction / prototype 按需读取。')
  } else {
    const summary = designStyleSummary(call.cwd, styleId)
    sections.push(
      summary
        ? `设计风格：${summary.name}（${styleId}，已锁定）。页面必须使用该风格的 --ts-* 变量与 ts-* 组件类。`
        : `设计风格：未知（${styleId}）；请重新用 canvas_style（action=set）设置。`,
    )
    try {
      const memory = memorySummary(call.cwd, styleId)
      if (memory) sections.push(memory)
    } catch {
      /* 记忆不是权威数据 */
    }
  }

  if (project.nodes.length === 0) {
    sections.push('画布上暂无页面节点。\n用 canvas_upsert_page 添加一个 HTML 原型。')
  } else {
    const lines = project.nodes.map((n, i) => {
      return (
        `${i + 1}. ${n.title} (id=${n.id})\n` +
        `   位置 x=${n.x}, y=${n.y}；尺寸 ${n.width}×${n.height}（${n.deviceType}）`
      )
    })
    sections.push(`画布上有 ${project.nodes.length} 个页面节点：\n${lines.join('\n')}`)
  }

  if (project.edges.length > 0) {
    const titleOf = (id: string): string => project.nodes.find((n) => n.id === id)?.title ?? id
    const lines = project.edges.map(
      (e) => `- ${titleOf(e.source)}（${e.source}） → ${titleOf(e.target)}（${e.target}）${e.label ? `：${e.label}` : ''}`,
    )
    sections.push(`页面连线（${project.edges.length} 条）：\n${lines.join('\n')}`)
  }

  if (project.pageBriefs && Object.keys(project.pageBriefs).length) {
    const lines = project.nodes.filter(n => project.pageBriefs?.[n.id]).map(n => {
      const brief = project.pageBriefs![n.id]!
      const decision = brief.confirmedDirection
      return `${n.title}（${n.id}）：${decision ? '用户已确认 ' + decision.directionId + '；理由：' + decision.reason + '；确认时间：' + decision.confirmedAt : '未确认草稿' + (brief.directionId ? ' ' + brief.directionId : '')}${brief.prototypeId ? '；原型：' + brief.prototypeId : ''}；完整简报用 canvas_style action=brief,page_id=${n.id} 读取。`
    })
    sections.push('页面设计简报（选中节点不等于确认）：\n' + lines.join('\n'))
  }

  if (selection) {
    sections.push(`当前选中：\n${formatSelection(selection, project).join('\n')}`)
  } else {
    sections.push(
      '当前画布没有选中项。\n' +
        '请在浏览器打开画布，点击某个页面节点（或按住 Ctrl 点击页面内的元素）后再试。',
    )
  }

  const pending = (project.comments ?? []).filter((c) => !c.resolved).length
  if (pending > 0) {
    sections.push(`待处理批注：${pending} 条。用 canvas_comments（action=list）查看全部批注并逐条修改。`)
  }

  sections.push(url ? `画布 URL：${url}` : '提示：先调用 canvas_open 获取画布 URL。')
  return { content: sections.join('\n\n') }
}

// ---------------------------------------------------------------------------
// canvas_arrange（remove / duplicate / link / unlink）
// ---------------------------------------------------------------------------

async function canvasArrange(call: ToolCall): Promise<ToolResult> {
  const action = str(call.args.action)
  switch (action) {
    case 'remove': {
      const id = str(call.args.id)
      if (!id) return { content: 'remove 需要 id。', isError: true }
      const { next, warnings } = withProjectTransaction(call.cwd, (tx) => {
        if (!tx.project.nodes.some((n) => n.id === id)) throw new InvalidInputError(`节点不存在：${id}`)
        const next = removeNode(call.cwd, id, tx)
        return { next, warnings: backfillNavigation(call.cwd, tx).warnings }
      })
      return { content: `已删除页面节点 ${id}（连带其连线与原型文件）。剩余 ${next.nodes.length} 个节点。` + (warnings.length ? `\n导航提示：${warnings.join('；')}` : '') }
    }
    case 'duplicate': {
      const id = str(call.args.id)
      if (!id) return { content: 'duplicate 需要 id。', isError: true }
      try {
        const { node, warnings } = withProjectTransaction(call.cwd, (tx) => {
          const node = duplicateNode(call.cwd, id, str(call.args.title), tx)
          return { node, warnings: backfillNavigation(call.cwd, tx).warnings }
        })
        const { url } = await ensureServer(call.cwd)
        return {
          content:
            `已复制页面节点，新 id=${node.id}，标题「${node.title}」。\n` +
            `位置：x=${node.x}, y=${node.y}\n画布 URL：${url}` + (warnings.length ? `\n导航提示：${warnings.join("；")}` : ""),
        }
      } catch (err) {
        return { content: reportError(err), isError: true }
      }
    }
    case 'link': {
      const source = str(call.args.source)
      const target = str(call.args.target)
      if (!source || !target) return { content: 'link 需要 source 和 target。', isError: true }
      try {
        const edge = addEdge(call.cwd, source, target, str(call.args.label))
        return { content: `已连线 ${edge.source} → ${edge.target}${edge.label ? `（${edge.label}）` : ''}。` }
      } catch (err) {
        return { content: reportError(err), isError: true }
      }
    }
    case 'unlink': {
      const source = str(call.args.source)
      const target = str(call.args.target)
      if (!source || !target) return { content: 'unlink 需要 source 和 target。', isError: true }
      const { before, next } = withProjectTransaction(call.cwd, (tx) => {
        const before = tx.project.edges.length
        return { before, next: removeEdge(call.cwd, source, target, tx) }
      })
      if (next.edges.length === before) return { content: `没有匹配的连线 ${source} → ${target}，未作改动。` }
      return { content: `已取消连线 ${source} → ${target}。` }
    }
    default:
      return {
        content: `未知或缺失的 action：${action ?? '(空)'}。可选：remove / duplicate / link / unlink。`,
        isError: true,
      }
  }
}

// ---------------------------------------------------------------------------
// canvas_style（list / get / set / template）
// ---------------------------------------------------------------------------

function formatStyleList(cwd: string): string {
  const catalog = loadDesignCatalog(cwd)
  if (catalog.styles.length === 0) return '当前构建不包含任何设计风格。'
  const current = currentStyleId(cwd)
  const lines = catalog.styles.map((s) => {
    const templates = s.templates.map((t) => t.name).join(' / ')
    const tag = isBuiltinStyle(s.id) ? '内置' : '自定义'
    return (
      `- ${s.name}（${s.id}）[${tag}]：${s.tagline}\n` +
      `  色板 ${s.swatches.join(' ')}；图标 ${s.counts.icons} 个、组件 ${s.counts.components} 个、交互 ${s.counts.interactions ?? 0} 个；模板 ${templates || '无'}`
    )
  })
  return (
    `${catalog.notice}\n\n可选设计风格（项目级锁定）：\n${lines.join('\n')}\n\n` +
    `当前：${current ? `已锁定 ${designStyleSummary(cwd, current)?.name ?? current}（${current}）` : '自由发挥（未锁定）'}\n` +
    `锁定/切换：canvas_style（action=set, style_id=<id>）；回到自由发挥：style_id=free。\n` +
    `风格控制 token 外观；新营销页面默认先双首屏选稿，用 direction / prototype 读取内容匹配的构图与原型；不必先按风格名提问。`
  )
}

function formatStyleBrief(cwd: string, styleId: string): string {
  const style = resolveDesignStyle(cwd, styleId)
  if (!style) return `未知的设计风格：${styleId}`
  const { manifest, summary } = style
  const group = (prefix: string): string[] => manifest.vars.filter((v) => v.startsWith(prefix))

  const semanticLines = Object.entries(manifest.resolvedSemantic)
    .filter(([key]) => key.startsWith('color.'))
    .map(([key, entry]) => {
      const varName = `--ts-${key.replace(/^color\./, 'color-').replace(/\./g, '-')}`
      const name = varName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
      return `${name}=${entry.value}${entry.primitive ? ` (${entry.primitive})` : ''}`
    })

  const primitives = group('--ts-color-').filter((v) => !Object.keys(manifest.resolvedSemantic).some((k) => {
    const varName = `--ts-${k.replace(/^color\./, 'color-').replace(/\./g, '-')}`.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    return varName === v
  }))

  const families = group('--ts-font-')
  const sizes = group('--ts-fs-')
  const weights = group('--ts-weight-')
  const lineHeights = group('--ts-lh-')
  const spacing = group('--ts-space-')
  const radiusVars = group('--ts-radius-')
  const shadows = group('--ts-shadow-')
  const sizesBox = group('--ts-size-')
  const motion = group('--ts-motion-')
  const icons = manifest.iconNames
  const iconLines: string[] = []
  for (let i = 0; i < icons.length; i += 10) iconLines.push(icons.slice(i, i + 10).join(' '))

  return (
    `设计风格「${summary.name}」（${styleId}）\n` +
    `${summary.description}\n\n` +
    `语义色（${semanticLines.length}）：\n${semanticLines.join('；')}\n\n` +
    `原色阶（${primitives.length}）：${primitives.join(' ')}\n\n` +
    `字体族：${families.join(' ')}\n字号：${sizes.join(' ')}\n字重：${weights.join(' ')}\n行高：${lineHeights.join(' ')}\n\n` +
    `间距：${spacing.join(' ')}\n圆角：${radiusVars.join(' ')}\n阴影：${shadows.join(' ')}\n尺寸：${sizesBox.join(' ')}\n动效：${motion.join(' ')}\n\n` +
    `组件类（${manifest.componentClasses.length}）：${manifest.componentClasses.join(' ')}\n\n` +
    `图标（${icons.length}）：\n${iconLines.join('\n')}\n\n` +
    formatInteractionList(style) +
    `模板：${Object.keys(style.templates).join(' / ')}\n` +
    `写法：颜色 var(--ts-color-*)；图标 <svg data-icon="名字" class="ts-icon"></svg>（写入时自动内联）。`
  )
}

/** 交互库清单（get 与 list 复用）。 */
function formatInteractionList(style: ResolvedStyle): string {
  const ids = manifest_interactionIds(style)
  if (ids.length === 0) return ''
  const byCat = new Map<string, string[]>()
  for (const id of ids) {
    const entry = style.interactions.catalog[id]
    if (!entry) continue
    const list = byCat.get(entry.category) ?? []
    list.push(`${id}（${entry.name}）`)
    byCat.set(entry.category, list)
  }
  const lines = [...byCat.entries()].map(([cat, items]) => `  ${cat}：${items.join('、')}`)
  return (
    `交互库（${ids.length}）：用 data-ts-* 标记 + 交互 ts-* 类声明，写入时自动注入共享运行时。\n${lines.join('\n')}\n` +
    `  取骨架与用法：canvas_style（action=interaction, interaction_id=<id>）。\n\n`
  )
}

function manifest_interactionIds(style: ResolvedStyle): string[] {
  const fromManifest = style.manifest.interactionIds ?? []
  if (fromManifest.length) return fromManifest
  return Object.keys(style.interactions.catalog)
}

// ---------------------------------------------------------------------------
// codegen（canvas_style 的 action=codegen）：设计 → 生产代码
// ---------------------------------------------------------------------------

const WEB_TARGETS = new Set(['react', 'css-vars', 'tailwind', 'shadcn', 'antd'])
const PLATFORM_TARGETS = new Set<PlatformTarget>(['ios', 'android', 'miniprogram'])
const ADAPTER_TARGETS = new Set<AdapterId>(['shadcn', 'antd'])

/** 取页面 HTML：优先内联 html 参数，其次 page_id，再次当前唯一页面。 */
function resolveCodegenHtml(call: ToolCall): { html: string | null; label: string; error?: string } {
  const inline = str(call.args.html)
  if (inline) return { html: inline, label: '传入的 HTML' }
  const project = readProject(call.cwd)
  const pageId = str(call.args.page_id)
  if (pageId) {
    const node = project.nodes.find((n) => n.id === pageId)
    if (!node) return { html: null, label: '', error: `页面不存在：${pageId}` }
    const html = readPageHtml(call.cwd, pageId)
    if (html === null) return { html: null, label: '', error: `页面文件缺失：${pageId}` }
    return { html, label: `页面「${node.title}」(id=${pageId})` }
  }
  if (project.nodes.length === 1) {
    const node = project.nodes[0]!
    const html = readPageHtml(call.cwd, node.id)
    if (html !== null) return { html, label: `页面「${node.title}」(id=${node.id})` }
  }
  if (project.nodes.length === 0) return { html: null, label: '', error: '画布上没有页面；请先用 canvas_upsert_page 写入原型，或用 html 直接传入。' }
  return { html: null, label: '', error: `画布上有 ${project.nodes.length} 个页面，请用 page_id 指定一个，或用 html 直接传入。` }
}

/** 组装 codegen 的文件产物列表。 */
function buildCodegenFiles(call: ToolCall, target: string, stack: string | undefined): { files: { name: string; content: string }[]; label: string; error?: string } {
  const resolved = resolveCodegenHtml(call)
  if (resolved.error || resolved.html === null) return { files: [], label: '', error: resolved.error }

  if (WEB_TARGETS.has(target)) {
    const styleId = str(call.args.style_id) ?? currentStyleId(call.cwd)
    if (target === 'react') {
      const themeId = styleId && styleId !== 'free' ? styleId : readDesignMarker(resolved.html)?.styleId
      const theme = themeId ? resolveDesignStyle(call.cwd, themeId) : null
      const files = toReactComponent(resolved.html).map((f) => ({ name: f.name, content: f.content }))
      files.push({ name: 'tokens.css', content: theme?.tokensCss ?? '' }, { name: 'components.css', content: theme?.componentsCss ?? '' })
      return { files, label: resolved.label }
    }
    if (!styleId || styleId === 'free') {
      return { files: [], label: '', error: `${target} 需要已锁定风格（或传 style_id）；当前为自由发挥。` }
    }
    const style = resolveDesignStyle(call.cwd, styleId)
    if (!style) return { files: [], label: '', error: `未知的设计风格：${styleId}` }
    if (target === 'css-vars') {
      return {
        files: toFrameworklessHtml(resolved.html, { tokensCss: style.tokensCss, componentsCss: style.componentsCss }).map((f) => ({ name: f.name, content: f.content })),
        label: resolved.label,
      }
    }
    if (ADAPTER_TARGETS.has(target as AdapterId)) {
      const files = generateWithAdapter(target as AdapterId, resolved.html, adapterContext(call.cwd, style))
      return { files: files.map((f) => ({ name: f.name, content: f.content })), label: resolved.label }
    }
    // tailwind
    const vars = parseCssVars(style.tokensCss)
    const colors: Record<string, string> = {}
    for (const [path, entry] of Object.entries(style.manifest.resolvedSemantic)) {
      const key = path.replace(/^color\./, '').replace(/\./g, '-')
      colors[key] = entry.value
    }
    const fontSizes: Record<string, string> = {}
    for (const [name, value] of Object.entries(vars)) {
      const m = /^--ts-fs-(.+)$/.exec(name)
      if (m) fontSizes[m[1]!] = value.replace('px', '')
    }
    const spacing = style.manifest.spacing
    const shadows: Record<string, string> = {}
    for (const [name, value] of Object.entries(vars)) {
      const m = /^--ts-shadow-(.+)$/.exec(name)
      if (m) shadows[m[1]!] = value
    }
    const families: Record<string, string> = { sans: vars['--ts-font-sans'] ?? 'system-ui', display: vars['--ts-font-display'] ?? 'system-ui', mono: vars['--ts-font-mono'] ?? 'monospace' }
    return {
      files: [{ name: 'tailwind.config.js', content: toTailwindConfig({ colors, fontFamilies: families, fontSizes, spacing, radius: style.manifest.radius, shadows }) }],
      label: resolved.label,
    }
  }

  if (PLATFORM_TARGETS.has(target as PlatformTarget)) {
    const styleId = str(call.args.style_id) ?? currentStyleId(call.cwd)
    if (!styleId || styleId === 'free') return { files: [], label: '', error: `target=${target} 需要已锁定风格（或传 style_id）；当前为自由发挥。` }
    const style = resolveDesignStyle(call.cwd, styleId)
    if (!style) return { files: [], label: '', error: `未知的设计风格：${styleId}` }
    const platform = target as PlatformTarget
    const allowed = STACKS[platform]
    const chosen = (stack ?? allowed[0]!) as PlatformStack
    if (!allowed.includes(chosen)) {
      return { files: [], label: '', error: `技术栈 ${stack} 不适用于 ${target}；可选：${allowed.join(' / ')}。` }
    }
    const input = buildPlatformInput(style, defaultComponents())
    try {
      return { files: generatePlatformFiles(platform, chosen, input).map((f) => ({ name: f.name, content: f.content })), label: `${resolved.label} · ${target}/${chosen}` }
    } catch (err) {
      return { files: [], label: '', error: reportError(err) }
    }
  }

  return { files: [], label: '', error: `未知的 target：${target}。Web：react / css-vars / tailwind；多端：ios / android / miniprogram。` }
}

async function canvasCodegen(call: ToolCall): Promise<ToolResult> {
  const target = str(call.args.target)
  if (!target) {
    return {
      content:
        'codegen 需要 target。**先问用户要哪种目标**（不要自行假定）：\n' +
        '  - react（React + TSX 组件）/ css-vars（CSS 变量 + 无框架 HTML）/ tailwind（Tailwind 配置 + 映射）\n' +
        '  - ios / android / miniprogram（多端：插件出「主题/Token 文件 + design-spec.md 规格」，页面代码由你按规格编写）\n' +
        '选多端时再问**技术栈**（存到 stack 参数）：ios ∈ swiftui/uikit；android ∈ compose/xml；miniprogram ∈ weapp/uniapp/taro。',
      isError: true,
    }
  }
  const { files, label, error } = buildCodegenFiles(call, target, str(call.args.stack))
  if (error) return { content: error, isError: true }

  // 品牌记忆：记录本次导出的页面用量（风格可能来自 style_id 覆盖）。
  try {
    const { styleId } = (() => {
      const override = str(call.args.style_id)
      const sid = override === 'free' ? null : (override ?? currentStyleId(call.cwd))
      return { styleId: sid && sid !== 'free' ? sid : null }
    })()
    const resolved = resolveCodegenHtml(call)
    if (styleId && resolved.html) {
      recordUsage(call.cwd, { styleId, htmls: [resolved.html], source: { kind: 'codegen', ref: target } })
    }
  } catch {
    /* 记忆不是权威数据，写失败不影响导出 */
  }

  const writeFiles = call.args.write_files === true || typeof call.args.out_dir === 'string'
  if (writeFiles) {
    const raw = str(call.args.out_dir) ?? join(PROJECT_DIR_NAME, 'exports', `${target}`)
    // 宿主会把 pathParams 声明的参数改写成规范化绝对路径；相对值仍按 cwd 解析。
    const base = isAbsolute(raw) ? raw : join(call.cwd, raw)
    for (const file of files) {
      const abs = join(base, file.name)
      // 代码生成产物同样走统一边界：工作区内拒绝链接越界，工作区外（用户显式指定的
      // out_dir）用独占随机临时文件，避免跟随被预置的叶子链接。
      mkdirSync(dirname(abs), { recursive: true })
      writeFileAtomic(call.cwd, abs, file.content)
    }
    return {
      content:
        `已生成 ${files.length} 个文件（${label}，target=${target}${call.args.stack ? `，stack=${call.args.stack}` : ''}）：\n` +
        files.map((f) => `  - ${join(base, f.name)}`).join('\n') +
        `\n\n${codegenCaveat(target)}`,
    }
  }

  const body = files.map((f) => `### ${f.name}\n\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
  return {
    content:
      `已生成 ${files.length} 个文件（${label}，target=${target}${call.args.stack ? `，stack=${call.args.stack}` : ''}）：\n\n${body}\n\n` +
      `（如需落盘：传 write_files=true 或 out_dir。<name> 会写到 <cwd>/.tianshu-canvas/exports/ 下。）\n\n${codegenCaveat(target)}`,
  }
}

function codegenCaveat(target: string): string {
  if (target === 'react') {
    return '注意：已附 tokens.css、components.css 与 layout.css；原型脚本不会迁移到 React，动态行为需用 React 状态与事件实现并验收。'
  }
  if (PLATFORM_TARGETS.has(target as PlatformTarget)) {
    return '注意：多端产物只保证**主题/Token 与 design-spec.md 规格**确定性正确；**页面代码需你按规格编写**（HTML→原生必然有损，flex/grid、伪元素、自定义滚动无法 1:1）。请不要声称「像素级还原」。'
  }
  return '注意：产物为确定性转换；如页面用了复杂嵌套或脚本生成的结构，请人工校对。'
}

async function canvasStyle(call: ToolCall): Promise<ToolResult> {
  const action = str(call.args.action) ?? 'list'
  try {
    if (action === 'prototype' || action === 'direction') {
      const rawId = call.args[action === 'prototype' ? 'prototype_id' : 'direction_id']
      if (rawId !== undefined && (typeof rawId !== 'string' || !rawId.trim())) {
        return { content: '原型或方向 ID 必须是非空字符串。', isError: true }
      }
      const id = typeof rawId === 'string' ? rawId : undefined
      if (!id) {
        const entries = action === 'prototype' ? listPrototypes() : listDirections()
        return { content: JSON.stringify({ action, entries, next: action === 'prototype'
          ? '指定 prototype_id 按需读取完整 HTML 与适用条件；按内容重新设计，不把示例演示数据当事实。'
          : '指定 direction_id 读取构图指导与原创示例。营销页面先用相同内容生成两个不同首屏，用户明确选择后保存 brief.confirmation。' }, null, 2) }
      }
      const override = str(call.args.style_id)
      if (override && override !== 'free' && !designStyleExists(call.cwd, override)) return { content: `未知的设计风格：${override}`, isError: true }
      const styleId = override === 'free' ? 'tianshu-original' : (override ?? currentStyleId(call.cwd) ?? 'tianshu-original')
      const doc = action === 'prototype' ? getPrototype(id, styleId, call.cwd) : getDirection(id, styleId, call.cwd)
      return doc ? { content: JSON.stringify(doc, null, 2) } : { content: `未知的${action === 'prototype' ? '原型' : '方向'}：${id}`, isError: true }
    }

    if (action === 'brief') {
      const pageId = str(call.args.page_id)
      if (!pageId) return { content: 'brief 需要 page_id，简报只关联指定页面。', isError: true }
      const brief = call.args.brief === undefined ? readPageBrief(call.cwd, pageId) : savePageBrief(call.cwd, pageId, call.args.brief)
      return { content: JSON.stringify({ pageId, brief, notice: 'confirmedDirection 只表示已明确记录的用户选择；未确认草稿不代表用户认可。' }, null, 2) }
    }

    if (action === 'list') return { content: formatStyleList(call.cwd) }

    if (action === 'get') {
      const styleId = str(call.args.style_id) ?? currentStyleId(call.cwd)
      if (!styleId || styleId === 'free') {
        return {
          content:
            '当前未锁定风格（自由发挥）。direction / prototype 可直接读取原创设计；如用户需要统一 token，再用 list / set 显式锁定。',
        }
      }
      if (!designStyleExists(call.cwd, styleId)) return { content: `未知的设计风格：${styleId}`, isError: true }
      return { content: formatStyleBrief(call.cwd, styleId) }
    }

    if (action === 'set') {
      const raw = str(call.args.style_id)
      if (!raw) return { content: 'set 需要 style_id（风格 id，或 free 表示解除锁定）。', isError: true }
      const styleId = raw === 'free' ? null : raw
      const result = applyProjectStyle(call.cwd, styleId)
      const { url } = await ensureServer(call.cwd)
      const missing = result.missingIcons.length
        ? `\n注意：这些图标名不在目录中，未内联：${result.missingIcons.slice(0, 8).join('、')}。`
        : ''
      return {
        content: styleId === null
          ? `已解除风格锁定：回到自由发挥；已有页面保留当前注入的样式块，新页面不再注入。\n画布 URL：${url}`
          : `已锁定设计风格「${result.name}」（${styleId}）：重写 ${result.pagesUpdated} 个页面（画布会自动刷新）。\n画布 URL：${url}${missing}${scriptIconNote(result.scriptIcons)}${navigationNotice(result.warnings)}`,
      }
    }

    if (action === 'codegen') return await canvasCodegen(call)

    if (action === 'template') {
      const styleId = str(call.args.style_id) ?? currentStyleId(call.cwd)
      if (!styleId || styleId === 'free') {
        return { content: 'template 需要已锁定的风格，或显式传 style_id。', isError: true }
      }
      const templateId = str(call.args.template_id) ?? 'dashboard'
      const doc = templateDocument(call.cwd, styleId, templateId)
      if (!doc) {
        return { content: `取模板失败：风格 ${styleId} 没有模板 ${templateId}。`, isError: true }
      }
      return {
        content:
          `已取到模板「${doc.name}」（风格 ${styleId}，设备 ${doc.device}）。\n` +
          `直接把下面的 HTML 作为 canvas_upsert_page 的 html 传入即可（样式块会在写入时注入）：\n\n` +
          doc.html,
      }
    }

    if (action === 'interaction') {
      const styleId = str(call.args.style_id) ?? currentStyleId(call.cwd)
      if (!styleId || styleId === 'free') {
        return { content: 'interaction 需要已锁定的风格，或显式传 style_id（交互库随风格提供）。', isError: true }
      }
      const interactionId = str(call.args.interaction_id)
      if (!interactionId) {
        const style = resolveDesignStyle(call.cwd, styleId)
        const available = style ? Object.keys(style.interactions.catalog).join(' / ') : ''
        return { content: `interaction 需要 interaction_id。可选：${available}`, isError: true }
      }
      const doc = interactionDocument(call.cwd, styleId, interactionId)
      if (!doc) {
        return { content: `未知的交互模式：${interactionId}。用 canvas_style（action=get）查看交互清单。`, isError: true }
      }
      const struct = doc.requiredStructure.length ? `必需结构：\n${doc.requiredStructure.map((s) => `  - ${s}`).join('\n')}\n` : ''
      const attrs = doc.requiredAttrs.length ? `必需属性：\n${doc.requiredAttrs.map((s) => `  - ${s}`).join('\n')}\n` : ''
      return {
        content:
          `交互「${doc.name}」（${interactionId}，分类 ${doc.category}）\n` +
          `根标记：${doc.rootAttr}${doc.requiresScript ? '（需要脚本，写入时自动注入运行时）' : '（纯 CSS，无需脚本）'}\n` +
          `用到类：${doc.classes.join(' ')}\n${struct}${attrs}` +
          `行为：${doc.api}\n\n` +
          `骨架（把它放进页面，按需改文案/数量；写入时工具会注入交互样式与运行时）：\n\n${doc.skeletonHtml}\n\n` +
          `注意：不要自己写这套交互的 JS——共享运行时会随页面自动注入；脚本里不要用 fetch / 本地存储（沙箱禁用）。`,
      }
    }

    return { content: `未知的 action：${action}。可选：list / get / set / template / interaction / prototype / direction / brief / codegen。`, isError: true }
  } catch (err) {
    return { content: reportError(err), isError: true }
  }
}

// ---------------------------------------------------------------------------
// canvas_check_style（只报告，不阻塞）
// ---------------------------------------------------------------------------

async function canvasCheckStyle(call: ToolCall): Promise<ToolResult> {
  const inlineHtml = str(call.args.html)
  const override = str(call.args.style_id)
  if (override && override !== 'free' && !designStyleExists(call.cwd, override)) {
    return { content: `未知的设计风格：${override}。可用 canvas_style（action=list）查看可选风格。`, isError: true }
  }
  const styleId = override === 'free' ? null : (override ?? currentStyleId(call.cwd))
  const pageTheme = (html: string): string | null => override !== undefined ? styleId : (styleId ?? readDesignMarker(html)?.styleId ?? null)

  if (inlineHtml !== undefined) {
    const report = lintHtml(inlineHtml, pageTheme(inlineHtml), call.cwd)
    return { content: formatLintReport(report, '直接检查传入的 HTML') }
  }

  const pageId = str(call.args.page_id)
  if (pageId) {
    const html = readPageHtml(call.cwd, pageId)
    if (html === null) return { content: `页面不存在：${pageId}`, isError: true }
    const report = lintHtml(html, pageTheme(html), call.cwd)
    return { content: formatLintReport(report, `页面 id=${pageId}`) }
  }

  const project = readProject(call.cwd)
  if (project.nodes.length === 0) return { content: '画布上没有页面可检查。' }
  const reports: string[] = []
  let total = 0
  for (const node of project.nodes) {
    const html = readPageHtml(call.cwd, node.id)
    if (html === null) continue
    const report = lintHtml(html, pageTheme(html), call.cwd)
    total += report.total
    if (report.total > 0) reports.push(formatLintReport(report, `页面「${node.title}」(id=${node.id})`))
  }
  if (reports.length === 0) {
    const name = styleId ? (designStyleSummary(call.cwd, styleId)?.name ?? styleId) : null
    return {
      content: `风格检查：${name ? `${name}（${styleId}）` : '未锁定风格'} · 全部 ${project.nodes.length} 个页面\n未发现不符合项（0 处）。`,
    }
  }
  return { content: `${reports.join('\n\n')}\n\n合计：${total} 处。` }
}

// ---------------------------------------------------------------------------
// canvas_design_system（create / list / get / remove）—— 项目级自定义设计系统
// ---------------------------------------------------------------------------

function builtinIds(): string[] {
  return designStyleIds()
}

function formatCustomList(cwd: string): string {
  const customs = loadCustomSummaries(cwd, designDir())
  if (customs.length === 0) {
    return `当前项目还没有自定义设计系统（目录：${libraryDir(cwd)}）。\n用 canvas_design_system（action=create）创建一套。`
  }
  const current = currentStyleId(cwd)
  const lines = customs.map(
    (s) =>
      `- ${s.name}（${s.id}）${s.id === current ? ' ← 当前' : ''}\n` +
      `  色板 ${s.swatches.join(' ')}；图标 ${s.counts.icons} 个、组件 ${s.counts.components} 个；模板 ${s.templates.map((t) => t.name).join(' / ') || '无'}`,
  )
  return `本项目自定义设计系统（${customs.length} 套，仅本工作区生效）：\n${lines.join('\n')}\n\n查看细节：canvas_design_system（action=get, id=<id>）。`
}

async function canvasDesignSystem(call: ToolCall): Promise<ToolResult> {
  const action = str(call.args.action) ?? 'list'
  try {
    if (action === 'list') {
      const all = await canvasStyle({ ...call, args: { action: 'list' } })
      if (all.isError) return all
      return { content: `${formatCustomList(call.cwd)}\n\n${all.content}` }
    }

      if (action === 'get') {
      const id = str(call.args.id) ?? currentStyleId(call.cwd) ?? ''
      if (!id) return { content: 'get 需要 id（或先锁定一套风格）。', isError: true }
      if (!designStyleExists(call.cwd, id)) return { content: `未知的设计风格：${id}`, isError: true }
      const brief = formatStyleBrief(call.cwd, id)
      const isCustom = customStyleExists(call.cwd, id)
      const darkNote = isCustom && resolveDesignStyle(call.cwd, id)?.tokensCss.includes('.dark {')
        ? '\n\n深色模式：页面根元素加 class="dark" 即切换（浅色为默认）。'
        : ''
      const memory = memorySummary(call.cwd, id)
      return { content: `${brief}${memory ? `\n\n${memory}` : ''}\n\n来源：${isCustom ? `自定义（${libraryDir(call.cwd)}）` : '内置'}${darkNote}` }
    }

    if (action === 'extract') {
      const id = str(call.args.id)
      if (!id) return { content: 'extract 需要 id（新建的风格 id：字母数字/_/-，1–64 位）。', isError: true }
      const rawPath = str(call.args.path)
      // pathParams 声明为 read：宿主已改写为绝对路径；本地调用时按 cwd 解析相对值。
      const filePath = rawPath === undefined ? undefined : isAbsolute(rawPath) ? rawPath : resolve(call.cwd, rawPath)
      const url = str(call.args.url)
      const source = str(call.args.source)
      if (!source && !filePath && !url) {
        return { content: 'extract 需要来源：source（内联 HTML/CSS）、path（工作区内文件）或 url 之一。', isError: true }
      }
      let extracted
      try {
        // 传入 cwd：工作区内的来源文件按边界校验，越界链接一律拒绝。
        extracted = await extractTokens({ source, file: filePath, url, cwd: filePath ? call.cwd : undefined })
      } catch (err) {
        return { content: `反抽取失败：${reportError(err)}`, isError: true }
      }
      const summary =
        `从来源反抽取设计系统（${extracted.report.length} 组）：\n${extracted.report.map((r) => `  ${r}`).join('\n')}\n` +
        `观测 ${extracted.observed} 项、推断 ${extracted.synthesized} 项。` +
        (extracted.warnings.length ? `\n提示：${extracted.warnings.join('；')}` : '')

      if (call.args.dry_run === true) {
        return {
          content:
            `${summary}\n\n（dry_run：未写入。下面是完整 tokens，可检查后去掉 dry_run 再执行）\n` +
            `\`\`\`json\n${JSON.stringify(extracted.tokens, null, 2)}\n\`\`\``,
        }
      }

      const { result, applied } = withProjectTransaction(call.cwd, (tx) => {
        const result = createCustomStyle(call.cwd, id, extracted.tokens, {
          name: call.args.name ?? `${id}（反抽取）`,
          tagline: call.args.tagline ?? '从现有页面反抽取',
          description: call.args.description ?? '由 canvas_design_system extract 从现有 HTML/CSS 反抽取生成。',
          tags: call.args.tags,
          swatches: call.args.swatches ?? Object.values((extracted.tokens.color as { primitives: { neutral: Record<string, string> } }).primitives.neutral).slice(0, 4),
          iconStyle: call.args.iconStyle ?? extracted.iconStyle,
          overwrite: call.args.overwrite,
        }, designDir(), { overwrite: call.args.overwrite === true, builtinIds: builtinIds() }, tx)
        recordUsage(call.cwd, {
          styleId: id,
          htmls: source ? [source] : [],
          source: { kind: 'extract', ref: filePath ?? (url ? new URL(url).host : 'inline') },
        }, tx)

        const preparedStyle = compileCustomStyle(call.cwd, id, designDir(), tx)
        const applied = call.args.set_current !== false ? applyProjectStyle(call.cwd, id, tx, preparedStyle) : null
        tx.afterCommit(() => invalidateDesignCache(call.cwd))
        return { result, applied }
      })

      let lockLine = '未锁定（如需使用：canvas_style action=set）。'
      if (applied) {
        const { url: canvasUrl } = await ensureServer(call.cwd)
        lockLine = `已锁定为当前项目风格：重写 ${applied.pagesUpdated} 个页面（画布会自动刷新）。\n画布 URL：${canvasUrl}`
      }
      lockLine += navigationNotice(applied?.warnings ?? [])
      return {
        content:
          `${summary}\n\n已创建自定义设计系统「${result.summary.name}」（${id}）并完成校验。\n` +
          `文件：${libraryDir(call.cwd)}/${id}/{tokens.json,meta.json}\n${lockLine}\n` +
          `（只在本工作区生效，随 .tianshu-canvas/ 一起被 gitignore。）`,
      }
    }

    if (action === 'import') {
      const id = str(call.args.id)
      if (!id) return { content: 'import 需要 id（新建的风格 id：字母数字/_/-，1–64 位）。', isError: true }
      const stackArg = str(call.args.stack)
      let adapterId = stackArg as AdapterId | undefined
      let detection = adapterId ? null : detectAdapters(call.cwd)[0]
      if (!adapterId && !detection) {
        return {
          content:
            '没有在当前工作区探测到可导入的技术栈（需要 package.json 依赖 antd，或 tailwindcss/class-variance-authority 之一 + 样式文件）。\n' +
            '请用 stack=shadcn|antd 显式指定，或用 extract 从页面反抽取。',
          isError: true,
        }
      }
      if (!adapterId && detection) adapterId = detection.id
      const adapter = getAdapter(adapterId!)
      if (!adapter) return { content: `未知的 stack：${adapterId}。可选：shadcn / antd。`, isError: true }
      const sourcePath = str(call.args.source_path)
      let imported
      try {
        imported = adapter.importTokens(call.cwd, sourcePath)
      } catch (err) {
        return { content: `导入主题失败：${reportError(err)}`, isError: true }
      }

      const summary =
        `从仓库导入主题（${adapterId}）：观测 ${imported.observed.length} 项、推断 ${imported.inferred.length} 项。\n` +
        (detection ? `探测依据：${detection.evidence.join('；')}\n` : '') +
        (imported.warnings.length ? `提示：\n${imported.warnings.map((w) => `  - ${w}`).join('\n')}\n` : '') +
        (imported.inferred.length ? `推断项（非仓库原值，请核对）：${imported.inferred.slice(0, 12).join('、')}${imported.inferred.length > 12 ? ` 等 ${imported.inferred.length} 项` : ''}\n` : '')

      if (call.args.dry_run === true) {
        return {
          content: `${summary}\n（dry_run：未写入。完整 tokens 如下，检查后去掉 dry_run 再执行）\n\`\`\`json\n${JSON.stringify(imported.tokens, null, 2)}\n\`\`\``,
        }
      }

      const tokens = imported.tokens as Record<string, any>
      const swatches = [
        tokens.color?.primitives?.brand?.['500'],
        tokens.color?.primitives?.neutral?.['900'],
        tokens.color?.primitives?.neutral?.['50'],
        tokens.color?.primitives?.danger?.['500'],
      ].filter(Boolean) as string[]

      const { result, applied } = withProjectTransaction(call.cwd, (tx) => {
        const result = createCustomStyle(
          call.cwd,
          id,
          tokens,
          {
            name: call.args.name ?? imported.name,
            tagline: call.args.tagline ?? imported.tagline,
            description: call.args.description ?? `由 canvas_design_system import 从现有 ${adapterId} 主题导入（观测 ${imported.observed.length} 项 / 推断 ${imported.inferred.length} 项）。`,
            tags: call.args.tags ?? [adapterId, 'imported'],
            swatches: call.args.swatches ?? swatches,
            iconStyle: call.args.iconStyle ?? imported.iconStyle,
            adapter: { id: adapterId, version: 1, source: sourcePath ?? detection?.evidence.join('; ') ?? 'auto' },
          },
          designDir(),
          { overwrite: call.args.overwrite === true, builtinIds: builtinIds() },
          tx,
        )
        recordUsage(call.cwd, { styleId: id, source: { kind: 'import', ref: adapterId ?? 'auto' } }, tx)

        const preparedStyle = compileCustomStyle(call.cwd, id, designDir(), tx)
        const applied = call.args.set_current !== false ? applyProjectStyle(call.cwd, id, tx, preparedStyle) : null
        tx.afterCommit(() => invalidateDesignCache(call.cwd))
        return { result, applied }
      })

      let lockLine = '未锁定（如需使用：canvas_style action=set）。'
      if (applied) {
        const { url } = await ensureServer(call.cwd)
        lockLine = `已锁定为当前项目风格：重写 ${applied.pagesUpdated} 个页面（画布会自动刷新）。\n画布 URL：${url}`
      }
      lockLine += navigationNotice(applied?.warnings ?? [])
      return {
        content:
          `${summary}\n已创建自定义设计系统「${result.summary.name}」（${id}）并完成校验。\n` +
          `文件：${libraryDir(call.cwd)}/${id}/{tokens.json,meta.json}\n${lockLine}\n` +
          `注意：自定义设计系统只在本工作区生效（随 .tianshu-canvas/ 一起被 gitignore）。`,
      }
    }

    if (action === 'create') {
      const id = str(call.args.id)
      if (!id) return { content: 'create 需要 id（风格 id：字母数字/_/-，1–64 位）。', isError: true }
      const { result, applied } = withProjectTransaction(call.cwd, (tx) => {
        const result = createCustomStyle(call.cwd, id, call.args.tokens, {
          name: call.args.name,
          tagline: call.args.tagline,
          description: call.args.description,
          tags: call.args.tags,
          swatches: call.args.swatches,
          iconStyle: call.args.iconStyle,
          license: call.args.license,
          notice: call.args.notice,
        }, designDir(), { overwrite: call.args.overwrite === true, builtinIds: builtinIds() }, tx)

        const preparedStyle = compileCustomStyle(call.cwd, id, designDir(), tx)
        const applied = call.args.set_current !== false ? applyProjectStyle(call.cwd, id, tx, preparedStyle) : null
        tx.afterCommit(() => invalidateDesignCache(call.cwd))
        return { result, applied }
      })

      let lockLine = '未锁定（如需使用：canvas_style action=set）。'
      if (applied) {
        const { url } = await ensureServer(call.cwd)
        lockLine =
          `已锁定为当前项目风格：重写 ${applied.pagesUpdated} 个页面（画布会自动刷新）。\n` +
          `画布 URL：${url}` +
          (applied.missingIcons.length ? `\n注意：这些图标名不在目录中：${applied.missingIcons.slice(0, 8).join('、')}。` : '') +
          scriptIconNote(applied.scriptIcons)
      }
      lockLine += navigationNotice(applied?.warnings ?? [])
      const warnLine = result.warnings.length ? `\n提示：${result.warnings.join('；')}` : ''
      return {
        content:
          `已创建自定义设计系统「${result.summary.name}」（${id}）：` +
          `${result.summary.swatches.length} 个色卡、图标 ${result.summary.counts.icons} 个、组件 ${result.summary.counts.components} 个（共享，不可扩展）。\n` +
          `文件：${libraryDir(call.cwd)}/${id}/{tokens.json,meta.json}\n` +
          `${lockLine}${warnLine}\n` +
          `注意：自定义设计系统只在本工作区生效（随 .tianshu-canvas/ 一起被 gitignore）。`,
      }
    }

    if (action === 'export') {
      const id = str(call.args.id) ?? currentStyleId(call.cwd) ?? ''
      if (!id) return { content: 'export 需要 id（或先锁定一套自定义风格）。', isError: true }
      if (isBuiltinStyle(id)) return { content: `「${id}」是内置风格，不支持导出为品牌包（用 canvas_style action=get 查看 token）。`, isError: true }
      let pack
      try {
        pack = buildBrandPack(call.cwd, id, designDir())
      } catch (err) {
        return { content: reportError(err), isError: true }
      }
      const rawOut = str(call.args.out_dir)
      const dir = rawOut ? (isAbsolute(rawOut) ? rawOut : join(call.cwd, rawOut)) : join(call.cwd, PROJECT_DIR_NAME, 'exports')
      const file = join(dir, `${id}.json`)
      try {
        exportBrandPack(call.cwd, pack, file)
      } catch (err) {
        return { content: `品牌包导出失败：${reportError(err)}`, isError: true }
      }
      return {
        content:
          `已导出品牌包「${pack.name}」（${id}）：${file}\n` +
          `包含：tokens、meta（含适配器绑定）、使用记忆（组件/图标/变量）、校验命中记录。\n` +
          `checksum：${pack.checksum.slice(0, 16)}…（导入时会校验）\n` +
          `把它复制到目标工作区后，用 canvas_design_system（action=import_pack, pack_path=<该文件>）导入。`,
      }
    }

    if (action === 'import_pack') {
      const rawPath = str(call.args.pack_path)
      if (!rawPath) return { content: 'import_pack 需要 pack_path（品牌包 JSON 的路径）。', isError: true }
      const file = isAbsolute(rawPath) ? rawPath : join(call.cwd, rawPath)
      if (!existsSync(file)) return { content: '品牌包不存在，请核对 pack_path 后重试。', isError: true }
      let raw: string
      try {
        // 工作区内的路径按边界拒绝越界读；工作区外按用户显式指定，但拒绝叶子符号链接。
        raw = readTextInWorkspace(call.cwd, file, '品牌包')
      } catch (err) {
        return { content: `品牌包读取失败：${reportError(err)}`, isError: true }
      }
      let pack: unknown
      try {
        pack = JSON.parse(raw)
      } catch (err) {
        return { content: '品牌包不是合法 JSON，请修复格式后重试。', isError: true }
      }
      const errors = verifyBrandPack(pack)
      if (errors.length) return { content: `品牌包校验失败：\n${errors.map((e) => `  - ${e}`).join('\n')}`, isError: true }
      const typed = pack as ReturnType<typeof buildBrandPack>
      if (builtinIds().includes(typed.id)) return { content: `品牌包 id「${typed.id}」与内置风格冲突。`, isError: true }
      if (customStyleExists(call.cwd, typed.id) && call.args.overwrite !== true) {
        return { content: `自定义设计系统「${typed.id}」已存在。若要覆盖，请传 overwrite=true。`, isError: true }
      }
      const applied = withProjectTransaction(call.cwd, (tx) => {
        createCustomStyle(call.cwd, typed.id, typed.tokens, typed.meta, designDir(), { overwrite: call.args.overwrite === true, builtinIds: builtinIds() }, tx)
        importBrandPack(call.cwd, typed, tx)
        const preparedStyle = compileCustomStyle(call.cwd, typed.id, designDir(), tx)
        const applied = applyProjectStyle(call.cwd, typed.id, tx, preparedStyle)
        tx.afterCommit(() => invalidateDesignCache(call.cwd))
        return applied
      })
      const { url } = await ensureServer(call.cwd)
      return {
        content: `已导入品牌包「${typed.name}」（${typed.id}）：${file}\n已锁定风格，重写 ${applied.pagesUpdated} 个页面。\n画布 URL：${url}${navigationNotice(applied.warnings)}`,
      }
    }

    if (action === 'remove') {
      const id = str(call.args.id)
      if (!id) return { content: 'remove 需要 id。', isError: true }
      if (isBuiltinStyle(id)) return { content: `「${id}」是内置风格，不能删除。`, isError: true }
      const wasCurrent = withProjectTransaction(call.cwd, (tx) => {
        const wasCurrent = currentStyleId(call.cwd, tx) === id
        removeCustomStyle(call.cwd, id, tx)
        forgetStyle(call.cwd, id, tx)
        if (wasCurrent) applyProjectStyle(call.cwd, null, tx)
        tx.afterCommit(() => invalidateDesignCache(call.cwd))
        return wasCurrent
      })
      const unlinkLine = wasCurrent ? '\n它原本是当前锁定的风格，已解除锁定（已有页面保留注入的样式块）。' : ''
      return { content: `已删除自定义设计系统「${id}」。${unlinkLine}` }
    }

    return { content: `未知的 action：${action}。可选：create / extract / list / get / remove。`, isError: true }
  } catch (err) {
    return { content: reportError(err), isError: true }
  }
}

// ---------------------------------------------------------------------------
// canvas_audit（contract / a11y / visual / baseline / drift）—— Design CI
// ---------------------------------------------------------------------------

function resolveAuditStyle(call: ToolCall): { styleId: string | null; style: ReturnType<typeof resolveDesignStyle> } {
  const override = str(call.args.style_id)
  const styleId = override === 'free' ? null : (override ?? currentStyleId(call.cwd))
  const style = styleId && styleId !== 'free' ? resolveDesignStyle(call.cwd, styleId) : null
  return { styleId: styleId ?? null, style }
}

function auditPages(call: ToolCall): { pages: { id: string; title: string; html: string }[]; error?: string } {
  const pageId = str(call.args.page_id)
  if (pageId) {
    const html = readPageHtml(call.cwd, pageId)
    if (html === null) return { pages: [], error: `页面不存在：${pageId}` }
    const node = readProject(call.cwd).nodes.find((n) => n.id === pageId)
    return { pages: [{ id: pageId, title: node?.title ?? pageId, html }] }
  }
  const project = readProject(call.cwd)
  if (project.nodes.length === 0) return { pages: [], error: '画布上没有页面可审计。' }
  const pages = []
  for (const node of project.nodes) {
    const html = readPageHtml(call.cwd, node.id)
    if (html !== null) pages.push({ id: node.id, title: node.title, html })
  }
  return { pages }
}

async function canvasAudit(call: ToolCall): Promise<ToolResult> {
  const action = str(call.args.action) ?? 'contract'
  try {
    if (action === 'review') {
      const pageId = str(call.args.page_id)
      if (!pageId) return { content: 'review 需要 page_id；逐页生成桌面、平板和手机截图与客观报告。', isError: true }
      const result = await reviewPage(call.cwd, pageId, { outputDir: str(call.args.out_dir) })
      return { content: formatReviewReport(result) }
    }

    if (action === 'contract') {
      const { pages, error } = auditPages(call)
      if (error) return { content: error, isError: true }
      const { styleId, style } = resolveAuditStyle(call)
      const results = pages.map((p) => {
        const result = computeContract(p.html, styleId, call.cwd, style?.manifest ?? null)
        return { page: p, result }
      })
      const total = results.reduce((n, r) => n + r.result.total, 0)
      const outDir = str(call.args.out_dir)
      let writeLine = ''
      if (call.args.write_files === true || outDir) {
        const base = outDir ? (isAbsolute(outDir) ? outDir : join(call.cwd, outDir)) : join(call.cwd, PROJECT_DIR_NAME, 'exports', 'audit')
        mkdirSync(base, { recursive: true })
        const written: string[] = []
        for (const { page, result } of results) {
          // 审计产物同样走统一边界：不跟随被预置的叶子链接。
          const htmlPath = join(base, `${page.id}.html`)
          writeFileAtomic(call.cwd, htmlPath, page.html)
          const testPath = join(base, `${page.id}.audit.test.mjs`)
          writeFileAtomic(call.cwd, testPath, result.testFile)
          written.push(testPath)
        }
        writeLine = `\n\n已落盘：${written.join('、')}`
      }
      const body = results.map(({ page, result }) => formatContractReport(result, `页面「${page.title}」(id=${page.id})`)).join('\n\n')
      return { content: `${body}\n\n合计：${total} 处 lint 问题。${writeLine}` }
    }

    if (action === 'drift') {
      const { styleId, style } = resolveAuditStyle(call)
      if (!style) return { content: 'drift 需要已锁定的风格（或传 style_id）；当前为自由发挥。', isError: true }
      const { pages, error } = auditPages(call)
      if (error) return { content: error, isError: true }
      const snapshot = buildSnapshot({
        styleId,
        htmls: pages.map((p) => p.html),
        manifest: style.manifest,
        tokensCss: style.tokensCss,
        componentsCss: style.componentsCss,
        icons: style.manifest.iconNames,
      })
      const dir = str(call.args.out_dir) ? (isAbsolute(str(call.args.out_dir)!) ? str(call.args.out_dir)! : join(call.cwd, str(call.args.out_dir)!)) : snapshotDir(call.cwd)
      const file = join(dir, 'snapshot.json')
      const before = readSnapshot(call.cwd, file)
      writeSnapshot(call.cwd, file, snapshot)
      if (!before) {
        return { content: `已写入首个设计快照：${file}\n（下次运行 drift 会展示与本次的差集。）` }
      }
      const drift = diffSnapshots(before, snapshot)
      return { content: `${formatDriftReport(drift, '上次快照', '当前')}\n\n快照：${file}` }
    }

    if (action === 'a11y') {
      const { pages, error } = auditPages(call)
      if (error) return { content: error, isError: true }
      const { url } = await ensureServer(call.cwd)
      const exe = resolveBrowser()
      if (!exe) return { content: '未找到 Chrome/Edge，无法渲染页面做可访问性审计。可用 TIANSHU_CANVAS_BROWSER 指定路径。', isError: true }
      const { browser, dispose } = await launchBrowser(exe)
      try {
        const authPage = await browser.newPage()
        await authPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await authPage.waitForFunction('!location.hash', { timeout: 15000 })
        await authPage.close()
        const parts: string[] = []
        let errors = 0
        for (const page of pages) {
          const pageUrl = new URL(url)
          pageUrl.pathname = `${pageUrl.pathname}page/${encodeURIComponent(page.id)}`
          pageUrl.hash = ''
          const report = await auditPage(browser, pageUrl.toString(), {
            minContrast: num(call.args.min_contrast),
            minTargetSize: num(call.args.min_target_size),
            ignore: Array.isArray(call.args.ignore) ? (call.args.ignore as unknown[]).map(String) : undefined,
          })
          errors += report.counts.error
          parts.push(formatA11yReport(report, `页面「${page.title}」(id=${page.id})`))
        }
        return { content: `${parts.join('\n\n')}\n\n合计 error ${errors} 处。` }
      } finally {
        await dispose()
      }
    }

    if (action === 'baseline' || action === 'visual') {
      const { styleId } = resolveAuditStyle(call)
      const rawDir = str(call.args.baseline_dir)
      const dir = rawDir ? (isAbsolute(rawDir) ? rawDir : join(call.cwd, rawDir)) : defaultBaselineDir(call.cwd)
      const threshold = num(call.args.threshold)
      if (action === 'baseline') {
        const result = await writeBaselines(call.cwd, styleId ?? 'free', dir)
        return { content: formatVisualReport(result, true) }
      }
      const result = await compareWithBaselines(call.cwd, styleId ?? 'free', dir, { threshold, updateMissing: call.args.update_missing === true })
      return { content: formatVisualReport(result, false) }
    }

    return { content: `未知的 action：${action}。可选：contract / a11y / visual / baseline / drift / review。`, isError: true }
  } catch (err) {
    return { content: reportError(err), isError: true }
  }
}

// ---------------------------------------------------------------------------
// canvas_comments（list / resolve / reopen / remove）—— 元素批注
// ---------------------------------------------------------------------------

function formatComment(c: Comment, index: number, project: Project): string {
  const node = project.nodes.find((n) => n.id === c.pageId)
  const pageTitle = node ? node.title : c.pageId
  const lines = [`${index}. [${c.id}] ${pageTitle}（${c.pageId}）· <${c.tagName || '?'}> xpath=${c.xpath}`]
  if (c.textContent) lines.push(`   当前文本：${c.textContent}`)
  lines.push(`   批注：${c.note}`)
  if (c.resolved) lines.push('   （已解决）')
  return lines.join('\n')
}

async function canvasComments(call: ToolCall): Promise<ToolResult> {
  const action = str(call.args.action) ?? 'list'
  try {
    if (action === 'list') {
      const project = readProject(call.cwd)
      const all = project.comments ?? []
      const includeResolved = call.args.include_resolved === true
      const shown = includeResolved ? all : all.filter((c) => !c.resolved)
      if (all.length === 0) {
        return {
          content:
            '当前没有元素批注。\n' +
            '用户在画布上选中页面内元素后，可在「选中面板」里写一句话并添加批注；保存后会出现在这里。',
        }
      }
      if (shown.length === 0) {
        return { content: `共有 ${all.length} 条批注，全部已解决。传 include_resolved=true 可查看。` }
      }
      const sorted = [...shown].sort((a, b) => a.createdAt - b.createdAt)
      const body = sorted.map((c, i) => formatComment(c, i + 1, project)).join('\n')
      const resolved = all.length - all.filter((c) => !c.resolved).length
      return {
        content:
          `待处理批注 ${sorted.length} 条${resolved ? `（另有 ${resolved} 条已解决）` : ''}：\n\n${body}\n\n` +
          `请逐条按 xpath 定位并修改（通常用 canvas_upsert_page 重写该页 HTML）；改完后调用 ` +
          `canvas_comments（action=resolve, ids=[...]）标记已解决。`,
      }
    }

    if (action === 'resolve' || action === 'reopen') {
      const ids = Array.isArray(call.args.ids) ? call.args.ids.filter((v): v is string => typeof v === 'string') : []
      if (ids.length === 0) return { content: `${action} 需要 ids（批注 id 数组）。`, isError: true }
      const { missing, changed } = withProjectTransaction(call.cwd, (tx) => {
        const known = new Set((tx.project.comments ?? []).map((c) => c.id))
        return { missing: ids.filter((id) => !known.has(id)), changed: setCommentsResolved(call.cwd, ids, action === 'resolve', tx) }
      })
      const { url } = await ensureServer(call.cwd)
      const missLine = missing.length ? `\n未找到：${missing.join('、')}` : ''
      return {
        content:
          `${action === 'resolve' ? '已标记' : '已重新打开'} ${changed} 条批注。\n画布 URL：${url}${missLine}`,
      }
    }

    if (action === 'remove') {
      const ids = Array.isArray(call.args.ids) ? call.args.ids.filter((v): v is string => typeof v === 'string') : undefined
      const all = call.args.all === true
      if (!all && (!ids || ids.length === 0)) {
        return { content: 'remove 需要 ids（批注 id 数组），或用 all=true 清空全部。', isError: true }
      }
      const removed = removeComments(call.cwd, all ? undefined : ids)
      const { url } = await ensureServer(call.cwd)
      return { content: `已删除 ${removed} 条批注。\n画布 URL：${url}` }
    }

    return { content: `未知的 action：${action}。可选：list / resolve / reopen / remove。`, isError: true }
  } catch (err) {
    return { content: reportError(err), isError: true }
  }
}

// ---------------------------------------------------------------------------
// 工具清单（名称必须与 tianshu.plugin.json 的 contributes.tools 完全一致）
// ---------------------------------------------------------------------------

export const tools: TpiTool[] = [
  {
    definition: {
      name: 'canvas_open',
      description: '【第一步】启动/复用本工作区的本地画布服务并返回画布 URL；必须先把该 URL 单独一行发给用户，再开始设计',
      input_schema: {
        type: 'object',
        properties: {
          port: { type: 'integer', description: '可选首选端口；0=自动分配（默认 43117，被占用则递增）' },
          open: { type: 'boolean', description: '可选：尝试用系统默认浏览器打开（默认 false）' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    timeoutMs: 30_000,
    execute: withBackupNotice(canvasOpen),
  },
  {
    definition: {
      name: 'canvas_upsert_page',
      description: '新增或更新画布页面节点（写入 HTML 原型，或仅改标题/位置/尺寸；可选内联资源）。先 canvas_open；营销页面默认双首屏选稿，已有品牌和指定布局优先，用户选择后原位深化',
      input_schema: {
        type: 'object',
        properties: {
          html_path: { type: 'string', description: '已有 HTML 文件路径（工作区内，优先于 html）；一般不要用，请直接用 html 内联，避免在工作区产生多余文件' },
          html: { type: 'string', description: '内联 HTML（推荐方式：原型只存放在 .tianshu-canvas/pages/，不要另建文件夹）。原型必须自包含：外链与相对路径会被画布 CSP 拦截，请内联。更新已有页面的元数据时可省略' },
          title: { type: 'string', description: '页面标题' },
          id: { type: 'string', description: '页面 id（字母数字/_/-）。缺省则新建并自动生成；传已存在的 id 则更新该页面，未指定的字段保持原值' },
          x: { type: 'number', description: '画布 X 坐标（新建缺省按网格自动排布；更新缺省保持原位）' },
          y: { type: 'number', description: '画布 Y 坐标（新建缺省按网格自动排布；更新缺省保持原位）' },
          width: { type: 'number', description: '逻辑宽度 px（覆盖设备预设）' },
          height: { type: 'number', description: '逻辑高度 px（覆盖设备预设）' },
          device_type: {
            type: 'string',
            enum: ['desktop', 'tablet', 'mobile', 'free'],
            description: '设备预设（新建默认 desktop；更新缺省保持原设备与尺寸）',
          },
          inline_assets: {
            type: 'boolean',
            description:
              '可选（默认 false）：把原型里会被画布 CSP 拦截的外链/相对路径资源抓取并内联为 data: URI（图片/字体/CSS/SVG/脚本）。' +
              '相对路径需要同时给出 inline_assets_origin。抓取失败或超限的资源保留原引用并在返回里说明。开启前请确认这些外部资源是你信任的来源。',
          },
          inline_assets_origin: {
            type: 'string',
            description: '可选：内联相对路径资源时的基准地址（如 https://example.com/page），用于把 ./img/a.png 解析成绝对 URL。',
          },
          inline_assets_max_kb: {
            type: 'integer',
            description: '可选：单个内联资源的体积上限（KB，默认 2048，硬顶 5120）。',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
    pathParams: { html_path: 'read' },
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    timeoutMs: 180_000,
    execute: withBackupNotice(canvasUpsertPage),
  },
  {
    definition: {
      name: 'canvas_get_state',
      description: '读取画布状态：页面节点、连线、用户当前选中项与画布 URL',
      input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    timeoutMs: 30_000,
    execute: withBackupNotice(canvasGetState),
  },
  {
    definition: {
      name: 'canvas_arrange',
      description: '编排画布：删除/复制页面节点、页面间连线或取消连线',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['remove', 'duplicate', 'link', 'unlink'],
            description: '操作类型',
          },
          id: { type: 'string', description: 'remove / duplicate 使用：页面节点 id' },
          title: { type: 'string', description: 'duplicate 可选：新标题（默认「原标题 副本」）' },
          source: { type: 'string', description: 'link / unlink 使用：源页面 id' },
          target: { type: 'string', description: 'link / unlink 使用：目标页面 id' },
          label: { type: 'string', description: 'link 可选：连线标签' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    timeoutMs: 60_000,
    execute: withBackupNotice(canvasArrange),
  },
  {
    definition: {
      name: 'canvas_style',
      description: '管理设计风格，按需读取原创原型和视觉方向，保存页面简报及用户确认，读取模板与交互或导出代码。营销页面默认先出两个不同首屏，用户选择后深化；已有品牌与锁定风格优先',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'get', 'set', 'template', 'interaction', 'prototype', 'direction', 'brief', 'codegen'],
            description:
              'list=列出可选风格与当前状态；get=查看某风格的 token/组件类/图标名/交互清单；' +
              'prototype=列出原型或用 prototype_id 读完整 HTML；direction=列出方向或用 direction_id 读原创示例；brief=读取或用 brief 对象保存 page_id 的简报；' +
              'set=锁定或切换风格；template=取 dashboard/landing 模板的完整 HTML，可直接传给 canvas_upsert_page；' +
              'interaction=取某个交互模式（tabs/modal/drawer 等）的骨架 HTML 与用法，可直接放进页面；' +
              'codegen=导出生产代码（**必须先问用户要哪种目标**，不要自行假定）',
          },
          style_id: {
            type: 'string',
            description: '风格 id（set/get/template/interaction/codegen 使用），内置或自定义均可；free 表示解除锁定',
          },
          template_id: { type: 'string', description: 'action=template 时使用：模板 id（如 dashboard / landing）' },
          prototype_id: { type: 'string', description: 'prototype：中性原型 ID，省略列出所有摘要；指定后返回完整 HTML、内容要求及响应式说明' },
          direction_id: { type: 'string', enum: ['editorial-narrative', 'product-evidence', 'brand-poster'], description: 'direction：视觉方向 ID；省略列出摘要。方向与风格、原型分别选择' },
          brief: {
            type: 'object', description: 'brief：指定页面简报的部分更新；省略则读取。不得代填用户确认或虚构证据',
            properties: {
              audience: { type: 'string', maxLength: 2000 }, purpose: { type: 'string', maxLength: 2000 },
              proposition: { type: 'string', maxLength: 2000 }, primaryAction: { type: 'string', maxLength: 2000 },
              evidence: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 2000 } },
              assets: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 2000 } },
              brandConstraints: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 2000 } },
              prototypeId: { type: 'string' }, directionId: { type: 'string', enum: ['editorial-narrative', 'product-evidence', 'brand-poster'] },
              confirmation: { type: 'object', description: '仅用户已明确选择后传入；不能从复制、选中节点或代理偏好推断认可',
                properties: { confirmed: { type: 'boolean', enum: [true] }, directionId: { type: 'string', enum: ['editorial-narrative', 'product-evidence', 'brand-poster'] }, reason: { type: 'string', minLength: 1, maxLength: 2000 } },
                required: ['confirmed', 'directionId', 'reason'], additionalProperties: false },
            }, additionalProperties: false,
          },
          interaction_id: {
            type: 'string',
            description: 'action=interaction 时使用：交互模式 id（如 tabs / modal / drawer / dropdown / accordion / toast / tooltip / loading-skeleton / progress / form-validation / segmented / switch / stepper / pagination / sortable-table / date-picker / scroll-progress / sticky-header / scroll-reveal / tilt-card / mobile-nav / copy-code / toc-outline）',
          },
          target: {
            type: 'string',
            enum: ['react', 'css-vars', 'tailwind', 'shadcn', 'antd', 'ios', 'android', 'miniprogram'],
            description: 'codegen：目标。Web：react（React+TSX）/ css-vars（CSS 变量+无框架 HTML）/ tailwind（Tailwind 配置）/ shadcn（shadcn 组件 + Tailwind）/ antd（Ant Design 组件 + ConfigProvider）；多端：ios / android / miniprogram（需配合 stack）',
          },
          stack: {
            type: 'string',
            enum: ['swiftui', 'uikit', 'compose', 'xml', 'weapp', 'uniapp', 'taro'],
            description:
              'codegen 多端专用：技术栈。ios→swiftui|uikit；android→compose|xml；miniprogram→weapp|uniapp|taro。Web 目标忽略。' +
              '**多端导出前必须先问用户选哪种技术栈并等回答，不得替用户决定**（也可多选多端）。' +
              '多端产物是「主题/Token 文件 + design-spec.md 规格清单」，**页面代码由你按规格编写**（HTML→原生必然有损，不得声称像素级还原）',
          },
          page_id: { type: 'string', description: 'brief：必填关联页面 ID；codegen：要转换的页面 id，省略时若画布只有一个页面则用它' },
          html: { type: 'string', description: 'codegen：直接传入源 HTML（优先于 page_id）' },
          out_dir: { type: 'string', description: 'codegen：落盘目录（默认 .tianshu-canvas/exports/<target>/）。宿主会把该参数规范化为绝对路径' },
          write_files: { type: 'boolean', description: 'codegen：是否写到磁盘（默认 false，直接返回文件内容）' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
    pathParams: { out_dir: 'write' },
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    timeoutMs: 120_000,
    execute: withBackupNotice(canvasStyle),
  },
  {
    definition: {
      name: 'canvas_check_style',
      description: '只读检查页面是否符合当前设计风格，输出分级报告',
      input_schema: {
        type: 'object',
        properties: {
          page_id: { type: 'string', description: '要检查的页面 id；省略则检查全部页面' },
          html: { type: 'string', description: '直接检查一段 HTML（优先于 page_id），用于写入前自查' },
          style_id: {
            type: 'string',
            description: '覆盖当前锁定的风格（内置或自定义 id）；free 表示只检查资源引用',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    timeoutMs: 60_000,
    execute: withBackupNotice(canvasCheckStyle),
  },
  {
    definition: {
      name: 'canvas_design_system',
      description: '创建/查看/删除当前项目的自定义设计系统（.tianshu-canvas/library/），从现有 HTML/CSS/URL 反抽取、从仓库 shadcn/AntD 主题导入，或导出/导入可移植品牌包',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'extract', 'import', 'export', 'import_pack', 'list', 'get', 'remove'],
            description:
              'create=创建；extract=从现有 HTML/CSS/URL 反抽取；import=从仓库现有 shadcn/Tailwind 或 AntD 主题导入；export=导出可移植品牌包；import_pack=导入品牌包；list=列出；get=查看细节；remove=删除。' +
              '**create 前必须先一次性问清配置并等回答：配色与主色、圆角、字号、字体、动效、阴影、控件尺寸、是否要深色——不要拆成多轮反复追问。**',
          },
          stack: {
            type: 'string',
            enum: ['shadcn', 'antd'],
            description: 'import：技术栈。省略时自动探测（有 antd 依赖 → antd；有 tailwind 依赖 + components.json/样式文件 → shadcn）',
          },
          source_path: {
            type: 'string',
            description: 'import：主题源文件（shadcn 的 globals.css / tailwind.config.*；AntD 含 ConfigProvider 的 tsx）。省略时自动查找。宿主会把该参数规范化为绝对路径',
          },
          pack_path: {
            type: 'string',
            description: 'import_pack：品牌包 JSON 路径。宿主会把该参数规范化为绝对路径',
          },
          out_dir: {
            type: 'string',
            description: 'export：品牌包落盘目录（默认 .tianshu-canvas/exports/）。宿主会把该参数规范化为绝对路径',
          },
          source: { type: 'string', description: 'extract：内联 HTML 或 CSS 文本（最高优先）' },
          path: { type: 'string', description: 'extract：工作区内的 HTML/CSS 文件路径。宿主会把该参数规范化为绝对路径' },
          url: { type: 'string', description: 'extract：远程页面 URL（仅 http/https；会做 SSRF 防护，禁内网）' },
          dry_run: {
            type: 'boolean',
            description: 'extract/import：只预览（返回摘要 + 完整 tokens），不写盘（默认 false）。**建议默认先传 true 让用户确认后再正式执行**——正式执行会创建风格并重写所有页面',
          },
          id: { type: 'string', description: '风格 id：字母数字/_/-，1–64 位；不得与内置风格重名' },
          name: { type: 'string', description: 'create：风格显示名' },
          tagline: { type: 'string', description: 'create：一句话描述' },
          description: { type: 'string', description: 'create：较长描述' },
          tags: { type: 'array', items: { type: 'string' }, description: 'create：标签' },
          swatches: { type: 'array', items: { type: 'string' }, description: 'create：色卡（4 个 hex，用于画布顶栏展示）' },
          iconStyle: {
            type: 'object',
            description: 'create：图标描边风格；strokeWidth 必填（数字，如 1.5 / 1.75），linecap/linejoin 可选',
            properties: {
              strokeWidth: { type: 'number' },
              linecap: { type: 'string' },
              linejoin: { type: 'string' },
            },
            required: ['strokeWidth'],
          },
          tokens: {
            type: 'object',
            description:
              'create：完整 tokens 对象。契约（值自由，变量名必须与内置风格一致）：\n' +
              '- color.primitives：neutral{0,50,100,200,300,500,700,900}、brand{100,300,500,600,700}、success{50,500}、warning{50,500}、danger{50,500}、info{50,500}，值均为 #hex。\n' +
              '- color.semantic（浅色）与 color.semanticDark（深色，同结构）：bg{canvas,surface,raised,sunken,inverse}、text{primary,secondary,muted,inverse,link}、border{default,strong,subtle,focus}、action{primary,primaryHover,primaryText,secondary,secondaryHover,secondaryText,ghostHover,danger,dangerText}、status{success,successBg,warning,warningBg,danger,dangerBg,info,infoBg}、chart{1..5}、overlay{scrim}；值写 "组.步"（如 neutral.900）或 #hex/rgba()。\n' +
              '- font：families{sans,display,mono}、sizes{xs,sm,md,lg,xl,2xl,3xl,4xl}(px)、weights{regular,medium,semibold,bold}、lineHeights{tight,snug,normal,relaxed}、letterSpacing{tight,normal,wide}。\n' +
              '- space（键 0..16，值须严格递增）、radius{none,sm,md,lg,xl,full}、borderWidth{hairline,thin,thick}、size{controlSm..containerLg,sidebar}、shadow{sm,md,lg}、motion{fast,base,easing}。\n' +
              '写入前会校验对比度（浅色与深色各一遍，正文≥4.5）、尺度递增、变量名覆盖共享组件/模板；不通过会返回逐条错误。',
          },
          overwrite: { type: 'boolean', description: 'create：id 已存在时是否覆盖（默认 false）' },
          set_current: { type: 'boolean', description: 'create：是否立即锁定为当前项目风格（默认 true）' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
    pathParams: { path: 'read', source_path: 'read', pack_path: 'read', out_dir: 'write' },
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    timeoutMs: 120_000,
    execute: withBackupNotice(canvasDesignSystem),
  },
  {
    definition: {
      name: 'canvas_audit',
      description: '设计 CI 审计：设计契约、可访问性、视觉回归、设计漂移；review 对指定页面生成桌面/平板/手机截图与客观报告，审美判断需要真实读图和用户评审',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['contract', 'a11y', 'visual', 'baseline', 'drift', 'review'],
            description:
              'contract=源码级设计契约（确定性，无需浏览器）；a11y=渲染后可访问性审计（需要 Chrome/Edge）；' +
              'baseline=写入视觉基线（覆盖式）；visual=与基线逐像素比较；drift=与上次设计快照比较；review=指定 page_id 的多尺寸截图与客观报告，不自动评审审美',
          },
          page_id: { type: 'string', description: '只审计指定页面；省略则审计全部页面' },
          style_id: { type: 'string', description: '覆盖当前锁定的风格；free 表示不做风格相关检查' },
          write_files: { type: 'boolean', description: 'contract：把可独立运行的 *.audit.test.mjs 落到 out_dir（默认 false）' },
          out_dir: {
            type: 'string',
            description: 'contract：测试文件落盘目录；drift：快照目录；review：截图与报告目录，必须在工作区内（默认 .tianshu-canvas/audit/review）',
          },
          baseline_dir: {
            type: 'string',
            description: 'visual/baseline：基线目录（默认 .tianshu-canvas/audit/baseline，被 gitignore；要团队共享就指到仓库内目录）',
          },
          threshold: { type: 'number', description: 'visual：单通道像素差阈值（0–255，默认 8，用于容忍抗锯齿）' },
          update_missing: { type: 'boolean', description: 'visual：缺少基线的页面是否顺手写入（默认 false）' },
          min_contrast: { type: 'number', description: 'a11y：正文对比度下限（默认 4.5）' },
          min_target_size: { type: 'number', description: 'a11y：点击目标最小尺寸（CSS px，默认 24）' },
          ignore: { type: 'array', items: { type: 'string' }, description: 'a11y：忽略的选择器片段（如 ["page-node__header"]）' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
    pathParams: { out_dir: 'write', baseline_dir: 'write' },
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    timeoutMs: 300_000,
    execute: withBackupNotice(canvasAudit),
  },
  {
    definition: {
      name: 'canvas_comments',
      description: '读取/处理用户在画布上留下的元素批注：列出待办、批量标记已解决/重开/删除',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'resolve', 'reopen', 'remove'], description: 'list=列出批注（默认）；resolve=标记已解决；reopen=重新打开；remove=删除' },
          ids: { type: 'array', items: { type: 'string' }, description: 'resolve / reopen / remove 使用：批注 id 数组' },
          include_resolved: { type: 'boolean', description: 'list 可选：是否一并列出已解决的批注（默认 false）' },
          all: { type: 'boolean', description: 'remove 可选：清空全部批注（忽略 ids）' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    timeoutMs: 60_000,
    execute: withBackupNotice(canvasComments),
  },
]
