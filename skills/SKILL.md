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

## 执行顺序（严格按序，不得跳步）

> **顺序是硬约束**：① 先把画布链接给用户 → ② 再确认设计风格 → ③ 最后才写原型。
> 跳步的后果：用户看不到画布，或者看到一套他从未选过的风格。

**第 1 步 · `canvas_open`**：启动/复用画布服务，拿到画布 URL。
把 URL **单独一行**发给用户，让他用浏览器打开。

**第 2 步 · 确认设计风格**：先 `canvas_get_state`，看「设计风格」段。

- **若用户说「要做一套设计系统 / 自定义设计系统 / design system」，或要求打造专属品牌风格** →
  走**自定义分支**（不要走下面的内置选项）：**一次性**问清全部配置——
  ① 配色气质与主色（可给参考产品 / 品牌色 / hex）；② 圆角形态（方正 / 中性 / 圆润）；
  ③ 字号体系（偏紧凑 / 标准 / 舒展）；④ 字体偏好（无衬线 / 衬线 / 等宽，或指定）；
  ⑤ 动效（克制 / 标准 / 活泼）；⑥ 阴影（无 / 轻浮层 / 明显层次）；⑦ 控件尺寸（紧凑 / 标准 / 宽松）；
  ⑧ 是否需要深色（默认要，会同时生成浅色 + 深色两套）。
  收齐回答后调 `canvas_design_system`（action=create，传完整 `tokens` + `iconStyle`），
  它会校验并锁定为当前项目风格，然后进第 3 步用它开发。**不要把配置项拆成多轮反复追问**。
- 已锁定 → 直接用，进第 3 步。
- **自由发挥**，且用户**没有**在需求里给出风格 / 参考产品 / 品牌色 → 调 `canvas_style`（action=list），
  把返回的风格名作为选项**问用户一次**（含各风格名与「自由发挥」），然后**停下来等回答**：

  > 这次用哪种风格？A 苹果风　B 谷歌风　C Claude 风　D 天枢原创　E 自由发挥

  用户答对应风格 → `canvas_style`（action=set，style_id 用 list 返回的 id）；
  答「你决定」→ 保持自由发挥，**不要** set。用户若想要内置风格之外的效果 → 转上面的自定义分支。
- 用户已在需求里给出风格 / 参考产品 / 品牌色 → **不要问**；能对应到内置风格时先 `canvas_style set`，
  否则保持自由发挥；若用户明确要「专属/自成一派」→ 转自定义分支。

**第 3 步 · 生成并写入原型**：按第 2 步确定的风格写页面，`canvas_upsert_page` 每页一次。

**第 4 步 · 自查**：`canvas_check_style`，修掉命中项后再交付。

### 禁止（违反即为流程错误）

- 在把画布 URL 发给用户之前，生成原型、调用 `canvas_upsert_page`、或开始查风格 / 模板。
- **在用户选定风格（或确认自定义配置）之前**，调用 `canvas_style` 的 `set` / `get` / `template`
  （此时只允许 `action=list`）、调用 `canvas_design_system` 的 `create`，
  或自行替用户挑一套风格——**即使你觉得某套「更合适」，也必须先问**。
- 问完不停下来：把选项 / 配置问题抛给用户后，必须等回答再继续，不得同时往下写页面。

## 设计风格（项目级）

风格由「执行顺序」第 2 步确定，锁定后按下面的写法生成页面。
工具会在写入时自动注入 token 与组件 CSS，**不要自己写一套变量**：

- 颜色 `var(--ts-color-*)`；字体 `var(--ts-font-*)`；字号 `var(--ts-fs-*)`；字重 `var(--ts-weight-*)`；
  间距 `var(--ts-space-*)`；圆角 `var(--ts-radius-*)`；阴影 `var(--ts-shadow-*)`；尺寸 `var(--ts-size-*)`。
- 组件用 `canvas_style`（action=get）列出的 `ts-*` 类；不要发明带 `ts-` 前缀的新类。
- 图标写 `<svg data-icon="search" class="ts-icon"></svg>`，名字取自图标清单；写入时工具会内联为当前风格 SVG。
  不要用 emoji 当图标，不要外链图标库 / 字体。
  只有静态 HTML 里的图标会展开；脚本要用图标时，把它写在 `<template>` 里再克隆，不要写在 JS 字符串中。
- 需要骨架：`canvas_style`（action=template，template_id=dashboard|landing）取完整 HTML，改内容后交给 `canvas_upsert_page`。
- 每次写完页面调用 `canvas_check_style`（只报告）；有 color / font / spacing / icon / component 命中就修掉再交付。
  **不要**把检查清单原样念给用户，除非用户问。
- 换风格用 `canvas_style set`：所有页面会被重写、画布自动刷新；告知用户即可。
  v1 只有项目级风格，不要给单页单独设风格。

