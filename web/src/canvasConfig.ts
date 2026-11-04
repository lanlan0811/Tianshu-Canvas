/**
 * 无限画布配置（单一事实来源）。
 *
 * 复刻自 Trae SOLO 的 React Flow 配置（见 .claude/trae-solo-analysis/画布实现分析报告-TraeSOLO.md）：
 *  - 普通滚轮 = 平移（panOnScroll），Ctrl+滚轮 = 缩放（zoomActivationKeyCode）
 *  - 空格按住 = 手型平移（panActivationKeyCode），中键拖拽 = 平移（panOnDrag:[1]）
 *  - 框选 = 部分相交即选中；吸附网格 12px；隐藏署名
 */
import { ConnectionMode, SelectionMode, type Edge, type ReactFlowProps } from '@xyflow/react'
import type { PageFlowNode } from './PageNode'

export const canvasConfig: Partial<ReactFlowProps<PageFlowNode, Edge>> = {
  panOnScroll: true,
  panOnScrollSpeed: 1,
  zoomOnScroll: false,
  zoomOnPinch: true,
  zoomActivationKeyCode: 'Control',
  panActivationKeyCode: 'Space',
  panOnDrag: [1],
  selectionOnDrag: false,
  selectNodesOnDrag: false,
  selectionMode: SelectionMode.Partial,
  snapToGrid: true,
  snapGrid: [12, 12],
  deleteKeyCode: null,
  proOptions: { hideAttribution: true },
  minZoom: 0.1,
  maxZoom: 5,
  elevateNodesOnSelect: false,
  nodesConnectable: true,
  connectionMode: ConnectionMode.Loose,
}

export const GRID_STEP = 12
