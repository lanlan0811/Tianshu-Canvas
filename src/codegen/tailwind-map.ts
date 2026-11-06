/**
 * ts-* 组件类 → Tailwind 工具类映射。
 *
 * 以 design-systems/components/components.json 的 26 个组件为准（防漂移：测试会断言
 * 每个 base 类都有映射）。映射刻意用 `var(--ts-*)` 任意值而非写死数值，
 * 这样换 tokens 时工具类仍然指向当前设计系统。
 *
 * 无对应标准工具类时用任意值语法（如 `p-[var(--ts-space-4)]`）兜底；
 * 仍未覆盖的类由 components.css 提供（见 codegen.ts 的说明）。
 */

export interface ComponentMapping {
  /** 组件 id（components.json 的 id）。 */
  id: string
  /** 基础类名（components.json 的 base）。 */
  base: string
  /** 映射到的 Tailwind 工具类串。 */
  utilities: string
}

export const TAILWIND_MAP: ComponentMapping[] = [
  { id: 'app', base: 'ts-app', utilities: 'flex min-h-[var(--ts-size-containerLg)] bg-[var(--ts-color-bg-canvas)] text-[var(--ts-color-text-primary)]' },
  { id: 'sidebar', base: 'ts-sidebar', utilities: 'w-[var(--ts-size-sidebar)] shrink-0 border-r border-[var(--ts-color-border-default)] bg-[var(--ts-color-bg-surface)]' },
  { id: 'main', base: 'ts-main', utilities: 'flex-1 min-w-0 bg-[var(--ts-color-bg-canvas)]' },
  { id: 'container', base: 'ts-container', utilities: 'mx-auto w-full max-w-[var(--ts-size-containerLg)] px-[var(--ts-space-6)]' },
  { id: 'stack', base: 'ts-stack', utilities: 'flex flex-col gap-[var(--ts-space-4)]' },
  { id: 'row', base: 'ts-row', utilities: 'flex flex-row items-center gap-[var(--ts-space-3)]' },
  { id: 'grid', base: 'ts-grid', utilities: 'grid gap-[var(--ts-space-4)]' },
  { id: 'section', base: 'ts-section', utilities: 'py-[var(--ts-space-6)]' },
  { id: 'button', base: 'ts-btn', utilities: 'inline-flex items-center justify-center gap-[var(--ts-space-2)] h-[var(--ts-size-controlMd)] px-[var(--ts-space-4)] rounded-[var(--ts-radius-md)] bg-[var(--ts-color-action-primary)] text-[var(--ts-color-action-primary-text)] font-[var(--ts-weight-medium)]' },
  { id: 'icon-button', base: 'ts-icon-btn', utilities: 'inline-flex items-center justify-center size-[var(--ts-size-controlMd)] rounded-[var(--ts-radius-md)] hover:bg-[var(--ts-color-action-ghost-hover)]' },
  { id: 'input', base: 'ts-input', utilities: 'h-[var(--ts-size-controlMd)] w-full px-[var(--ts-space-3)] rounded-[var(--ts-radius-md)] border border-[var(--ts-color-border-default)] bg-[var(--ts-color-bg-surface)] text-[var(--ts-color-text-primary)]' },
  { id: 'field', base: 'ts-field', utilities: 'flex flex-col gap-[var(--ts-space-2)]' },
  { id: 'select', base: 'ts-select', utilities: 'h-[var(--ts-size-controlMd)] px-[var(--ts-space-3)] rounded-[var(--ts-radius-md)] border border-[var(--ts-color-border-default)] bg-[var(--ts-color-bg-surface)]' },
  { id: 'switch', base: 'ts-switch', utilities: 'inline-flex h-[var(--ts-size-controlSm)] w-[calc(var(--ts-size-controlSm)*1.8)] items-center rounded-full bg-[var(--ts-color-border-strong)]' },
  { id: 'checkbox', base: 'ts-check', utilities: 'inline-flex size-[var(--ts-size-iconMd)] items-center justify-center rounded-[var(--ts-radius-sm)] border border-[var(--ts-color-border-default)]' },
  { id: 'card', base: 'ts-card', utilities: 'rounded-[var(--ts-radius-lg)] border border-[var(--ts-color-border-default)] bg-[var(--ts-color-bg-surface)] p-[var(--ts-space-5)] shadow-[var(--ts-shadow-sm)]' },
  { id: 'stat', base: 'ts-stat', utilities: 'flex flex-col gap-[var(--ts-space-1)]' },
  { id: 'badge', base: 'ts-badge', utilities: 'inline-flex items-center px-[var(--ts-space-2)] py-[var(--ts-space-1)] rounded-[var(--ts-radius-full)] text-[var(--ts-fs-xs)] font-[var(--ts-weight-medium)]' },
  { id: 'table', base: 'ts-table', utilities: 'w-full border-collapse text-[var(--ts-fs-md)]' },
  { id: 'nav', base: 'ts-nav', utilities: 'flex flex-col gap-[var(--ts-space-1)]' },
  { id: 'tabs', base: 'ts-tabs', utilities: 'flex flex-row gap-[var(--ts-space-2)] border-b border-[var(--ts-color-border-subtle)]' },
  { id: 'dialog', base: 'ts-dialog', utilities: 'rounded-[var(--ts-radius-lg)] bg-[var(--ts-color-bg-raised)] p-[var(--ts-space-6)] shadow-[var(--ts-shadow-lg)]' },
  { id: 'toast', base: 'ts-toast', utilities: 'rounded-[var(--ts-radius-md)] bg-[var(--ts-color-bg-inverse)] px-[var(--ts-space-4)] py-[var(--ts-space-3)] text-[var(--ts-color-text-inverse)] shadow-[var(--ts-shadow-md)]' },
  { id: 'avatar', base: 'ts-avatar', utilities: 'inline-flex size-[var(--ts-size-iconLg)] items-center justify-center overflow-hidden rounded-full bg-[var(--ts-color-bg-sunken)]' },
  { id: 'empty', base: 'ts-empty', utilities: 'flex flex-col items-center justify-center gap-[var(--ts-space-3)] py-[var(--ts-space-10)] text-[var(--ts-color-text-muted)]' },
  { id: 'progress', base: 'ts-progress', utilities: 'h-[var(--ts-space-2)] w-full overflow-hidden rounded-full bg-[var(--ts-color-bg-sunken)]' },
]

/** 以 base 类名为键的查找表。 */
export const TAILWIND_BY_BASE: Record<string, string> = Object.fromEntries(
  TAILWIND_MAP.map((m) => [m.base, m.utilities]),
)
