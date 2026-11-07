/**
 * 导出交付：画布截图 PNG（无头浏览器）与原型打包 ZIP（纯 Node）。
 *
 * PNG 依赖 puppeteer-core + 系统 Chrome/Edge（与 design 插件同款做法）。
 * ZIP 用 node:zlib 自写最小 zip，零依赖。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { Browser } from 'puppeteer-core'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { projectDir, readPageHtml, readProject } from './project.js'
import { assertInsideWorkspace, assertWritableTarget, writeFileAtomic } from './paths.js'
import { warnUser } from './host.js'
import { ensureServer } from './server.js'
import { resolveDesignStyle, stripDesign } from './design.js'
import { currentStyleId } from './designOps.js'
import { rewriteNavLinks } from './nav.js'
import { injectBeforeHeadClose, navHomeHtml, pageUsesInteractions, sharedLinkTags, type SiteAssets, type SitePage } from './site.js'

export type ExportKind = 'png' | 'zip' | 'both'

export interface ExportFile {
  name: string
  path: string
  bytes: number
}

const BROWSER_CANDIDATES = [
  process.env.TIANSHU_CANVAS_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p): p is string => typeof p === 'string' && p.length > 0)

export function resolveBrowser(): string | null {
  return BROWSER_CANDIDATES.find((p) => existsSync(p)) ?? null
}

export function exportsDir(cwd: string): string {
  return join(projectDir(cwd), 'exports')
}

function stamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

// PNG 导出串行排队：同一时刻只允许一个无头浏览器，避免并发启动互相争抢/残留。
let pngQueue: Promise<unknown> = Promise.resolve()

export function exportPng(cwd: string): Promise<ExportFile> {
  const run = pngQueue.then(() => exportPngOnce(cwd))
  pngQueue = run.catch(() => {})
  return run
}

/**
 * Chromium 启动参数。**保留浏览器进程沙箱**：截图与视觉回归会渲染可能含脚本的原型，
 * 关掉沙箱（`--no-sandbox`）等于让这些脚本拿到当前用户全部权限。
 *
 * 环境确实无法启动沙箱时（Linux 上缺 SUID helper 且内核禁止非特权 user namespace），
 * 由 `launchBrowser` 抛出明确错误并**停止**截图/视觉回归，而不是静默降级为无沙箱。
 * 仅在此类已知受限环境下才通过 `TIANSHU_CANVAS_ALLOW_NO_SANDBOX=1` 显式放开。
 */
const LAUNCH_ARGS = [
  '--remote-debugging-port=0',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--headless=new',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-background-networking',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-breakpad',
  '--disable-crash-reporter',
]

/** 沙箱相关启动失败的典型 stderr 片段。 */
const SANDBOX_FAILURE_PATTERN = /(?:No usable sandbox|Failed to move to new namespace|SUID sandbox helper|clone\(\)|Operation not permitted|namespace sandbox)/i

/** 是否显式允许在无法启动沙箱时降级（默认否）。 */
function sandboxOptOutAllowed(): boolean {
  return process.env.TIANSHU_CANVAS_ALLOW_NO_SANDBOX === '1'
}

/** 组装本次启动参数；默认保留沙箱。 */
export function launchArgsFor(): string[] {
  return sandboxOptOutAllowed() ? [...LAUNCH_ARGS, '--no-sandbox'] : [...LAUNCH_ARGS]
}

/** 浏览器程序本身无法启动（路径错误、不可执行），重试没有意义。 */
class BrowserSpawnError extends Error {}

/** 沙箱无法启动：必须明确失败，绝不静默降级。 */
class SandboxUnavailableError extends Error {}

