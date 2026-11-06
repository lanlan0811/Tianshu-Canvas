/**
 * 全局 SVG defs：手绘抖动滤镜 + 墨色箭头 marker。
 *
 * 仅在静态外壳（提示条边框）上使用 #sketch——
 * 这些元素不在画布变换内，滤镜只栅格化一次，不会在平移/缩放时逐帧重绘。
 * 节点与连线一律走 CSS 方案（非对称圆角 / 双 path），避免性能问题。
 */
export function SketchDefs() {
  return (
    <svg className="sketch-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="sketch" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <marker
          id="ink-arrow"
          viewBox="0 0 12 12"
          markerWidth="9"
          markerHeight="9"
          refX="8"
          refY="6"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M2 2 10 6 2 10 4 6z" fill="var(--ink)" />
        </marker>
      </defs>
    </svg>
  )
}
