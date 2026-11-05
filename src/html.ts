/**
 * HTML 文本工具。
 */

/**
 * doctype 声明结束的位置；没有声明时返回 0。
 * 向文档头部插入内容时不能早于这里：doctype 前出现元素会让页面进入怪异模式。
 */
export function afterDoctype(html: string): number {
  const match = /^(?:\s|<!--[\s\S]*?-->)*<!doctype\b[^>]*>/i.exec(html)
  return match ? match[0].length : 0
}
