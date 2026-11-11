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
  ApiRequestError,
  exportFileUrl,
  fetchDesignSystems,
  fetchProject,
  fetchSelection,
  postCommentOp,
  postEdge,
  postNodeOp,
  postSelection,
  postViewport,
  requestExport,
  subscribeEvents,
  type ApiComment,
  type ApiDesignCatalog,
  type ApiProject,
  type ApiSelection,
} from './api'
import { EmptyState } from './EmptyState'
import { PreviewOverlay } from './PreviewOverlay'
import { resolveNavTarget } from './navTarget'
import type { PreviewDevice } from './previewDevices'

const params = new URLSearchParams(location.search)
const ws = params.get('ws') ?? ''
const exporting = params.get('export') === '1'
/** 审计截图：只渲染指定页面（与 export=1 配合）。 */
const pageFilter = params.get('page') ?? ''

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
  commentCounts: Map<string, number>,
): PageFlowNode[] {
  const byId = new Map(previous.map((n) => [n.id, n]))
  const nodes = pageFilter ? project.nodes.filter((n) => n.id === pageFilter) : project.nodes
  return nodes.map((n) => {
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
        commentCount: commentCounts.get(n.id) ?? 0,
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
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [selection, setSelection] = useState<ApiSelection | null>(null)
  const [comments, setComments] = useState<ApiComment[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [preview, setPreview] = useState<{ pageId: string } | null>(null)
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop')
  const [previewFreeSize, setPreviewFreeSize] = useState({ width: 800, height: 600 })
  const [catalog, setCatalog] = useState<ApiDesignCatalog | null>(null)
  const [design, setDesign] = useState<{ styleId: string; updatedAt: number } | null>(null)
  const nodesRef = useRef<PageFlowNode[]>([])
  nodesRef.current = nodes
  const commentsRef = useRef<ApiComment[]>([])
  commentsRef.current = comments
  // 高度只在页面加载时上报一次，项目刷新重建节点时不能丢。
  const contentHeights = useRef(new Map<string, number>())

  const { setViewport, getViewport, fitView } = useReactFlow()

  /** 把某页未解决的批注推给该页 iframe（探针按 xpath 画编号图钉）。 */
  function syncCommentsToPage(pageId: string, list: ApiComment[]): void {
    const pins = list
      .filter((c) => c.pageId === pageId && !c.resolved)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((c) => ({ xpath: c.xpath, note: c.note }))
    postToPage(pageId, '__vd_set_comments', { comments: pins })
  }

  const loadProject = useCallback(async () => {
    try {
      const project = await fetchProject(ws)
      const list = project.comments ?? []
      const counts = new Map<string, number>()
      for (const c of list) if (!c.resolved) counts.set(c.pageId, (counts.get(c.pageId) ?? 0) + 1)
      setNodes((prev) => toFlowNodes(project, contentHeights.current, prev, counts))
      setInitialViewport((current) => (current === undefined ? restorableViewport(project) : current))
      setEdges(toFlowEdges(project))
      setDesign(project.design ?? null)
      setComments(list)
      setReady(true)
      setError(project.issue ?? null)
      // 把批注推给已加载的 iframe（图钉在 iframe 内绘制）。
      for (const n of project.nodes) syncCommentsToPage(n.id, list)
    } catch (err) {
      setError((err as Error).message)
      setInitialViewport((current) => (current === undefined ? null : current))
      setReady(true)
    }
  }, [setNodes, setEdges])

  const loadSelection = useCallback(async () => {
    try {
      const sel = await fetchSelection(ws)
      setSelection(sel)
      markElementSelected(sel)
    } catch {
      setError('无法读取选中状态，请检查画布服务后重试。')
    }
  }, [])

  /** 变更失败后重新读取服务端；错误独立保存，避免 SSE 刷新把拒绝提示清掉。 */
  useEffect(() => {
    const onWarning = (event: Event): void => {
      const detail: unknown = (event as CustomEvent<unknown>).detail
      if (typeof detail === 'string') setMutationError('导航提示：' + detail)
    }
    window.addEventListener('tianshu-canvas-warning', onWarning)
    return () => window.removeEventListener('tianshu-canvas-warning', onWarning)
  }, [])

  const runMutation = useCallback(async (operation: () => Promise<unknown>, restoreViewport = false): Promise<void> => {
    try {
      await operation()
    } catch (err) {
      setMutationError(err instanceof ApiRequestError ? err.message : '操作失败，请检查画布服务和工作区状态后重试。')
      await Promise.all([loadProject(), loadSelection()])
      if (restoreViewport) {
        try {
          const latest = await fetchProject(ws)
          await setViewport(latest.viewport)
        } catch {
          // 原始拒绝原因保留在画布；恢复失败不覆盖它。
        }
      }
    }
  }, [loadProject, loadSelection, setViewport])

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
          void runMutation(() => postNodeOp(ws, 'move', { id: c.id, x: Math.round(c.position!.x), y: Math.round(c.position!.y) }))
        }
      }
    },
    [baseOnNodesChange, runMutation],
  )

  // 侧栏点击 / 页面内链接跳转：选中该页并定位到它
  const selectAndFit = useCallback(
    (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id)
      if (!node) return
      const sel: ApiSelection = { pageId: id, kind: 'page', at: Date.now() }
      setSelection(sel)
      markElementSelected(sel)
      void runMutation(() => postSelection(ws, id, 'page'))
      void fitView({ nodes: [{ id }], padding: 0.5, maxZoom: 1, duration: 600 })
    },
    [fitView, runMutation],
  )

  // 探针桥
  useProbeBridge({
    onReady: (pageId) => {
      // iframe 就绪时补推该页批注（首屏注入可能早于项目数据到达）。
      syncCommentsToPage(pageId, commentsRef.current)
    },
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
      void runMutation(() => postSelection(ws, pageId, 'element', { ...payload } as Record<string, unknown>))
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
      if (!exporting) void runMutation(() => postViewport(ws, next), true)
    },
    onNavigate: (_pageId, nav) => {
      const ids = new Set(nodesRef.current.map((n) => n.id))
      const target = resolveNavTarget(nav, ids)
      if (target) selectAndFit(target)
    },
  })

  // 节点级选中（点节点空白/标题）→ 记录为页面级选中
  const onNodeClick = useCallback(
    (_evt: unknown, node: PageFlowNode) => {
      const sel: ApiSelection = { pageId: node.id, kind: 'page', at: Date.now() }
      setSelection(sel)
      markElementSelected(sel)
      void runMutation(() => postSelection(ws, node.id, 'page'))
    },
    [runMutation],
  )

  // 右键菜单：节点 / 空白
  const onNodeContextMenu = useCallback((e: ReactMouseEvent, node: PageFlowNode) => {
    e.preventDefault()
    setMenu({ kind: 'node', x: e.clientX, y: e.clientY, nodeId: node.id })
  }, [])

  const onPaneContextMenu = useCallback((e: ReactMouseEvent | MouseEvent) => {
    e.preventDefault()
    setMenu({ kind: 'pane', x: e.clientX, y: e.clientY })
  }, [])

  // 右键「预览」/「预览设备」：设备只影响预览视口，不改节点、不写盘。
  const openPreview = useCallback((id: string) => {
    setPreview({ pageId: id })
  }, [])

  const openPreviewDevice = useCallback((id: string, device: PreviewDevice) => {
    setPreviewDevice(device)
    setPreview({ pageId: id })
  }, [])

  const closePreview = useCallback(() => setPreview(null), [])

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      void runMutation(() => postEdge(ws, 'add', c.source!, c.target!))
    },
    [runMutation],
  )

  // 批注：写盘后重拉项目（SSE 也会刷新，这里保证即时反馈）。
  const addComment = useCallback(
    async (input: { pageId: string; xpath: string; tagName: string; textContent?: string; note: string }) => {
      await runMutation(async () => { await postCommentOp(ws, 'add', input); await loadProject() })
    },
    [loadProject, runMutation],
  )

  const toggleResolve = useCallback(
    async (id: string, resolved: boolean) => {
      await runMutation(async () => { await postCommentOp(ws, 'resolve', { ids: [id], resolved }); await loadProject() })
    },
    [loadProject, runMutation],
  )

  const removeComment = useCallback(
    async (id: string) => {
      await runMutation(async () => { await postCommentOp(ws, 'remove', { ids: [id] }); await loadProject() })
    },
    [loadProject, runMutation],
  )

  const [exportingNow, setExportingNow] = useState(false)

  const doExport = useCallback(async (kind: 'png' | 'zip' | 'both') => {
    setExportingNow(true)
    try {
      const result = await requestExport(ws, kind)
      if (!result.ok) {
        setMutationError(result.error ?? '导出失败')
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
      if (result.pngError) setMutationError(`PNG 导出未完成：${result.pngError}`)
    } catch (err) {
      setMutationError(err instanceof ApiRequestError ? err.message : '导出失败，请检查画布服务和工作区状态后重试。')
    } finally {
      setExportingNow(false)
    }
  }, [])

  // 画布编排动作（供节点工具栏调用）
  const actions: CanvasActions = {
    rename: (id, title) => {
      void runMutation(() => postNodeOp(ws, 'rename', { id, title }))
    },
    duplicate: (id) => {
      void runMutation(() => postNodeOp(ws, 'duplicate', { id }))
    },
    remove: (id) => {
      void runMutation(() => postNodeOp(ws, 'remove', { id }))
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
    void fetchDesignSystems(ws).then(setCatalog)
    return subscribeEvents(ws, {
      onProject: () => {
        void loadProject()
        // 自定义设计系统是工作区数据，AI 侧新建后要让它出现在顶栏切换器里。
        void fetchDesignSystems(ws).then(setCatalog)
      },
      onSelection: () => void loadSelection(),
    })
  }, [loadProject, loadSelection])

  const onMove = useCallback(
    (evt: unknown, viewport: { x: number; y: number; zoom: number }) => {
      // 只保存用户操作。初次适应视图等程序调用没有事件对象，保存了会盖掉真正的视口。
      if (evt && ws && !exporting) void runMutation(() => postViewport(ws, viewport), true)
    },
    [runMutation],
  )

  // 导出模式：铺满全部节点、隐藏交互外壳
  useEffect(() => {
    if (exporting && nodes.length > 0) {
      setTimeout(() => void fitView({ padding: 0.1, maxZoom: 1 }), 300)
    }
  }, [exporting, nodes.length, fitView])

  const selectedNode = selection ? nodes.find((n) => n.id === selection.pageId) : null
  const pageTitle = selectedNode ? selectedNode.data.title : null
  const pageComments = selection
    ? comments.filter((c) => c.pageId === selection.pageId).sort((a, b) => a.createdAt - b.createdAt)
    : []

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
        {(mutationError || error) && (
          <div className="app-error" role="alert">
            <span>{mutationError || error}</span>
            {mutationError && <button type="button" className="app-error__dismiss" onClick={() => setMutationError(null)}>关闭提示</button>}
          </div>
        )}
        {!exporting && (
          <TopBar
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            onExport={doExport}
            busy={exportingNow}
            catalog={catalog}
            design={design}
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
          <div className="hint">空格/中键拖拽 平移 · Ctrl+滚轮 缩放 · 滚轮 平移 · 点击选中元素（Ctrl 点击选最内层） · 点页面内链接跳到对应页</div>
        )}
        {!exporting && (
          <SelectionPanel
            selection={selection}
            pageTitle={pageTitle}
            comments={pageComments}
            onAddComment={addComment}
            onToggleResolve={toggleResolve}
            onRemoveComment={removeComment}
          />
        )}
        {!exporting && menu && (
          <ContextMenu
            state={menu}
            previewDevice={previewDevice}
            onClose={() => setMenu(null)}
            onPreview={openPreview}
            onPreviewDevice={openPreviewDevice}
            onFitView={() => void fitView({ padding: 0.3, maxZoom: 1, duration: 400 })}
          />
        )}
        {!exporting && preview && (
          <PreviewOverlay
            pages={nodes}
            initialPageId={preview.pageId}
            ws={ws}
            device={previewDevice}
            freeSize={previewFreeSize}
            onDeviceChange={setPreviewDevice}
            onFreeSizeChange={setPreviewFreeSize}
            onClose={closePreview}
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