### 自定义设计系统

用户要「专属设计系统」时用 `canvas_design_system`（见第 2 步的自定义分支）。要点：

- **只在本工作区生效**，存在 `.tianshu-canvas/library/`（随项目数据一起被 gitignore，不随仓库分发）。
- **只能改 token，不能扩展组件与图标**：`ts-*` 组件类（23 个）与图标名（77 个）是共享的，
  自定义风格只决定它们的颜色 / 字体 / 间距 / 圆角 / 阴影 / 尺寸。不要发明新的 `ts-` 类或图标名。
- **变量名必须与内置风格完全一致**（工具会校验），值自由。
- **浅色 + 深色两套**：默认生成。深色在页面根元素加 `class="dark"` 即切换
  （`<html class="dark">` 或 `<body class="dark">`），浅色是默认。
- `canvas_design_system` 的 `create` 会做写入前校验：对比度（浅色与深色各一遍，正文 ≥ 4.5）、
  尺度递增、变量名覆盖共享 CSS。**不通过会返回逐条错误——照错误改，不要绕过**。
- 查看：`canvas_design_system`（action=list / get）；删除：action=remove（内置风格不可删）。
- 跨机克隆若缺少 `library/`，该风格会解析失败、页面退化为无样式——提醒用户别把 library 排除在备份外。

## 工作流（第 3 步的写法细节）

> 步骤顺序见上面的「执行顺序」。本节只讲原型怎么写、怎么写入。

- **原型内容**：直接写好完整 HTML，**不要**在工作区里新建 `design/`、`prototype/` 等文件夹或 HTML 文件——原型只存放在 `.tianshu-canvas/pages/`。
  - 用真实 HTML/CSS，可用现代布局（flex/grid）、渐变、圆角、阴影。
  - **必须单页自包含**：外链（CDN、Google Fonts、图片）和相对路径都会被画布 CSP 拦截，加载不到。样式和脚本写进 `<style>`、`<script>`，图片用 `data:` URI 或 CSS/SVG 绘制；不要依赖 Tailwind CDN 这类外部脚本。
- **写入**：调用 `canvas_upsert_page`，用 `html` 参数直接传入完整内联 HTML（不要先写文件再用 `html_path`），
  再给 `title`、可选 `device_type`（desktop/tablet/mobile/free）与 `x`/`y`。
  - 每次写入后，把画布 URL 一并回给用户，方便其刷新查看。
- **多页**：每页一个节点，画布会自动排布；重复「写 HTML → 写入」即可。
- **查看 / 确认**：`canvas_get_state` 一次返回所有页面节点、连线、用户当前选中项和画布 URL。

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
- **导出**：由用户在画布顶栏点「导出」自行完成（PNG 截图 / ZIP 打包）。**没有对应工具**，不要尝试导出或替用户导出。
- **元素批注（批量改）**：用户在画布上选中元素后打图钉、写一句批注（存在 project.json 的 `comments[]`）。
  用户说「我圈了几处」「画布上有几处要改」时，调用 `canvas_comments`（action=list）**一次读回全部待处理批注**，
  按 xpath 逐条修改（通常用 `canvas_upsert_page` 重写该页），改完再用 `action=resolve` 传 ids 标记已解决。
  也支持 `reopen`（重新打开）与 `remove`（删除，或 `all=true` 清空）。
- 用户也可在画布面板点「复制修改请求」把选中项文本粘给你；或直接在画布上改文案/样式（会回写原型）。

## 资源内联（`canvas_upsert_page` 的 `inline_assets`）

原型里外链（CDN/字体/图片）与相对路径都会被画布 CSP 拦截，加载不到。传 `inline_assets=true` 时，
工具会把这些资源抓取并内联成 `data:` URI（图片/字体/CSS/SVG/脚本），相对路径还需给 `inline_assets_origin`
（基准地址，如 `https://example.com/page`）。

- **默认关闭**：只有用户要求「用真实图片/真实字体」或原型确实缺资源时才开。
- 开启前确认这些外部资源是**可信来源**（插件会真的发起网络请求）。
- 抓不到或超限的资源会**保留原引用并说明**；返回里会列出「已内联 N 项 / 跳过 M 项」。
- 内联会让页面变大；合计超过约 8MB 会跳过剩余项，可能导致保存失败，超限时如实告知用户。

## 导出生产代码（`canvas_style` 的 `action=codegen`）

用户说「导出代码 / 转成前端代码 / 要 React 版本 / 要 iOS 版 / 给我个能用的代码」时用它。

**执行顺序（硬约束，不得跳步）**：
1. **先问「目标」**——把下面四项作为选项问用户，**等回答**，不得自行假定：
   > 导出成什么？A React + TSX　B CSS 变量 + 无框架 HTML　C Tailwind　D 多端
