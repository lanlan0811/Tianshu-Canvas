/**
 * 画布待机态（等原型出现前的空态）：品牌图案 + 标题 + 说明 + 4 行快捷键。
 *
 * 顶部用应用图标（brand-icon.png，构建期内联为 data: URI）替代原先的手绘 SVG
 * 画板 + 便签：与顶栏品牌标、插件图标保持同一形象。图标本身是圆角卡片，
 * 故不再套手绘边框。不使用 video（CSP 无 media-src）与 emoji（项目规则）。
 * 快捷键文案逐字沿用原左下角 .hint，避免两处不一致。
 */
import type { ReactNode } from 'react'
import brandIcon from './brand-icon.png'

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
      <div className="empty-state__art">
        <img className="empty-state__brand" src={brandIcon} alt="" width={132} height={132} />
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
