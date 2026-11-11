/** Objective rendered review. Screenshots are evidence for human visual judgement, never an aesthetic score. */
import { createHash, randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import type { CDPSession, Frame, Page } from 'puppeteer-core'
import { launchBrowser, resolveBrowser } from '../export.js'
import { assertSafeId, InvalidInputError } from '../ids.js'
import { assertInsideWorkspace, writeFileInWorkspace } from '../paths.js'
import { projectDir, readPageHtml, readProject } from '../project.js'
import { ensureServer } from '../server.js'
import { decodePng } from './png.js'

export interface ReviewIssue {
  rule: string
  severity: 'error' | 'warning' | 'info'
  message: string
  selectors?: string[]
}
export interface ReviewMetrics {
  viewportWidth: number
  viewportHeight: number
  contentWidth: number
  contentHeight: number
  elements: number
  headings: number
  controls: number
  fontStatus: string
  reducedMotion: boolean
  isolatedOrigin: boolean
  internalScrollRegions: number
}
export interface ReviewCapture {
  width: number
  height: number
  path: string
  bytes: number
  captureMode: 'viewport' | 'stitched-scroll'
  capturedHeight: number
  metrics: ReviewMetrics
  issues: ReviewIssue[]
}
export interface PageReviewResult {
  pageId: string
  title: string
  outputDir: string
  reportFile: string
  sourceSha256: string
  capturedAt: string
  captures: ReviewCapture[]
  visualAssessment: 'requires-human-review'
  limitations: string[]
}
export interface PageReviewOptions { outputDir?: string }

const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }] as const
const MAX_HEIGHT = 16000
let reviewQueue: Promise<unknown> = Promise.resolve()

/** Validate before launching a browser or creating output. Explicit output paths are also workspace-confined. */
export function reviewPage(cwd: string, pageId: string, options: PageReviewOptions = {}): Promise<PageReviewResult> {
  const run = reviewQueue.then(() => reviewOnce(cwd, pageId, options))
  reviewQueue = run.catch(() => {})
  return run
}