2. 若选 **D 多端**，**再问技术栈**（可多选多端）：
   > iOS：SwiftUI / UIKit；Android：Compose / XML；小程序：微信原生 / uni-app / Taro
3. 拿到回答后调 `canvas_style`（`action=codegen`）：
   - Web：`target` = `react` / `css-vars` / `tailwind`。
   - 多端：`target` = `ios` / `android` / `miniprogram`，并传 `stack`（`swiftui`/`uikit`/`compose`/`xml`/`weapp`/`uniapp`/`taro`）。
   - 可用 `page_id` 指定页面（画布只有一个页面时可省略），或用 `html` 直接传源。

**多端产物的正确用法**：插件只出**主题/Token 文件 + `design-spec.md` 规格清单**（这是确定性的、已校验的部分）。
**页面代码由你按 `design-spec.md` 亲自编写** —— HTML→原生不是自动转换，必然有损
（flex/grid 布局、伪元素、自定义滚动无法 1:1）。**不要声称「像素级还原」**，并提醒用户真机校对。

### 禁止（违反即为流程错误）

- 在用户选定目标（多端还要选定技术栈）之前，调用 `canvas_style`（`action=codegen`）——**即使你觉得某个目标更合适，也必须先问**。
- 把多端产物当成「完整可运行的原生工程」交付；它是主题 + 规格，页面代码需要你写。
- 替用户决定多端技术栈。

## 从现有页面反推设计系统（`canvas_design_system` 的 `action=extract`）

用户说「照这个站点的风格做」「用这个页面的配色」「把这个设计系统搬过来」时用它。
插件会解析现有 HTML/CSS（或抓取一个 URL），**反推出一套能通过严格校验的设计系统**并创建。

- 来源三选一：`source`（内联 HTML/CSS）、`path`（工作区内 `.html`/`.css` 文件）、`url`（远程页面，仅 http/https，有 SSRF 防护禁内网）。
- 建议先 `dry_run=true` 看摘要（含「观测 N 项 / 推断 M 项」与完整 tokens），确认后再正式执行。
- 反抽取会按契约补齐缺失键，并对低对比配色做后处理；返回里会说明哪些是观测、哪些是推断。
- 创建后默认锁定为当前项目风格；不要在 `notice`/`description` 里写源 URL（会被校验拒绝）。

## 约定

- 页面节点以**逻辑分辨率**渲染（desktop 1440×900 / tablet 768×1024 / mobile 375×812），
  节点标题栏在任意缩放下视觉尺寸恒定。
- 画布操作：空格/中键拖拽平移；Ctrl+滚轮缩放；普通滚轮平移；缩略图与缩放控件在右下角。
- 原型在沙箱 iframe 中渲染（`sandbox=\"allow-scripts\"`，无同源权限），因此**不要依赖读取画布页面的状态**。
- 用户在画布上只能改不含子元素的元素文案，并按源 HTML 回写；由脚本生成的元素无法直接回写，会提示交给你修改。
- 项目数据存于 `<cwd>/.tianshu-canvas/`（project.json + pages/*.html），可版本化。原型 HTML 只存放在这里，**不要**在工作区另建 `design/`、`prototype/` 等目录存放原型。
- 安装/启用插件后需**新建会话**才生效。

## 工具

| 工具 | 用途 | 何时用 |
|---|---|---|
| `canvas_open` | 启动/复用本地画布服务，返回浏览器 URL | **第一步，永远先调用** |
| `canvas_upsert_page` | 新增页面，或更新已有页面（HTML / 标题 / 位置 / 尺寸）；`inline_assets` 可内联被拦资源 | 已 `canvas_open` 且已生成原型后；重命名、移动也用它 |
| `canvas_get_state` | 读取页面列表、连线、用户当前选中项、画布 URL | 需要查看/确认，或用户选中元素后据此修改 |
| `canvas_arrange` | 删除 / 复制页面、连线 / 取消连线（`action` 选择） | 编排画布、表达页面流程时 |
| `canvas_style` | 列出 / 查看 / 锁定 / 切换设计风格，取模板 HTML，或 `action=codegen` 导出生产代码 | 用户没指定风格时先 list 再问；写页面前 get；需要骨架时 template；导出代码时**先问目标（多端再问技术栈）**再 codegen |
| `canvas_check_style` | 只读检查页面是否符合当前风格 | 每次写完页面后；用户问「为什么风格不统一」时 |
| `canvas_design_system` | 创建 / 查看 / 删除自定义设计系统；`action=extract` 从现有 HTML/CSS/URL 反抽取 | 用户要做「专属设计系统」时：问清配置后 create；用户要「照这个站点的风格」时 extract（先 dry_run） |
| `canvas_comments` | 读取 / 处理画布元素批注（`action`: list / resolve / reopen / remove） | 用户圈了几处要改时：先 list 读全部，逐条改完再 resolve |
