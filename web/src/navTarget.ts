/**
 * 页面内链接 → 目标页面 id 的解析（画布编辑态与预览层共用）。
 *
 * 导入时链接已被工具规范化为 `<id>.html`。data-nav 优先；否则取 href 的
 * basename 去 .html 后精确匹配页面 id。只接受已存在的页面 id，
 * scheme: / // / # / 畸形百分号编码一律拒绝。
 */
export function resolveNavTarget(
  nav: { href: string | null; nav: string | null },
  ids: Set<string>,
): string | null {
  if (nav.nav && ids.has(nav.nav)) return nav.nav
  const href = nav.href ?? ''
  if (!href || /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|#)/.test(href)) return null
  let base = (href.split(/[?#]/)[0] ?? '').split('/').pop() ?? ''
  base = base.replace(/\.html?$/i, '')
  try {
    base = decodeURIComponent(base)
  } catch {
    /* 非法百分号编码保持原样 */
  }
  return ids.has(base) ? base : null
}
