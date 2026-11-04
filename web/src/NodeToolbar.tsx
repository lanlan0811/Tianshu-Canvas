/**
 * 节点工具栏：选中节点时浮现在节点上方，提供重命名/复制/删除。
 */
import { useState } from 'react'
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

  function commit(): void {
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
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setTitle(node.data.title)
              setEditing(false)
            }
          }}
        />
      ) : (
        <>
          <button type="button" className="node-toolbar__btn" title="重命名" onClick={() => setEditing(true)}>
            <EditIcon size={14} />
          </button>
          <button type="button" className="node-toolbar__btn" title="复制" onClick={() => onDuplicate(node.id)}>
            <CopyIcon size={14} />
          </button>
          <button type="button" className="node-toolbar__btn" title="删除" onClick={() => onRemove(node.id)}>
            <TrashIcon size={14} />
          </button>
        </>
      )}
    </div>
  )
}
