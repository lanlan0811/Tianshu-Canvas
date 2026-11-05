/**
 * 顶栏设计风格切换器：显示当前项目级风格与色卡，点开可切换或回到「自由发挥」。
 * 切换走 POST /api/design；服务端会重写所有页面并广播 SSE，画布随之刷新。
 */
import { useEffect, useRef, useState } from 'react'
import type { ApiDesignCatalog, ApiDesignStyleSummary } from './api'
import { CheckIcon, ChevronIcon, PaletteIcon, SparkIcon } from './icons'

export interface StyleSwitcherProps {
  catalog: ApiDesignCatalog | null
  current: { styleId: string; updatedAt: number } | null
  onPick: (styleId: string | null) => void
  busy?: boolean
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

export function StyleSwitcher({ catalog, current, onPick, busy }: StyleSwitcherProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const currentStyle = catalog?.styles.find((s) => s.id === current?.styleId) ?? null

  function pick(styleId: string | null): void {
    setOpen(false)
    onPick(styleId)
  }

  return (
    <div className="style-switcher" ref={ref}>
      <button
        type="button"
        className="style-switcher__chip"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title="设计风格"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <PaletteIcon size={14} />
        {currentStyle ? <Swatches style={currentStyle} /> : <SparkIcon size={13} />}
        <span className="style-switcher__name">{currentStyle ? currentStyle.name : '自由发挥'}</span>
        <ChevronIcon size={12} />
      </button>
      {open && (
        <div className="style-switcher__menu" role="listbox">
          {(catalog?.styles ?? []).map((style) => {
            const active = style.id === current?.styleId
            return (
              <button
                key={style.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`style-switcher__item${active ? ' is-active' : ''}`}
                onClick={() => pick(style.id)}
              >
                <span className="style-switcher__item-main">
                  <Swatches style={style} />
                  <span className="style-switcher__item-text">
                    <strong>{style.name}</strong>
                    <small>{style.tagline}</small>
                  </span>
                </span>
                <span className="style-switcher__item-side">
                  <small>{style.templates.map((t) => t.name).join(' / ') || '无模板'}</small>
                  {active && <CheckIcon size={13} />}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            role="option"
            aria-selected={current === null}
            className={`style-switcher__item${current === null ? ' is-active' : ''}`}
            onClick={() => pick(null)}
          >
            <span className="style-switcher__item-main">
              <SparkIcon size={14} />
              <span className="style-switcher__item-text">
                <strong>自由发挥</strong>
                <small>不锁定风格，由模型自行决定视觉</small>
              </span>
            </span>
            <span className="style-switcher__item-side">{current === null && <CheckIcon size={13} />}</span>
          </button>
          {catalog?.notice && <p className="style-switcher__notice">{catalog.notice}</p>}
        </div>
      )}
    </div>
  )
}
