/**
 * 内联 SVG 图标。项目规则：不使用 emoji 作为图标，一律用 SVG。
 * 画布空态见 ./EmptyState.tsx。
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

export function TrashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
    </Svg>
  )
}

export function CopyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </Svg>
  )
}

export function EditIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
      <path d="M14 6l4 4" />
    </Svg>
  )
}

export function LinkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </Svg>
  )
}

export function DownloadIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
    </Svg>
  )
}

export function ZoomInIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5 21 21M11 8v6M8 11h6" />
    </Svg>
  )
}

export function ZoomOutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5 21 21M8 11h6" />
    </Svg>
  )
}

export function FitViewIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </Svg>
  )
}

export function SidebarIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </Svg>
  )
}

export function RenameIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7V5h16v2M12 5v14M9 19h6" />
    </Svg>
  )
}

export function BringToFrontIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="12" height="12" rx="1.5" />
      <path d="M9 21h12V9" />
    </Svg>
  )
}

export function ChevronIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  )
}

export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}
