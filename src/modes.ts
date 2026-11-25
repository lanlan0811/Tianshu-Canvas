/**
 * 页面模式（surface mode）：决定这个页面访客的成功是什么，进而决定
 * 检测器画像与设计流程约束。
 *
 * 关键判据：按**页面**选，不按产品整体选。
 * 工具的落地页仍然是 persuade；时尚品牌的文档仍然是 read。
 *
 * 本模块不依赖 project.ts（避免运行时循环），也不做持久化。
 */
export const SURFACE_MODES = ['persuade', 'operate', 'read', 'experience'] as const

export type SurfaceMode = (typeof SURFACE_MODES)[number]

const LABELS: Record<SurfaceMode, string> = {
  persuade: '说服型',
  operate: '操作型',
  read: '阅读型',
  experience: '体验型',
}

/** 每种模式的用途说明，用于报错与文档。 */
const PURPOSES: Record<SurfaceMode, string> = {
  persuade: '访客决定并行动：落地页、营销页、活动页、定价页',
  operate: '访客完成一个任务：后台、看板、设置、工具界面',
  read: '访客理解一件事：文档、指南、文章、更新日志',
  experience: '访客身处作品之中：作品集、画廊、展示',
}

/** 把外部输入归一成合法模式；无法识别时返回 null（不猜测）。 */
export function normalizeSurfaceMode(value: unknown): SurfaceMode | null {
  if (typeof value !== 'string') return null
  const lower = value.trim().toLowerCase()
  return (SURFACE_MODES as readonly string[]).includes(lower) ? (lower as SurfaceMode) : null
}

/** 中文标签，例如 operate → 操作型。 */
export function surfaceModeLabel(mode: SurfaceMode): string {
  return LABELS[mode]
}

/** 用途说明，用于错误提示。 */
export function surfaceModePurpose(mode: SurfaceMode): string {
  return PURPOSES[mode]
}

/** 给报错用的可选值清单。 */
export function surfaceModeChoices(): string {
  return SURFACE_MODES.map((m) => `${m}（${LABELS[m]}）`).join('、')
}
