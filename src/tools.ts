/**
 * 工具实现。与宿主解耦：只依赖 node 内置模块，可脱离天枢直接单测。
 *
 * execute 收到宿主传入的 { args, cwd, sessionId }（cwd = 会话工作区根）。
 * 返回值约定：{ content: string, isError?: boolean } —— 宿主只透传这两个字段，
 * 其它字段一律丢弃，因此 URL / id / 路径都必须写进 content 文本。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_DEVICE, isDeviceType, resolveSize, type DeviceType } from './device.js'
import { isSafeId, newPageId } from './ids.js'
import {
  addEdge,
  autoLayoutPosition,
  duplicateNode,
  moveNode,
  nextLayoutIndex,
  PROJECT_DIR_NAME,
  projectFile,
  readProject,
  readSelection,
  removeEdge,
  removeNode,
  renameNode,
  upsertNode,
  writePageHtml,
  type PageNode,
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
      `画布服务已就绪。\n` +
      `画布 URL：${url}\n` +
      `在浏览器打开上面的 URL 即可看到无限画布。\n` +
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
    child.unref()
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// canvas_add_page
// ---------------------------------------------------------------------------

async function canvasAddPage(call: ToolCall): Promise<ToolResult> {
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
  if (!html) {
    return { content: '缺少内容：请提供 html_path（工作区内的 HTML 文件）或 html（内联 HTML）。', isError: true }
  }

  const requestedId = str(args.id)
  if (requestedId && !isSafeId(requestedId)) {
    return { content: `非法 id：${requestedId}（仅允许字母数字、下划线、连字符，1–64 位）`, isError: true }
  }
  const id = requestedId ?? newPageId()

  const deviceType: DeviceType = isDeviceType(args.device_type) ? args.device_type : DEFAULT_DEVICE
  const size = resolveSize(deviceType, num(args.width), num(args.height))

  const project = readProject(call.cwd)
  const existing = project.nodes.find((n) => n.id === id)

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

  const rel = writePageHtml(call.cwd, id, html)
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
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  upsertNode(call.cwd, node)

  // 确保画布服务在跑，这样返回里一定带可点击的画布 URL（用户能看到）。
  const { url } = await ensureServer(call.cwd)
  return {
    content:
      `${existing ? '已更新' : '已添加'}页面节点 "${node.title}"（id=${id}）。\n` +
      `位置：x=${node.x}, y=${node.y}；尺寸：${node.width}×${node.height}（${deviceType}）\n` +
      `原型文件：${join(call.cwd, rel)}\n` +
      `画布 URL：${url}\n` +
      `项目：${projectHint(call.cwd)}`,
  }
}

// ---------------------------------------------------------------------------
// canvas_list_pages
// ---------------------------------------------------------------------------

async function canvasListPages(call: ToolCall): Promise<ToolResult> {
  const project = readProject(call.cwd)
  const url = currentUrl(call.cwd)
  if (project.nodes.length === 0) {
    return {
      content:
        `画布上暂无页面节点。\n` +
        `用 canvas_add_page 添加一个 HTML 原型。\n` +
        (url ? `画布 URL：${url}` : `提示：先调用 canvas_open 获取画布 URL。`),
    }
  }
  const lines = project.nodes.map((n, i) => {
    return (
      `${i + 1}. ${n.title} (id=${n.id})\n` +
      `   位置 x=${n.x}, y=${n.y}；尺寸 ${n.width}×${n.height}（${n.deviceType}）`
    )
  })
  return {
    content:
      `画布上有 ${project.nodes.length} 个页面节点：\n` +
      lines.join('\n') +
      `\n` +
      (url ? `画布 URL：${url}` : `提示：先调用 canvas_open 获取画布 URL。`),
  }
}

// ---------------------------------------------------------------------------
// canvas_get_selection
// ---------------------------------------------------------------------------

async function canvasGetSelection(call: ToolCall): Promise<ToolResult> {
  const selection = readSelection(call.cwd)
  if (!selection) {
    return {
      content:
        '当前画布没有选中项。\n' +
        '请在浏览器打开画布，点击某个页面节点（或按住 Ctrl 点击页面内的元素）后再试。',
    }
  }
  const project = readProject(call.cwd)
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
  return { content: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// 画布编排工具
// ---------------------------------------------------------------------------

async function canvasRemovePage(call: ToolCall): Promise<ToolResult> {
  const id = str(call.args.id)
  if (!id) return { content: '缺少 id。', isError: true }
  const project = readProject(call.cwd)
  if (!project.nodes.some((n) => n.id === id)) return { content: `节点不存在：${id}`, isError: true }
  const next = removeNode(call.cwd, id)
  return { content: `已删除页面节点 ${id}。剩余 ${next.nodes.length} 个节点。` }
}

async function canvasRenamePage(call: ToolCall): Promise<ToolResult> {
  const id = str(call.args.id)
  const title = str(call.args.title)
  if (!id || !title) return { content: '缺少 id 或 title。', isError: true }
  try {
    renameNode(call.cwd, id, title)
    return { content: `已把节点 ${id} 重命名为「${title}」。` }
  } catch (err) {
    return { content: (err as Error).message, isError: true }
  }
}

async function canvasDuplicatePage(call: ToolCall): Promise<ToolResult> {
  const id = str(call.args.id)
  if (!id) return { content: '缺少 id。', isError: true }
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

async function canvasMovePage(call: ToolCall): Promise<ToolResult> {
  const id = str(call.args.id)
  const x = num(call.args.x)
  const y = num(call.args.y)
  if (!id || x === undefined || y === undefined) return { content: '缺少 id / x / y。', isError: true }
  try {
    moveNode(call.cwd, id, x, y)
    return { content: `已把节点 ${id} 移动到 x=${x}, y=${y}。` }
  } catch (err) {
    return { content: (err as Error).message, isError: true }
  }
}

async function canvasLinkPages(call: ToolCall): Promise<ToolResult> {
  const source = str(call.args.source)
  const target = str(call.args.target)
  if (!source || !target) return { content: '缺少 source 或 target。', isError: true }
  if (call.args.remove === true) {
    removeEdge(call.cwd, source, target)
    return { content: `已取消连线 ${source} → ${target}。` }
  }
  const edge = addEdge(call.cwd, source, target, str(call.args.label))
  return { content: `已连线 ${edge.source} → ${edge.target}${edge.label ? `（${edge.label}）` : ''}。` }
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
      name: 'canvas_add_page',
      description:
        '把一段 HTML 原型作为页面节点加入画布（可用 html_path 读文件，或直接给 html）。可指定标题/位置/尺寸/设备。' +
        '返回里会带上画布 URL（若画布服务尚未启动会自动启动）。',
      input_schema: {
        type: 'object',
        properties: {
          html_path: { type: 'string', description: '原型 HTML 文件路径（工作区内，优先于 html）' },
          html: { type: 'string', description: '内联 HTML（当没有 html_path 时使用）' },
          title: { type: 'string', description: '页面标题' },
          id: { type: 'string', description: '可选页面 id（字母数字/_/-，缺省自动生成）' },
          x: { type: 'number', description: '画布 X 坐标（缺省按网格自动排布）' },
          y: { type: 'number', description: '画布 Y 坐标（缺省按网格自动排布）' },
          width: { type: 'number', description: '逻辑宽度 px（覆盖设备预设）' },
          height: { type: 'number', description: '逻辑高度 px（覆盖设备预设）' },
          device_type: {
            type: 'string',
            enum: ['desktop', 'tablet', 'mobile', 'free'],
            description: '设备预设（默认 desktop）',
          },
        },
        required: [],
      },
    },
    pathParams: { html_path: 'read' },
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: canvasAddPage,
  },
  {
    definition: {
      name: 'canvas_list_pages',
      description: '列出画布上已有的页面节点（id/标题/位置/尺寸/设备）。',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: canvasListPages,
  },
  {
    definition: {
      name: 'canvas_get_selection',
      description: '读取用户在画布上的当前选中项（整个页面节点或页面内元素，含 xpath/标签/文案/关键样式），用于据此修改设计。',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: canvasGetSelection,
  },
  {
    definition: {
      name: 'canvas_remove_page',
      description: '从画布删除一个页面节点（连带其连线与原型文件）。',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string', description: '页面节点 id' } },
        required: ['id'],
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: canvasRemovePage,
  },
  {
    definition: {
      name: 'canvas_rename_page',
      description: '重命名画布上的页面节点。',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '页面节点 id' },
          title: { type: 'string', description: '新标题' },
        },
        required: ['id', 'title'],
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: canvasRenamePage,
  },
  {
    definition: {
      name: 'canvas_duplicate_page',
      description: '复制画布上的页面节点（含原型 HTML，偏移 40px）。',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '源页面节点 id' },
          title: { type: 'string', description: '可选新标题（默认「原标题 副本」）' },
        },
        required: ['id'],
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: canvasDuplicatePage,
  },
  {
    definition: {
      name: 'canvas_move_page',
      description: '移动画布上的页面节点到指定坐标。',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '页面节点 id' },
          x: { type: 'number', description: 'X 坐标' },
          y: { type: 'number', description: 'Y 坐标' },
        },
        required: ['id', 'x', 'y'],
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: canvasMovePage,
  },
  {
    definition: {
      name: 'canvas_link_pages',
      description: '在两个页面节点之间连线（页面流程），或取消连线。',
      input_schema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '源页面 id' },
          target: { type: 'string', description: '目标页面 id' },
          label: { type: 'string', description: '可选连线标签' },
          remove: { type: 'boolean', description: '为 true 时取消连线' },
        },
        required: ['source', 'target'],
      },
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: canvasLinkPages,
  },
]
