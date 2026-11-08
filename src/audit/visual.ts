/**
 * 视觉回归：逐页截图 → 与基线逐像素比较 → 偏离度评分。
 *
 * 复用 export.ts 的启动链路（spawn + DevToolsActivePort + puppeteer.connect）与串行队列，
 * 避免并发争抢浏览器；等待策略不用固定 sleep，而是字体 + iframe 双就绪。
 *
 * 基线目录可指定（baseline_dir），默认落在 .tianshu-canvas/audit/baseline —— 该目录被
 * gitignore 忽略，团队若要共享基线，需把 baseline_dir 指到仓库内可提交的位置。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser, resolveBrowser } from '../export.js'
import { assertInsideWorkspace, writeFileInWorkspace } from '../paths.js'
import { projectDir, readProject } from '../project.js'
import { ensureServer } from '../server.js'
import { decodePng, diffPng, type DiffResult } from './png.js'

export interface VisualBaseline {
  pageId: string
  title: string
  file: string
  bytes: number
}

export interface VisualCompare {
  pageId: string
  title: string
  baseline: string
  diff: DiffResult
}

export interface VisualResult {
  baselineDir: string
  /** baseline 动作：新写入的基线。 */
  written: VisualBaseline[]
  /** visual 动作：逐页比较结果。 */
  compared: VisualCompare[]
  /** 没有基线的页面（首次运行）。 */
  missing: string[]
}

/** 基线目录：默认 .tianshu-canvas/audit/baseline。 */
export function defaultBaselineDir(cwd: string): string {
  return join(projectDir(cwd), 'audit', 'baseline')
}

/** 基线文件名：<styleId>/<pageId>@<device>@2x.png。 */
export function baselineFile(dir: string, styleId: string, pageId: string, device: string): string {
  return join(dir, styleId || 'free', `${pageId}@${device}@2x.png`)
}

/**
 * 单页截图。通过画布 URL 的 `?page=<id>&export=1` 只渲染目标节点（见 web 端导出模式），
 * 无该能力时退化为整画布裁剪到节点矩形。
 */
async function capturePage(page: import('puppeteer-core').Page, canvasUrl: string, pageId: string): Promise<Buffer> {
  const url = new URL(canvasUrl)
  url.searchParams.set('page', pageId)
  url.searchParams.set('export', '1')
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.page-node', { timeout: 15000 })
  // 字体与 iframe 双就绪，替代固定 sleep。
  await page.evaluate(async () => {
    const doc = (globalThis as unknown as { document: any }).document
    if (doc.fonts?.ready) await doc.fonts.ready
    const frames = Array.from(doc.querySelectorAll('iframe')) as any[]
    await Promise.all(
      frames.map(
        (f: any) =>
          new Promise<void>((resolve) => {
            if (f.contentDocument?.readyState === 'complete') return resolve()
            f.addEventListener('load', () => resolve(), { once: true })
            setTimeout(resolve, 5000)
          }),
      ),
    )
  })
  const clip = await page.evaluate(() => {
    const doc = (globalThis as unknown as { document: any }).document
    const nodes = Array.from(doc.querySelectorAll('.page-node')) as any[]
    const target = nodes[0]
    if (!target) return null
    const header = target.querySelector('.page-node__header')
    const rects = [target.getBoundingClientRect(), ...(header ? [header.getBoundingClientRect()] : [])]
    const left = Math.min(...rects.map((r) => r.left))
    const top = Math.min(...rects.map((r) => r.top))
    const right = Math.max(...rects.map((r) => r.right))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    return { x: Math.max(0, left), y: Math.max(0, top), width: right - left, height: bottom - top }
  })
  const shot = await page.screenshot({ clip: clip ?? undefined })
  return Buffer.from(shot as Uint8Array)
}

/** 与 export 共用一条串行队列，避免并发启动浏览器。 */
let queue: Promise<unknown> = Promise.resolve()

