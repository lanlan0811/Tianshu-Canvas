/**
 * 画布待机态（等原型出现前的空态）：手绘风插画 + 标题 + 说明 + 4 行快捷键。
 *
 * 版式参考 Trae SOLO 的画布空态，但视觉改为本项目的手绘白板/便签风：
 * 不使用 video（CSP 无 media-src）与 emoji（项目规则），顶部用手绘 SVG + CSS 轻动画。
 * 快捷键文案逐字沿用原左下角 .hint，避免两处不一致。
 */
import type { ReactNode } from 'react'

/** 键帽：如「空格」「Ctrl」。 */
function Keycap({ children }: { children: ReactNode }) {
  return <span className="empty-state__keycap">{children}</span>
}

/** 指针键帽：纯 CSS 鼠标图标 + 文字（如「滚轮」「点击」）。 */
function PointerKeycap({ children }: { children: ReactNode }) {
  return (
    <span className="empty-state__keycap empty-state__keycap--pointer">
      <span className="empty-state__mouse" aria-hidden="true" />
      <span>{children}</span>
    </span>
  )
}

/** 一行快捷键：左侧键帽（右对齐）+ 右侧说明（左对齐）。 */
function ShortcutRow({ keys, label }: { keys: ReactNode; label: string }) {
  return (
    <div className="empty-state__row">
      <div className="empty-state__keys">{keys}</div>
      <span className="empty-state__label">{label}</span>
    </div>
  )
}

export function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state__art" aria-hidden="true">
        {/* 手绘空白画板：虚线边框 + 抖动滤镜 */}
        <svg
          className="empty-state__board"
          width="180"
          height="126"
          viewBox="0 0 120 84"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: 'url(#sketch)' }}
        >
          <rect x="5" y="5" width="110" height="74" rx="6" strokeDasharray="6 6" />
          <path d="M18 24h36M18 38h52M18 52h28" />
        </svg>
        {/* 三张便签小方片：轻微浮动，用 --rot 控制各自倾角 */}
        <span className="empty-state__note empty-state__note--1" />
        <span className="empty-state__note empty-state__note--2" />
        <span className="empty-state__note empty-state__note--3" />
      </div>

      <p className="empty-state__title">画布还是空白的</p>
      <p className="empty-state__desc">让天枢生成一个前端原型页面，再调用 canvas_upsert_page 贴到这块白板上。</p>

      <div className="empty-state__shortcuts">
        <ShortcutRow keys={<><Keycap>空格</Keycap><PointerKeycap>中键拖拽</PointerKeycap></>} label="平移" />
        <ShortcutRow keys={<><Keycap>Ctrl</Keycap><PointerKeycap>滚轮</PointerKeycap></>} label="缩放" />
        <ShortcutRow keys={<PointerKeycap>滚轮</PointerKeycap>} label="平移" />
        <ShortcutRow keys={<PointerKeycap>点击</PointerKeycap>} label="选中元素（Ctrl 点击选最内层）" />
      </div>
    </div>
  )
}
