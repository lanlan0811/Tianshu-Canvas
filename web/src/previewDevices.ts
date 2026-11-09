/**
 * 预览设备预设：右键「预览设备」与预览层共用。
 *
 * 数值与 src/device.ts 的 desktop/tablet/mobile 保持一致，避免「预览尺寸」与
 * 「节点设备口径」对不上；自定义（free）默认 800×600。
 */
export const PREVIEW_DEVICES = {
  desktop: { label: '网页', width: 1440, height: 900 },
  tablet: { label: '平板', width: 768, height: 1024 },
  mobile: { label: '手机', width: 375, height: 812 },
  free: { label: '自定义', width: 800, height: 600 },
} as const

export type PreviewDevice = keyof typeof PREVIEW_DEVICES

export const PREVIEW_DEVICE_ORDER: PreviewDevice[] = ['desktop', 'tablet', 'mobile', 'free']

/** 自定义尺寸的可输入范围（clamp 用）。 */
export const PREVIEW_MIN_SIZE = 1
export const PREVIEW_MAX_SIZE = 10000
