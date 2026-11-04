# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
每个版本的详细发布说明见 `release/release-<版本>.md`。

## [v0.2.4] - 2026-11-05

选中面板可收起，不再常驻遮挡画布。详细说明见 [release-0.2.4.md](release/release-0.2.4.md)。

### 新增

- 选中面板头部新增「×」收起按钮：收起后缩为右上角浮动小标签「选中面板」，点击即可展开，已填写的文案/样式不丢失。
- 切换选中项时自动展开面板，避免收起后误以为点击元素无反应。

## [v0.2.3] - 2026-11-04

不再在工作区产生多余的原型文件夹。详细说明见 [release-0.2.3.md](release/release-0.2.3.md)。

### 修复

- 技能说明不再引导 AI 把原型先写成工作区里的 HTML 文件（如 `prototype/`、`design/`），改为直接用 `html` 内联传入 `canvas_upsert_page`；原型只存放在 `.tianshu-canvas/pages/`。
- `canvas_upsert_page` 的工具描述同步调整：`html` 为推荐方式，`html_path` 仅用于导入已有文件。
- README 使用步骤同步更新。

## [v0.2.2] - 2026-11-04

修复 PNG 导出偶发失败（Failed to launch the browser process / The browser is already running）。详细说明见 [release-0.2.2.md](release/release-0.2.2.md)。

### 修复

- PNG 导出串行排队：同一时刻只启动一个无头浏览器，避免并发导出互相争抢。
- 每次启动使用独立的临时 profile，启动失败自动清理并重试（最多 3 次）。
- 关闭浏览器加 10 秒超时，超时后强杀进程并清理 profile，不再留下孤儿 Edge/Chrome 进程。
- 修复 PNG 文件名与实际路径可能不一致的问题（原先跨秒时会两次取时间戳）。

## [v0.2.1] - 2026-11-04

修复画布节点标题栏被页面内容遮挡。详细说明见 [release-0.2.1.md](release/release-0.2.1.md)。

### 修复

- 节点标题栏改为悬于节点上方、不参与布局：高度不再被 flex 压缩（原来 28px 被压到约 21px），
  也不会被 iframe 内容区覆盖；任何缩放下都恒为 28px 屏幕高度。
- 标题栏与节点工具栏间距改为随缩放反算，避免低缩放下工具栏压住标题栏。
- e2e 测试新增标题栏几何断言（高度 28px、不被 iframe 覆盖）防止回归。

## [v0.2.0] - 2026-11-04

工具精简：10 个工具合并为 5 个，业务能力不变。详细说明见 [release-0.2.0.md](release/release-0.2.0.md)。

### 变更（破坏性）

- 工具由 10 个精简为 5 个：`canvas_open`、`canvas_upsert_page`、`canvas_get_state`、`canvas_arrange`、`canvas_export`。
- `canvas_add_page` / `canvas_rename_page` / `canvas_move_page` 合并为 `canvas_upsert_page`：已有 id 可省略 html，仅更新标题/位置/尺寸/设备；未指定的字段保持原值。
- `canvas_list_pages` / `canvas_get_selection` 合并为 `canvas_get_state`：一次返回页面、连线、选中项和画布 URL。
- `canvas_remove_page` / `canvas_duplicate_page` / `canvas_link_pages` 合并为 `canvas_arrange`（`action`: remove / duplicate / link / unlink）。
- 旧工具名不再保留，升级后需新建会话。

### 工程

- 测试同步改用新工具名；新增 upsert 仅改元数据（HTML 与尺寸不被重置）、arrange 各 action 及错误路径的覆盖；共 5 个工具握手一致。

## [v0.1.2] - 2026-11-04

画布交互闭环：选中反馈 + 可视化编辑 + 编排 + 导出。详细说明见 [release-0.1.2.md](release/release-0.1.2.md)。

### 新增

- **选中元素 → 加入对话**：iframe 探针支持两层选择（无修饰键=区块，Ctrl/meta=最内层元素）、
  悬停高亮、滚轮转发；选中经 `/api/selection` 落盘，AI 用 `canvas_get_selection` 读取；
  面板提供「复制修改请求」。
- **可视化编辑**：选中元素后可改文案与样式（颜色/字号/内边距/圆角等），回写原型 HTML（剥离探针痕迹）。
- **画布编排**：节点重命名/复制/删除（含工具栏）、页面连线；工具
  `canvas_remove_page`/`canvas_rename_page`/`canvas_duplicate_page`/`canvas_move_page`/`canvas_link_pages`。
- **导出交付**：整块画布截图 PNG（无头浏览器）+ 原型打包 ZIP（含 index.html 画廊）；
  工具 `canvas_export`。

### 工程

- 探针注入 `/page/:id`；新增路由 `/api/selection`、`/api/page-html`、`/api/nodes`、`/api/edges`、`/api/export`、`/api/export-file`；SSE 增 `selection` 事件。
- `puppeteer-core` 移入 `dependencies`，esbuild `external`。
- 测试：新增 selection、export、probe.e2e（真实浏览器两层选择 + UI 编辑回写）；共 10 个工具握手一致。

## [v0.1.1] - 2026-11-04

修复工作流顺序：先启动画布、给用户链接，再做原型设计。详细说明见 [release-0.1.1.md](release/release-0.1.1.md)。

### 修复

- 技能说明强制「第一步调用 `canvas_open`」：未拿到链接前不得开始原型/写入画布。
- `canvas_add_page` 自动确保画布服务在运行，返回里必带可点击的画布 URL。
- 工具描述补充顺序提示。

## [v0.1.0] - 2026-11-04

首个版本：无限画布设计工作台。详细说明见 [release-0.1.0.md](release/release-0.1.0.md)。

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
