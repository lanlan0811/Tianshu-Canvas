# 天枢画布设计 v0.8.0

> 2026-11-07 · Apache-2.0

把画布从「一次生成一个 HTML」升级为「生成完整一套多页前端」：
新增可复用、可校验的**交互库**（和组件库同构），支持**页面间跳转**与**多页静态站导出**，
并精修画布点击语义（不再吞掉原生默认行为）。

---

## 新增

### 01 交互库 —— 和组件库一样的东西

16 个交互模式，声明式写法，写入页面时自动注入共享样式与运行时：

| 分类 | 模式 |
|---|---|
| 基础 | tabs、modal、drawer、dropdown、accordion、toast |
| 反馈 | tooltip、loading-skeleton、progress |
| 表单 | form-validation、segmented、switch、stepper |
| 数据 | pagination、sortable-table、date-picker |

- **源数据**在 `design-systems/interactions/`：`interactions.json`（契约）+ `interactions.css`（样式，只用 `--ts-*`）+ `interactions.js`（**单一共享运行时**，原生 JS，存在性守卫）。
- **与组件库同构**：全风格共享，差异只来自 token；构建期校验 16 条、类名 `ts-` 前缀与定义、骨架只用已声明类、`interactions.js` 禁 `fetch`/XHR/本地存储/cookie/外链；自定义风格（`library/`）复用同一契约。
- **按需注入**：页面用到 `data-ts-*` 或交互类时才注入，未用到保持轻量；随设计系统注入块一起幂等剥离。复用组件目录已有类（`ts-tabs`/`ts-dialog`/`ts-toast`/`ts-switch`/`ts-progress`/`ts-table`），交互独有类用 `ts-i-` 前缀。
- **取用**：`canvas_style`（`action=get`）列交互清单；`action=interaction`（`interaction_id=...`）返回骨架 HTML、必需结构与用法。

### 02 页面间跳转

页面里用**真实链接**表达跳转，三种写法：

- `<a href="page-3f2a91c4.html">`（推荐，真实页面 id）
- `<a data-nav="page-3f2a91c4">`
- `<a href="产品详情.html">`（按页面 `title` 的 slug 匹配，要求标题唯一）

写入时链接被**规范化为目标页面 id**（写入时规范化）：标题 slug 统一解析、重名歧义**直接报错**、
目标页稍后创建时**自动补齐**前向引用（变更检测，仅改写变化的页面）。外链、`#` 锚点原样保留。
画布上点击这类链接会**选中并定位到目标页面节点**；Ctrl/⌘+点击只选中以便编辑。

实现：`src/nav.ts`（纯函数：slug / 解析 / 规范化）、`src/tools.ts`（写入前规范化 + 写后补齐）、探针新增 `__vd_request_navigate` 上行消息、`ProbeBridge` + `App.selectAndFit` 接跳转。

### 03 多页静态站导出

用户在画布顶栏「导出」得到的 ZIP 从「画廊 + 各页孤立 HTML」升级为**一套可直接打开的多页前端**：

```
index.html            导航首页（各页真链接）
overview.html         旧的 iframe 画廊（保留不丢）
pages/<id>.html       每页：剥离内联 ds 块 → 挂共享 CSS → 内联脚本原样
assets/tokens.css     resolveDesignStyle 的 tokens（仅锁定风格时）
assets/components.css 共享组件样式
assets/interactions.{css,js}  页面用到交互时
project.json
```

## 变更

### 01 画布点击语义精修

旧版探针对每次点击**无条件** `preventDefault()`：既吞掉页面内链接，也打断了元素原生默认行为
（`<details>` 折叠、`<label for>` 聚焦、复选框等）。新版只拦截**会导致页面导航的链接**，其余一律放行。

### 02 自定义设计系统复用交互契约

`library/<id>/` 与组件/图标/模板一致：只换 token，复用内置交互库（16 模式、`ts-i-*` 类）。

## 测试

- 新增 `test/nav.test.mjs`（slug / 外链过滤 / 规范化 / 前向补齐 / 歧义）、
  `test/design.interact.inject.test.mjs`（按需注入 / 幂等 / 剥离还原 / lint）、
  `test/nav.e2e.test.mjs`（画布内真点链接跳转 / Ctrl 只选中 / 外链不跳）、
  `test/interaction.e2e.test.mjs`（画布侧原生默认行为 + tabs/modal；导出站 `file://` 真点导航与按钮）。
- 扩充 `test/export.test.mjs`（新 ZIP 结构 + 共享 CSS + 链接规范化 + 内联脚本保留）、`test/design.catalog.test.mjs`（交互产物齐全/同构/无禁用能力）。
- `npm run verify` 全绿，共 141 项通过；`dist/` 已重建提交；零新增依赖（`THIRD-PARTY-NOTICES.md` 不变）。

## 边界（明确不做）

- 交互运行时**不支持** `fetch`/后端请求（画布 CSP 禁 connect），**不支持**本地存储/cookie（iframe 无同源）——交互状态用内存变量。
- 导出是 HTML/CSS 的确定性转换，页面内联 `<script>` 原样保留，但不校验其可运行性。
- 跳转恒为 postMessage + 父侧定位，不做 iframe 自身导航；`edges`（画布连线）只表达流程，不生成导航。
- 仅抽离注入的 ds 块为共享资源；页面自写的非 ds `<style>`/`<script>` 仍内联。
