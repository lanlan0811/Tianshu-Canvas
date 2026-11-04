# Tianshu-Canvas · 画布设计

天枢（Tianshu）插件：把**前端设计原型**写入一块可平移缩放的**无限画布**。
每个原型是一个画布节点，节点内以 iframe 渲染真实 HTML；画布在浏览器中打开。

> 画布内核为 [React Flow](https://github.com/xyflow/xyflow)（`@xyflow/react`，MIT）。

## 安装

插件通过天枢「插件中心 → 社区插件 → 从其他来源安装」安装，支持两种方式：

| 方式 | 操作 |
|---|---|
| **Git URL** | 填本仓库地址（可选分支/标签）→「读取清单并审阅」→ 确认安装 |
| **本地路径** | 填本仓库根目录的**绝对路径** → 审阅 → 安装 |

> **要求**：仓库根目录就是插件根（`tianshu.plugin.json` 在根目录）。
> 安装后需**新建会话**才生效。

## 使用

在对话里让天枢做前端设计，或直接调用工具：

1. `canvas_open` — 启动/复用本地画布服务，返回浏览器 URL（用浏览器打开）。
2. 让天枢生成原型 HTML，并直接内联传给 `canvas_upsert_page`（只存放在 `.tianshu-canvas/pages/`，不会在工作区产生其他文件夹）。
3. `canvas_upsert_page` — 新增或更新页面节点（`html_path` 或 `html`，可选 `title` / `device_type`；对已有 `id` 可省略 html，仅改标题/位置/尺寸）。
4. `canvas_get_state` — 读取页面节点、连线、当前选中项与画布 URL。

**画布操作**：空格/中键拖拽平移 · Ctrl+滚轮缩放 · 普通滚轮平移 · 右下角 MiniMap。

### 迭代与交付

- **选中反馈**：在画布上点击页面/元素（Ctrl 点击选最内层），用 `canvas_get_state` 读回；
  或点面板「复制修改请求」粘给 AI。
- **可视化编辑**：选中元素后直接改文案/样式，回写原型 HTML；面板可用头部「×」收起为右上角小标签，点击再展开。
- **编排**：节点工具栏重命名/复制/删除；页面间连线。AI 侧用 `canvas_arrange`（`action`: remove / duplicate / link / unlink）。
- **导出**：`canvas_export` 产出画布截图 PNG 与/或原型打包 ZIP。

> PNG 导出需系统安装 Chrome/Edge；可用 `TIANSHU_CANVAS_BROWSER` 指定路径。ZIP 不依赖浏览器。

## 项目数据

存于工作区内，可版本化：

```
<cwd>/.tianshu-canvas/
├── project.json          画布模型（节点/视口）
└── pages/<id>.html       每个页面的原型 HTML
```

## 开发

```bash
npm install
npm run verify   # typecheck + build + test
```

- **技术栈**：TypeScript（Node 侧 + React 侧），esbuild 打包。
- **构建产物 `dist/` 必须提交进仓库**：天枢安装插件时只跑
  `npm install --ignore-scripts --omit=dev`，**不会执行构建脚本**，因此
  `dist/`（`entry` 指向 `dist/index.js`）必须随仓库分发。CI 会用
  `git diff --exit-code -- dist` 校验产物与源码一致。
- **Node 侧是单文件 bundle**：`src/server.ts` 是模块级单例，多文件会产生重复单例。

### 目录

```
src/        Node 侧（入口/工具/本地服务/项目模型/探针/导出）→ dist/index.js
web/        画布前端（React + React Flow）→ dist/web/canvas.js
dist/       构建产物（提交进仓库）
test/       契约 / 项目 / 服务 / 选中 / 导出 / 探针 e2e 测试（node:test，跑构建产物）
scripts/    build.mjs、verify-web.mjs、extract-release-notes.mjs
release/    每个版本的发布详情文档（release-<版本>.md）
```

### 端到端验证（真实浏览器）

```bash
npm run build
node scripts/verify-web.mjs            # 自动探测 Chrome/Edge
node scripts/verify-web.mjs <chrome.exe>
```

用无头浏览器打开画布，断言 React Flow 真正渲染、节点出现、iframe 指向原型页、无 JS 报错。

## 许可

Apache License 2.0（见 [LICENSE](LICENSE)）。
