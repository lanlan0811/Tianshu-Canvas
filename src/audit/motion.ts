/**
 * 动效抓帧审计（`canvas_audit action=motion`）。
 *
 * 为什么需要它：单张截图无法证明动效。这里按固定采样点抓一串帧，
 * 与第 0 帧做像素差，得到每个采样点的变化比例与包围盒；再按相对判据
 * （帧间比例而非绝对时间）给出客观发现。
 *
 * 诚实边界（写进 limitations，不允许省）：
 *  - 采样帧数固定，只证明"这些帧上的变化"，不证明平滑；
 *  - 截图本身有开销，elapsedMs 是实测值不是标称值；
 *  - 只测一个选择器的一次点击；键盘序列与多步交互未覆盖；
 *  - prefers-reduced-motion 只在 Chromium 上模拟。
 */

import { join } from 'node:path'
import type { Browser } from 'puppeteer-core'
import { InvalidInputError } from '../ids.js'
import { decodePng, diffPng, encodeImage, scaleImage, tileImages, type PngImage, type Rect } from './png.js'

export interface MotionOptions {
  selector: string
  /** 只截这一个元素的区域；省略则截整个视口。 */
  region?: string
  /** 帧数，3–15，默认 7。 */
  frames?: number
  /** 首次点击到最后稳定帧的总窗口（ms），默认 700。 */
  windowMs?: number
  /** 是否在 prefers-reduced-motion: reduce 下采集。 */
  reducedMotion?: boolean
  /** 每帧之后的额外等待（ms），默认 0。 */
  settleMs?: number
}

export interface MotionFrame {
  index: number
  elapsedMs: number
  /** 相对第 0 帧的变化像素比例（0–1）。 */
  changeRatio: number
  bbox: Rect | null
  /** 该帧的包围盒跨度（宽或高的较大者），用于判断位移幅度。 */
  span: number
  path: string
}

export type MotionFindingKind =
  | 'start-jump'
  | 'end-jump'
  | 'mid-step'
  | 'clipped-midway'
  | 'reduced-motion-ignored'

export interface MotionFinding {
  kind: MotionFindingKind
  severity: 'warning' | 'advisory'
  message: string
}

export interface MotionCapture {
  label: 'normal' | 'reduced'
  dir: string
  frames: MotionFrame[]
  filmstrip: string
  viewer: string
  report: string
  durationMs: number
  totalSpan: number
}

export interface MotionReport {
  pageId: string
  selector: string
  region: string | null
  viewport: { width: number; height: number }
  normal: MotionCapture
  reduced: MotionCapture | null
  findings: MotionFinding[]
  limitations: string[]
}

const DEFAULT_FRAMES = 7
const MIN_FRAMES = 3
const MAX_FRAMES = 15
const VIEWPORT = { width: 1000, height: 760 } as const

/** 判据阈值：全部是相对比例，不用绝对时间，避免机器快慢导致结果漂移。 */
export const MOTION_THRESHOLDS = {
  /** 首帧/末帧跳变：变化比例超过它就算没有过渡。 */
  jump: 0.02,
  /** 中间跳帧：单帧变化超过它，且超过相邻帧的倍数。 */
  midStep: 0.08,
  midStepRatio: 4,
  /** 中间被裁切：中间帧超过它而首末帧低于 clippedEdge。 */
  clippedMid: 0.02,
  clippedEdge: 0.01,
  /** reduced-motion 判定：位移跨度 ≥ 基线跨度的这个比例即视为没减少。 */
  reducedSpanShare: 0.9,
  /** 基线跨度太小（px）时不做 reduced 比较。 */
  minSpanPx: 4,
  /** 基线时长低于此值时不做 reduced 比较。 */
  minDurationMs: 100,
} as const

