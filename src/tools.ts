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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_DEVICE, isDeviceType, resolveSize, type DeviceType } from './device.js'
import { designStyleExists, designStyleIds, designStyleSummary, injectDesign, loadDesignCatalog, resolveDesignStyle } from './design.js'
import { applyProjectStyle, currentStyleId, templateDocument } from './designOps.js'
import { runExport, type ExportFile, type ExportKind } from './export.js'
import { isSafeId, newPageId } from './ids.js'
import { formatLintReport, lintHtml } from './lint.js'
import { findBlockedResources } from './resources.js'
import {
  addEdge,
  autoLayoutPosition,
  duplicateNode,
  nextLayoutIndex,
  PROJECT_DIR_NAME,
  projectFile,
  projectIssue,
  readPageHtml,
  readProject,
  readSelection,
  removeEdge,
  removeNode,
  takeProjectBackup,
  upsertNode,
  writePageHtml,
  type PageNode,
  type Project,
  type Selection,
} from './project.js'
import { currentUrl, ensureServer } from './server.js'

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

/** 写入前若备份过有问题的项目文件，把备份路径告诉调用方（宿主只透传 content）。 */
function withBackupNotice(run: (call: ToolCall) => Promise<ToolResult>): (call: ToolCall) => Promise<ToolResult> {
  return async (call) => {
    const result = await run(call)
    const backup = takeProjectBackup(call.cwd)
    if (!backup) return result
    return { ...result, content: `${result.content}\n注意：project.json 曾损坏或含无效条目，覆盖前已备份到 ${backup}` }
  }
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
      `在用户拿到链接后，先确认设计风格（canvas_get_state 看「设计风格」段；若为「自由发挥」且用户没指定过风格，\n` +
      `用 canvas_style（action=list）把风格名作为选项问用户一次并等回答），再开始写原型。\n` +
      `工作区：${call.cwd}\n` +
      `项目文件：${projectFile(call.cwd)}\n` +
      `操作提示：空格+拖拽 或 中键拖拽 平移；Ctrl+滚轮 缩放；普通滚轮 平移。`,
  }
}

function writeUrlHint(cwd: string, url: string): void {
  try {
    writeFileSync(join(cwd, PROJECT_DIR_NAME, 'url.txt'), url + '\n', 'utf8')
  } catch {
    /* 目录可能尚未创建；忽略 */
  }
}

