/**
 * 找出原型里会被画布 CSP 拦截的资源引用。
 *
 * `/page/:id` 的 CSP 只放行内联内容与 data:/blob:，服务端也没有相对路径的静态路由，
 * 因此外链和相对路径都加载不到。这里只用于提示调用方，误报的代价只是多一句提醒。
 */
const TAG_RESOURCE =
  /<(?:script|img|link|iframe|video|audio|source|embed|object)\b[^>]*?\b(?:src|href|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
const CSS_RESOURCE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi
const INLINE = /^(?:data:|blob:|about:|#)/i

export function findBlockedResources(html: string): string[] {
  const found = new Set<string>()
  for (const pattern of [TAG_RESOURCE, CSS_RESOURCE]) {
    for (const match of html.matchAll(pattern)) {
      const value = match.slice(1).find((group) => group !== undefined)?.trim()
      if (value && !INLINE.test(value)) found.add(value)
    }
  }
  return [...found]
}
