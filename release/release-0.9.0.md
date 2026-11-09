# 天枢画布设计 v0.9.0

> 2026-11-09 · Apache-2.0

功能版：**画布内预览**。右键页面节点即可进入全屏可交互预览，按网页 / 平板 / 手机 /
自定义视口查看原型，按钮、tab、弹窗、滚动都按真实行为生效。
工具清单、参数、项目数据格式与导出行为一律不变；**不新增任何 AI 工具**。

---

## 一 新增能力

### 1.1 右键菜单：预览 / 预览设备

页面节点右键菜单顶部新增两项（其后为原有重命名 / 复制 / 置于顶层 / 删除）：

| 菜单项 | 行为 |
|---|---|
| **预览** | 在画布内打开该页面的全屏预览（设备 = 上次选择，默认网页） |
| **预览设备 ▸** | 二级菜单：**网页 / 平板 / 手机 / 自定义**，当前项打勾；选中后直接按该设备进入预览 |

二级菜单靠近视口右缘时向左展开，不会溢出屏幕；外点 / `Esc` 关闭。

### 1.2 全屏预览层

预览层覆盖整个画布（`z-index` 高于所有画布控件），由四部分组成：

- **顶栏左侧**：当前页面标题 + 下拉，列出全部页面（图标 / 标题 / 设计尺寸），点击即可切换预览页面，
  设备与缩放保持不变。
- **顶栏中间**：设备分段切换（网页 / 平板 / 手机 / 自定义）；选中「自定义」时右侧出现 `W` / `H`
  输入框（1–10000，回车或失焦生效，非法值回退原值）。
- **顶栏右侧**：「退出预览」按钮。
- **右下角**：缩放控件，可选「适应窗口 / 50% / 75% / 100% / 125% / 150% / 200%」。

设备视口：

| 设备 | 逻辑尺寸 | 展示 |
|---|---|---|
| 网页 | 预览舞台尺寸（随窗口自适应） | 铺满舞台，无外框 |
| 平板 | 768 × 1024 | 居中 + 设备外框，按可用空间等比缩放（不超过 100%） |
| 手机 | 375 × 812 | 同上 |
| 自定义 | 用户输入 W×H（默认 800×600） | 居中 + 浅边框，可拖拽四边伸长/缩短（右侧竖条、底部横条） |

原型 iframe 始终以**逻辑尺寸**渲染，再整体 CSS 缩放——因此响应式断点与真机一致，
不会因为缩放比例改变排版。

### 1.3 预览内的交互

- 点击不再选中元素：按钮、`<details>`、tab、弹窗、表单输入、页面滚动都按原型自身行为工作。
- 点击站内链接（如「详情」）在当前预览层内切换到目标页，设备 / 缩放保持不变。
- 点击外链：被拦截并提示「外链不可在预览内打开」，预览层不离开画布。
- `Esc` 退出预览（焦点在预览 iframe 内时同样有效）。
- 预览内不显示悬停高亮与批注图钉。

### 1.4 边界

- 「预览设备」**只影响预览视口**：不修改节点尺寸、`deviceType`，不写入 `project.json`。
- 不做预览内编辑/批注；编辑仍在画布编辑态。
- 导出模式（`?export=1`）不渲染预览层。
- **不新增 AI 工具**：`tianshu.plugin.json` 的工具清单与权限（fs / net / shell）保持 9 个工具不变，
  预览完全由用户在画布上操作。

## 二 实现要点

### 2.1 探针预览模式（`src/probe.ts` + `src/server.ts`）

- 探针源码改为 `buildProbeScript(preview: boolean)` 生成；`PROBE_SCRIPT` 仍导出编辑态版本（向后兼容）。
- `injectProbe(html, { preview })` 按开关注入；`/page/:id` 路由解析 `preview=1` 后传入。
  用 URL 参数而非事后 `postMessage` 开关：探针首屏即确定行为，无时序窗口。
- 预览态（`PREVIEW === true`）：
  - 点击不 `setSelected`、不上报选中；只处理链接——站内链接 `preventDefault` +
    `__vd_request_navigate`，外链 `preventDefault` + `__vd_preview_blocked`，纯 `#` 锚点放行；
  - `mousemove` / `mouseleave` 不上报、不高亮；
  - `wheel` 不 `preventDefault`、不转发（页面自身滚动生效）；
  - `__vd_set_comments` 不渲染图钉，不 `reportHeight`；
  - `keydown Escape` → `__vd_request_escape`（焦点在 iframe 内也能退出）。
- 编辑态（`PREVIEW === false`）行为**逐字保持不变**（回归基线）。

### 2.2 预览组件（新增 `web/src/PreviewOverlay.tsx`）

- 预览 iframe **不注册** `ProbeBridge`：组件用 `e.source === iframe.contentWindow` 自建消息监听，
  与节点 iframe 的 `pageToWin` 映射互不覆盖（同一页面可同时存在节点 iframe 与预览 iframe）。
- 舞台用 `ResizeObserver` 测量内容盒尺寸；`fitScale = min(availW / w, availH / h, 1)`，
  切设备时重置为「适应窗口」。
