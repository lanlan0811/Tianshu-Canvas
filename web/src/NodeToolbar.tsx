/**
 * 节点工具栏：选中节点时浮现在节点上方，提供重命名/复制/删除。
 */
import { useEffect, useRef, useState } from 'react'
import { CopyIcon, EditIcon, TrashIcon } from './icons'
import type { PageFlowNode } from './PageNode'

export interface NodeToolbarProps {
  node: PageFlowNode
  onRename: (id: string, title: string) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
}

export function NodeToolbar({ node, onRename, onDuplicate, onRemove }: NodeToolbarProps) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(node.data.title)
  const renameButton = useRef<HTMLButtonElement>(null)
  const committed = useRef(false)

  useEffect(() => { setTitle(node.data.title) }, [node.data.title])

  function commit(): void {
    if (committed.current) return
    committed.current = true
    setEditing(false)
    const next = title.trim()
    if (next && next !== node.data.title) onRename(node.id, next)
    else setTitle(node.data.title)
  }

  return (
    <div className="node-toolbar" onMouseDown={(e) => e.stopPropagation()}>
      {editing ? (
        <input
          className="node-toolbar__input"
          aria-label="页面名称"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
              requestAnimationFrame(() => renameButton.current?.focus())
            }
            if (e.key === 'Escape') {
              committed.current = true
              e.preventDefault()
              setTitle(node.data.title)
              setEditing(false)
              requestAnimationFrame(() => renameButton.current?.focus())
            }
          }}
        />
      ) : (
        <>
          <button type="button" className="node-toolbar__btn" title="重命名" aria-label="重命名" ref={renameButton} onClick={() => { committed.current = false; setTitle(node.data.title); setEditing(true) }}>
            <EditIcon size={14} />
          </button>
          <button type="button" className="node-toolbar__btn" title="复制" aria-label="复制" onClick={() => onDuplicate(node.id)}>
            <CopyIcon size={14} />
          </button>
          <button type="button" className="node-toolbar__btn" title="删除" aria-label="删除" onClick={() => onRemove(node.id)}>
            <TrashIcon size={14} />
          </button>
        </>
      )}
    </div>
  )
}
