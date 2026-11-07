# 天枢画布设计 v0.8.1

> 2026-11-07 · Apache-2.0

一套新风格 + 一轮交互库扩容：新增内置风格**天枢·霞光**（10 → 11 套），
交互库从 16 个模式扩充到 **23 个**，补齐**滚动、指针、移动端**这一类此前缺失的交互形态。

7 个新模式取材自一个真实个人站的交互实现（滚动进度环、头部胶囊化、AOS 渐显、卡片 3D 倾斜、
汉堡菜单、代码复制、文章大纲），但**全部重新实现**：去掉外链依赖（AOS、Font Awesome、emoji 图标），
改由本项目内置的 `--ts-*` 变量、组件类与自绘 SVG 图标承载，以满足画布沙箱的硬约束。

---

## 新增

### 01 天枢·霞光（`tianshu-aurora`）

- 色板：浅蓝紫底 `#f2f4ff` / 白卡片 / 主操作蓝 `#4a6fd8` / 樱粉点缀 `#f77daa`。
- 字体：正文 Poppins + Noto Sans SC，标题同族几何无衬线，数据等宽。
- 尺度：4px 步进间距、8–24px 大圆角、彩色柔光投影（蓝调阴影）；字号 11–50px，行高更宽松。
- 对比度：正文/底 10.27:1，正文/卡片 11.26:1，次级文字/底 8.64:1，主按钮白字 4.61:1。
- **主按钮取加深一档的 `#4a6fd8`**：原色 `#7aa2f7` 白字仅 2.52:1，不满足构建期 ≥4.5 的硬约束；
  品牌亮蓝保留为 `brand.300`，与樱粉一起用在图表色阶与强调位。

### 02 交互库 7 个新模式（16 → 23）

| 分类 | 新增模式 |
|---|---|
| 导航 | `scroll-progress`、`sticky-header`、`mobile-nav`、`toc-outline` |
| 反馈 | `scroll-reveal`、`tilt-card` |
| 数据 | `copy-code` |

- **`scroll-progress`**：圆形进度环 + 点击回顶。`rAF` 节流更新 `strokeDashoffset`，超过阈值（默认 300px）才显形。
- **`sticky-header`**：滚过阈值加 `--scrolled`（收缩 + 阴影），下滚且超阈值加 `--hidden`，上滚立即复现。
  具体外观由 token 与 CSS 决定，运行时只维护状态类。
- **`scroll-reveal`**：`IntersectionObserver` 入视口渐显，支持 `--up/--left/--right` 与 `data-ts-delay` 错峰
  （组内未显式指定时按序号 × 90ms 自动排布），只触发一次。
- **`tilt-card`**：指针按相对卡片中心的位置算 `rotateX/rotateY` 透视，离开回正；仅 `pointer: fine` 且未减弱动效时启用。
- **`mobile-nav`**：汉堡 + 遮罩 + 锁滚动，Esc 关闭并把焦点归还 toggle，宽屏自动复位。
- **`copy-code`**：优先 `navigator.clipboard`，被拒时退回临时 textarea + `execCommand`；成功后约 1.6s 复原文案。
- **`toc-outline`**：滚动高亮当前小节（`aria-current`），窄屏可折叠，只读取页面锚点位置。

## 变更

- `design-systems/index.json` 新增风格登记；`dist/design/` 重新构建（11 套产物）。
- 交互库构建期校验的条目数 16 → 23；测试（catalog / 注入 / e2e）、`design-systems/README.md`、
  `skills/SKILL.md`、`canvas_style` 的工具描述同步更新。
- README 风格清单 10 → 11 套，交互库 16 → 23 种。
- 版本号 0.8.0 → 0.8.1（`package.json`、`tianshu.plugin.json`）。

## 已知限制

- **滚动类交互（`scroll-progress` / `sticky-header` / `toc-outline` 高亮）在画布 iframe 内不生效**：
  画布 iframe 会撑到内容全高（`innerHeight === scrollHeight`），内部永远不会滚动，`window.scrollY` 恒为 0。
  这三项在**导出站（真实视口）**中正常工作。因此 e2e 分两侧验证：画布侧验指针与点击类，
  导出侧验滚动类。
- 新交互**不引入**常驻定时器（如原实现里 30ms 间隔的持续动画），避免长期占用主线程。

## 兼容性

- 无接口与数据变更；旧项目直接可用。
- 新模式不改变 `--ts-*` 变量名集合、组件类与模板 id，跨风格切换仍保持同构。
- 交互运行时仍遵守沙箱：不发起网络请求、不读写本地存储/cookie、不外链。

## 发版检查单

1. `npm run verify`（typecheck + build + notices + test），共 141 项通过。
2. `npm run verify:codegen`（适配器编译验收）。
3. `node scripts/verify-web.mjs`（真实浏览器渲染）。
4. `npm run check:plugin`。
