/**
 * 画布内全屏预览层：右键「预览 / 预览设备」打开。
 *
 * 与编辑态节点 iframe 的关系：
 *  - 预览 iframe 走 /page/:id?preview=1，探针不选中元素、不高亮、不转发滚轮，
 *    因此按钮 / tab / 弹窗 / 滚动等原生交互照常工作；
 *  - 预览 iframe **不注册** ProbeBridge，本组件用 e.source 自建消息监听，
 *    与节点 iframe 的 pageToWin 映射互不覆盖；
 *  - 站内链接在预览内切换页面（沿用 resolveNavTarget），外链被探针拦截并提示。
 *
 * 设备尺寸只影响预览视口，不写回节点/项目文件。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  CheckIcon,
  ChevronIcon,
  DesktopIcon,
  DeviceIcon,
  ExitIcon,
  FreeIcon,
  MobileIcon,
  TabletIcon,
} from './icons'
import { resolveNavTarget } from './navTarget'
import {
  PREVIEW_DEVICES,
  PREVIEW_DEVICE_ORDER,
  PREVIEW_MAX_SIZE,
  PREVIEW_MIN_SIZE,
  type PreviewDevice,
} from './previewDevices'
import type { PageFlowNode } from './PageNode'

export interface PreviewOverlayProps {
  pages: PageFlowNode[]
  initialPageId: string
  ws: string
  device: PreviewDevice
  freeSize: { width: number; height: number }
  onDeviceChange: (device: PreviewDevice) => void
  onFreeSizeChange: (size: { width: number; height: number }) => void
  onClose: () => void
}

type ResizeDir = 'top' | 'right' | 'bottom' | 'left'

const HEADER_HEIGHT = 56
const ZOOM_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]

const DEVICE_ICONS = {
  desktop: DesktopIcon,
  tablet: TabletIcon,
  mobile: MobileIcon,
  free: FreeIcon,
} as const

function clampSize(value: number): number {
  if (!Number.isFinite(value)) return PREVIEW_MIN_SIZE
  return Math.min(PREVIEW_MAX_SIZE, Math.max(PREVIEW_MIN_SIZE, Math.round(value)))
}

export function PreviewOverlay({
  pages,
  initialPageId,
  ws,
  device,
  freeSize,
  onDeviceChange,
  onFreeSizeChange,
  onClose,
}: PreviewOverlayProps) {
  const [pageId, setPageId] = useState(initialPageId)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [zoomOpen, setZoomOpen] = useState(false)
  const [zoomMode, setZoomMode] = useState<'fit' | number>(1)
  const [toast, setToast] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    width: String(freeSize.width),
    height: String(freeSize.height),
  })
  const [stage, setStage] = useState(() => ({
    width: window.innerWidth,
    height: Math.max(240, window.innerHeight - HEADER_HEIGHT),
  }))
  const stageRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pageMenuRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<number | null>(null)
  const dragRef = useRef<{
    dir: ResizeDir
    startX: number
    startY: number
    width: number
    height: number
    scale: number
  } | null>(null)

  const page = pages.find((p) => p.id === pageId) ?? pages[0] ?? null

  // 页面被删除（或初始页不存在）时关闭预览。
  useEffect(() => {
    if (!page) onClose()
  }, [page, onClose])

  // 舞台尺寸 → 自适应缩放。padding 会随设备切换（网页铺满、其余留白），
  // 因此按内容盒测量，并在设备变化时重新测量。
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = (): void => {
      const cs = getComputedStyle(el)
      const padX = (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0)
      const padY = (Number.parseFloat(cs.paddingTop) || 0) + (Number.parseFloat(cs.paddingBottom) || 0)
      setStage({
        width: Math.max(1, el.clientWidth - padX),
        height: Math.max(1, el.clientHeight - padY),
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [device])

  // 自定义尺寸输入框与拖拽/外部修改保持同步。
  useEffect(() => {
    setDraft({ width: String(freeSize.width), height: String(freeSize.height) })
  }, [freeSize.width, freeSize.height])

  // Esc 关闭 + 下拉外点关闭。
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    function onDown(e: MouseEvent): void {
      const target = e.target as Node
      if (pageMenuRef.current && !pageMenuRef.current.contains(target)) setPagesOpen(false)
      if (zoomRef.current && !zoomRef.current.contains(target)) setZoomOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    }
  }, [])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }, [])

  // 预览 iframe 的消息：站内跳转 / 外链拦截 / iframe 内 Esc。
  useEffect(() => {
    function onMessage(e: MessageEvent): void {
      const win = iframeRef.current?.contentWindow
      if (!win || e.source !== win) return
      const data = e.data as { type?: string; payload?: unknown } | null
      if (!data || typeof data.type !== 'string') return
      if (data.type === '__vd_request_escape') {
        onClose()
        return
      }
      if (data.type === '__vd_preview_blocked') {
        showToast('外链不可在预览内打开')
        return
      }
      if (data.type === '__vd_request_navigate') {
        const p = data.payload as { href?: string | null; nav?: string | null } | null
        if (!p) return
        const ids = new Set(pages.map((n) => n.id))
        const target = resolveNavTarget({ href: p.href ?? null, nav: p.nav ?? null }, ids)
        if (target) {
          setPageId(target)
          setPagesOpen(false)
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [pages, onClose, showToast])

  function pickDevice(next: PreviewDevice): void {
    if (next !== device) setZoomMode(1)
    onDeviceChange(next)
  }

  const logicalWidth =
    device === 'desktop'
      ? Math.max(320, stage.width)
      : device === 'free'
        ? freeSize.width
        : PREVIEW_DEVICES[device].width
  const logicalHeight =
    device === 'desktop'
      ? Math.max(240, stage.height)
      : device === 'free'
        ? freeSize.height
        : PREVIEW_DEVICES[device].height

  const fitScale =
    device === 'desktop'
      ? 1
      : Math.min(stage.width / logicalWidth, stage.height / logicalHeight, 1)
  const scale = zoomMode === 'fit' ? fitScale : zoomMode
  const displayWidth = Math.max(1, Math.round(logicalWidth * scale))
  const displayHeight = Math.max(1, Math.round(logicalHeight * scale))
  const percent = Math.round(scale * 100)

  function commitSize(axis: 'width' | 'height'): void {
    const raw = Number.parseInt(axis === 'width' ? draft.width : draft.height, 10)
    if (!Number.isFinite(raw) || raw < PREVIEW_MIN_SIZE) {
      setDraft({ width: String(freeSize.width), height: String(freeSize.height) })
      return
    }
    const next = {
      width: axis === 'width' ? clampSize(raw) : freeSize.width,
      height: axis === 'height' ? clampSize(raw) : freeSize.height,
    }
    onFreeSizeChange(next)
    setDraft({ width: String(next.width), height: String(next.height) })
  }

  function startResize(dir: ResizeDir) {
    return (e: ReactPointerEvent<HTMLDivElement>): void => {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = {
        dir,
        startX: e.clientX,
        startY: e.clientY,
        width: freeSize.width,
        height: freeSize.height,
        scale: scale || 1,
      }
    }
  }

  function moveResize(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.startX) / d.scale
    const dy = (e.clientY - d.startY) / d.scale
    let width = d.width
    let height = d.height
    if (d.dir === 'right') width = d.width + dx
    if (d.dir === 'left') width = d.width - dx
    if (d.dir === 'bottom') height = d.height + dy
    if (d.dir === 'top') height = d.height - dy
    onFreeSizeChange({ width: clampSize(width), height: clampSize(height) })
  }

  function endResize(): void {
    dragRef.current = null
  }

  return (
    <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="原型预览">
      <header className="preview-header">
        <div className="preview-header__left" ref={pageMenuRef}>
          <button
            type="button"
            className="preview-page-btn"
            aria-haspopup="menu"
            aria-expanded={pagesOpen}
            onClick={() => setPagesOpen((v) => !v)}
          >
            <DeviceIcon type={page?.data.deviceType ?? 'desktop'} size={15} />
            <span className="preview-page-btn__title">{page?.data.title ?? '预览'}</span>
            <ChevronIcon size={13} />
          </button>
          {pagesOpen && (
            <div className="preview-pages" role="menu">
              {pages.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={n.id === pageId}
                  className={`preview-pages__item${n.id === pageId ? ' is-active' : ''}`}
                  onClick={() => {
                    setPageId(n.id)
                    setPagesOpen(false)
                  }}
                >
                  <DeviceIcon type={n.data.deviceType} size={14} />
                  <span className="preview-pages__title">{n.data.title}</span>
                  <span className="preview-pages__size">
                    {n.data.width}×{n.data.height}
                  </span>
                  {n.id === pageId && <CheckIcon size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="preview-header__center">
          <div className="preview-device-seg" role="group" aria-label="预览设备">
            {PREVIEW_DEVICE_ORDER.map((d) => {
              const Icon = DEVICE_ICONS[d]
              return (
                <button
                  key={d}
                  type="button"
                  data-device={d}
                  className={`preview-device-seg__btn${device === d ? ' is-active' : ''}`}
                  aria-pressed={device === d}
                  title={PREVIEW_DEVICES[d].label}
                  onClick={() => pickDevice(d)}
                >
                  <Icon size={17} />
                </button>
              )
            })}
          </div>
          {device === 'free' && (
            <div className="preview-free-size">
              <label className="preview-free-size__field">
                <span>W</span>
                <input
                  type="number"
                  min={PREVIEW_MIN_SIZE}
                  max={PREVIEW_MAX_SIZE}
                  value={draft.width}
                  onChange={(e) => setDraft((d) => ({ ...d, width: e.target.value }))}
                  onBlur={() => commitSize('width')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitSize('width')
                  }}
                  aria-label="预览宽度"
                />
              </label>
              <label className="preview-free-size__field">
                <span>H</span>
                <input
                  type="number"
                  min={PREVIEW_MIN_SIZE}
                  max={PREVIEW_MAX_SIZE}
                  value={draft.height}
                  onChange={(e) => setDraft((d) => ({ ...d, height: e.target.value }))}
                  onBlur={() => commitSize('height')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitSize('height')
                  }}
                  aria-label="预览高度"
                />
              </label>
            </div>
          )}
        </div>

        <div className="preview-header__right">
          <button type="button" className="preview-exit" onClick={onClose}>
            <ExitIcon size={16} />
            <span>退出预览</span>
          </button>
        </div>
      </header>

      <div className={`preview-stage${device === 'desktop' ? ' preview-stage--desktop' : ''}`} ref={stageRef}>
        {page && (
          <div
            className={`preview-device preview-device--${device}${
              device === 'tablet' || device === 'mobile' ? ' preview-device--framed' : ''
            }`}
            data-device={device}
            style={{ width: displayWidth, height: displayHeight }}
          >
            <div
              className="preview-device__scaler"
              style={{
                width: logicalWidth,
                height: logicalHeight,
                transform: scale === 1 ? 'none' : `scale(${scale})`,
              }}
            >
              <iframe
                key={`${page.id}:${page.data.rev ?? 0}`}
                ref={iframeRef}
                className="preview-device__iframe"
                title={page.data.title}
                src={`${location.pathname}page/${encodeURIComponent(page.id)}?ws=${encodeURIComponent(ws)}${
                  page.data.rev ? `&v=${page.data.rev}` : ''
                }&preview=1`}
                sandbox="allow-scripts"
                onLoad={() => iframeRef.current?.focus()}
              />
            </div>
            {device === 'free' && (
              <>
                {(['top', 'right', 'bottom', 'left'] as ResizeDir[]).map((dir) => (
                  <div
                    key={dir}
                    className={`preview-handle preview-handle--${dir}`}
                    data-handle={dir}
                    onPointerDown={startResize(dir)}
                    onPointerMove={moveResize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onDoubleClick={() => {
                      const preset = PREVIEW_DEVICES.free
                      onFreeSizeChange({ width: preset.width, height: preset.height })
                    }}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {toast && <div className="preview-toast">{toast}</div>}

      <div className="preview-zoom" ref={zoomRef}>
        {zoomOpen && (
          <div className="preview-zoom__menu" role="menu">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={zoomMode === 'fit'}
              className={zoomMode === 'fit' ? 'is-active' : ''}
              onClick={() => {
                setZoomMode('fit')
                setZoomOpen(false)
              }}
            >
              适应窗口
            </button>
            {ZOOM_OPTIONS.map((z) => (
              <button
                key={z}
                type="button"
                role="menuitemradio"
                aria-checked={zoomMode === z}
                className={zoomMode === z ? 'is-active' : ''}
                onClick={() => {
                  setZoomMode(z)
                  setZoomOpen(false)
                }}
              >
                {Math.round(z * 100)}%
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="preview-zoom__btn"
          aria-haspopup="menu"
          aria-expanded={zoomOpen}
          onClick={() => setZoomOpen((v) => !v)}
        >
          {percent}% <ChevronIcon size={12} />
        </button>
      </div>
    </div>
  )
}
