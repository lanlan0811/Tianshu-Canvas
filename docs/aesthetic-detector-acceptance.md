# 审美与工艺检测：阶段 0 + 阶段 1 验收记录

日期：2026-11-25 · 版本：0.9.6（未发版，功能入库）

## 交付内容

### 阶段 0 · 地基契约

| 项 | 落地 | 验证 |
|---|---|---|
| 选择器级 CSS 解析 | `src/cssParse.ts` 新增 `ruleBlocks` / `inlineStyleBlocks`；`declarations()` 未改 | `test/css.rule-blocks.test.mjs`（18 项，含 1 MiB 对抗样本 < 300ms） |
| 页面模式 | `src/modes.ts`；`PageNode.mode`；`canvas_upsert_page.surface_mode`；`canvas_get_state` 显示 | `test/modes.test.mjs`（8 项，含非法值拒绝、旧项目兼容、复制继承） |
| LintOptions | `lintHtml(html, styleId, cwd, options)`；`contract.ts` 显式 `{detector:false}` | `test/audit.contract.test.mjs` 分数未变 |
| 组件八态 | `components.json` 26 条 `states`/`stateAttrs`；`components.css` 状态规则；`validateStateContract` 构建期门禁 | `test/design.states.test.mjs`（11 项，含 3 个负例） |
| 浏览器表面 | `::selection` / caret / 滚动条 / 下划线偏移 / tabular-nums / `color-scheme` / reduced-motion | 同上（4 项断言） |
| SKILL 契约 | 页面模式节、状态契约节、浏览器表面节、文案四级 + 硬规则 | 人工复核 |

### 阶段 1 · 检测器

| 项 | 落地 |
|---|---|
| 规则注册表 | `src/rules/registry.ts`：18 条源码级规则，含中文名/描述/修复/模式画像/溯源 |
| 规则引擎 | `src/rules/engine.ts` + 6 个规则模块 + `colorMath` / `textMath` / `ignores` / `profiles` |
| 豁免 | `<!-- tianshu-lint-disable[-next-line] rule -->`，未生效豁免点名 |
| 工具面 | `canvas_check_style`：`action=list_rules`、`rules`、`ignore`、`surface_mode`；写入时工艺提示（非阻塞，0 命中不加行） |
| 文档 | `docs/rule-sources.md`（溯源与差异）、README 两节 |

## 规则清单与门禁

18 条源码级规则，每条 **4 flag + 5 pass** fixture，共 162 个 fixture：

overused-font · gradient-text · side-tab · border-accent-on-rounded · ai-color-palette ·
cream-palette · gray-on-color · hard-offset-shadow · bounce-easing ·
repeating-stripes-gradient · codex-grid-background · marquee · monotonous-spacing ·
em-dash-overuse · marketing-buzzword · aphoristic-cadence · radial-halo · emoji-icon

## 验收（对应项目规则）

1. **复现**：每条规则先写 fixture；实现过程中 9 条规则先后红→绿（side-tab 圆形豁免、gray-on-color 灰系阈值、
   codex-grid 的 calc 形态、aphoristic EN 正则、emoji solo 文本、marketing 专名豁免等）。
2. **回归**：`npm run verify` 全绿；`npm test` **571 项全过**（较改动前 331 → 551 → 571）；
   `test/audit.contract.test.mjs` 分数与改动前一致（detector 已显式关闭）。
3. **复发**：每个 fixture 目录都有一条「连续两次结果一致」的确定性断言。
4. **验证**：真实链路走过 —— `canvas_open` → `canvas_upsert_page`（带 `surface_mode`）→ 写入提示 →
   `canvas_check_style` 完整报告 → `action=list_rules`。
5. **核实**：`npm run check:plugin` 逐字节比对 9 个工具描述通过；`dist/**` 已随源码重新生成并提交。
6. **归族**：`docs/rule-sources.md` 记录每条规则的判据来源与不移植理由。
7. **时间维 / 基线**：components.css 新增状态样式与浏览器表面，**会改变渲染结果**；
   已有视觉基线需要重新生成（`canvas_audit action=baseline`），这是预期变化。
8. **假绿 / 未测项**：
   - 渲染级 8 条规则（tiny-text、line-length、tight-leading、all-caps-body、wide-tracking、
     flat-type-hierarchy、heading-rhythm、undersized-ui-text）**本轮未实现**，留待下一阶段接 Puppeteer 通道；
   - 无 Chrome 的 CI 环境不会跑任何渲染检查；
   - 浏览器差异（Safari/Firefox 的滚动条伪元素、`color-scheme` 表现）未在本轮验证；
   - 中文 em-dash 规则按设计不生效（「——」是合法标点），因此中文页面的破折号过密不会被报出。

## 已知取舍

- **不新增 `--ts-*` token / `ts-*` 类**：11 套风格与 codegen 映射都依赖这两份契约的稳定性，
  状态一律属性/伪类驱动，`success`/`error` 复用既有 `status-*` 与 toast 变体。
- **`::selection` 用 `action.ghost-hover`**：各内置风格都是 brand 浅色调；自定义风格若该值过深，
  需人工复核选中文字的可读性。
- **`cream-palette` 对 `#faf9f5` 不报**：暖差 5 未达 6 的下限（claude 风格画布色），属规则阈值的预期边界。
