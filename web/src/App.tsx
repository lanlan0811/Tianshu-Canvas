/**
 * 画布应用：拉项目 → 渲染 React Flow 无限画布 → 订阅 SSE 实时刷新。
 */
import { useCallback, useEffect, useState } from 'react'
import { MiniMap, ReactFlow, ReactFlowProvider, useNodesState, type Edge } from '@xyflow/react'
import { canvasConfig } from './canvasConfig'
import { nodeTypes, type PageFlowNode } from './PageNode'
import { GridLayer } from './GridLayer'
import { fetchProject, postViewport, subscribeProject, type ApiProject } from './api'
import { EmptyState } from './icons'

const ws = new URLSearchParams(location.search).get('ws') ?? ''

function toFlowNodes(project: ApiProject): PageFlowNode[] {
  return project.nodes.map((n) => ({
    id: n.id,
    type: 'page',
    position: { x: n.x, y: n.y },
    data: { title: n.title, width: n.width, height: n.height, deviceType: n.deviceType, ws },
  }))
}

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<PageFlowNode>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const project = await fetchProject(ws)
      setNodes(toFlowNodes(project))
      setReady(true)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
      setReady(true)
    }
  }, [setNodes])

  useEffect(() => {
    if (!ws) {
      setError('缺少 ws 参数：请通过 canvas_open 返回的 URL 打开本页。')
      setReady(true)
      return
    }
    void load()
    return subscribeProject(ws, () => void load())
  }, [load])

  const onMove = useCallback(
    (_evt: unknown, viewport: { x: number; y: number; zoom: number }) => {
      if (ws) postViewport(ws, viewport)
    },
    [],
  )

  return (
    <ReactFlowProvider>
      <div className="app">
        <GridLayer />
        <ReactFlow<PageFlowNode, Edge>
          {...canvasConfig}
          nodes={nodes}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          onMove={onMove}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        >
          <MiniMap pannable zoomable position="bottom-right" />
        </ReactFlow>
        {ready && !error && nodes.length === 0 && <EmptyState />}
        {error && <div className="app-error">{error}</div>}
        <div className="hint">空格/中键拖拽 平移 · Ctrl+滚轮 缩放 · 滚轮 平移</div>
      </div>
    </ReactFlowProvider>
  )
}
