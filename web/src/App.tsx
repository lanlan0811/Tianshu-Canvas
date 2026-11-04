/**
 * 画布应用：拉项目 → 渲染 React Flow 无限画布 → 订阅 SSE 实时刷新。
 * v0.1.2：接入探针桥（选中/悬停/滚轮/编辑）、选中面板、连线编排、导出模式。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
} from '@xyflow/react'
import { canvasConfig } from './canvasConfig'
import { nodeTypes, type PageFlowNode } from './PageNode'
import { GridLayer } from './GridLayer'
import { SelectionPanel } from './SelectionPanel'
import { CanvasActionsProvider, type CanvasActions } from './actions'
import { postToPage, useProbeBridge } from './ProbeBridge'
import {
  fetchProject,
  fetchSelection,
  postEdge,
  postNodeOp,
  postPageHtml,
  postSelection,
  postViewport,
  subscribeEvents,
  type ApiProject,
  type ApiSelection,
} from './api'
import { EmptyState } from './icons'

const params = new URLSearchParams(location.search)
const ws = params.get('ws') ?? ''
const exporting = params.get('export') === '1'

function toFlowNodes(project: ApiProject): PageFlowNode[] {
  return project.nodes.map((n) => ({
    id: n.id,
    type: 'page',
    position: { x: n.x, y: n.y },
    data: { title: n.title, width: n.width, height: n.height, deviceType: n.deviceType, ws },
  }))
}

function toFlowEdges(project: ApiProject): Edge[] {
  return project.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label }))
}

function Canvas() {
  const [nodes, setNodes, baseOnNodesChange] = useNodesState<PageFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<ApiSelection | null>(null)
  const nodesRef = useRef<PageFlowNode[]>([])
  nodesRef.current = nodes

  const { setViewport, getViewport, fitView } = useReactFlow()

  const loadProject = useCallback(async () => {
    try {
      const project = await fetchProject(ws)
      setNodes(toFlowNodes(project))
      setEdges(toFlowEdges(project))
      setReady(true)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
      setReady(true)
    }
  }, [setNodes, setEdges])

  const loadSelection = useCallback(async () => {
    const sel = await fetchSelection(ws)
    setSelection(sel)
    markElementSelected(sel)
  }, [])

  function markElementSelected(sel: ApiSelection | null): void {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, elementSelected: !!sel && sel.kind === 'element' && sel.pageId === n.id },
      })),
    )
  }

  // 节点位置变化（拖拽结束）持久化
  const onNodesChange = useCallback(
    (changes: NodeChange<PageFlowNode>[]) => {
      baseOnNodesChange(changes)
      for (const c of changes) {
        if (c.type === 'position' && c.dragging === false && c.position) {
          void postNodeOp(ws, 'move', { id: c.id, x: Math.round(c.position.x), y: Math.round(c.position.y) })
        }
      }
    },
    [baseOnNodesChange],
  )

  // 探针桥
  useProbeBridge({
    onSelect: (pageId, payload) => {
      const sel: ApiSelection = {
        pageId,
        kind: 'element',
        at: Date.now(),
        element: {
          xpath: payload.xpath,
          tagName: payload.tagName,
          textContent: payload.textContent,
          computedStyles: payload.computedStyles,
        },
      }
      setSelection(sel)
      markElementSelected(sel)
      void postSelection(ws, pageId, 'element', { ...payload } as Record<string, unknown>)
    },
    onEditApplied: (_pageId, _xpath, ok, html, err) => {
      if (ok && html) void postPageHtml(ws, _pageId, html)
      else if (!ok) setError(`编辑失败：${err ?? '未知错误'}`)
    },
    onHeight: (pageId, height) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === pageId && height > 0 ? { ...n, data: { ...n.data, height } } : n)),
      )
    },
    onWheel: (_pageId, e) => {
      const vp = getViewport()
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY / 500)
        const zoom = Math.min(5, Math.max(0.1, vp.zoom * factor))
        void setViewport({ ...vp, zoom })
      } else {
        void setViewport({ ...vp, x: vp.x - e.deltaX, y: vp.y - e.deltaY })
      }
    },
  })

  // 节点级选中（点节点空白/标题）→ 记录为页面级选中
  const onNodeClick = useCallback(
    (_evt: unknown, node: PageFlowNode) => {
      const sel: ApiSelection = { pageId: node.id, kind: 'page', at: Date.now() }
      setSelection(sel)
      markElementSelected(sel)
      void postSelection(ws, node.id, 'page')
    },
    [],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      void postEdge(ws, 'add', c.source, c.target)
    },
    [],
  )

  const applyEdits = useCallback(
    (pageId: string, xpath: string, edits: { text?: string; styles?: Record<string, string> }) => {
      const ok = postToPage(pageId, '__vd_apply_edits', { xpath, ...edits })
      if (!ok) setError('无法向该页面发送编辑：iframe 未就绪。')
    },
    [],
  )

  // 画布编排动作（供节点工具栏调用）
  const actions: CanvasActions = {
    rename: (id, title) => {
      void postNodeOp(ws, 'rename', { id, title })
    },
    duplicate: (id) => {
      void postNodeOp(ws, 'duplicate', { id })
    },
    remove: (id) => {
      void postNodeOp(ws, 'remove', { id })
    },
  }

  useEffect(() => {
    if (!ws) {
      setError('缺少 ws 参数：请通过 canvas_open 返回的 URL 打开本页。')
      setReady(true)
      return
    }
    void loadProject()
    void loadSelection()
    return subscribeEvents(ws, {
      onProject: () => void loadProject(),
      onSelection: () => void loadSelection(),
    })
  }, [loadProject, loadSelection])

  const onMove = useCallback(
    (_evt: unknown, viewport: { x: number; y: number; zoom: number }) => {
      if (ws && !exporting) postViewport(ws, viewport)
    },
    [],
  )

  // 导出模式：铺满全部节点、隐藏交互外壳
  useEffect(() => {
    if (exporting && nodes.length > 0) {
      setTimeout(() => void fitView({ padding: 0.1, maxZoom: 1 }), 300)
    }
  }, [exporting, nodes.length, fitView])

  const selectedNode = selection ? nodes.find((n) => n.id === selection.pageId) : null
  const pageTitle = selectedNode ? selectedNode.data.title : null

  return (
    <CanvasActionsProvider value={actions}>
      <div className={`app${exporting ? ' app--exporting' : ''}`}>
        <GridLayer />
        <ReactFlow<PageFlowNode, Edge>
          {...canvasConfig}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          onMove={onMove}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        >
          <MiniMap pannable zoomable position="bottom-right" />
        </ReactFlow>
        {ready && !error && nodes.length === 0 && <EmptyState />}
        {error && <div className="app-error">{error}</div>}
        {!exporting && (
          <div className="hint">空格/中键拖拽 平移 · Ctrl+滚轮 缩放 · 滚轮 平移 · 点击选中元素（Ctrl 点击选最内层）</div>
        )}
        {!exporting && (
          <SelectionPanel selection={selection} pageTitle={pageTitle} onApplyEdits={applyEdits} />
        )}
      </div>
    </CanvasActionsProvider>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}