/** 等待 DevToolsActivePort 出现并读出 `端口 + ws 路径`（Chromium 成功绑定调试端口后才会写此文件）。 */
async function readDevToolsEndpoint(userDataDir: string, proc: ChildProcess, timeoutMs: number): Promise<string> {
  const portFile = join(userDataDir, 'DevToolsActivePort')
  const deadline = Date.now() + timeoutMs
  let stderr = ''
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  let exitCode: number | null = null
  proc.once('exit', (code) => {
    exitCode = code
  })
  // 启动失败只触发 error、不触发 exit；不监听会变成未捕获异常打垮宿主。
  let spawnError: Error | null = null
  proc.on('error', (err) => {
    spawnError = err
  })
  while (Date.now() < deadline) {
    if (spawnError) throw new BrowserSpawnError(`无法启动浏览器 ${proc.spawnfile}：${(spawnError as Error).message}`)
    // 沙箱启动失败会让 Chromium 立刻退出；识别出来并给出可操作的错误，不做无沙箱重试。
    if (exitCode !== null) {
      if (SANDBOX_FAILURE_PATTERN.test(stderr)) {
        throw new SandboxUnavailableError(
          `Chromium 沙箱无法启动，已停止截图与视觉回归（不会以 --no-sandbox 降级）：${stderr.trim()}`,
        )
      }
      throw new Error(`浏览器进程已退出（exit code ${exitCode}）${stderr ? `：${stderr.trim()}` : ''}`)
    }
    if (existsSync(portFile)) {
      const lines = readFileSync(portFile, 'utf8').split('\n')
      const port = lines[0]?.trim()
      const wsPath = lines[1]?.trim()
      if (port && wsPath) return `ws://127.0.0.1:${port}${wsPath}`
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`等待浏览器调试端口超时（${timeoutMs}ms）${stderr ? `：${stderr.trim()}` : ''}`)
}

/** 强杀浏览器进程树（Windows 用 taskkill /T，其余平台用进程组）。 */
function killTree(proc: ChildProcess): void {
  if (proc.exitCode !== null || !proc.pid) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {
        /* 系统里没有 taskkill 时无法强杀，不影响后续清理 */
      })
    } else {
      process.kill(-proc.pid, 'SIGKILL')
    }
  } catch {
    /* 进程可能已自行退出 */
  }
}

/** 清理临时 profile：进程占用文件时重试若干次，最终失败则记日志而非静默吞掉。 */
function removeProfile(userDataDir: string): void {
  try {
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } catch (err) {
    warnUser(`临时 profile 未能删除：${userDataDir}（${(err as Error).message}）`)
  }
}

/** 清理陈旧的 tsc-png-* 临时目录（历史失败遗留），只动超过 2 小时的，避免误删正在使用的 profile。 */
function cleanStaleProfiles(): void {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000
  try {
    for (const entry of readdirSync(tmpdir())) {
      if (!entry.startsWith('tsc-png-')) continue
      const dir = join(tmpdir(), entry)
      try {
        if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 })
      } catch {
        /* 目录可能正被其它进程占用，跳过 */
      }
    }
  } catch {
    /* 读不到临时目录不影响导出 */
  }
}

/**
 * 启动无头浏览器：**自己 spawn Chromium，读 DevToolsActivePort 拿调试端点，再用 puppeteer.connect 接入**。
 *
 * 为什么不直接用 puppeteer.launch：它靠等 Chromium 往 stdout 打印 `DevTools listening on ws://…`
 * 来判断启动成功（@puppeteer/browsers launch.js 的 CDP_WEBSOCKET_ENDPOINT_REGEX）。在天枢宿主进程内
 * 该行拿不到，于是 Chromium 明明已启动（profile 里写下了 DevToolsActivePort）却抛出
 * `Failed to launch the browser process: Code: 0` 且 stderr 为空。
 * 走 DevToolsActivePort 则不依赖任何 stdout 文本。
 *
 * 每次尝试使用独立临时 profile，失败自动强杀进程树并清理，最多重试 3 次。
 */
