/**
 * 设备预设与尺寸换算。
 *
 * 画布上的「设计页」以逻辑分辨率渲染（iframe 以 1:1 逻辑像素渲染，再等比缩放到节点显示宽度），
 * 因此节点需要一对逻辑尺寸（width/height）。设备预设给出常用逻辑视口。
 */

export type DeviceType = 'desktop' | 'tablet' | 'mobile' | 'free'

export interface DevicePreset {
  label: string
  width: number
  height: number
}

export const DEVICE_PRESETS: Record<Exclude<DeviceType, 'free'>, DevicePreset> = {
  desktop: { label: '桌面', width: 1440, height: 900 },
  tablet: { label: '平板', width: 768, height: 1024 },
  mobile: { label: '手机', width: 375, height: 812 },
}

export const DEFAULT_DEVICE: DeviceType = 'desktop'

export function isDeviceType(value: unknown): value is DeviceType {
  return value === 'desktop' || value === 'tablet' || value === 'mobile' || value === 'free'
}

/**
 * 解析出节点逻辑尺寸。
 * 优先级：显式 width/height > 设备预设 > free（默认取桌面尺寸）。
 * free 且未给尺寸时回退到桌面预设，保证总有一个可用尺寸。
 */
export function resolveSize(
  device: DeviceType,
  width?: number,
  height?: number,
): { width: number; height: number } {
  const preset = device === 'free' ? DEVICE_PRESETS.desktop : DEVICE_PRESETS[device]
  const w = positiveOr(width, preset.width)
  const h = positiveOr(height, preset.height)
  return { width: w, height: h }
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}
