---
name: tianshu-canvas
description: 用无限画布承载前端设计原型。当用户要做页面/组件/界面设计、生成 HTML 原型、做多页设计稿、或提到「画布」时使用。
triggers:
  - 画布
  - canvas
  - 原型
  - prototype
  - 设计稿
  - 页面设计
  - 前端设计
---

# 天枢画布设计（tianshu-canvas）

把前端设计原型放到一块可平移缩放的**无限画布**上。画布在浏览器中打开（本地服务），
每个原型是一个画布节点，节点内以 iframe 渲染真实 HTML。

## 执行顺序（必须遵守）

> **必须先启动画布并把链接给用户，再开始做原型设计。**

1. **第一步永远是 `canvas_open`**：启动/复用画布服务，拿到画布 URL，
   **立刻把 URL 明确地发给用户**（单独一行，便于点击）。
   在用户拿到链接之前，**不要**开始写原型、也不要调用 `canvas_upsert_page`。
2. 用户拿到链接后，再生成原型 → 写入画布。

**禁止**：跳过 `canvas_open` 直接生成原型或 `canvas_upsert_page`——那样用户看不到画布。

## 工作流

1. **`canvas_open`（必做第一步）**：拿到画布 URL，把 URL 发给用户让其用浏览器打开。
   - 若用户已在本会话拿到过链接，可复用（`canvas_open` 会返回同一个服务地址）。
2. **生成原型**：直接写好完整 HTML，**不要**在工作区里新建 `design/`、`prototype/` 等文件夹或 HTML 文件——原型只存放在 `.tianshu-canvas/pages/`。
   - 用真实 HTML/CSS，可用现代布局（flex/grid）、渐变、圆角、阴影。
   - **必须单页自包含**：外链（CDN、Google Fonts、图片）和相对路径都会被画布 CSP 拦截，加载不到。样式和脚本写进 `<style>`、`<script>`，图片用 `data:` URI 或 CSS/SVG 绘制；不要依赖 Tailwind CDN 这类外部脚本。
3. **写入画布**：调用 `canvas_upsert_page`，用 `html` 参数直接传入完整内联 HTML（不要先写文件再用 `html_path`），
   再给 `title`、可选 `device_type`（desktop/tablet/mobile/free）与 `x`/`y`。
   - 每次写入后，把画布 URL 一并回给用户，方便其刷新查看。
4. **多页设计**：重复 2–3，每页一个节点，画布会自动排布。
5. **查看/确认**：`canvas_get_state` 一次返回所有页面节点、连线、用户当前选中项和画布 URL。

## 迭代与交付（v0.2.0）

- **读状态与用户选中**：用户在画布上点选元素后，调用 `canvas_get_state`，
  从「当前选中」段读取选中项（页面/元素 xpath/文案/关键样式），据此修改设计。
- **改页面**：`canvas_upsert_page` 传已存在的 `id` 即为更新。
  - 传新的 `html` / `html_path`：覆盖该页原型。
  - 省略 `html`：只更新标题、位置、尺寸、设备（即重命名、移动、调整尺寸），未指定的字段保持原值。
- **编排**：`canvas_arrange`，用 `action` 选择操作：
  - `remove`（传 `id`）：删除页面，连带其连线与原型文件。
  - `duplicate`（传 `id`，可选 `title`）：复制页面。
  - `link`（传 `source`、`target`，可选 `label`）：页面间连线，表达页面流程。
  - `unlink`（传 `source`、`target`）：取消连线。
- **导出**：`canvas_export`（`kind`: png / zip / both）——画布截图 PNG + 原型打包 ZIP。
- 用户也可在画布面板点「复制修改请求」把选中项文本粘给你；或直接在画布上改文案/样式（会回写原型）。

## 约定

- 页面节点以**逻辑分辨率**渲染（desktop 1440×900 / tablet 768×1024 / mobile 375×812），
  节点标题栏在任意缩放下视觉尺寸恒定。
- 画布操作：空格/中键拖拽平移；Ctrl+滚轮缩放；普通滚轮平移；MiniMap 右下角。
- 原型在沙箱 iframe 中渲染（`sandbox=\"allow-scripts\"`，无同源权限），因此**不要依赖读取画布页面的状态**。
- 用户在画布上只能改不含子元素的元素文案，并按源 HTML 回写；由脚本生成的元素无法直接回写，会提示交给你修改。
- 项目数据存于 `<cwd>/.tianshu-canvas/`（project.json + pages/*.html），可版本化。原型 HTML 只存放在这里，**不要**在工作区另建 `design/`、`prototype/` 等目录存放原型。
- 安装/启用插件后需**新建会话**才生效。

## 工具

| 工具 | 用途 | 何时用 |
|---|---|---|
| `canvas_open` | 启动/复用本地画布服务，返回浏览器 URL | **第一步，永远先调用** |
| `canvas_upsert_page` | 新增页面，或更新已有页面（HTML / 标题 / 位置 / 尺寸） | 已 `canvas_open` 且已生成原型后；重命名、移动也用它 |
| `canvas_get_state` | 读取页面列表、连线、用户当前选中项、画布 URL | 需要查看/确认，或用户选中元素后据此修改 |
| `canvas_arrange` | 删除 / 复制页面、连线 / 取消连线（`action` 选择） | 编排画布、表达页面流程时 |
| `canvas_export` | 导出 PNG / ZIP | 交付成果时 |
