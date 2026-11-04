/**
 * 内联 SVG 图标与空态。项目规则：不使用 emoji 作为图标，一律用 SVG。
 */
import type { CSSProperties } from 'react'

interface IconProps {
  size?: number
  style?: CSSProperties
}

function Svg({ size = 16, style, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function DesktopIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </Svg>
  )
}

export function TabletIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M12 18h.01" />
    </Svg>
  )
}

export function MobileIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 19h2" />
    </Svg>
  )
}

export function FreeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M9 5v14M15 5v14" />
    </Svg>
  )
}

export function DeviceIcon({ type, ...p }: IconProps & { type: string }) {
  switch (type) {
    case 'tablet':
      return <TabletIcon {...p} />
    case 'mobile':
      return <MobileIcon {...p} />
    case 'free':
      return <FreeIcon {...p} />
    default:
      return <DesktopIcon {...p} />
  }
}

export function CanvasIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 9v12" />
    </Svg>
  )
}

export function EmptyState() {
  return (
    <div className="empty-state">
      <CanvasIcon size={48} style={{ opacity: 0.4 }} />
      <p className="empty-state__title">画布为空</p>
      <p className="empty-state__desc">让天枢生成一个前端原型页面，然后调用 canvas_add_page 加入画布。</p>
    </div>
  )
}
