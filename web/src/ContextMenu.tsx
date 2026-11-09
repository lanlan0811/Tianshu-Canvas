/**
 * 右键菜单：节点版（预览/预览设备/重命名/复制/置于顶层/删除）与空白版（适应视图）。
 * 定位用视口坐标，渲染在 .app 内（不在画布变换里），外点与 Esc 关闭。
 *
 * 「预览设备」为二级菜单：网页 / 平板 / 手机 / 自定义，当前项打勾；
 * 选择后直接按该设备进入画布内预览。二级菜单靠近视口右缘时向左翻转。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import {
  BringToFrontIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  DesktopIcon,
  DeviceIcon,
  FitViewIcon,
  FreeIcon,
  MobileIcon,
  PlayIcon,
  RenameIcon,
  TabletIcon,
  TrashIcon,
} from './icons'
import { PREVIEW_DEVICES, PREVIEW_DEVICE_ORDER, type PreviewDevice } from './previewDevices'

export type ContextMenuState =
  | { kind: 'node'; x: number; y: number; nodeId: string; title: string }
  | { kind: 'pane'; x: number; y: number }

export interface ContextMenuProps {
  state: ContextMenuState
  previewDevice: PreviewDevice
  onClose: () => void
  onPreview: (id: string) => void
  onPreviewDevice: (id: string, device: PreviewDevice) => void
  onRename: (id: string, title: string) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
  onBringToFront: (id: string) => void
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
  onRename,
  onDuplicate,
  onRemove,
  onBringToFront,
  onFitView,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(state.kind === 'node' ? state.title : '')
  const [deviceOpen, setDeviceOpen] = useState(false)
  const [subLeft, setSubLeft] = useState(false)

  useEffect(() => {
    setEditing(false)
    setTitle(state.kind === 'node' ? state.title : '')
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

  function commitRename(): void {
    if (state.kind !== 'node') return
    const next = title.trim()
    if (next && next !== state.title) onRename(state.nodeId, next)
    onClose()
  }

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
        editing ? (
          <input
            className="context-menu__input"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') onClose()
            }}
          />
        ) : (
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
            <div className="context-menu__sep" role="separator" />
            <button type="button" className="context-menu__item" onClick={() => setEditing(true)}>
              <RenameIcon size={14} /> 重命名
            </button>
            <button
              type="button"
              className="context-menu__item"
              onClick={() => {
                onDuplicate(state.nodeId)
                onClose()
              }}
            >
              <CopyIcon size={14} /> 复制
            </button>
            <button
              type="button"
              className="context-menu__item"
              onClick={() => {
                onBringToFront(state.nodeId)
                onClose()
              }}
            >
              <BringToFrontIcon size={14} /> 置于顶层
            </button>
            <button
              type="button"
              className="context-menu__item context-menu__item--danger"
              onClick={() => {
                onRemove(state.nodeId)
                onClose()
              }}
            >
              <TrashIcon size={14} /> 删除
            </button>
          </>
        )
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
