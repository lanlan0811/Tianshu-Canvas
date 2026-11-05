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

const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
