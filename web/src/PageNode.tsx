/**
 * 设计页节点：反缩放标题栏 + 沙箱 iframe。
 *
 * 关键技巧（复刻自 Trae SOLO）：
 *  - 标题栏内层用 transform:scale(1/zoom) + width:100%*zoom 抵消画布缩放，
 *    使标题在任何缩放级别下视觉尺寸恒定（只有内容真正缩放）。
 *  - 内容用 iframe 以逻辑分辨率渲染原型；iframe 无 allow-same-origin（opaque origin），
 *    只能通过 postMessage 通信，原型无法读取画布页面的任何状态。
 */
import { memo } from 'react'
import { Handle, Position, useStore, type NodeProps, type Node } from '@xyflow/react'
import { DeviceIcon } from './icons'

export interface PageNodeData extends Record<string, unknown> {
  title: string
  width: number
  height: number
  deviceType: string
  ws: string
}

export type PageFlowNode = Node<PageNodeData, 'page'>

const HEADER = 28

export const PageNode = memo(function PageNode({ id, data, selected }: NodeProps<PageFlowNode>) {
  const zoom = useStore((s) => s.transform[2])
  const inv = 1 / zoom
  const width = data.width
  const height = data.height

  return (
    <div
      className={`page-node${selected ? ' page-node--selected' : ''}`}
      style={{ width, height: height + HEADER, ['--inv' as string]: String(inv) }}
    >
      <Handle type="target" position={Position.Left} id="in" className="page-node__handle" />
      <div className="page-node__header" style={{ height: HEADER }}>
        <div
          className="page-node__header-inner"
          style={{ transform: `scale(${inv})`, transformOrigin: 'top left', width: `${100 * zoom}%` }}
        >
          <DeviceIcon type={data.deviceType} size={14} />
          <span className="page-node__title">{data.title}</span>
          <span className="page-node__size">
            {data.width}×{data.height}
          </span>
        </div>
      </div>
      <div className="page-node__body" style={{ height }}>
        <iframe
          className="page-node__iframe"
          title={data.title}
          src={`/page/${encodeURIComponent(id)}?ws=${encodeURIComponent(data.ws)}`}
          sandbox="allow-scripts"
          loading="lazy"
        />
      </div>
      <div className="page-node__frame" />
      <Handle type="source" position={Position.Right} id="out" className="page-node__handle" />
    </div>
  )
})

export const nodeTypes = { page: PageNode }