async function reviewOnce(cwd: string, pageId: string, options: PageReviewOptions): Promise<PageReviewResult> {
  assertSafeId(pageId)
  const node = readProject(cwd).nodes.find((item) => item.id === pageId)
  if (!node) throw new InvalidInputError('页面不存在：' + pageId)
  const originalHtml = readPageHtml(cwd, pageId)
  if (originalHtml === null) throw new InvalidInputError('页面 HTML 不存在：' + pageId)
  const sourceSha256 = createHash('sha256').update(originalHtml).digest('hex')
  if (options.outputDir !== undefined && (typeof options.outputDir !== 'string' || !options.outputDir.trim())) {
    throw new InvalidInputError('outputDir 必须是非空路径。')
  }
  const base = resolve(cwd, options.outputDir ?? join(projectDir(cwd), 'audit', 'review'))
  assertInsideWorkspace(cwd, base, '审阅输出目录')
  const outputDir = join(base, pageId + '-' + Date.now() + '-' + randomBytes(6).toString('hex'))
  assertInsideWorkspace(cwd, outputDir, '审阅输出目录')
  const exe = resolveBrowser()
  if (!exe) throw new Error('未找到 Chrome/Edge，无法生成审阅截图；正式验收不能跳过浏览器。')
  const { url } = await ensureServer(cwd)
  const { browser, dispose } = await launchBrowser(exe)
  const captures: ReviewCapture[] = []
  try {
    for (const viewport of VIEWPORTS) {
      if (readPageHtml(cwd, pageId) !== originalHtml) throw new Error('审阅期间页面内容已变化，请对最新版本重新审阅。')
      const page = await browser.newPage()
      let mediaSession: CDPSession | undefined
      try {
        await page.setViewport({ ...viewport, deviceScaleFactor: 1 })
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
        const errors: string[] = []
        const network = new Set<string>()
        const violations = new Set<string>()
        const origin = new URL(url).origin
        await page.setRequestInterception(true)
        page.on('request', (request) => {
          let allowed = false
          try { allowed = ['data:', 'blob:', 'about:'].includes(new URL(request.url()).protocol) || new URL(request.url()).origin === origin } catch { /* reject unknown protocols */ }
          if (allowed) void request.continue().catch(() => {})
          else {
            // Do not expose arbitrary query strings or credentials from untrusted page URLs in a report.
            if (network.size < 30) {
              try { network.add(new URL(request.url()).origin) } catch { network.add('unrecognized-resource') }
            }
            void request.abort('blockedbyclient').catch(() => {})
          }
        })
        page.on('pageerror', (error) => { if (errors.length < 30) errors.push(String(error).slice(0, 500)) })
        await page.evaluateOnNewDocument(() => {
          const w = globalThis as any
          const failures: string[] = []
          Object.defineProperty(w, '__tianshuReviewErrors', { value: failures, writable: false, configurable: false })
          w.addEventListener('error', (event: any) => { if (failures.length < 30) failures.push(String(event.message ?? 'script error').slice(0, 500)) })
          w.addEventListener('unhandledrejection', (event: any) => { if (failures.length < 30) failures.push(String(event.reason?.message ?? event.reason ?? 'unhandled rejection').slice(0, 500)) })
        })
        page.on('console', (message) => {
          if (violations.size < 30 && message.type() === 'error' && /Content Security Policy|violates|Refused to/i.test(message.text())) violations.add(message.text().slice(0, 350))
        })
        const frame = await openReviewFrame(page, url, pageId, viewport)
        // Opaque sandbox frames may be out-of-process and do not inherit the
        // parent page's emulation state on all Chromium versions.
        const frameTarget = browser.targets().find((target) => target.url() === frame.url())
        mediaSession = frameTarget ? await frameTarget.createCDPSession() : await page.createCDPSession()
        await mediaSession.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
        await frame.evaluate(async () => {
          const w = globalThis as any
          await Promise.race([w.document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 5000))])
          await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)))
        })
        const evidence = await collectEvidence(frame)
        if (!evidence.metrics.isolatedOrigin) throw new Error('审阅 iframe 未隔离来源，已停止截图。')
        const issues: ReviewIssue[] = evidence.issues
        if (evidence.metrics.contentHeight > MAX_HEIGHT) issues.push({ rule: 'capture-limit', severity: 'warning', message: '页面超过 16000px，截图仅覆盖前 16000px；不能据此认定整页已审阅。' })
        const shot = await captureScroll(page, frame, viewport.width, viewport.height, Math.min(MAX_HEIGHT, Math.max(viewport.height, evidence.metrics.contentHeight)))
        errors.push(...await frame.evaluate(() => {
          const entries = (globalThis as any).__tianshuReviewErrors
          return Array.isArray(entries) ? entries.slice(0, 30).map((entry: unknown) => String(entry).slice(0, 500)) : []
        }))
        if (errors.length) issues.push({ rule: 'script-error', severity: 'error', message: errors.join('\n') })
        if (network.size) issues.push({ rule: 'external-resource', severity: 'error', message: '页面尝试访问外部资源，已阻止：' + [...network].join('、') })
        if (violations.size) issues.push({ rule: 'csp-blocked-resource', severity: 'warning', message: [...violations].join('\n') })
        const file = join(outputDir, pageId + '-' + viewport.width + '.png')
        assertInsideWorkspace(cwd, file, '审阅截图')
        writeFileInWorkspace(cwd, file, shot.buffer, '审阅截图')
        captures.push({ ...viewport, path: file, bytes: shot.buffer.length, captureMode: shot.height > viewport.height ? 'stitched-scroll' : 'viewport', capturedHeight: shot.height, metrics: evidence.metrics, issues })
      } finally {
        await mediaSession?.detach().catch(() => {})
        await page.close().catch(() => {})
      }
    }
  } finally { await dispose() }
  const reportFile = join(outputDir, 'review.json')
  const result: PageReviewResult = {
    pageId, title: node.title, outputDir, reportFile, captures, sourceSha256, capturedAt: new Date().toISOString(),
    visualAssessment: 'requires-human-review',
    limitations: [
      '客观几何与资源检查不判断品牌契合、构图质量或审美高下，需宿主读图或项目所有者评审。',
      '截图按固定设备视口滚动拼接并核验重叠像素；固定/粘性元素或动态效果可能使校验失败。内部滚动区域仅展示其当前状态。',
      '已启用减少动态效果；不会点击提交、改变保存内容，也不代表全部交互状态已验收。',
      '字体 ready 只能确认加载结束，不能证明每种中文字体都存在；裁切为候选警告，需结合截图核实。',
      '页面脚本可捕获自己的异常；本轮无异常记录不代表脚本已完成安全审计。',
    ],
  }
  if (readPageHtml(cwd, pageId) !== originalHtml) throw new Error('审阅期间页面内容已变化，请对最新版本重新审阅。')
  assertInsideWorkspace(cwd, reportFile, '审阅报告')
  writeFileInWorkspace(cwd, reportFile, JSON.stringify(result, null, 2) + '\n', '审阅报告')
  return result
}

