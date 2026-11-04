/**
 * 选中面板：展示当前选中项，提供「复制修改请求」（粘给 AI）与文案/样式编辑（M3）。
 */
import { useEffect, useState } from 'react'
import type { ApiSelection } from './api'

export interface SelectionPanelProps {
  selection: ApiSelection | null
  pageTitle: string | null
  /** 应用编辑（M3 接入探针 __vd_apply_edits） */
  onApplyEdits?: (pageId: string, xpath: string, edits: { text?: string; styles?: Record<string, string> }) => void
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

export function SelectionPanel({ selection, pageTitle, onApplyEdits }: SelectionPanelProps) {
  const [copied, setCopied] = useState(false)
  const [text, setText] = useState('')
  const [styles, setStyles] = useState<Record<string, string>>({})

  useEffect(() => {
    setCopied(false)
    setText(selection?.element?.textContent ?? '')
    // 样式输入留空：仅应用用户实际填写的项，避免把当前计算样式整体写成内联样式污染原型。
    setStyles({})
  }, [selection])

  if (!selection) return null
  const el = selection.element

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
    if (text && text !== el.textContent) edits.text = text
    if (Object.keys(stylesOut).length) edits.styles = stylesOut
    if (!edits.text && !edits.styles) return
    onApplyEdits(selection.pageId, el.xpath, edits)
  }

  return (
    <div className="selection-panel">
      <div className="selection-panel__head">
        <span className="selection-panel__title">选中：{selection.kind === 'element' ? '页面内元素' : '页面节点'}</span>
        <button type="button" className="btn btn--primary" onClick={copyRequest}>
          {copied ? '已复制' : '复制修改请求'}
        </button>
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
          <label className="field">
            <span>文案</span>
            <textarea value={text} rows={2} onChange={(e) => setText(e.target.value)} />
          </label>
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
    </div>
  )
}