/** 纯函数：从帧序列算客观发现（可脱浏览器单测）。 */
export function analyzeMotion(normal: { frames: MotionFrame[]; durationMs: number }, reduced: { frames: MotionFrame[]; durationMs: number } | null): MotionFinding[] {
  const findings: MotionFinding[] = []
  const frames = normal.frames
  if (frames.length < 3) return findings

  const ratios = frames.map((f) => f.changeRatio)
  const last = ratios[ratios.length - 1] ?? 0
  const first = ratios[1] ?? 0
  // 相邻帧的增量：判"跳变"要看增量，而不是累计变化量。
  const deltas = ratios.slice(1).map((value, index) => value - (ratios[index] ?? 0))

  // 1) start-jump：第 1 帧就完成巨变，之后的增量都很小
  if (first >= MOTION_THRESHOLDS.jump && deltas.slice(1).every((d) => d < MOTION_THRESHOLDS.jump)) {
    findings.push({
      kind: 'start-jump',
      severity: 'warning',
      message: `首帧就完成 ${(first * 100).toFixed(1)}% 的变化且后续几乎不动：动画很可能从已变化的状态开始，没有入场过程`,
    })
  }

  // 2) end-jump：最后一帧的增量不但超过阈值，还明显大于前一帧（收尾不收敛）
  const lastDelta = deltas[deltas.length - 1] ?? 0
  const prevDelta = deltas[deltas.length - 2] ?? 0
  if (lastDelta >= MOTION_THRESHOLDS.jump && lastDelta >= prevDelta * 2) {
    findings.push({
      kind: 'end-jump',
      severity: 'warning',
      message: `末帧增量 ${(lastDelta * 100).toFixed(1)}%（前一帧 ${(prevDelta * 100).toFixed(1)}%）：动画结束时跳变，没有收敛`,
    })
  }

  // 3) mid-step：单帧增量超过阈值，且是相邻增量的数倍
  for (let i = 1; i < deltas.length - 1; i++) {
    const current = deltas[i] ?? 0
    const prev = deltas[i - 1] ?? 0
    const next = deltas[i + 1] ?? 0
    const neighbour = Math.max(prev, next) || 1e-6
    if (current >= MOTION_THRESHOLDS.midStep && current >= neighbour * MOTION_THRESHOLDS.midStepRatio) {
      findings.push({
        kind: 'mid-step',
        severity: 'warning',
        message: `第 ${i + 1} 帧单帧变化 ${(current * 100).toFixed(1)}%（相邻帧 ${(prev * 100).toFixed(1)}% / ${(next * 100).toFixed(1)}%）：中间存在跳帧`,
      })
      break
    }
  }

  // 4) clipped-midway：中间出现而首末没有 → 多半是内容被裁切后恢复
  const mids = ratios.slice(1, -1)
  const maxMid = mids.length ? Math.max(...mids) : 0
  if (maxMid >= MOTION_THRESHOLDS.clippedMid && first < MOTION_THRESHOLDS.clippedEdge && last < MOTION_THRESHOLDS.clippedEdge) {
    findings.push({
      kind: 'clipped-midway',
      severity: 'warning',
      message: `中间帧变化 ${(maxMid * 100).toFixed(1)}% 而首末帧都低于 ${(MOTION_THRESHOLDS.clippedEdge * 100).toFixed(0)}%：过渡中内容被裁切或临时消失`,
    })
  }

  // 5) reduced-motion-ignored：reduced 下的位移跨度没有实质减少
  if (reduced && reduced.frames.length >= 3) {
    const spanOf = (list: MotionFrame[]): number => Math.max(0, ...list.map((f) => f.span))
    const normalSpan = spanOf(normal.frames)
    const reducedSpan = spanOf(reduced.frames)
    if (normal.durationMs >= MOTION_THRESHOLDS.minDurationMs && normalSpan >= MOTION_THRESHOLDS.minSpanPx) {
      if (reducedSpan >= normalSpan * MOTION_THRESHOLDS.reducedSpanShare) {
        findings.push({
          kind: 'reduced-motion-ignored',
          severity: 'warning',
          message: `减少动效下位移跨度仍有 ${reducedSpan.toFixed(0)}px（基线 ${normalSpan.toFixed(0)}px，${((reducedSpan / Math.max(1, normalSpan)) * 100).toFixed(0)}%）：应减少空间位移，而不是只缩短时长`,
        })
      }
    }
  }

  return findings
}

