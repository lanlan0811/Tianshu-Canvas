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
   在用户拿到链接之前，**不要**开始写原型、也不要调用 `canvas_add_page`。
2. 用户拿到链接后，再生成原型 → 写入画布。

**禁止**：跳过 `canvas_open` 直接生成原型或 `canvas_add_page`——那样用户看不到画布。

## 工作流

1. **`canvas_open`（必做第一步）**：拿到画布 URL，把 URL 发给用户让其用浏览器打开。
   - 若用户已在本会话拿到过链接，可复用（`canvas_open` 会返回同一个服务地址）。
2. **生成原型**：把设计原型写成 HTML 文件放进工作区（例如 `<cwd>/prototype/login.html`）。
   - 用真实 HTML/CSS，可用现代布局（flex/grid）、渐变、圆角、阴影。
   - 单页自包含最好；如引用资源，用相对路径或内联。
3. **写入画布**：调用 `canvas_add_page`，传 `html_path`（工作区内的 HTML 文件路径）或 `html`（内联），
   再给 `title`、可选 `device_type`（desktop/tablet/mobile/free）与 `x`/`y`。
   - 每次写入后，把画布 URL 一并回给用户，方便其刷新查看。
4. **多页设计**：重复 2–3，每页一个节点，画布会自动排布。
5. **查看/确认**：`canvas_list_pages` 列出当前所有页面节点。

## 迭代与交付（v0.1.2）

- **读用户选中**：用户在画布上点选元素后，调用 `canvas_get_selection` 读取选中项
  （页面/元素 xpath/文案/关键样式），据此修改设计。
- **编排**：`canvas_remove_page` / `canvas_rename_page` / `canvas_duplicate_page` /
  `canvas_move_page` / `canvas_link_pages`。
- **导出**：`canvas_export`（`kind`: png / zip / both）——画布截图 PNG + 原型打包 ZIP。
- 用户也可在画布面板点「复制修改请求」把选中项文本粘给你；或直接在画布上改文案/样式（会回写原型）。

## 约定

- 页面节点以**逻辑分辨率**渲染（desktop 1440×900 / tablet 768×1024 / mobile 375×812），
  节点标题栏在任意缩放下视觉尺寸恒定。
- 画布操作：空格/中键拖拽平移；Ctrl+滚轮缩放；普通滚轮平移；MiniMap 右下角。
- 原型在沙箱 iframe 中渲染（`sandbox="allow-scripts"`，无同源权限），因此**不要依赖读取画布页面的状态**。
- 项目数据存于 `<cwd>/.tianshu-canvas/`（project.json + pages/*.html），可版本化。
- 安装/启用插件后需**新建会话**才生效。

## 工具

| 工具 | 用途 | 何时用 |
|---|---|---|
| `canvas_open` | 启动/复用本地画布服务，返回浏览器 URL | **第一步，永远先调用** |
| `canvas_add_page` | 把 HTML 原型作为页面节点加入画布 | 已 `canvas_open` 且已生成原型后 |
| `canvas_list_pages` | 列出画布上的页面节点 | 需要查看/确认时 |
| `canvas_get_selection` | 读取画布上的当前选中项 | 用户选中元素后，据此修改 |
| `canvas_remove_page` / `canvas_rename_page` / `canvas_duplicate_page` / `canvas_move_page` | 节点增删改 | 编排画布时 |
| `canvas_link_pages` | 页面间连线 | 表达页面流程时 |
| `canvas_export` | 导出 PNG / ZIP | 交付成果时 |