function openBrowser(url: string): void {
  try {
    const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
    // 命令不存在时走异步 error 事件，外层 try/catch 接不住，不监听会打垮宿主。
    child.on('error', (err) => {
      console.error(`[tianshu-canvas] 无法打开系统浏览器：${err.message}`)
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
      return { content: `读取失败：文件不存在 ${htmlPath}`, isError: true }
    }
    try {
      html = readFileSync(htmlPath, 'utf8')
    } catch (err) {
      return { content: `读取失败：${(err as Error).message}`, isError: true }
    }
  } else {
    html = str(args.html)
  }

  const requestedId = str(args.id)
  if (requestedId && !isSafeId(requestedId)) {
    return { content: `非法 id：${requestedId}（仅允许字母数字、下划线、连字符，1–64 位）`, isError: true }
  }

  const project = readProject(call.cwd)
  const existing = requestedId ? project.nodes.find((n) => n.id === requestedId) : undefined
  if (!html && !existing) {
    return {
      content:
        '缺少内容：请提供 html_path（工作区内的 HTML 文件）或 html（内联 HTML）。' +
        '仅更新已有页面的标题/位置/尺寸时，需传已存在的 id。',
      isError: true,
    }
  }
  const id = requestedId ?? newPageId()

  // 已存在的节点：未显式指定设备/尺寸时沿用原值，避免只改标题就把尺寸重置。
  const deviceProvided = isDeviceType(args.device_type)
  const deviceType: DeviceType = isDeviceType(args.device_type)
    ? args.device_type
    : (existing?.deviceType ?? DEFAULT_DEVICE)
  const base = existing && !deviceProvided ? { width: existing.width, height: existing.height } : resolveSize(deviceType)
  const size = {
    width: positive(num(args.width)) ?? base.width,
    height: positive(num(args.height)) ?? base.height,
  }

  let x = num(args.x)
  let y = num(args.y)
  if (x === undefined || y === undefined) {
    if (existing) {
      x = x ?? existing.x
      y = y ?? existing.y
    } else {
      const pos = autoLayoutPosition(call.cwd, nextLayoutIndex(call.cwd), size)
      x = x ?? pos.x
      y = y ?? pos.y
    }
  }

  // 设计系统是项目级锁定：写入时自动内联 token/组件样式并展开图标。
  const styleId = currentStyleId(call.cwd)
  const injection = html !== undefined ? injectDesign(html, styleId) : null
  const pageHtml = injection ? injection.html : html

  const rel = pageHtml !== undefined ? writePageHtml(call.cwd, id, pageHtml) : (existing?.htmlPath ?? '')
  const now = Date.now()
  const node: PageNode = {
    id,
    type: 'page',
    title: str(args.title) ?? existing?.title ?? id,
    x,
    y,
    width: size.width,
    height: size.height,
    deviceType,
    htmlPath: rel,
    htmlRev: pageHtml !== undefined ? now : existing?.htmlRev,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  upsertNode(call.cwd, node)

  // 确保画布服务在跑，这样返回里一定带可点击的画布 URL（用户能看到）。
  const { url } = await ensureServer(call.cwd)
  const blocked = pageHtml !== undefined ? findBlockedResources(pageHtml) : []
  const styleLine = injection
    ? injection.injected
      ? `\n已应用设计风格「${designStyleSummary(injection.styleId ?? '')?.name ?? injection.styleId}」（${injection.styleId}）：注入 token/组件样式${injection.usedIcons.length ? `，内联 ${injection.usedIcons.length} 个图标` : ''}。`
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
      (blocked.length
        ? `\n注意：画布 CSP 会拦截这些外链或相对路径资源，页面里将加载不到：${blocked.slice(0, 8).join('、')}${blocked.length > 8 ? ` 等 ${blocked.length} 处` : ''}。请改为内联（<style>、<script>、data: URI）或用 CSS/SVG 绘制。`
        : ''),
  }
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
    sections.push('设计风格：自由发挥（未锁定风格）。生成原型前先与用户确认风格；可用 canvas_style（action=list）给出选项。')
  } else {
    const summary = designStyleSummary(styleId)
    sections.push(
      summary
        ? `设计风格：${summary.name}（${styleId}，已锁定）。页面必须使用该风格的 --ts-* 变量与 ts-* 组件类。`
        : `设计风格：未知（${styleId}）；请重新用 canvas_style（action=set）设置。`,
    )
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

  if (selection) {
    sections.push(`当前选中：\n${formatSelection(selection, project).join('\n')}`)
  } else {
    sections.push(
      '当前画布没有选中项。\n' +
        '请在浏览器打开画布，点击某个页面节点（或按住 Ctrl 点击页面内的元素）后再试。',
    )
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
      const project = readProject(call.cwd)
      if (!project.nodes.some((n) => n.id === id)) return { content: `节点不存在：${id}`, isError: true }
      const next = removeNode(call.cwd, id)
      return { content: `已删除页面节点 ${id}（连带其连线与原型文件）。剩余 ${next.nodes.length} 个节点。` }
    }
    case 'duplicate': {
      const id = str(call.args.id)
      if (!id) return { content: 'duplicate 需要 id。', isError: true }
      try {
        const node = duplicateNode(call.cwd, id, str(call.args.title))
        const { url } = await ensureServer(call.cwd)
        return {
          content:
            `已复制页面节点，新 id=${node.id}，标题「${node.title}」。\n` +
            `位置：x=${node.x}, y=${node.y}\n画布 URL：${url}`,
        }
      } catch (err) {
        return { content: (err as Error).message, isError: true }
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
        return { content: (err as Error).message, isError: true }
      }
    }
    case 'unlink': {
      const source = str(call.args.source)
      const target = str(call.args.target)
      if (!source || !target) return { content: 'unlink 需要 source 和 target。', isError: true }
      const before = readProject(call.cwd).edges.length
      const next = removeEdge(call.cwd, source, target)
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
// canvas_export
// ---------------------------------------------------------------------------

async function canvasExport(call: ToolCall): Promise<ToolResult> {
  const kindRaw = str(call.args.kind)
  const kind: ExportKind = kindRaw === 'png' || kindRaw === 'zip' ? kindRaw : 'both'
  await ensureServer(call.cwd)
  let result: { files: ExportFile[]; pngError?: string }
  try {
    result = await runExport(call.cwd, kind)
  } catch (err) {
    return { content: `导出失败：${(err as Error).message}`, isError: true }
  }
  const lines: string[] = []
  for (const f of result.files) {
    lines.push(`${f.name}（${(f.bytes / 1024).toFixed(1)} KB）\n  路径：${f.path}`)
  }
  const url = currentUrl(call.cwd)
  const head = `已导出 ${result.files.length} 个文件：`
  const pngNote = result.pngError ? `\n注意：PNG 导出未完成——${result.pngError}` : ''
  const linkNote = url ? `\n画布 URL：${url}` : ''
  return { content: `${head}\n${lines.join('\n')}${pngNote}${linkNote}` }
}

// ---------------------------------------------------------------------------
// canvas_style（list / get / set / template）
// ---------------------------------------------------------------------------

function formatStyleList(cwd: string): string {
  let catalog
  try {
    catalog = loadDesignCatalog()
  } catch (err) {
    return (err as Error).message
  }
  if (catalog.styles.length === 0) return '当前构建不包含任何设计风格。'
  const current = currentStyleId(cwd)
  const lines = catalog.styles.map((s) => {
    const templates = s.templates.map((t) => t.name).join(' / ')
    return (
      `- ${s.name}（${s.id}）：${s.tagline}\n` +
      `  色板 ${s.swatches.join(' ')}；图标 ${s.counts.icons} 个、组件 ${s.counts.components} 个；模板 ${templates || '无'}`
    )
  })
  return (
    `${catalog.notice}\n\n可选设计风格（项目级锁定）：\n${lines.join('\n')}\n\n` +
    `当前：${current ? `已锁定 ${designStyleSummary(current)?.name ?? current}（${current}）` : '自由发挥（未锁定）'}\n` +
    `锁定/切换：canvas_style（action=set, style_id=<id>）；回到自由发挥：style_id=free。\n` +
    `用户没有指定风格时，把上面的风格名作为选项问用户一次（含「自由发挥」）。`
  )
}

function formatStyleBrief(styleId: string): string {
  const style = resolveDesignStyle(styleId)
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
    `模板：${Object.keys(style.templates).join(' / ')}\n` +
    `写法：颜色 var(--ts-color-*)；图标 <svg data-icon="名字" class="ts-icon"></svg>（写入时自动内联）。`
  )
}

async function canvasStyle(call: ToolCall): Promise<ToolResult> {
  const action = str(call.args.action) ?? 'list'
  try {
    if (action === 'list') return { content: formatStyleList(call.cwd) }

    if (action === 'get') {
      const styleId = str(call.args.style_id) ?? currentStyleId(call.cwd)
      if (!styleId || styleId === 'free') {
        return {
          content:
            '当前未锁定风格（自由发挥）。先用 canvas_style（action=list）查看可选风格，再用 action=set 锁定。',
        }
      }
      if (!designStyleExists(styleId)) return { content: `未知的设计风格：${styleId}`, isError: true }
      return { content: formatStyleBrief(styleId) }
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
          : `已锁定设计风格「${result.name}」（${styleId}）：重写 ${result.pagesUpdated} 个页面（画布会自动刷新）。\n画布 URL：${url}${missing}`,
      }
    }

    if (action === 'template') {
      const styleId = str(call.args.style_id) ?? currentStyleId(call.cwd)
      if (!styleId || styleId === 'free') {
        return { content: 'template 需要已锁定的风格，或显式传 style_id。', isError: true }
      }
      const templateId = str(call.args.template_id) ?? 'dashboard'
      const doc = templateDocument(styleId, templateId)
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

    return { content: `未知的 action：${action}。可选：list / get / set / template。`, isError: true }
  } catch (err) {
    return { content: (err as Error).message, isError: true }
  }
}

// ---------------------------------------------------------------------------
// canvas_check_style（只报告，不阻塞）
// ---------------------------------------------------------------------------

async function canvasCheckStyle(call: ToolCall): Promise<ToolResult> {
  const inlineHtml = str(call.args.html)
  const override = str(call.args.style_id)
  if (override && override !== 'free' && !designStyleExists(override)) {
    return { content: `未知的设计风格：${override}。可用 canvas_style（action=list）查看可选风格。`, isError: true }
  }
  const styleId = override === 'free' ? null : (override ?? currentStyleId(call.cwd))

  if (inlineHtml !== undefined) {
    const report = lintHtml(inlineHtml, styleId)
    return { content: formatLintReport(report, '直接检查传入的 HTML') }
  }

  const pageId = str(call.args.page_id)
  if (pageId) {
    const html = readPageHtml(call.cwd, pageId)
    if (html === null) return { content: `页面不存在：${pageId}`, isError: true }
    const report = lintHtml(html, styleId)
    return { content: formatLintReport(report, `页面 id=${pageId}`) }
  }

  const project = readProject(call.cwd)
  if (project.nodes.length === 0) return { content: '画布上没有页面可检查。' }
  const reports: string[] = []
  let total = 0
  for (const node of project.nodes) {
    const html = readPageHtml(call.cwd, node.id)
    if (html === null) continue
    const report = lintHtml(html, styleId)
    total += report.total
    if (report.total > 0) reports.push(formatLintReport(report, `页面「${node.title}」(id=${node.id})`))
  }
  if (reports.length === 0) {
    const name = styleId ? (designStyleSummary(styleId)?.name ?? styleId) : null
    return {
      content: `风格检查：${name ? `${name}（${styleId}）` : '未锁定风格'} · 全部 ${project.nodes.length} 个页面\n未发现不符合项（0 处）。`,
    }
  }
  return { content: `${reports.join('\n\n')}\n\n合计：${total} 处。` }
}

// ---------------------------------------------------------------------------
// 工具清单（名称必须与 tianshu.plugin.json 的 contributes.tools 完全一致）
// ---------------------------------------------------------------------------

export const tools: TpiTool[] = [
  {
    definition: {
      name: 'canvas_open',
      description:
        '启动/复用本工作区的本地画布服务，返回可在浏览器打开的 URL（127.0.0.1）。' +
        '**这是画布设计的第一步：先调用本工具把画布链接给用户，再开始生成原型。**',
      input_schema: {
        type: 'object',
        properties: {
          port: { type: 'integer', description: '可选首选端口；0=自动分配（默认 43117，被占用则递增）' },
          open: { type: 'boolean', description: '可选：尝试用系统默认浏览器打开（默认 false）' },
        },
        required: [],
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: canvasOpen,
  },
  {
    definition: {
      name: 'canvas_upsert_page',
      description:
        '新增或更新画布上的页面节点。优先传 html（内联）写入 HTML 原型（原型自动保存到 .tianshu-canvas/pages/，无需也不要在工作区另建文件夹），html_path 仅用于导入已有文件。原型必须自包含：外链（CDN、字体、图片）和相对路径都会被画布 CSP 拦截，资源请内联；' +
        '对已有 id 可省略 html，仅更新标题/位置/尺寸/设备（即重命名、移动、调整尺寸，未指定的字段保持原值）。' +
        '返回里会带上画布 URL（若画布服务尚未启动会自动启动）。',
      input_schema: {
        type: 'object',
        properties: {
          html_path: { type: 'string', description: '已有 HTML 文件路径（工作区内，优先于 html）；一般不要用，请直接用 html 内联，避免在工作区产生多余文件' },
          html: { type: 'string', description: '内联 HTML（推荐方式：原型只存放在 .tianshu-canvas/pages/，不要另建文件夹）；更新已有页面的元数据时可省略' },
          title: { type: 'string', description: '页面标题' },
          id: { type: 'string', description: '页面 id（字母数字/_/-）。缺省则新建并自动生成；传已存在的 id 则更新该页面' },
          x: { type: 'number', description: '画布 X 坐标（新建缺省按网格自动排布；更新缺省保持原位）' },
          y: { type: 'number', description: '画布 Y 坐标（新建缺省按网格自动排布；更新缺省保持原位）' },
          width: { type: 'number', description: '逻辑宽度 px（覆盖设备预设）' },
          height: { type: 'number', description: '逻辑高度 px（覆盖设备预设）' },
          device_type: {
            type: 'string',
            enum: ['desktop', 'tablet', 'mobile', 'free'],
            description: '设备预设（新建默认 desktop；更新缺省保持原设备与尺寸）',
          },
        },
        required: [],
      },
    },
    pathParams: { html_path: 'read' },
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: withBackupNotice(canvasUpsertPage),
  },
  {
    definition: {
      name: 'canvas_get_state',
      description:
        '读取画布当前状态：所有页面节点（id/标题/位置/尺寸/设备）、页面连线、' +
        '用户在画布上的选中项（整个页面或页面内元素，含 xpath/标签/文案/关键样式）以及画布 URL。' +
        '修改设计前先调用，据此定位用户指的是哪个页面/元素。',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: withBackupNotice(canvasGetState),
  },
  {
    definition: {
      name: 'canvas_arrange',
      description:
        '编排画布：按 action 删除页面（remove，连带其连线与原型文件）、复制页面（duplicate）、' +
        '在两个页面间连线（link）或取消连线（unlink）。重命名/移动请用 canvas_upsert_page。',
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
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: withBackupNotice(canvasArrange),
  },
  {
    definition: {
      name: 'canvas_export',
      description: '导出画布成果：整块画布截图 PNG 与/或原型打包 ZIP（含 index.html 画廊 + project.json）。',
      input_schema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['png', 'zip', 'both'], description: '导出类型（默认 both）' },
        },
        required: [],
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: canvasExport,
  },
  {
    definition: {
      name: 'canvas_style',
      description:
        '查看/锁定/切换项目级设计风格，或取一份页面模板 HTML。' +
        'action=list 列出全部可选风格与当前状态（用户没指定风格时据此提问）；get 查看某风格的 token/组件类/图标名；' +
        'set 锁定或切换风格（style_id=风格 id，free 表示解除锁定，会重写所有页面并刷新画布）；' +
        'template 取 dashboard/landing 模板的完整 HTML，可直接传给 canvas_upsert_page。',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'get', 'set', 'template'], description: 'list=列出风格；get=查看细节；set=锁定/切换；template=取模板' },
          style_id: {
            type: 'string',
            ...(designStyleIds().length ? { enum: [...designStyleIds(), 'free'] } : {}),
            description: '风格 id（set/get/template 使用）；free 表示解除锁定',
          },
          template_id: { type: 'string', description: 'action=template 时使用：模板 id（如 dashboard / landing）' },
        },
        required: ['action'],
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: withBackupNotice(canvasStyle),
  },
  {
    definition: {
      name: 'canvas_check_style',
      description:
        '只读检查页面是否符合当前设计风格（裸色值、非 token 字体、越界间距/圆角、目录外图标与组件类、未知变量、会被 CSP 拦截的资源）。' +
        '按 page_id 检查单页、省略则检查全部页面；也可用 html 直接检查一段未落盘的 HTML。只报告、不修改文件、不阻塞写入。',
      input_schema: {
        type: 'object',
        properties: {
          page_id: { type: 'string', description: '要检查的页面 id；省略则检查全部页面' },
          html: { type: 'string', description: '直接检查一段 HTML（优先于 page_id），用于写入前自查' },
          style_id: {
            type: 'string',
            ...(designStyleIds().length ? { enum: [...designStyleIds(), 'free'] } : {}),
            description: '覆盖当前锁定的风格；free 表示只检查资源引用',
          },
        },
        required: [],
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: canvasCheckStyle,
  },
]
