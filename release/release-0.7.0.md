# 天枢画布设计 v0.7.0

> 2026-11-06 · Apache-2.0

护城河版：让设计产物**进得去真实代码库**、**经得起查**、**越用越准**。

- **适配器**：`canvas_style` 的 `codegen` 新增 `shadcn` 与 `antd` 两个 target，按真实组件 props 生成代码，并纳入编译验收。
- **Design CI**：新增第 9 个工具 `canvas_audit`（契约 / 可访问性 / 视觉回归 / 漂移）。
- **品牌记忆**：使用数据沉淀到 `.tianshu-canvas/memory/brand.json`，并支持可移植品牌包（`export` / `import_pack`）。

---

## 新增

### 1. 真实代码库适配器（`shadcn` / `antd`）

- `canvas_design_system` 新增 `action=import`：从仓库现有主题导入成设计系统。
  - 自动探测：`antd` 依赖 → antd；tailwind 依赖 + `components.json`/样式文件 → shadcn；也可用 `stack` 显式指定。
  - shadcn 支持 `oklch()`、旧版 `hsl(var(--x))` 裸三元组、`tailwind.config.*` 字面值与 `@theme inline`。
  - AntD 读取 `ConfigProvider theme={{ token }}` 字面量；**找不到时明确说明使用的是 v5 默认种子 token**，不冒充项目主题。
  - 所有颜色归一化为 `#hex` 后走同一套严格 token 契约（对比度、尺度递增、变量覆盖）。
  - 返回区分「观测 N 项 / 推断 M 项」；推断项（hover、状态色、色阶）需用户核对。
- `canvas_style` 的 `target` 新增 `shadcn`、`antd`：
  - shadcn：`Button`（`variant`/`size`）、`Input`、`Table` 系列、`Card`、`Badge`、`Tabs`、`Dialog`，其余类名改写为 Tailwind utility；产物为 `app/page.tsx`、`lib/theme.ts`、`app/theme.css`、落地说明。
  - AntD：`Button`（`type`/`danger`）、`Input`、`Select`、`Table`（`columns` 从表头派生）、`Card`、`Tag`、`Tabs`、`Modal`，主题集中在 `src/theme.ts`，页面不硬编码色值。
  - 组件选择基于 **HTML 节点树**（新增 `src/htmlTree.ts`），不是字符串替换；结构变了，产物随之变化。
  - 自定义风格的 `meta.json` 新增可选 `adapter` 字段（旧 library 不受影响）。

### 2. 编译验收

- `npm run verify:codegen`（进 CI）：用 `test/fixtures/codegen/stubs.d.ts` 做严格类型检查，
  正向两条产物必须编译通过，反向四条（非法 `variant`、非法 `Button type`、主题类型错误）**必须编译失败**——证明桩不是 `any` 假绿。
- `npm run verify:codegen:real`（发版前手动）：真实安装 `react` / `antd` / `typescript` 后编译同一批产物。

### 3. Design CI：`canvas_audit`

| action | 能力 |
|---|---|
| `contract` | token 使用、裸色值、间距越界、图标来源、组件类；符合度评分；可落盘自包含的 `*.audit.test.mjs` |
| `a11y` | 自研零依赖规则集：对比度（追溯真实背景）、可访问名、表单标签、焦点可见性、目标尺寸、标题层级、`lang`、`aria-hidden` 焦点 |
| `baseline` / `visual` | 逐页截图基线与逐像素比较，输出偏离度分数与变化区域 bbox；`node:zlib` 自写 PNG 解码，无新增依赖 |
| `drift` | 与上次设计快照比较：新增 / 移除 / 未使用 / 越界四类差集 |

- 视觉基线默认 `.tianshu-canvas/audit/baseline`（被 gitignore），可用 `baseline_dir` 指到仓库内可提交目录。
- 截图复用 `export.ts` 的 `spawn + DevToolsActivePort + puppeteer.connect` 链路与串行队列；等待策略改为 `document.fonts.ready` + iframe load，不再固定 sleep。
- 画布支持 `?page=<id>&export=1` 只渲染目标页面，避免整画布截图漂移。

### 4. 品牌记忆与品牌包

- `.tianshu-canvas/memory/brand.json` 累加每个风格的使用统计（组件 / 图标 / 变量）与审计命中；
  `canvas_design_system`（`action=get`）与 `canvas_get_state` 展示摘要。
- `action=export`：单 JSON 品牌包（tokens + meta + 使用记忆 + checksum），无时间戳，重复导出字节一致。
- `action=import_pack`：先校验 checksum 与 token 契约，重名默认拒绝（`overwrite=true` 才覆盖），导入后自动锁定。
- 删除自定义风格时同步清理其记忆，不留悬空引用。

---

## 变更

- 工具数 **8 → 9**（新增 `canvas_audit`）。清单与运行时描述仍逐字一致、≤200 字。
- `canvas_design_system` 的描述更新（包含 import / export / import_pack）。
- `canvas_design_system` 的 `pathParams` 新增 `source_path: read`、`pack_path: read`、`out_dir: write`。
- `canvas_style.codegen` 的 `target` 枚举扩展；原有 target 行为不变。
- CI 在 `npm test` 之后新增 `npm run verify:codegen`。

## 兼容性

- 无项目数据迁移；旧 `.tianshu-canvas/`（project.json / pages / library）直接可用。
- 自定义风格 `meta.json` 的 `adapter` 为可选字段；旧风格加载行为不变。
- 已安装 0.6.0 可直接覆盖升级，新建会话后生效。

## 发版检查单

1. `npm run verify`（typecheck + build + test，全绿）。
2. `npm run verify:codegen`（正向 2 项 / 反向 4 项）。
3. `npm run verify:codegen:real`（真实依赖编译，结果记录于本文件）。
4. `node scripts/verify-web.mjs`（真实无头浏览器渲染画布）。
5. `npm run check:plugin` + 官方套件 `validate --lane official_reviewed`。
6. `git diff --exit-code -- dist` 通过（dist 与源码一致）。
