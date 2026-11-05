/**
 * 把编辑应用到原型的**源 HTML**，而不是序列化 iframe 里的运行时 DOM。
 *
 * 运行时 DOM 已被页面脚本改过：把它写回文件后，脚本下次加载会再执行一遍，
 * 生成的内容就会重复，弹窗、动画等临时状态也会被固化。
 * DOMParser 得到的文档不执行脚本，可以安全地按源码结构修改。
 */
const SAFE_PROP = /^[a-z-]+$/
const BAD_VALUE = /url\(|expression|javascript:|@import/i

export interface SourceEdits {
  text?: string
  styles?: Record<string, string>
}

export type SourceEditResult = { ok: true; html: string } | { ok: false; error: string }

const SCRIPT_GENERATED =
  '这个元素由页面脚本生成或改动过，和源文件对不上，无法直接回写。请点「复制修改请求」交给 AI 修改。'

function findByXPath(doc: Document, xpath: string): Element | null {
  let current: Element | null = null
  for (const part of xpath.split('/').filter(Boolean)) {
    const match = /^([^[\]]+)\[(\d+)\]$/.exec(part)
    if (!match) return null
    const tag = match[1]!.toLowerCase()
    const index = Number(match[2])
    const siblings: HTMLCollection = current ? current.children : doc.children
    let seen = 0
    let found: Element | null = null
    for (const el of Array.from(siblings)) {
      if (el.tagName.toLowerCase() === tag && ++seen === index) {
        found = el
        break
      }
    }
    if (!found) return null
    current = found
  }
  return current
}

/** 与探针 payload 的 textContent 口径一致，用来确认定位到的是同一个元素。 */
export function textFingerprint(text: string | null | undefined): string {
  return (text ?? '').trim().slice(0, 200)
}

export function applyEditToSource(
  source: string,
  xpath: string,
  expectedText: string,
  edits: SourceEdits,
): SourceEditResult {
  const doc = new DOMParser().parseFromString(source, 'text/html')
  const el = findByXPath(doc, xpath)
  // 脚本可能在前面插入过同名元素，xpath 相同也可能是另一个元素，所以还要比对文本。
  if (!el || textFingerprint(el.textContent) !== expectedText) return { ok: false, error: SCRIPT_GENERATED }

  if (edits.text !== undefined) {
    if (el.children.length > 0) return { ok: false, error: '该元素包含子元素，整体改文案会丢失页面结构。' }
    el.textContent = edits.text
  }
  for (const [prop, value] of Object.entries(edits.styles ?? {})) {
    if (SAFE_PROP.test(prop) && !BAD_VALUE.test(value)) (el as HTMLElement).style.setProperty(prop, value)
  }
  return { ok: true, html: (doc.doctype ? '<!doctype html>\n' : '') + doc.documentElement.outerHTML }
}