async function openReviewFrame(page: Page, canvasUrl: string, pageId: string, viewport: { width: number; height: number }): Promise<Frame> {
  const url = new URL(canvasUrl)
  url.searchParams.set('page', pageId)
  url.searchParams.set('export', '1')
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.page-node__iframe', { timeout: 15000 })
  const src = new URL('page/' + encodeURIComponent(pageId), new URL('.', url))
  src.searchParams.set('ws', url.searchParams.get('ws') ?? '')
  src.searchParams.set('preview', '1')
  // Authentication is bootstrapped by the real canvas shell. The reviewed document keeps
  // its opaque origin, strict response CSP, and preview probe, exactly like the product preview.
  await page.evaluate(({ source, width, height }) => {
    const d = (globalThis as any).document
    const frame = d.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('title', '页面审阅')
    frame.setAttribute('data-review-frame', 'true')
    frame.style.cssText = 'display:block;border:0;width:' + width + 'px;height:' + height + 'px;'
    d.documentElement.style.cssText = 'margin:0;padding:0;overflow:hidden;background:white;'
    d.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:white;'
    d.body.replaceChildren(frame)
    frame.src = source
  }, { source: src.toString(), ...viewport })
  // Do not retain the iframe's initial about:blank Frame across an opaque-origin
  // process swap. Resolve the committed frame by URL, then bind it back to the
  // exact DOM iframe that was created above; another canvas iframe is not proof.
  const deadline = Date.now() + 15000
  const remaining = (): number => Math.max(1, deadline - Date.now())
  const frame = await page.waitForFrame((candidate) => candidate.parentFrame() === page.mainFrame() && candidate.url() === src.toString(), { timeout: remaining() })
  const owner = await frame.frameElement()
  if (!owner) throw new Error('审阅 iframe 的页面容器已失效。')
  try {
    if (!await owner.evaluate((element) => element.matches('iframe[data-review-frame="true"]') && element.isConnected)) {
      throw new Error('审阅 iframe 与指定的页面容器不匹配。')
    }
  } finally { await owner.dispose() }
  await frame.waitForFunction((source) => {
    const w = globalThis as any
    return w.location.href === source && w.document.readyState === 'complete'
  }, { timeout: remaining() }, src.toString())
  if (frame.url() !== src.toString()) throw new Error('审阅页面未加载到指定的工作区页面。')
  return frame
}