const LIMITATIONS = [
  '采样帧数固定，只证明这些帧上的变化，不证明动画平滑。',
  '截图本身有 30–80ms 开销，elapsedMs 是实测值不是标称时长。',
  '只测了一个选择器的一次点击；键盘步骤、多步交互、连续手势未覆盖。',
  'prefers-reduced-motion 只在 Chromium 上模拟，Safari / Firefox 的差异未测。',
  '客观像素差不能判断动效是否恰当，只判断它「有没有跑成这个样子」。',
]

/** 拖帧查看器：纯内联 CSS/JS，无外部依赖，直接 file:// 打开即可。 */
function viewerHtml(label: string, selector: string, frameFiles: string[]): string {
  const images = frameFiles.map((file) => `'${file}'`).join(',')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>动效抓帧 · ${label}</title>
<style>
body{margin:0;background:#18181b;color:#e4e4e7;font:13px/1.6 ui-sans-serif,system-ui}
header{padding:12px 16px;border-bottom:1px solid #3f3f46;display:flex;gap:16px;align-items:center}
code{background:#27272a;padding:2px 6px;border-radius:4px}
main{padding:16px;display:flex;flex-direction:column;gap:12px}
img{max-width:100%;border:1px solid #3f3f46;border-radius:6px;background:#000}
input[type=range]{width:100%}
</style></head><body>
<header><strong>动效抓帧</strong><span>${label}</span><code>${selector}</code><span id="pos">0 / ${frameFiles.length - 1}</span></header>
<main><img id="frame" src="${frameFiles[0]}" alt="frame"><input id="slider" type="range" min="0" max="${frameFiles.length - 1}" value="0"></main>
<script>
const files=[${images}];const img=document.getElementById('frame');const slider=document.getElementById('slider');const pos=document.getElementById('pos');
slider.addEventListener('input',()=>{const i=Number(slider.value);img.src=files[i];pos.textContent=i+' / '+(files.length-1)});
</script></body></html>
`
}

/** 采集一段动效：点击选择器后按固定间隔截图，写帧、filmstrip、查看器与 report.json。 */
export async function captureMotion(
  browser: Browser,
  url: string,
  opts: MotionOptions,
  write: { dir: string; save: (path: string, data: Buffer | string) => void },
  label: 'normal' | 'reduced',
): Promise<MotionCapture> {
  const frames = Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, opts.frames ?? DEFAULT_FRAMES))
  const windowMs = Math.max(200, opts.windowMs ?? 700)
  const page = await browser.newPage()
  try {
    await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 })
    if (opts.reducedMotion) {
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    } else {
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('body', { timeout: 10000 })
    await new Promise((r) => setTimeout(r, 300))

    // 解析裁剪区域（region 优先，否则整视口）
    const clip = opts.region
      ? ((await page.evaluate(
          `(() => {
             const el = document.querySelector(${JSON.stringify(opts.region)})
             if (!el) return null
             const r = el.getBoundingClientRect()
             return { x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), width: Math.max(1, Math.floor(r.width)), height: Math.max(1, Math.floor(r.height)) }
           })()`,
        )) as { x: number; y: number; width: number; height: number } | null)
      : { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height }
    if (!clip) throw new InvalidInputError(`找不到动效区域选择器：${opts.region}`)

    // 逐帧截图：先截「前」帧（未触发），再点击，按窗口均匀采样
    const shots: Array<{ buffer: Buffer; elapsedMs: number }> = []
    const started = Date.now()
    const first = await page.screenshot({ clip, encoding: 'binary' })
    shots.push({ buffer: Buffer.from(first as Uint8Array), elapsedMs: 0 })

    const triggered = (await page.evaluate(
      `(() => {
         const el = document.querySelector(${JSON.stringify(opts.selector)})
         if (!el) return false
         if (typeof el.click === 'function') el.click()
         else el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
         return true
       })()`,
    )) as boolean
    if (!triggered) throw new InvalidInputError(`找不到动效触发选择器：${opts.selector}`)

    const step = windowMs / (frames - 1)
    for (let i = 1; i < frames; i++) {
      const target = i * step
      const now = Date.now() - started
      if (target > now) await new Promise((r) => setTimeout(r, target - now))
      if (opts.settleMs) await new Promise((r) => setTimeout(r, opts.settleMs))
      const buffer = await page.screenshot({ clip, encoding: 'binary' })
      shots.push({ buffer: Buffer.from(buffer as Uint8Array), elapsedMs: Date.now() - started })
    }

    const images: PngImage[] = shots.map((shot) => decodePng(shot.buffer))
    const base = images[0]!
    const frameFiles: string[] = []
    const frameResults: MotionFrame[] = []
    images.forEach((image, index) => {
      const name = `frame-${String(index).padStart(2, '0')}.png`
      const path = join(write.dir, name)
      write.save(path, index === 0 ? shots[index]!.buffer : encodeImage(image))
      frameFiles.push(name)
      const diff = index === 0 ? { ratio: 0, bbox: null } : diffPng(base, image, { threshold: 8 })
      const bbox = (diff.bbox as Rect | null) ?? null
      const span = bbox ? Math.max(bbox.width, bbox.height) : 0
      frameResults.push({ index, elapsedMs: shots[index]!.elapsedMs, changeRatio: diff.ratio, bbox, span, path })
    })

    // filmstrip：3 列，缩到 1/3 以免过大
    const thumbs = images.map((image) => scaleImage(image, Math.max(1, Math.floor(image.width / 3)), Math.max(1, Math.floor(image.height / 3))))
    const strip = tileImages(thumbs, 3, 6)
    const filmstripPath = join(write.dir, 'filmstrip.png')
    write.save(filmstripPath, encodeImage(strip))

    const viewerPath = join(write.dir, 'index.html')
    write.save(viewerPath, viewerHtml(label, opts.selector, frameFiles))

    const durationMs = shots[shots.length - 1]!.elapsedMs
    const totalSpan = Math.max(0, ...frameResults.map((f) => f.span))
    const capture: MotionCapture = {
      label,
      dir: write.dir,
      frames: frameResults,
      filmstrip: filmstripPath,
      viewer: viewerPath,
      report: join(write.dir, 'report.json'),
      durationMs,
      totalSpan,
    }
    write.save(capture.report, JSON.stringify({ label, selector: opts.selector, region: opts.region ?? null, viewport: VIEWPORT, durationMs, totalSpan, frames: frameResults, limitations: LIMITATIONS }, null, 2) + '\n')
    return capture
  } finally {
    await page.close().catch(() => {})
  }
}

/** 人类可读报告。 */
export function formatMotionReport(report: MotionReport): string {
  const lines: string[] = []
  lines.push(`动效抓帧审计：${report.pageId} · 选择器 ${report.selector}${report.region ? ` · 区域 ${report.region}` : ''}`)
  lines.push(`视口 ${report.viewport.width}×${report.viewport.height} · 正常 ${report.normal.frames.length} 帧 / ${report.normal.durationMs}ms` +
    (report.reduced ? ` · 减少动效 ${report.reduced.frames.length} 帧 / ${report.reduced.durationMs}ms` : ''))
  if (report.findings.length === 0) {
    lines.push('未发现可测的动效异常（这不等于动效恰当：像素差只证明它跑成了这个样子）。')
  } else {
    for (const finding of report.findings) lines.push(`- [${finding.severity}] ${finding.kind}：${finding.message}`)
  }
  lines.push('')
  lines.push('帧序列（变化比例 / 位移跨度）：')
  for (const frame of report.normal.frames) {
    lines.push(`- #${frame.index} ${frame.elapsedMs}ms · ${(frame.changeRatio * 100).toFixed(1)}% · 跨度 ${frame.span}px`)
  }
  if (report.reduced) {
    lines.push('')
    lines.push('减少动效下的帧：')
    for (const frame of report.reduced.frames) {
      lines.push(`- #${frame.index} ${frame.elapsedMs}ms · ${(frame.changeRatio * 100).toFixed(1)}% · 跨度 ${frame.span}px`)
    }
  }
  lines.push('')
  lines.push(`filmstrip：${report.normal.filmstrip}`)
  lines.push(`拖帧查看：${report.normal.viewer}`)
  if (report.reduced) lines.push(`减少动效：${report.reduced.filmstrip}`)
  lines.push('')
  lines.push('未测项：')
  for (const item of report.limitations) lines.push(`- ${item}`)
  return lines.join('\n')
}
