/**
 * 多页静态站组装：把画布上的多个原型页导出成一套可直接打开的前端。
 *
 * 纯函数、无 IO：调用方（export.ts）负责读页面与共享 CSS、写 ZIP。
 * 产物形态：
 *   index.html            导航首页（各页真链接）
 *   overview.html         旧 iframe 画廊（保留不丢）
 *   pages/<id>.html       每页：剥离 ds 内联块 → 挂共享 CSS → 内联脚本原样
 *   assets/*.css|js       共享 tokens/components/interactions（仅锁定风格时）
 *   project.json
 */

export interface SitePage {
  id: string
  title: string
  /** 已处理好的页面 HTML（剥离 ds 块、重写链接、挂好共享 CSS）。 */
  html: string
}

export interface SiteAssets {
  tokensCss?: string
  componentsCss?: string
  interactionsCss?: string
  interactionsJs?: string
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** 在 `</head>` 前插入一串标签（无 head 则忽略，导出页一般都有）。 */
export function injectBeforeHeadClose(html: string, tags: string): string {
  if (!tags) return html
  const match = /<\/head\s*>/i.exec(html)
  if (!match) return html
  return html.slice(0, match.index) + tags + html.slice(match.index)
}

/** 组装页面要挂的共享资源标签（`prefix` 为相对 assets 目录的路径，如 '../assets'）。 */
export function sharedLinkTags(assets: SiteAssets, prefix: string): string {
  const tags: string[] = []
  if (assets.tokensCss !== undefined) tags.push(`  <link rel="stylesheet" href="${prefix}/tokens.css">\n`)
  if (assets.componentsCss !== undefined) tags.push(`  <link rel="stylesheet" href="${prefix}/components.css">\n`)
  if (assets.interactionsCss !== undefined) tags.push(`  <link rel="stylesheet" href="${prefix}/interactions.css">\n`)
  if (assets.interactionsJs !== undefined) tags.push(`  <script src="${prefix}/interactions.js" defer></script>\n`)
  return tags.join('')
}

/** 判断页面用到了交互库（决定导出站是否需要一个共享 interactions.js）。 */
export function pageUsesInteractions(html: string): boolean {
  return /\bdata-ts-[a-z0-9-]+\b/.test(html) || /\bts-i-[a-z0-9-]+\b/.test(html)
}

/**
 * 生成导航首页。有 styleId 时挂共享 tokens/components，视觉与页面一致。
 */
export function navHomeHtml(pages: SitePage[], options: { title: string; hasAssets: boolean }): string {
  const links = pages
    .map((p) => `      <li><a href="pages/${encodeURIComponent(p.id)}.html">${escapeHtml(p.title)}</a></li>`)
    .join('\n')
  const head = options.hasAssets
    ? `  <link rel="stylesheet" href="assets/tokens.css">\n  <link rel="stylesheet" href="assets/components.css">\n`
    : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
${head}  <style>
    nav ul { list-style: none; padding: 0; display: grid; gap: 8px; }
    nav a { display: block; padding: 12px 16px; border: 1px solid currentColor; border-radius: 8px; }
  </style>
</head>
<body>
  <main class="ts-container" style="padding:32px 16px">
    <h1>${escapeHtml(options.title)}</h1>
    <p>共 ${pages.length} 个页面。点击进入；页面间的链接可直接互相跳转。</p>
    <nav>
      <ul>
${links}
      </ul>
    </nav>
    <p><a href="overview.html">全部原型缩略图 →</a></p>
  </main>
</body>
</html>
`
}
