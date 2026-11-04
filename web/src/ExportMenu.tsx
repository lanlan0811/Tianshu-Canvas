/**
 * 导出菜单：顶栏下拉，触发 PNG / ZIP / 两者导出（M4 接入后端 /api/export）。
 */
import { useEffect, useRef, useState } from 'react'
import { DownloadIcon } from './icons'

export interface ExportMenuProps {
  onExport: (kind: 'png' | 'zip' | 'both') => void
  busy?: boolean
}

export function ExportMenu({ onExport, busy }: ExportMenuProps) {
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
    <div className="export-menu" ref={ref}>
      <button type="button" className="btn btn--primary" onClick={() => setOpen((v) => !v)} disabled={busy}>
        <DownloadIcon size={14} /> {busy ? '导出中…' : '导出'}
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
  )
}