async function collectEvidence(frame: Frame): Promise<{ metrics: ReviewMetrics; issues: ReviewIssue[] }> {
  return frame.evaluate(() => {
    const w = globalThis as any
    const d = w.document
    const root = d.documentElement
    const body = d.body
    const all = Array.from(d.querySelectorAll('body *')) as any[]
    const visible = (e: any): boolean => {
      const r = e.getBoundingClientRect()
      const s = w.getComputedStyle(e)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' && !e.closest('[hidden],[aria-hidden="true"]')
    }
    const elements = all.filter(visible)
    const path = (e: any): string => e.tagName.toLowerCase() + (e.id ? '#' + String(e.id).slice(0, 70) : '') + (e.classList?.length ? '.' + Array.from(e.classList).slice(0, 2).join('.') : '')
    const issues: ReviewIssue[] = []
    const contentWidth = Math.max(root.scrollWidth, body?.scrollWidth ?? 0)
    if (contentWidth > w.innerWidth + 2) issues.push({ rule: 'horizontal-overflow', severity: 'error', message: '文档宽度 ' + contentWidth + 'px 超出视口 ' + w.innerWidth + 'px。', selectors: elements.filter((e: any) => e.getBoundingClientRect().right > w.innerWidth + 2).slice(0, 12).map(path) })
    const clipped = elements.filter((e: any) => {
      if (!e.textContent?.trim() || e.children.length) return false
      const s = w.getComputedStyle(e)
      return ((['hidden', 'clip'].includes(s.overflowX) && e.scrollWidth > e.clientWidth + 2) || (['hidden', 'clip'].includes(s.overflowY) && e.scrollHeight > e.clientHeight + 2))
    })
    if (clipped.length) issues.push({ rule: 'text-clipping-candidate', severity: 'warning', message: '发现可能的文字裁切；省略号或折叠容器可能是有意设计，请据图核实。', selectors: clipped.slice(0, 15).map(path) })
    const broken = elements.filter((e: any) => e.tagName === 'IMG' && e.complete && e.naturalWidth === 0)
    if (broken.length) issues.push({ rule: 'broken-image', severity: 'error', message: '图片加载失败。', selectors: broken.slice(0, 15).map(path) })
    const controls = elements.filter((e: any) => e.matches('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[tabindex]') && !e.disabled)
    const unreachable = controls.filter((e: any) => e.tabIndex < 0 && !e.closest('[role="tablist"],[role="menu"],[role="listbox"],[data-ts-tabs]'))
    if (unreachable.length) issues.push({ rule: 'keyboard-unreachable-candidate', severity: 'warning', message: '这些可操作元素未进入顺序键盘焦点；自定义方向键组件需另行核实。', selectors: unreachable.slice(0, 15).map(path) })
    const unlabelled = controls.filter((e: any) => {
      const ids = (e.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
      return !(e.getAttribute('aria-label') || ids.map((id: string) => d.getElementById(id)?.textContent ?? '').join('').trim() || e.textContent?.trim() || e.getAttribute('title') || e.getAttribute('alt') || ['submit','reset','button'].includes(e.type) && e.value || e.labels?.length)
    })
    if (unlabelled.length) issues.push({ rule: 'control-name', severity: 'error', message: '可操作元素缺少可访问名称。', selectors: unlabelled.slice(0, 15).map(path) })
    if (!elements.some((e: any) => e.tagName === 'H1')) issues.push({ rule: 'heading-h1', severity: 'warning', message: '未发现可见一级标题；应用界面可按任务核实。' })
    const internalScrollRegions = elements.filter((e: any) => {
      const s = w.getComputedStyle(e)
      return ['auto','scroll'].includes(s.overflowY) && e.scrollHeight > e.clientHeight + 2
    }).length
    let isolatedOrigin = false
    try { void w.parent.document.body } catch { isolatedOrigin = w.parent !== w }
    return {
      metrics: { viewportWidth: w.innerWidth, viewportHeight: w.innerHeight, contentWidth, contentHeight: Math.max(root.scrollHeight, body?.scrollHeight ?? 0), elements: elements.length, headings: elements.filter((e: any) => /^H[1-6]$/.test(e.tagName)).length, controls: controls.length, fontStatus: d.fonts?.status ?? 'unavailable', reducedMotion: w.matchMedia('(prefers-reduced-motion: reduce)').matches, isolatedOrigin, internalScrollRegions },
      issues,
    }
  })
}

async function captureScroll(page: Page, frame: Frame, width: number, viewportHeight: number, height: number): Promise<{ buffer: Buffer; height: number }> {
  const stride = width * 3
  const pixels = Buffer.alloc(stride * height, 255)
  for (let y = 0; y < height;) {
    const actualY = await frame.evaluate(async (target) => {
      const w = globalThis as any
      w.scrollTo({ top: target, left: 0, behavior: 'instant' })
      await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)))
      return Math.round(w.scrollY)
    }, y === 0 ? 0 : Math.max(0, y - 64))
    let image: ReturnType<typeof decodePng> | undefined
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = decodePng(Buffer.from(await page.screenshot({ type: 'png', fromSurface: true })))
      if (candidate.width !== width || candidate.height !== viewportHeight) throw new Error('审阅截图视口不一致。')
      // DOM scrollY can advance before Chromium composites an opaque iframe.
      // Each tile must agree with already captured overlap pixels before its
      // new rows are trusted, rejecting mismatched stale compositor frames.
      const overlap = Math.min(y - actualY, viewportHeight)
      let mismatches = 0
      let samples = 0
      if (y > 0 && overlap <= 0) throw new Error('审阅截图缺少滚动重叠证据，已停止拼接。')
      for (let row = 3; row < overlap - 2; row += 3) {
        const destinationY = actualY + row
        if (destinationY < 0 || destinationY >= y) continue
        for (let x = 8; x < width - 8; x += 13) {
          const from = (row * width + x) * candidate.channels
          const to = destinationY * stride + x * 3
          samples++
          if (Math.abs(candidate.data[from]! - pixels[to]!) > 12 || Math.abs(candidate.data[from + (candidate.channels >= 3 ? 1 : 0)]! - pixels[to + 1]!) > 12 || Math.abs(candidate.data[from + (candidate.channels >= 3 ? 2 : 0)]! - pixels[to + 2]!) > 12) mismatches++
        }
      }
      if (y === 0 || samples > 0 && mismatches / samples <= 0.02) { image = candidate; break }
      await page.bringToFront()
      await frame.evaluate(async () => {
        const w = globalThis as any
        await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(() => w.requestAnimationFrame(r))))
      })
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
    }
    if (!image) throw new Error('页面滚动后的像素重叠不一致，可能为未完成的合成、固定元素或动画；已停止，不能把重复拼接图当完整截图。')
    const sourceY = Math.max(0, y - actualY)
    const rows = Math.min(height - y, viewportHeight - sourceY)
    if (rows <= 0) throw new Error('页面阻止滚动，无法生成完整审阅截图。')
    for (let row = 0; row < rows; row++) {
      for (let x = 0; x < width; x++) {
        const from = ((sourceY + row) * width + x) * image.channels
        const to = (y + row) * stride + x * 3
        pixels[to] = image.data[from]!
        pixels[to + 1] = image.data[from + (image.channels >= 3 ? 1 : 0)]!
        pixels[to + 2] = image.data[from + (image.channels >= 3 ? 2 : 0)]!
      }
    }
    y += rows
  }
  return { buffer: encodeRgb(width, height, pixels), height }
}

