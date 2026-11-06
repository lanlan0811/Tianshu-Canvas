# 天枢画布设计 v0.7.3

> 2026-11-06 · Apache-2.0

外观与交付门禁修复：画布换上专属应用图标，并修掉一个会让 CI 在 Linux 上
误判「产物与源码不一致」的换行符问题。

---

## 新增 / 变更

### 画布改用专属应用图标

原先顶栏品牌标、浏览器 favicon 与空态插画用的是手绘占位图形（橙色小方块、
橙色线框 favicon、虚线画板）。现在三处统一为应用图标：

| 位置 | 变化 |
|---|---|
| 顶栏品牌标 | 手绘橙色方块 → 图标 22px |
| 浏览器 favicon | 橙色线框 SVG → 图标 64px |
| 空态插画 | 虚线画板 → 图标 132px（居中，带浮动与投影） |

三张手绘便签小方片**保留**，绕图标分布（右上琥珀 / 右侧薄荷 / 左下天蓝），
各自倾角与错开的浮动动画；`prefers-reduced-motion` 下与图标一起停动画。

**接入方式**（不新增静态资源路由，也符合画布 CSP `img-src 'self' data: blob:`）：

- 图标源图 `assets/icon.png`（透明底 1225×1225）。
- 构建用的 `web/src/brand-icon.png` 为 384px 量化 256 色（约 12KB，平均每通道误差约 2），
  由 esbuild 的 `dataurl` loader 在构建期内联进 `canvas.js`。
- favicon 走 `scripts/build.mjs` 的 `__FAVICON__` 占位替换（源 `web/favicon.png`，64px），
  `web/index.html` 源文件里不再内嵌大块 base64。

## 修复

### dist/ 在 Windows 上会与 CI 产物不一致

CI 的 `git diff --exit-code -- dist` 门禁在 Linux runner 上失败，日志显示
`dist/web/index.html` 有 15 行纯换行差异。

根因：`web/index.html` 在 Windows checkout（`core.autocrlf=true`）下是 CRLF，
构建脚本把它直接复制成 `dist/web/index.html`，产物便带着 CRLF 入库；CI 在 Linux 上
重建得到 LF，逐字节比较自然不等。其它产物（`canvas.js` / `canvas.css` / `index.mjs`）
由 esbuild 生成，本来就输出 LF，因此只有这一个文件出问题。

修复：`scripts/build.mjs` 写出 HTML 外壳前统一 `replace(/\r\n/g, '\n')`，
让产物与本地换行设置无关；并重新提交归一化后的 `dist/web/index.html`。

## 兼容性

- **无接口、参数与数据格式变更**：只改了画布前端的图标资源与构建脚本。
- 工具名、参数、行为、项目数据格式、设计系统契约全部不变。
- 图标内联进 `canvas.js`，插件 ZIP 不新增文件（打包清单仍是 `tianshu.plugin.json`、
  `dist/`、`skills/`、`LICENSE`）。
- **需重装插件 + 新建会话**才生效。

## 发版检查单

1. `npm run verify`（typecheck + build + test）—— 119/119 通过。
2. `npm run check:plugin`（清单/入口/握手/路径/体积自检）。
3. 产物与源码一致（CI 用 `git diff --exit-code -- dist` 校验）。
