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

## 工作流

1. **打开画布**：调用 `canvas_open` 拿到画布 URL，把 URL 给用户让其用浏览器打开。
2. **生成原型**：把设计原型写成 HTML 文件放进工作区（例如 `<cwd>/prototype/login.html`）。
   - 用真实 HTML/CSS，可用现代布局（flex/grid）、渐变、圆角、阴影。
   - 单页自包含最好；如引用资源，用相对路径或内联。
3. **写入画布**：调用 `canvas_add_page`，传 `html_path`（工作区内的 HTML 文件路径）或 `html`（内联），
   再给 `title`、可选 `device_type`（desktop/tablet/mobile/free）与 `x`/`y`。
4. **多页设计**：重复 2–3，每页一个节点，画布会自动排布。
5. **查看/确认**：`canvas_list_pages` 列出当前所有页面节点。

## 约定

- 页面节点以**逻辑分辨率**渲染（desktop 1440×900 / tablet 768×1024 / mobile 375×812），
  节点标题栏在任意缩放下视觉尺寸恒定。
- 画布操作：空格/中键拖拽平移；Ctrl+滚轮缩放；普通滚轮平移；MiniMap 右下角。
- 原型在沙箱 iframe 中渲染（`sandbox="allow-scripts"`，无同源权限），因此**不要依赖读取画布页面的状态**。
- 项目数据存于 `<cwd>/.tianshu-canvas/`（project.json + pages/*.html），可版本化。
- 安装/启用插件后需**新建会话**才生效。

## 工具

| 工具 | 用途 |
|---|---|
| `canvas_open` | 启动/复用本地画布服务，返回浏览器 URL |
| `canvas_add_page` | 把 HTML 原型作为页面节点加入画布 |
| `canvas_list_pages` | 列出画布上的页面节点 |
