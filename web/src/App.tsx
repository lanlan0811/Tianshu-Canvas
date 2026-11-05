/**
 * 画布应用：拉项目 → 渲染 React Flow 无限画布 → 订阅 SSE 实时刷新。
 * v0.1.2：接入探针桥（选中/悬停/滚轮/编辑）、选中面板、连线编排、导出模式。
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'
import { canvasConfig } from './canvasConfig'
import { nodeTypes, type PageFlowNode } from './PageNode'
import { GridLayer } from './GridLayer'
import { SketchDefs } from './SketchDefs'
import { TopBar } from './TopBar'
import { PageListSidebar } from './PageListSidebar'
import { ZoomControls } from './ZoomControls'
import { ContextMenu, type ContextMenuState } from './ContextMenu'
import { InkEdge } from './edges/InkEdge'
import { SelectionPanel } from './SelectionPanel'
import { CanvasActionsProvider, type CanvasActions } from './actions'
import { postToPage, useProbeBridge } from './ProbeBridge'
import {
  exportFileUrl,
  fetchDesignSystems,
  fetchPageSource,
  fetchProject,
  fetchSelection,
  postDesignStyle,
  postEdge,
  postNodeOp,
  postPageHtml,
  postSelection,
  postViewport,
  requestExport,
  subscribeEvents,
  type ApiDesignCatalog,
  type ApiProject,
  type ApiSelection,
} from './api'
import { EmptyState } from './EmptyState'
import { applyEditToSource, textFingerprint, type SourceEdits } from './sourceEdit'

const params = new URLSearchParams(location.search)
const ws = params.get('ws') ?? ''
const exporting = params.get('export') === '1'

const edgeTypes = { ink: InkEdge }
const defaultEdgeOptions = {
  type: 'ink',
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#2b2b2b' },
}

/** .page-node 上下边框之和：节点高度要多出这一点，iframe 视口才等于内容高度。 */
const NODE_BORDER = 2

function toFlowNodes(
  project: ApiProject,
  contentHeights: Map<string, number>,
  previous: PageFlowNode[],
): PageFlowNode[] {
  const byId = new Map(previous.map((n) => [n.id, n]))
  return project.nodes.map((n) => {
    const prev = byId.get(n.id)
    return {
      // 项目刷新只更新服务端数据；选中、置顶、尺寸测量等客户端状态要保留。
      ...prev,
      id: n.id,
      type: 'page' as const,
      // 正在拖拽的节点以本地位置为准，否则会被刷新拉回去。
      position: prev?.dragging ? prev.position : { x: n.x, y: n.y },
      data: {
        title: n.title,
        width: n.width,
        height: n.height,
        deviceType: n.deviceType,
        ws,
        rev: n.htmlRev,
        contentHeight: contentHeights.get(n.id),
        elementSelected: prev?.data.elementSelected,
      },
    }
  })
}

/** 可以恢复的视口：从未保存过、导出模式或看不到任何节点时返回 null，交给适应视图。 */
function restorableViewport(project: ApiProject): Viewport | null {
  const { x, y, zoom } = project.viewport
  if (exporting || (x === 0 && y === 0 && zoom === 1)) return null
  const visible = project.nodes.some((n) => {
    const left = n.x * zoom + x
    const top = n.y * zoom + y
    return left < window.innerWidth && left + n.width * zoom > 0 && top < window.innerHeight && top + n.height * zoom > 0
  })
  return visible ? { x, y, zoom } : null
}

function toFlowEdges(project: ApiProject): Edge[] {
  return project.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label }))
}