export async function launchBrowser(exe: string): Promise<{ browser: Browser; dispose: () => Promise<void> }> {
  const puppeteer = (await import('puppeteer-core')).default
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const userDataDir = mkdtempSync(join(tmpdir(), 'tsc-png-'))
    const proc = spawn(exe, [...launchArgsFor(), `--user-data-dir=${userDataDir}`, 'about:blank'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    try {
      const wsEndpoint = await readDevToolsEndpoint(userDataDir, proc, 60000)
      const browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
        protocolTimeout: 120000,
        defaultViewport: null,
      })
      const dispose = async (): Promise<void> => {
        await Promise.race([browser.close().catch(() => {}), new Promise<void>((r) => setTimeout(r, 10000))])
        killTree(proc)
        await new Promise<void>((r) => setTimeout(r, 500))
        removeProfile(userDataDir)
      }
      return { browser, dispose }
    } catch (err) {
      lastErr = err
      killTree(proc)
      await new Promise<void>((r) => setTimeout(r, 500))
      removeProfile(userDataDir)
      // 路径错误 / 沙箱不可用重试没有意义。
      if (err instanceof BrowserSpawnError || err instanceof SandboxUnavailableError) break
      await new Promise<void>((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  throw lastErr
}

async function exportPngOnce(cwd: string): Promise<ExportFile> {
  const exe = resolveBrowser()
  if (!exe) {
    throw new Error(
      '未找到 Chrome/Edge，无法导出 PNG。请安装 Chrome/Edge，或用环境变量 TIANSHU_CANVAS_BROWSER 指定浏览器路径。',
    )
  }
  const { url } = await ensureServer(cwd)
  cleanStaleProfiles()
  const { browser, dispose } = await launchBrowser(exe)
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 })
    await page.goto(`${url}&export=1`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('.page-node', { timeout: 15000 })
    await new Promise((r) => setTimeout(r, 800))

    // 该回调在浏览器上下文执行（Node 侧无 DOM 类型，故用 any 访问）
    // 同时纳入标题栏矩形：标题栏悬于节点上方，只按 .page-node 裁剪会把它切掉。
    const clip = await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: any }).document
      const els = Array.from(doc.querySelectorAll('.page-node, .page-node__header')) as any[]
      if (!els.length) return null
      const rects = els.map((e) => e.getBoundingClientRect())
      const left = Math.min(...rects.map((r) => r.left))
      const top = Math.min(...rects.map((r) => r.top))
      const right = Math.max(...rects.map((r) => r.right))
      const bottom = Math.max(...rects.map((r) => r.bottom))
      const pad = 40
      return { x: left - pad, y: top - pad, width: right - left + pad * 2, height: bottom - top + pad * 2 }
    })

    const dir = exportsDir(cwd)
    // exports 目录可能在项目里被替换成指向外部目录的符号链接/目录联接。
    assertInsideWorkspace(cwd, dir, '导出目录')
    mkdirSync(dir, { recursive: true })
    const name = `canvas-${stamp()}.png`
    const path = join(dir, name)
    // 截图无法先写到临时文件再改名（Chromium 直接落盘），因此写入前拒一次叶子链接，
    // 避免跟随被预置的链接把 PNG 写到工作区外。
    assertWritableTarget(cwd, path, '截图导出目标')
    await page.screenshot({ path, clip: clip ?? undefined })
    return { name, path, bytes: readFileSync(path).length }
  } finally {
    await dispose()
  }
}

// ---------------------------------------------------------------------------
// ZIP（最小实现：crc32 + deflateRaw + 本地头/中央目录/EOCD）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  name: string
  data: Buffer
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const compressed = deflateRawSync(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBuf, compressed)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(compressed.length, 20)
    cd.writeUInt32LE(entry.data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBuf)

    offset += local.length + nameBuf.length + compressed.length
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, centralBuf, eocd])
}

