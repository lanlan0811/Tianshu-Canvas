/**
 * 手绘连线：墨色贝塞尔 + 一条错位淡影 path 造「抖动」笔触。
 *
 * 不用 SVG 滤镜——连线位于画布缩放变换内，滤镜会在平移/缩放时逐帧重栅格化，
 * 是明显的卡顿来源；双 path 叠加是零成本的手绘替代方案。
 * 箭头用 SketchDefs 里的 #ink-arrow marker（随内容缩放）。
 */
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'

export function InkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  markerEnd,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="ink-edge" />
      <path d={path} className="ink-edge__ghost" />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
