# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [v0.1.0] - 2026-11-04

首个版本：无限画布设计工作台。

### 新增

- **无限画布**：基于 React Flow 的无限画布，支持空格/中键拖拽平移、Ctrl+滚轮缩放、
  普通滚轮平移、网格吸附、右下角 MiniMap。
- **原型写入画布**：`canvas_add_page` 把工作区内的 HTML 原型作为页面节点加入画布，
  节点内以沙箱 iframe 渲染真实 HTML；节点标题栏在任意缩放下视觉尺寸恒定。
- **本地画布服务**：`canvas_open` 启动/复用 127.0.0.1 单例服务并返回浏览器 URL；
  静态资源白名单、Host 校验、原型页严格 CSP、变更路由自定义头防 CSRF。
- **实时刷新**：项目变更经 SSE 推送到浏览器，画布自动刷新。
- **项目存储**：工作区 `<cwd>/.tianshu-canvas/`（project.json + pages/*.html），原子写。
- **工具**：`canvas_open` / `canvas_add_page` / `canvas_list_pages`。

### 工程

- TypeScript 源码（Node 侧 + React 侧），esbuild 打包，构建产物提交进仓库。
- `node:test` 测试：契约（握手一致）、项目模型、本地服务。
- CI（typecheck + build + dist 一致性 + test）与 Release（tag 触发、发布说明）工作流。
