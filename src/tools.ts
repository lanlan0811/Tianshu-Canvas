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
  autoLayoutPosition,
  nextLayoutIndex,
  PROJECT_DIR_NAME,
  projectFile,
  readProject,
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

  const url = currentUrl(call.cwd)
  return {
    content:
      `${existing ? '已更新' : '已添加'}页面节点 "${node.title}"（id=${id}）。\n` +
      `位置：x=${node.x}, y=${node.y}；尺寸：${node.width}×${node.height}（${deviceType}）\n` +
      `原型文件：${join(call.cwd, rel)}\n` +
      (url ? `画布 URL：${url}` : `提示：先调用 canvas_open 获取画布 URL。`) +
      `\n项目：${projectHint(call.cwd)}`,
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
// 工具清单（名称必须与 tianshu.plugin.json 的 contributes.tools 完全一致）
// ---------------------------------------------------------------------------

export const tools: TpiTool[] = [
  {
    definition: {
      name: 'canvas_open',
      description: '启动/复用本工作区的本地画布服务，返回可在浏览器打开的 URL（127.0.0.1）。',
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
      description: '把一段 HTML 原型作为页面节点加入画布（可用 html_path 读文件，或直接给 html）。可指定标题/位置/尺寸/设备。',
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
]