function encodeRgb(width: number, height: number, pixels: Buffer): Buffer {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
  const chunk = (kind: string, data: Buffer): Buffer => {
    const type = Buffer.from(kind)
    const checksum = Buffer.concat([type, data])
    let crc = 0xffffffff
    for (const value of checksum) crc = table[(crc ^ value) & 255]! ^ (crc >>> 8)
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length)
    const tail = Buffer.alloc(4); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([head, checksum, tail])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let row = 0; row < height; row++) pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride)
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export function formatReviewReport(result: PageReviewResult): string {
  const lines = ['页面审阅：' + result.title + '（' + result.pageId + '）', '审美判断：待宿主读图或项目所有者评审；没有自动审美评分。']
  for (const capture of result.captures) {
    lines.push('\n' + capture.width + '×' + capture.height + '；内容 ' + capture.metrics.contentWidth + '×' + capture.metrics.contentHeight + '：' + capture.path)
    if (!capture.issues.length) lines.push('未发现本轮可测问题；不代表视觉或交互全面通过。')
    for (const issue of capture.issues) lines.push('- [' + issue.severity + '] ' + issue.rule + '：' + issue.message + (issue.selectors?.length ? '（' + issue.selectors.join('、') + '）' : ''))
  }
  lines.push('\n报告：' + result.reportFile, ...result.limitations.map((item) => '- ' + item))
  return lines.join('\n')
}
