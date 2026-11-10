/** 浏览器 E2E 共用入口：正式验收缺少浏览器必须失败，不能以 skip 假绿。 */
import { existsSync } from 'node:fs'

const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

export function resolveTestBrowser({ env = process.env, exists = existsSync } = {}) {
  const configured = env.TIANSHU_CANVAS_BROWSER
  if (configured !== undefined) {
    if (typeof configured !== 'string' || !configured.trim() || !exists(configured)) {
      throw new Error('TIANSHU_CANVAS_BROWSER 指定的浏览器路径无效：' + String(configured))
    }
    return configured
  }

  const browser = BROWSER_CANDIDATES.find((candidate) => exists(candidate))
  if (!browser && (env.CI === 'true' || env.TIANSHU_CANVAS_REQUIRE_BROWSER === '1')) {
    throw new Error('正式验收必须提供可用浏览器，请设置 TIANSHU_CANVAS_BROWSER；浏览器 E2E 不允许跳过。')
  }
  return browser
}
