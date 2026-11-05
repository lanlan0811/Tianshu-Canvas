/**
 * 顶部工具条：品牌标 + 工具组（适应视图、切换页面列表）+ 实时缩放百分比 + 导出下拉。
 * 导出下拉沿用 .export-menu* 类名（导出模式与既有样式依赖）。
 */
import { useEffect, useRef, useState } from 'react'
import { useReactFlow, useViewport } from '@xyflow/react'
import { ChevronIcon, DownloadIcon, FitViewIcon, SidebarIcon } from './icons'

export interface TopBarProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onExport: (kind: 'png' | 'zip' | 'both') => void
  busy?: boolean
}

export function TopBar({ sidebarOpen, onToggleSidebar, onExport, busy }: TopBarProps) {
  const { fitView } = useReactFlow()
  const { zoom } = useViewport()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  function pick(kind: 'png' | 'zip' | 'both'): void {
    setOpen(false)
    onExport(kind)
  }

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__mark" aria-hidden="true" />
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
      <span className="topbar__zoom">{Math.round(zoom * 100)}%</span>
      <div className="export-menu" ref={ref}>
        <button
          type="button"
          className="btn btn--primary export-menu__trigger"
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
        >
          <DownloadIcon size={14} /> {busy ? '导出中…' : '导出'}
          <ChevronIcon size={13} />
        </button>
        {open && (
          <div className="export-menu__list">
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
