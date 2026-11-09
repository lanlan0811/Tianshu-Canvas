/**
 * 顶栏设计风格展示（只读）：显示当前项目级风格与色卡，画布上不可切换。
 * 风格由 AI 通过 canvas_style 设定/切换；锁定后所有页面视觉统一，避免误操作改掉设计系统。
 */
import type { ApiDesignCatalog, ApiDesignStyleSummary } from './api'
import { LockIcon, PaletteIcon, SparkIcon } from './icons'

export interface StyleSwitcherProps {
  catalog: ApiDesignCatalog | null
  current: { styleId: string; updatedAt: number } | null
}

function Swatches({ style, size = 8 }: { style: ApiDesignStyleSummary; size?: number }) {
  return (
    <span className="style-switcher__swatches" aria-hidden="true">
      {style.swatches.slice(0, 4).map((color) => (
        <span
          key={color}
          className="style-switcher__dot"
          style={{ width: size, height: size, background: color }}
        />
      ))}
    </span>
  )
}

export function StyleSwitcher({ catalog, current }: StyleSwitcherProps) {
  const currentStyle = catalog?.styles.find((s) => s.id === current?.styleId) ?? null

  return (
    <div className="style-switcher">
      <div
        className="style-switcher__chip"
        title="设计风格已锁定，画布上不可更改；如需调整请让 AI 重新设定"
        aria-label={`设计风格：${currentStyle ? currentStyle.name : '自由发挥'}（已锁定，画布上不可更改）`}
      >
        <PaletteIcon size={14} />
        {currentStyle ? <Swatches style={currentStyle} /> : <SparkIcon size={13} />}
        <span className="style-switcher__name">{currentStyle ? currentStyle.name : '自由发挥'}</span>
        <span className="style-switcher__lock">
          <LockIcon size={12} />
        </span>
      </div>
    </div>
  )
}
