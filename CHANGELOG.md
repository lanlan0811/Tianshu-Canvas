# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
每个版本的详细发布说明见 `release-<版本>.md`。

## [v0.1.1] - 2026-11-04

修复工作流顺序：先启动画布、给用户链接，再做原型设计。详细说明见 [release-0.1.1.md](release-0.1.1.md)。

### 修复

- 技能说明强制「第一步调用 `canvas_open`」：未拿到链接前不得开始原型/写入画布。
- `canvas_add_page` 自动确保画布服务在运行，返回里必带可点击的画布 URL。
- 工具描述补充顺序提示。

## [v0.1.0] - 2026-11-04

首个版本：无限画布设计工作台。详细说明见 [release-0.1.0.md](release-0.1.0.md)。

### 新增

- 无限画布（基于 React Flow）：空格/中键拖拽平移、Ctrl+滚轮缩放、普通滚轮平移、12px 网格吸附、右下角 MiniMap。
- `canvas_open`：启动/复用本工作区的本地画布服务，返回可在浏览器打开的 URL。
- `canvas_add_page`：把 HTML 原型作为页面节点加入画布，节点内以沙箱 iframe 渲染。
- `canvas_list_pages`：列出画布上已有的页面节点。
- 实时刷新：项目变更经 SSE 推送到浏览器自动刷新。
- 项目存储：工作区 `<cwd>/.tianshu-canvas/`（`project.json` + `pages/*.html`），原子写。

### 工程

- TypeScript（Node 侧 + React 侧），esbuild 打包，构建产物 `dist/` 提交进仓库。
- `node:test` 测试：契约（握手一致）、项目模型、本地服务。
- CI（typecheck + build + dist 一致性 + test）与 Release（tag 触发）工作流。
