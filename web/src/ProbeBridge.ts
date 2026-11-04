/**
 * 探针桥：接收 iframe 探针的 postMessage，分发到画布。
 *
 * 关键：iframe 是 opaque origin（sandbox 无 allow-same-origin），`e.origin` 为 "null"，
 * 因此父侧**不能信任 origin**，改用 `e.source === iframe.contentWindow` 认领消息。
 */
import { useEffect, useRef } from 'react'

export interface ProbePayload {
  xpath: string
  selector: string
  tagName: string
  className: string
  domId: string | null
  textContent: string
  outerHtml: string
  rect: { x: number; y: number; width: number; height: number }
  computedStyles: Record<string, string>
  parentXpath: string | null
  siblingIndex: number
}

export interface ProbeHandlers {
  onReady?: (pageId: string) => void
  onSelect?: (pageId: string, payload: ProbePayload) => void
  onHover?: (pageId: string, payload: ProbePayload | null) => void
  onEditApplied?: (pageId: string, xpath: string, ok: boolean, html?: string, error?: string) => void
  onHeight?: (pageId: string, height: number) => void
  onWheel?: (
    pageId: string,
    e: { deltaX: number; deltaY: number; ctrlKey: boolean; metaKey: boolean; clientX: number; clientY: number },
  ) => void
}

/** pageId ↔ iframe contentWindow 双向映射。 */
const winToPage = new WeakMap<Window, string>()
const pageToWin = new Map<string, Window>()

export function registerIframe(pageId: string, win: Window | null): void {
  if (!win) return
  winToPage.set(win, pageId)
  pageToWin.set(pageId, win)
}

export function unregisterIframe(pageId: string): void {
  const win = pageToWin.get(pageId)
  if (win) winToPage.delete(win)
  pageToWin.delete(pageId)
}

/** 父→子：向指定页面 iframe 发消息。 */
export function postToPage(pageId: string, type: string, payload?: unknown): boolean {
  const win = pageToWin.get(pageId)
  if (!win) return false
  try {
    win.postMessage({ type, payload: payload ?? null }, '*')
    return true
  } catch {
    return false
  }
}

export function hasIframe(pageId: string): boolean {
  return pageToWin.has(pageId)
}

/** 在画布根组件里调用一次，挂 window message 监听。 */
export function useProbeBridge(handlers: ProbeHandlers): void {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    function onMessage(e: MessageEvent): void {
      const pageId = winToPage.get(e.source as Window)
      if (!pageId) return
      const data = e.data as { type?: string; payload?: unknown } | null
      if (!data || typeof data.type !== 'string') return
      const h = ref.current
      switch (data.type) {
        case '__vd_iframe_ready':
          h.onReady?.(pageId)
          break
        case '__vd_proto_element_selected':
          h.onSelect?.(pageId, data.payload as ProbePayload)
          break
        case '__vd_proto_hover_changed':
          h.onHover?.(pageId, (data.payload as ProbePayload | null) ?? null)
          break
        case '__vd_edit_applied': {
          const p = data.payload as { xpath: string; ok: boolean; html?: string; error?: string }
          h.onEditApplied?.(pageId, p.xpath, p.ok, p.html, p.error)
          break
        }
        case '__vd_content_height': {
          const p = data.payload as { height: number }
          if (typeof p?.height === 'number') h.onHeight?.(pageId, p.height)
          break
        }
        case '__vd_wheel_forward':
          h.onWheel?.(pageId, data.payload as never)
          break
        default:
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
}