async function withBrowser<T>(cwd: string, run: (page: import('puppeteer-core').Page, url: string) => Promise<T>): Promise<T> {
  const exe = resolveBrowser()
  if (!exe) throw new Error('未找到 Chrome/Edge，无法截图。请安装 Chrome/Edge，或用环境变量 TIANSHU_CANVAS_BROWSER 指定路径。')
  const { url } = await ensureServer(cwd)
  const { browser, dispose } = await launchBrowser(exe)
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 })
    return await run(page, url)
  } finally {
    await page.close().catch(() => {})
    await dispose()
  }
}

function runSerial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn)
  queue = next.catch(() => {})
  return next
}

/** 写基线（覆盖式）。 */
export function writeBaselines(cwd: string, styleId: string, dir: string): Promise<VisualResult> {
  return runSerial(async () => {
    const project = readProject(cwd)
    const written: VisualBaseline[] = []
    await withBrowser(cwd, async (page, url) => {
      for (const node of project.nodes) {
        const buf = await capturePage(page, url, node.id)
        const file = baselineFile(dir, styleId, node.id, node.deviceType)
        // 基线是隐式写入：走统一边界 + 独占随机临时文件。
        writeFileInWorkspace(cwd, file, buf, '视觉基线')
        written.push({ pageId: node.id, title: node.title, file, bytes: buf.length })
      }
    })
    return { baselineDir: dir, written, compared: [], missing: [] }
  })
}

/** 与基线比较。 */
export function compareWithBaselines(
  cwd: string,
  styleId: string,
  dir: string,
  options: { threshold?: number; updateMissing?: boolean } = {},
): Promise<VisualResult> {
  return runSerial(async () => {
    const project = readProject(cwd)
    const compared: VisualCompare[] = []
    const missing: string[] = []
    const written: VisualBaseline[] = []
    await withBrowser(cwd, async (page, url) => {
      for (const node of project.nodes) {
        const file = baselineFile(dir, styleId, node.id, node.deviceType)
        const buf = await capturePage(page, url, node.id)
        if (!existsSync(file)) {
          missing.push(`${node.title}（${node.id}）`)
          if (options.updateMissing) {
            writeFileInWorkspace(cwd, file, buf, '视觉基线')
            written.push({ pageId: node.id, title: node.title, file, bytes: buf.length })
          }
          continue
        }
        const plainBaseline = join(file, '..', `${node.id}@${node.deviceType}@2x.plain.png`)
        const readBaseline = (p: string): Buffer => {
          // 基线是工作区数据：读前按边界校验，指向工作区外的链接一律拒绝。
          assertInsideWorkspace(cwd, p, '视觉基线')
          return readFileSync(p)
        }
        if (existsSync(plainBaseline)) {
          const a = decodePng(readBaseline(plainBaseline))
          const b = decodePng(buf)
          compared.push({ pageId: node.id, title: node.title, baseline: plainBaseline, diff: diffPng(a, b, { threshold: options.threshold }) })
        } else {
          // 基线是直接截图产物，直接解码。
          const a = decodePng(readBaseline(file))
          const b = decodePng(buf)
          compared.push({ pageId: node.id, title: node.title, baseline: file, diff: diffPng(a, b, { threshold: options.threshold }) })
        }
      }
    })
    return { baselineDir: dir, written, compared, missing }
  })
}

export function formatVisualReport(result: VisualResult, withBaseline: boolean): string {
  if (withBaseline) {
    return `已写入 ${result.written.length} 张基线（${result.baselineDir}）：\n${result.written.map((b) => `  - ${b.title} → ${b.file}`).join('\n')}`
  }
  const lines = [`视觉回归（基线 ${result.baselineDir}）`]
  if (result.missing.length) lines.push(`缺少基线 ${result.missing.length} 页：${result.missing.join('、')}（可用 action=baseline 生成）`)
  for (const c of result.compared) {
    lines.push(`- ${c.title}：偏离度 ${((1 - c.diff.score) * 100).toFixed(2)}%（score ${c.diff.score}，变化 ${c.diff.changed}/${c.diff.total} 像素）`)
    if (c.diff.bbox) lines.push(`    变化区域 x=${c.diff.bbox.x} y=${c.diff.bbox.y} ${c.diff.bbox.width}×${c.diff.bbox.height}`)
  }
  if (result.compared.length === 0 && result.missing.length === 0) lines.push('没有可比较的页面。')
  return lines.join('\n')
}
