/**
 * 右键菜单：节点版（预览/预览设备）与空白版（适应视图）。
 * 定位用视口坐标，渲染在 .app 内（不在画布变换里），外点与 Esc 关闭。
 *
 * 「预览设备」为二级菜单：网页 / 平板 / 手机 / 自定义，当前项打勾；
 * 选择后直接按该设备进入画布内预览。二级菜单靠近视口右缘时向左翻转。
 * 页面节点的重命名/复制/删除由节点悬浮工具栏提供，不在此菜单重复。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import {
  CheckIcon,
  ChevronRightIcon,
  DesktopIcon,
  DeviceIcon,
  FitViewIcon,
  FreeIcon,
  MobileIcon,
  PlayIcon,
  TabletIcon,
} from './icons'
import { PREVIEW_DEVICES, PREVIEW_DEVICE_ORDER, type PreviewDevice } from './previewDevices'

export type ContextMenuState =
  | { kind: 'node'; x: number; y: number; nodeId: string }
  | { kind: 'pane'; x: number; y: number }

export interface ContextMenuProps {
  state: ContextMenuState
  previewDevice: PreviewDevice
  onClose: () => void
  onPreview: (id: string) => void
  onPreviewDevice: (id: string, device: PreviewDevice) => void
  onFitView: () => void
}

const DEVICE_ICONS: Record<PreviewDevice, ComponentType<{ size?: number }>> = {
  desktop: DesktopIcon,
  tablet: TabletIcon,
  mobile: MobileIcon,
  free: FreeIcon,
}

export function ContextMenu({
  state,
  previewDevice,
  onClose,
  onPreview,
  onPreviewDevice,
  onFitView,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const [deviceOpen, setDeviceOpen] = useState(false)
  const [subLeft, setSubLeft] = useState(false)

  useEffect(() => {
    setDeviceOpen(false)
  }, [state])

  useEffect(() => {
    function onDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // 二级菜单超出右缘时向左展开；上下越界时贴住视口底部。
  useLayoutEffect(() => {
    if (!deviceOpen || !ref.current || !subRef.current) return
    const sub = subRef.current.getBoundingClientRect()
    setSubLeft(sub.right > window.innerWidth - 8)
    if (sub.bottom > window.innerHeight - 8) {
      subRef.current.style.top = `${Math.max(0, window.innerHeight - 8 - sub.bottom)}px`
    }
  }, [deviceOpen])

  function pickDevice(id: string, device: PreviewDevice): void {
    onPreviewDevice(id, device)
    onClose()
  }

  return (
    <div
      className="context-menu"
      ref={ref}
      style={{ left: state.x, top: state.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.kind === 'node' ? (
        <>
          <button
            type="button"
            className="context-menu__item"
            onClick={() => {
              onPreview(state.nodeId)
              onClose()
            }}
          >
            <PlayIcon size={14} /> 预览
          </button>
          <div
            className="context-menu__subwrap"
            onMouseEnter={() => setDeviceOpen(true)}
            onMouseLeave={() => setDeviceOpen(false)}
          >
            <button
              type="button"
              className={`context-menu__item${deviceOpen ? ' is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={deviceOpen}
              onClick={() => setDeviceOpen((v) => !v)}
            >
              <DeviceIcon type={previewDevice} size={14} /> 预览设备
              <span className="context-menu__chevron">
                <ChevronRightIcon size={13} />
              </span>
            </button>
            {deviceOpen && (
              <div
                className={`context-menu__sub${subLeft ? ' is-left' : ''}`}
                ref={subRef}
                role="menu"
              >
                {PREVIEW_DEVICE_ORDER.map((device) => {
                  const Icon = DEVICE_ICONS[device]
                  const active = previewDevice === device
                  return (
                    <button
                      key={device}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className={`context-menu__item context-menu__subitem${active ? ' is-active' : ''}`}
                      onClick={() => pickDevice(state.nodeId, device)}
                    >
                      <Icon size={14} /> {PREVIEW_DEVICES[device].label}
                      {active && (
                        <span className="context-menu__check">
                          <CheckIcon size={13} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <button
          type="button"
          className="context-menu__item"
          onClick={() => {
            onFitView()
            onClose()
          }}
        >
          <FitViewIcon size={14} /> 适应视图
        </button>
      )}
    </div>
  )
}
