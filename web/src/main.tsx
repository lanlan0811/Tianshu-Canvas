/**
 * Web 入口：挂载 React 应用，并引入 React Flow 样式与画布样式
 * （esbuild 会把 import 的 CSS 打包成 dist/web/canvas.css）。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './tokens.css'
import './styles.css'
import App from './App'

async function start(): Promise<void> {
  const rootEl = document.getElementById('root')
  if (!rootEl) return
  const ws = new URLSearchParams(location.search).get('ws')
  const secret = location.hash.slice(1)
  if (secret) {
    const res = await fetch(`${location.pathname}api/auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' },
      body: JSON.stringify({ ws, secret }),
    })
    if (!res.ok) throw new Error('画布授权已失效，请重新打开画布。')
    history.replaceState(null, '', location.pathname + location.search)
  }
  createRoot(rootEl).render(<StrictMode><App /></StrictMode>)
}
void start().catch(() => {
  const rootEl = document.getElementById('root')
  if (rootEl) rootEl.textContent = '画布授权失败，请重新打开画布。'
})
