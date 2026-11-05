/**
 * 左侧页面列表：列出画布上的页面节点，点击选中并定位到该节点。
 * 只做展示与定位，选中状态由 App 统一管理（与画布/面板保持同步）。
 */
import { DeviceIcon } from './icons'
import type { PageFlowNode } from './PageNode'

export interface PageListSidebarProps {
  nodes: PageFlowNode[]
  selectedId: string | null
  onPick: (id: string) => void
}

export function PageListSidebar({ nodes, selectedId, onPick }: PageListSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__head">页面 · {nodes.length}</div>
      <ul className="sidebar__list">
        {nodes.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className={`sidebar__item${n.id === selectedId ? ' is-active' : ''}`}
              onClick={() => onPick(n.id)}
              title={n.data.title}
            >
              <DeviceIcon type={n.data.deviceType} size={15} />
              <span className="sidebar__title">{n.data.title}</span>
              <span className="sidebar__size">
                {n.data.width}×{n.data.height}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