function galleryHtml(cwd: string): string {
  const project = readProject(cwd)
  const cards = project.nodes
    .map(
      (n) =>
        `<section><h2>${escapeHtml(n.title)} <small>${n.width}×${n.height}</small></h2>` +
        `<iframe src="pages/${encodeURIComponent(n.id)}.html" style="width:${n.width}px;height:${n.height}px;max-width:100%;border:1.5px solid #2b2b2b;border-radius:12px 5px 14px 6px/6px 13px 5px 12px;background:#fffdf8"></iframe></section>`,
    )
    .join('\n')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>天枢画布设计 · 原型集</title>
<style>body{font-family:system-ui;margin:0;padding:24px;background:#faf7f0;color:#2b2b2b}
h1{font-size:20px;font-family:"Kaiti SC","STKaiti","KaiTi",system-ui}h2{font-size:15px;margin:0 0 8px;font-family:"Kaiti SC","STKaiti","KaiTi",system-ui}section{margin:0 0 32px}small{color:#6b6152;font-weight:400}
iframe{display:block}</style></head>
<body><h1>天枢画布设计 · 原型集（共 ${project.nodes.length} 页）</h1>
${cards || '<p>（无页面）</p>'}
</body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export async function exportZip(cwd: string): Promise<ExportFile> {
  const project = readProject(cwd)
  const pages: SitePage[] = project.nodes.map((n) => ({ id: n.id, title: n.title, html: '' }))

  // 共享样式：仅当项目锁定风格时产出（自由发挥则页面自带样式，不抽离）。
  const styleId = currentStyleId(cwd)
  const style = styleId && styleId !== 'free' ? resolveDesignStyle(cwd, styleId) : null
  const assets: SiteAssets = style
    ? { tokensCss: style.tokensCss, componentsCss: style.componentsCss }
    : {}

  let needsInteractions = false
  for (let i = 0; i < project.nodes.length; i++) {
    const node = project.nodes[i]!
    const raw = readPageHtml(cwd, node.id)
    if (raw === null) continue
    let html = style ? stripDesign(raw) : raw
    html = rewriteNavLinks(html, pages, '').html
    if (style && pageUsesInteractions(html)) {
      needsInteractions = true
    }
    pages[i]!.html = html
  }
  if (style && needsInteractions) {
    assets.interactionsCss = style.interactions.css
    assets.interactionsJs = style.interactions.js
  }

  const entries: ZipEntry[] = []
  for (const page of pages) {
    if (!page.html) continue
    const withAssets = style
      ? injectBeforeHeadClose(page.html, sharedLinkTags(assets, '../assets'))
      : page.html
    entries.push({ name: `pages/${page.id}.html`, data: Buffer.from(withAssets, 'utf8') })
  }
  if (style) {
    if (assets.tokensCss !== undefined) entries.push({ name: 'assets/tokens.css', data: Buffer.from(assets.tokensCss, 'utf8') })
    if (assets.componentsCss !== undefined) entries.push({ name: 'assets/components.css', data: Buffer.from(assets.componentsCss, 'utf8') })
    if (assets.interactionsCss !== undefined) entries.push({ name: 'assets/interactions.css', data: Buffer.from(assets.interactionsCss, 'utf8') })
    if (assets.interactionsJs !== undefined) entries.push({ name: 'assets/interactions.js', data: Buffer.from(assets.interactionsJs, 'utf8') })
  }
  entries.push({ name: 'project.json', data: Buffer.from(JSON.stringify(project, null, 2), 'utf8') })
  entries.push({ name: 'overview.html', data: Buffer.from(galleryHtml(cwd), 'utf8') })
  entries.push({
    name: 'index.html',
    data: Buffer.from(navHomeHtml(pages.filter((p) => p.html), { title: '天枢画布设计 · 站点', hasAssets: Boolean(style) }), 'utf8'),
  })

  const zip = buildZip(entries)
  const dir = exportsDir(cwd)
  assertInsideWorkspace(cwd, dir, '导出目录')
  mkdirSync(dir, { recursive: true })
  const name = `canvas-${stamp()}.zip`
  const path = join(dir, name)
  // 用独占临时文件 + rename 落盘：目标路径被预置成符号链接时不会写到外部。
  writeFileAtomic(cwd, path, zip)
  return { name, path, bytes: zip.length }
}

// ---------------------------------------------------------------------------

export async function runExport(cwd: string, kind: ExportKind): Promise<{ files: ExportFile[]; pngError?: string }> {
  const files: ExportFile[] = []
  let pngError: string | undefined
  if (kind === 'png' || kind === 'both') {
    try {
      files.push(await exportPng(cwd))
    } catch (err) {
      pngError = (err as Error).message
    }
  }
  if (kind === 'zip' || kind === 'both') {
    files.push(await exportZip(cwd))
  }
  return { files, pngError }
}
