/**
 * 自绘网格层（替代 React Flow 的 <Background>，与 Trae SOLO 的做法一致）。
 * 读取当前视口变换，用 CSS 背景平铺出主/次网格。
 */
import { useViewport } from '@xyflow/react'
import { GRID_STEP } from './canvasConfig'

export function GridLayer() {
  const { x, y, zoom } = useViewport()
  const step = GRID_STEP * zoom
  return (
    <div
      className="grid-layer"
      style={{
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${x}px ${y}px`,
      }}
    />
  )
}
