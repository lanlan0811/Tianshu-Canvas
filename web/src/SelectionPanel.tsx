/**
 * 选中面板：展示当前选中项，提供「复制修改请求」（粘给 AI）与文案/样式编辑（M3）。
 */
import { useEffect, useState } from 'react'
import type { ApiComment, ApiSelection } from './api'

export interface SelectionPanelProps {
  selection: ApiSelection | null
  pageTitle: string | null
  /** 该页（selection.pageId）的批注，按创建时间升序。 */
  comments?: ApiComment[]
  /** 应用编辑（M3 接入探针 __vd_apply_edits） */
  onApplyEdits?: (
    pageId: string,
    element: NonNullable<ApiSelection['element']>,
    edits: { text?: string; styles?: Record<string, string> },
  ) => void
  /** 给当前选中元素添加一条批注。 */
  onAddComment?: (input: { pageId: string; xpath: string; tagName: string; textContent?: string; note: string }) => void
  /** 标记批注已解决 / 重新打开。 */
  onToggleResolve?: (id: string, resolved: boolean) => void
  /** 删除一条批注。 */
  onRemoveComment?: (id: string) => void
}

const EDITABLE_STYLES: Array<{ key: string; label: string }> = [
  { key: 'color', label: '文字颜色' },
  { key: 'background-color', label: '背景色' },
  { key: 'font-size', label: '字号' },
  { key: 'padding', label: '内边距' },
  { key: 'border-radius', label: '圆角' },
]

function buildRequestText(selection: ApiSelection, pageTitle: string | null): string {
  const lines = [`请修改以下设计：`, `页面：${pageTitle ?? selection.pageId}（id=${selection.pageId}）`]
  if (selection.kind === 'element' && selection.element) {
    const el = selection.element
    lines.push(`元素：<${el.tagName}> xpath=${el.xpath}`)
    if (el.textContent) lines.push(`当前文本：${el.textContent}`)
    if (el.computedStyles) {
      const keys = ['color', 'background-color', 'font-size', 'font-weight', 'padding', 'border-radius']
      const picked = keys.filter((k) => el.computedStyles?.[k]).map((k) => `${k}: ${el.computedStyles?.[k]}`)
      if (picked.length) lines.push(`当前样式：${picked.join('；')}`)
    }
  } else {
    lines.push(`选中：整个页面节点`)
  }
  lines.push(``, `期望的修改：`)
  return lines.join('\n')
}

export function SelectionPanel({
  selection,
  pageTitle,
  comments,
  onApplyEdits,
  onAddComment,
  onToggleResolve,
  onRemoveComment,
}: SelectionPanelProps) {
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [text, setText] = useState('')
  const [styles, setStyles] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')

  useEffect(() => {
    setCopied(false)
    setCollapsed(false)
    setText(selection?.element?.editableText ?? '')
    // 样式输入留空：仅应用用户实际填写的项，避免把当前计算样式整体写成内联样式污染原型。
    setStyles({})
    setNote('')
  }, [selection])

  if (!selection) return null
  const el = selection.element

  if (collapsed) {
    return (
      <button
        type="button"
        className="selection-panel__tab"
        title="展开选中面板"
        onClick={() => setCollapsed(false)}
      >
        选中面板
      </button>
    )
  }

  async function copyRequest(): Promise<void> {
    const content = buildRequestText(selection!, pageTitle)
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 剪贴板不可用 */
    }
  }

  function apply(): void {
    if (!selection || !el || !onApplyEdits) return
    const stylesOut: Record<string, string> = {}
    for (const [k, v] of Object.entries(styles)) if (v) stylesOut[k] = v
    const edits: { text?: string; styles?: Record<string, string> } = {}
    if (typeof el.editableText === 'string' && text !== el.editableText) edits.text = text
    if (Object.keys(stylesOut).length) edits.styles = stylesOut
    if (edits.text === undefined && !edits.styles) return
    onApplyEdits(selection.pageId, el, edits)
  }

  return (
    <div className="selection-panel">
      <div className="selection-panel__head">
        <span className="selection-panel__title">选中：{selection.kind === 'element' ? '页面内元素' : '页面节点'}</span>
        <div className="selection-panel__actions">
          <button type="button" className="btn btn--primary" onClick={copyRequest}>
            {copied ? '已复制' : '复制修改请求'}
          </button>
          <button
            type="button"
            className="selection-panel__collapse"
            title="收起面板"
            aria-label="收起面板"
            onClick={() => setCollapsed(true)}
          >
            ×
          </button>
        </div>
      </div>
      <div className="selection-panel__meta">
        {pageTitle ? `${pageTitle} · ` : ''}
        {el ? `<${el.tagName}>` : selection.pageId}
      </div>
      {el && (
        <>
          <div className="selection-panel__xpath" title={el.xpath}>
            {el.xpath}
          </div>
          {typeof el.editableText === 'string' ? (
            <label className="field">
              <span>文案</span>
              <textarea className="selection-panel__text" value={text} rows={2} onChange={(e) => setText(e.target.value)} />
            </label>
          ) : (
            <p className="selection-panel__note">这个元素包含子元素，不能整体改文案。按住 Ctrl 点击具体的文字可单独修改。</p>
          )}
          <div className="selection-panel__styles">
            {EDITABLE_STYLES.map(({ key, label }) => (
              <label className="field field--inline" key={key}>
                <span>{label}</span>
                <input
                  value={styles[key] ?? ''}
                  placeholder={el.computedStyles?.[key] ?? ''}
                  onChange={(e) => setStyles((s) => ({ ...s, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <button type="button" className="btn" onClick={apply}>
            应用修改
          </button>
        </>
      )}
      {selection && (!!comments?.length || !!el) ? (
        <div className="selection-panel__comments">
          {el && onAddComment && (
            <div className="field field--note">
              <label>
                <span>批注这个元素</span>
                <textarea
                  className="selection-panel__note-input"
                  value={note}
                  rows={2}
                  placeholder="例如：这个按钮改成主色、字号加大"
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!note.trim()}
                onClick={() => {
                  onAddComment({
                    pageId: selection.pageId,
                    xpath: el.xpath,
                    tagName: el.tagName,
                    textContent: el.textContent,
                    note: note.trim(),
                  })
                  setNote('')
                }}
              >
                添加批注
              </button>
            </div>
          )}
          {comments && comments.length > 0 && (
            <ul className="comment-list">
              {comments.map((c, i) => (
                <li key={c.id} className={`comment-item${c.resolved ? ' comment-item--resolved' : ''}`}>
                  <span className="comment-item__seq">{i + 1}</span>
                  <div className="comment-item__body">
                    <div className="comment-item__note">{c.note}</div>
                    <div className="comment-item__xpath" title={c.xpath}>
                      {c.xpath}
                    </div>
                  </div>
                  {onToggleResolve && (
                    <button
                      type="button"
                      className="comment-item__btn"
                      title={c.resolved ? '重新打开' : '标记已解决'}
                      onClick={() => onToggleResolve(c.id, !c.resolved)}
                    >
                      {c.resolved ? '重开' : '解决'}
                    </button>
                  )}
                  {onRemoveComment && (
                    <button
                      type="button"
                      className="comment-item__btn"
                      title="删除批注"
                      onClick={() => onRemoveComment(c.id)}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
