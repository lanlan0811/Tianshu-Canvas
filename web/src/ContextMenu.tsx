/**
 * 右键菜单：节点版（重命名/复制/删除/置顶）与空白版（适应视图）。
 * 定位用视口坐标，渲染在 .app 内（不在画布变换里），外点与 Esc 关闭。
 */
import { useEffect, useRef, useState } from 'react'
import { BringToFrontIcon, CopyIcon, FitViewIcon, RenameIcon, TrashIcon } from './icons'

export type ContextMenuState =
  | { kind: 'node'; x: number; y: number; nodeId: string; title: string }
  | { kind: 'pane'; x: number; y: number }

export interface ContextMenuProps {
  state: ContextMenuState
  onClose: () => void
  onRename: (id: string, title: string) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
  onBringToFront: (id: string) => void
  onFitView: () => void
}

export function ContextMenu({
  state,
  onClose,
  onRename,
  onDuplicate,
  onRemove,
  onBringToFront,
  onFitView,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(state.kind === 'node' ? state.title : '')

  useEffect(() => {
    setEditing(false)
    setTitle(state.kind === 'node' ? state.title : '')
  }, [state])

  useEffect(() => {
    function onDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  function commitRename(): void {
    if (state.kind !== 'node') return
    const next = title.trim()
    if (next && next !== state.title) onRename(state.nodeId, next)
    onClose()
  }

  return (
    <div
      className="context-menu"
      ref={ref}
      style={{ left: state.x, top: state.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.kind === 'node' ? (
        editing ? (
          <input
            className="context-menu__input"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') onClose()
            }}
          />
        ) : (
          <>
            <button type="button" className="context-menu__item" onClick={() => setEditing(true)}>
              <RenameIcon size={14} /> 重命名
            </button>
            <button
              type="button"
              className="context-menu__item"
              onClick={() => {
                onDuplicate(state.nodeId)
                onClose()
              }}
            >
              <CopyIcon size={14} /> 复制
            </button>
            <button
              type="button"
              className="context-menu__item"
              onClick={() => {
                onBringToFront(state.nodeId)
                onClose()
              }}
            >
              <BringToFrontIcon size={14} /> 置于顶层
            </button>
            <button
              type="button"
              className="context-menu__item context-menu__item--danger"
              onClick={() => {
                onRemove(state.nodeId)
                onClose()
              }}
            >
              <TrashIcon size={14} /> 删除
            </button>
          </>
        )
      ) : (
        <button
          type="button"
          className="context-menu__item"
          onClick={() => {
            onFitView()
            onClose()
          }}
        >
          <FitViewIcon size={14} /> 适应视图
        </button>
      )}
    </div>
  )
}
