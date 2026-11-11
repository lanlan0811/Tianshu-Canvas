/**
 * 顶部工具条：品牌标 + 工具组（适应视图、切换页面列表）+ 实时缩放百分比 + 导出下拉。
 * 导出下拉沿用 .export-menu* 类名（导出模式与既有样式依赖）。
 */
import { useEffect, useRef, useState } from 'react'
import { useReactFlow, useViewport } from '@xyflow/react'
import { ChevronIcon, DownloadIcon, FitViewIcon, SidebarIcon } from './icons'
import brandIcon from './brand-icon.png'
import { StyleSwitcher } from './StyleSwitcher'
import type { ApiDesignCatalog } from './api'

export interface TopBarProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onExport: (kind: 'png' | 'zip' | 'both') => void
  busy?: boolean
  catalog: ApiDesignCatalog | null
  design: { styleId: string; updatedAt: number } | null
}

export function TopBar({
  sidebarOpen,
  onToggleSidebar,
  onExport,
  busy,
  catalog,
  design,
}: TopBarProps) {
  const { fitView } = useReactFlow()
  const { zoom } = useViewport()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  function pick(kind: 'png' | 'zip' | 'both'): void {
    setOpen(false)
    triggerRef.current?.focus()
    onExport(kind)
  }

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <img className="topbar__mark" src={brandIcon} alt="" width={22} height={22} />
        <span className="topbar__name">天枢画布</span>
      </div>
      <div className="topbar__tools">
        <button
          type="button"
          className={`topbar__btn${sidebarOpen ? ' is-on' : ''}`}
          title="页面列表"
          aria-pressed={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <SidebarIcon size={15} />
          <span>页面</span>
        </button>
        <button
          type="button"
          className="topbar__btn"
          title="适应视图"
          onClick={() => void fitView({ padding: 0.3, maxZoom: 1, duration: 400 })}
        >
          <FitViewIcon size={15} />
          <span>适应</span>
        </button>
      </div>
      <div className="topbar__spacer" />
      <StyleSwitcher catalog={catalog} current={design} />
      <span className="topbar__zoom">{Math.round(zoom * 100)}%</span>
      <div className="export-menu" ref={ref}>
        <button
          type="button"
          className="btn btn--primary export-menu__trigger"
          ref={triggerRef}
          aria-expanded={open}
          aria-controls="canvas-export-options"
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
        >
          <DownloadIcon size={14} /> {busy ? '导出中…' : '导出'}
          <ChevronIcon size={13} />
        </button>
        {open && (
          <div className="export-menu__list" id="canvas-export-options" role="group" aria-label="导出选项">
            <button type="button" onClick={() => pick('png')}>
              画布截图 PNG
            </button>
            <button type="button" onClick={() => pick('zip')}>
              原型打包 ZIP
            </button>
            <button type="button" onClick={() => pick('both')}>
              两者都要
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