function Canvas() {
  const [nodes, setNodes, baseOnNodesChange] = useNodesState<PageFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [ready, setReady] = useState(false)
  // 首次拉到项目后才知道怎么定位：undefined=加载中，null=适应视图。
  const [initialViewport, setInitialViewport] = useState<Viewport | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<ApiSelection | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [catalog, setCatalog] = useState<ApiDesignCatalog | null>(null)
  const [design, setDesign] = useState<{ styleId: string; updatedAt: number } | null>(null)
  const [styleBusy, setStyleBusy] = useState(false)
  const nodesRef = useRef<PageFlowNode[]>([])
  nodesRef.current = nodes
  // 高度只在页面加载时上报一次，项目刷新重建节点时不能丢。
  const contentHeights = useRef(new Map<string, number>())

  const { setViewport, getViewport, fitView } = useReactFlow()

  const loadProject = useCallback(async () => {
    try {
      const project = await fetchProject(ws)
      setNodes((prev) => toFlowNodes(project, contentHeights.current, prev))
      setInitialViewport((current) => (current === undefined ? restorableViewport(project) : current))
      setEdges(toFlowEdges(project))
      setDesign(project.design ?? null)
      setReady(true)
      setError(project.issue ?? null)
    } catch (err) {
      setError((err as Error).message)
      setInitialViewport((current) => (current === undefined ? null : current))
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
          editableText: payload.editableText,
          computedStyles: payload.computedStyles,
        },
      }
      setSelection(sel)
      markElementSelected(sel)
      void postSelection(ws, pageId, 'element', { ...payload } as Record<string, unknown>)
    },
    onEditApplied: (_pageId, ok, err) => {
      if (!ok) setError(`修改已保存，但画布预览未更新，刷新页面可查看：${err ?? '未知错误'}`)
    },
    onHeight: (pageId, height) => {
      if (height <= 0) return
      const contentHeight = height + NODE_BORDER
      contentHeights.current.set(pageId, contentHeight)
      setNodes((nds) => nds.map((n) => (n.id === pageId ? { ...n, data: { ...n.data, contentHeight } } : n)))
    },
    onWheel: (_pageId, e) => {
      const vp = getViewport()
      let next = { ...vp, x: vp.x - e.deltaX, y: vp.y - e.deltaY }
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY / 500)
        next = { ...vp, zoom: Math.min(5, Math.max(0.1, vp.zoom * factor)) }
      }
      void setViewport(next)
      // 程序设置视口时 onMove 没有事件对象，不会保存，这里补上。
      if (!exporting) postViewport(ws, next)
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

  // 侧栏点击：选中该页并定位到它
  const selectAndFit = useCallback(
    (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id)
      if (!node) return
      const sel: ApiSelection = { pageId: id, kind: 'page', at: Date.now() }
      setSelection(sel)
      markElementSelected(sel)
      void postSelection(ws, id, 'page')
      void fitView({ nodes: [{ id }], padding: 0.5, maxZoom: 1, duration: 600 })
    },
    [fitView],
  )

  // 右键菜单：节点 / 空白
  const onNodeContextMenu = useCallback((e: ReactMouseEvent, node: PageFlowNode) => {
    e.preventDefault()
    setMenu({ kind: 'node', x: e.clientX, y: e.clientY, nodeId: node.id, title: node.data.title })
  }, [])

  const onPaneContextMenu = useCallback((e: ReactMouseEvent | MouseEvent) => {
    e.preventDefault()
    setMenu({ kind: 'pane', x: e.clientX, y: e.clientY })
  }, [])

  // 置顶：客户端 zIndex，不持久化（刷新页面后复位）
  const bringToFront = useCallback(
    (id: string) => {
      setNodes((nds) => {
        const max = Math.max(0, ...nds.map((n) => n.zIndex ?? 0))
        return nds.map((n) => (n.id === id ? { ...n, zIndex: max + 1 } : n))
      })
    },
    [setNodes],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      void postEdge(ws, 'add', c.source, c.target)
    },
    [],
  )

  // 先改源文件并确认保存成功，再更新画布预览，保证两边一致。
  const applyEdits = useCallback(
    async (pageId: string, element: NonNullable<ApiSelection['element']>, edits: SourceEdits) => {
      try {
        const source = await fetchPageSource(ws, pageId)
        const result = applyEditToSource(source, element.xpath, element.textContent ?? '', edits)
        if (!result.ok) {
          setError(result.error)
          return
        }
        if (!(await postPageHtml(ws, pageId, result.html))) {
          setError('保存失败，修改没有写入文件。')
          return
        }
        setError(null)
        postToPage(pageId, '__vd_apply_edits', { xpath: element.xpath, ...edits })
        if (edits.text !== undefined) {
          const next = { ...element, textContent: textFingerprint(edits.text), editableText: edits.text }
          setSelection({ pageId, kind: 'element', at: Date.now(), element: next })
          void postSelection(ws, pageId, 'element', next)
        }
      } catch (err) {
        setError(`保存失败：${(err as Error).message}`)
      }
    },
    [],
  )

  const pickStyle = useCallback(
    async (styleId: string | null) => {
      setStyleBusy(true)
      setError(null)
      const failure = await postDesignStyle(ws, styleId)
      if (failure) setError(failure)
      else await loadProject()
      setStyleBusy(false)
    },
    [loadProject],
  )

  const [exportingNow, setExportingNow] = useState(false)

  const doExport = useCallback(async (kind: 'png' | 'zip' | 'both') => {
    setExportingNow(true)
    try {
      const result = await requestExport(ws, kind)
      if (!result.ok) {
        setError(result.error ?? '导出失败')
        return
      }
      for (const f of result.files) {
        const a = document.createElement('a')
        a.href = exportFileUrl(ws, f.name)
        a.download = f.name
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
      if (result.pngError) setError(`PNG 导出未完成：${result.pngError}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setExportingNow(false)
    }
  }, [])

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
      setInitialViewport(null)
      setReady(true)
      return
    }
    void loadProject()
    void loadSelection()
    void fetchDesignSystems().then(setCatalog)
    return subscribeEvents(ws, {
      onProject: () => void loadProject(),
      onSelection: () => void loadSelection(),
    })
  }, [loadProject, loadSelection])

  const onMove = useCallback(
    (evt: unknown, viewport: { x: number; y: number; zoom: number }) => {
      // 只保存用户操作。初次适应视图等程序调用没有事件对象，保存了会盖掉真正的视口。
      if (evt && ws && !exporting) postViewport(ws, viewport)
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

  // 待机态（等原型出现前的空态）：空态时隐藏左下角 .hint，避免与空态里的快捷键重复
  const showIdle = ready && !error && nodes.length === 0

  return (
    <CanvasActionsProvider value={actions}>
      <div className={`app${exporting ? ' app--exporting' : ''}`}>
        <GridLayer />
        <SketchDefs />
        {initialViewport !== undefined && (
        <ReactFlow<PageFlowNode, Edge>
          {...canvasConfig}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onPaneClick={() => setMenu(null)}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onMove={onMove}
          defaultViewport={initialViewport ?? undefined}
          fitView={initialViewport === null}
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        >
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            className="minimap"
            bgColor="var(--paper-2)"
            maskColor="rgba(43, 43, 43, 0.08)"
            nodeColor="var(--amber)"
            nodeStrokeColor="#2b2b2b"
            nodeStrokeWidth={2}
            nodeBorderRadius={3}
          />
        </ReactFlow>
        )}
        {showIdle && <EmptyState />}
        {error && <div className="app-error">{error}</div>}
        {!exporting && (
          <TopBar
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            onExport={doExport}
            busy={exportingNow}
            catalog={catalog}
            design={design}
            onPickStyle={(id) => void pickStyle(id)}
            styleBusy={styleBusy}
          />
        )}
        {!exporting && sidebarOpen && (
          <PageListSidebar
            nodes={nodes}
            selectedId={selection?.pageId ?? null}
            onPick={selectAndFit}
          />
        )}
        {!exporting && <ZoomControls />}
        {!exporting && !showIdle && (
          <div className="hint">空格/中键拖拽 平移 · Ctrl+滚轮 缩放 · 滚轮 平移 · 点击选中元素（Ctrl 点击选最内层）</div>
        )}
        {!exporting && (
          <SelectionPanel selection={selection} pageTitle={pageTitle} onApplyEdits={applyEdits} />
        )}
        {!exporting && menu && (
          <ContextMenu
            state={menu}
            onClose={() => setMenu(null)}
            onRename={actions.rename}
            onDuplicate={actions.duplicate}
            onRemove={actions.remove}
            onBringToFront={bringToFront}
            onFitView={() => void fitView({ padding: 0.3, maxZoom: 1, duration: 400 })}
          />
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
