/**
 * 右下角缩放控件：缩小 / 百分比 / 放大 / 适应视图。
 * 替代 React Flow 自带 <Controls>，外观走便签风。
 */
import { useReactFlow, useViewport } from '@xyflow/react'
import { FitViewIcon, ZoomInIcon, ZoomOutIcon } from './icons'

export function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { zoom } = useViewport()

  return (
    <div className="zoom-controls">
      <button type="button" className="zoom-controls__btn" title="缩小" onClick={() => void zoomOut({ duration: 200 })}>
        <ZoomOutIcon size={16} />
      </button>
      <span className="zoom-controls__value">{Math.round(zoom * 100)}%</span>
      <button type="button" className="zoom-controls__btn" title="放大" onClick={() => void zoomIn({ duration: 200 })}>
        <ZoomInIcon size={16} />
      </button>
      <span className="zoom-controls__sep" />
      <button
        type="button"
        className="zoom-controls__btn"
        title="适应视图"
        onClick={() => void fitView({ padding: 0.3, maxZoom: 1, duration: 400 })}
      >
        <FitViewIcon size={16} />
      </button>
    </div>
  )
}
