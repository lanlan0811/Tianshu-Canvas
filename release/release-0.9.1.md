# 天枢画布设计 v0.9.1

> 2026-11-10 · Apache-2.0

交互精简版：画布上只保留「看」和「批注」，写操作统一回到 AI。
两个用户反馈直接落地——**选中面板去掉元素修改**（很多用户不会用，只会写批注），
**右键菜单只留预览与预览设备**，**设计风格在画布上锁定只读**。
AI 工具清单、参数与项目数据格式一律不变；**不新增任何 AI 工具**。

---

## 一 变更

### 1.1 选中面板：只留批注，去掉元素修改

反馈：多数用户不会用「元素修改」，只会用批注；保留修改入口反而增加误操作与困惑。

移除：

- 文案输入框（含子元素时的「按住 Ctrl 点击」提示）；
- 五项样式输入（文字颜色 / 背景色 / 字号 / 内边距 / 圆角）；
- 「应用修改」按钮与整套回写链路。

保留：

| 区域 | 内容 |
|---|---|
| 头部 | 「选中：页面内元素 / 页面节点」、**复制修改请求**、收起（×） |
| 选中信息 | 页面标题 · 标签名 · xpath |
| 批注 | 「批注这个元素」输入框与**添加批注**按钮 |
| 批注列表 | 每条批注的编号、内容、xpath，以及解决 / 重开 / 删除 |

批注仍写入 `project.json` 的 `comments[]`，AI 用 `canvas_comments`（`action`: list / resolve / reopen / remove）
一次读回全部待处理批注并逐条修改；改动后不会触碰原型文件。

### 1.2 右键菜单：只留预览相关

页面节点右键菜单不再出现「重命名 / 复制 / 置于顶层 / 删除」，只剩：

| 菜单项 | 行为 |
|---|---|
| **预览** | 在画布内打开该页面的全屏预览（设备 = 上次选择，默认网页） |
| **预览设备 ▸** | 二级菜单：**网页 / 平板 / 手机 / 自定义**，当前项打勾；选中后直接进入预览 |

重命名 / 复制 / 删除仍可通过**选中节点后的悬浮工具栏**完成，能力没有减少。
空白处右键的「适应视图」保持不变。

### 1.3 设计风格：画布上锁定只读

顶栏的设计风格徽标改为**只读展示**：

- 显示调色板图标 + 当前风格色卡 + 风格名（如「极简风」「Claude 风」）；
- 右侧加锁图标，`title` 提示「设计风格已锁定，画布上不可更改；如需调整请让 AI 重新设定」；
- 不再可点击、不再有下拉菜单，也不能在画布上回到「自由发挥」。

风格仍由 AI 通过 `canvas_style` 设定 / 切换；因用户误点导致整套设计系统被换掉的情况不复存在。
仅供画布切换使用的 `POST /api/design` 一并移除，AI 侧的 `canvas_style` 与 `/api/design-systems` 不变。

## 二 实现要点

- 前端：`SelectionPanel.tsx` 删除文案/样式状态与提交逻辑；`ContextMenu.tsx` 删除重命名/复制/置顶/删除
  分支与内联重命名输入框；`StyleSwitcher.tsx` 改为无状态只读徽标；`icons.tsx` 新增 `LockIcon`，
  删除已无引用的 `RenameIcon`、`BringToFrontIcon`。
- 删除 `web/src/sourceEdit.ts`（源 HTML 回写）；`Selection` 类型与 `/api/selection` 落盘不再包含 `editableText`。
- 探针移除 `__vd_apply_edits` / `__vd_edit_applied` 消息处理与 `editableText` 字段，
  原型页恢复纯只读（仍保留两层选择、悬停高亮、滚轮转发与批注图钉）。
- 服务端移除仅供元素修改使用的 `GET/POST /api/page-html` 与仅供画布切风格使用的 `POST /api/design`；
  `/page/:id`（探针注入）、`/api/selection`、`/api/comments`、`/api/design-systems` 等保持原样。
- 样式清理：删除 `.selection-panel__styles`、`.selection-panel__text`、`.field--inline`、
  `.context-menu__input`、`.context-menu__sep`、`.context-menu__item--danger` 等失效规则。

## 三 验收

### 3.1 自动化

`npm run verify`（typecheck + build + notices + test）全绿。
`npm test` 的 Node 汇总：**`tests 155` / `pass 155` / `fail 0` / `skipped 0`**（与 0.9.0 同级）。

`npm run check:plugin` 通过：`tianshu-canvas@0.9.1 · 9 个工具`，
权限摘要与工具清单不变（`605d55d1…21d9`）。
`git diff --exit-code -- dist` 为空——提交的 `dist` 与源码构建结果一致。

### 3.2 测试调整（真实浏览器）

| 测试 | 断言 |
|---|---|
| `test/rendering.e2e.test.mjs`（原 `editing.e2e`） | 选中元素后面板**没有** `.selection-panel__styles` / `.selection-panel__text` / 任何 `input`，也没有「应用修改」按钮；只有批注输入框；填批注后写入 `project.json` 且原型文件字节不变；页面脚本伪造 `__vd_edit_applied` / `__vd_apply_edits` 不能改写文件；节点高度稳定、AI 更新后 iframe 自动刷新 |
| `test/probe.e2e.test.mjs` | 两层选择（div / button）后，面板没有样式输入框、有批注输入框；选中不写页面文件 |
| `test/preview.e2e.test.mjs` | 右键菜单**恰好**两项：`['预览', '预览设备']`；四设备、自定义尺寸、跳转、外链、退出等全部回归 |
| `test/server.test.mjs` | `/api/page-html` 与 `/api/design` 均已移除（404）；`/api/design-systems`、鉴权、CSP、CSRF 头不变 |
| `test/regressions.test.mjs` | 变更路由的非对象请求体仍返回 400（已去掉 `/api/page-html`、`/api/design` 两项） |

### 3.3 视觉核对

用真实 `canvas_open` + 合成项目截图（`.claude/canvas-preview/`）：

- `panel-only-comment.png`：选中元素后面板只剩选中信息 + 复制修改请求 + 批注；
- `menu-preview-only.png`：右键菜单只剩「预览」「预览设备」两项；
- `topbar-style-locked.png`：顶栏风格徽标带锁图标、为只读（`button` 数量为 0）。

### 3.4 已知残留

- macOS / Linux 未声明、未测试；声明范围仍为 `win32-x64` + 天枢 `>=4.0.2 <5.0.0`。
- 画布上不再提供任何元素级写操作：改文案 / 改样式 / 增删页面一律由 AI 执行（或节点工具栏的重命名/复制/删除）。
- 「复制修改请求」仍保留：它只生成文本给 AI，不改任何数据。

## 变更清单

- 版本号 0.9.0 → 0.9.1（`package.json`、`tianshu.plugin.json`）。
- 删除 `web/src/sourceEdit.ts`；`Selection` 类型去掉 `editableText`。
- 服务端移除 `GET/POST /api/page-html`、`POST /api/design`。
- 打包清单的验收文档改为 `docs/windows-acceptance-0.9.1.md`。

## 兼容性

- **工具层无变更**：9 个工具的名称、描述、参数、返回结构与错误语义不变。
- **项目数据无变更**：`.tianshu-canvas/` 下文件格式不变；`selection.json` 只是不再写 `editableText`（旧文件仍可读）。
- **行为变化**：画布面板与右键菜单精简，风格徽标只读；这些入口此前也不属于 AI 工具，不影响自动化调用。
- 旧工程直接打开即可使用，无需迁移。