- 自定义尺寸拖拽按 `dx / scale` 换算逻辑像素，clamp 到 1–10000。
- 站内跳转复用 `resolveNavTarget`（从 `App.tsx` 抽到 `web/src/navTarget.ts`，编辑态与预览共用）：
  只匹配已存在的页面 id，拒绝 `scheme:` / `//` / `#` / 畸形百分号编码。

### 2.3 安全与隔离

- 预览 iframe 与编辑态节点**完全同构**：`sandbox="allow-scripts"`（无 `allow-same-origin`）、
  同一 `/page/:id` 路由与 CSP、`X-Content-Type-Options: nosniff`。
- `preview=1` 仍先经过工作区鉴权（scope + token + Cookie/Bearer 三者匹配）；
  无凭证 / 错误凭证访问预览页仍是 404，参数不构成任何绕过。
- 设备尺寸仅存在于前端内存，只用于 iframe CSS 尺寸；不接受任意 URL / 脚本输入。
- 不新增服务端路由、数据接口、`connect-src` 或 `eval`；不放宽 CSP。

## 三 验收

### 3.1 自动化

`npm run verify`（typecheck + build + notices + test）全绿。
`npm test` 的 Node 汇总：**`tests 155` / `pass 155` / `fail 0` / `skipped 0`**
（0.8.5 为 154，本版新增 `test/preview.e2e.test.mjs` 一项）。

`npm run check:plugin` 通过：`tianshu-canvas@0.9.0 · 9 个工具`，
权限摘要与 0.8.5 相同（工具清单与权限未变）。
`git diff --exit-code -- dist` 为空——提交的 `dist` 与源码构建结果一致。

### 3.2 新增 e2e（真实浏览器 + puppeteer-core）

`test/preview.e2e.test.mjs` 覆盖：

| 组 | 断言 |
|---|---|
| 右键菜单 | 节点右键出现「预览」「预览设备」；二级菜单四项顺序为 网页/平板/手机/自定义，默认「网页」打勾 |
| 打开预览 | 点「预览」→ `.preview-overlay` 出现、iframe 加载；网页模式铺满舞台；「退出预览」可见 |
| 原生交互 | 预览内 `<details>` 可展开、按钮可点击；`selection.json` **不被写入** |
| 设备切换 | 平板逻辑尺寸 768×1024；手机 375×812；分段控件激活态同步 |
| 自定义 | W/H 输入 500×700 生效；输入 `0` 回退原值；拖拽右边缘加宽 |
| 缩放 | 100% 时显示尺寸 = 逻辑尺寸且按钮显示 `100%`；「适应窗口」不大于 100% |
| 站内跳转 | 预览内点链接切到目标页（标题 + iframe src 变化），设备保持 mobile；不写 selection |
| 外链拦截 | 点外链后预览层仍在，出现「外链不可在预览内打开」提示 |
| 页面下拉 | 列出全部页面并可切换 |
| 关闭 | `Esc` 与「退出预览」都能关闭 |
| 预览设备直达 | 右键「预览设备 → 手机」直接进入 mobile 预览 |
| 编辑态回归 | 关闭预览后节点 iframe 点击仍正常写 selection |
| 安全 | `rawFetch` 无凭证 / 错误凭证访问 `/page/:id?preview=1` 均被拒；`preview=1` 注入 `var PREVIEW = true`，编辑态为 `false` |

### 3.3 视觉核对

用真实 `canvas_open` + 合成项目截图（`.claude/canvas-preview/`）：右键菜单（两级、勾选）、
网页 / 平板 / 手机 / 自定义四种预览形态，与需求参考图逐项对照——标题栏布局、设备分段、
自定义 W/H、设备外框、拖拽条、退出按钮、右下角缩放。

### 3.4 已知残留

- macOS / Linux 未声明、未测试；声明范围仍为 `win32-x64` + 天枢 `>=4.0.2 <5.0.0`。
- 预览是只读交互体验，不支持在预览内继续编辑或批注（需退出回编辑态）。
- 预览设备选择只保存在前端内存：刷新页面后回到「网页」，不写入项目文件。

## 变更

- 版本号 0.8.5 → 0.9.0（`package.json`、`tianshu.plugin.json`）。
- 新增 `web/src/PreviewOverlay.tsx`、`web/src/previewDevices.ts`、`web/src/navTarget.ts`。
- 右键菜单新增「预览」「预览设备」；新增 `PlayIcon`、`ExitIcon`、`ChevronRightIcon`。
- 探针支持预览模式；`/page/:id` 接受 `preview=1`。
- 打包清单的验收文档改为 `docs/windows-acceptance-0.9.0.md`。

## 兼容性

- **工具层无变更**：9 个工具的名称、描述、参数、返回结构与错误语义不变。
- **项目数据无变更**：`.tianshu-canvas/` 下文件格式不变，预览不写入任何数据。
- **行为变化**：仅画布前端新增预览入口与预览层；编辑态探针行为不变。
- 旧工程直接打开即可使用，无需迁移。
