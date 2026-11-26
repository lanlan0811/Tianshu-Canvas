# 阶段 6（治理与回归）验收记录

日期：2026-11-26 · 版本：0.9.6（未发版，功能入库）
复刻来源：`D:\Trae项目\impeccable`（Apache-2.0，Paul Bakaus，提交 `b49177d`）。规范源以 `skill/reference/` 为准。
只移植判据、阈值与流程约束；中文文案、JSON/Markdown 结构与实现代码全部自写。

## Context：为什么需要这一层

阶段 0–5 把检测能力做起来了，但缺三样治理手段：规则不分轻重（写入提示把「机械可改」和「口味判断」混在一起报）、
报告文本没有回归基线（改一条消息文案没有任何东西会失败）、漂移只覆盖变量与类。

## 交付内容

### 6.1 规则自证

| 项 | 落地 | 验证 |
|---|---|---|
| immediate / deferred 两档 | `RuleDef.tier` 必填（`src/rules/types.ts`）；22 条逐条标注；9 条风格规则用 `IMMEDIATE_STYLE_RULES` 常量打档（`src/lint.ts`） | `test/rules.unit.test.mjs` 硬断言 immediate 集合恰为 5 条（防止悄悄放水） |
| 写入提示改按档位过滤 | `craftHint` 改为 `f.tier === 'immediate'`，并纳入风格规则（`{ mode }` 而非 `{ style: false, mode }`） | `test/lint.detector.test.mjs`：immediate 命中要提示、deferred 命中不提示、设计系统漂移要提示 |
| list_rules 展示档位 | 每行加 `immediate`/`deferred`，并解释两档语义 | 同上 |
| golden 逐字节基线 | `test/golden/check-style/` 6 组输入 + 6 份 `.golden.txt` + `README.md` | `test/golden.check-style.test.mjs`（8 项：6 组比对 + 确定性 + 篡改检测） |

**immediate 名单（5 条工艺规则 + 9 条风格规则）**：`gradient-text`、`side-tab`、`border-accent-on-rounded`、
`gray-on-color`、`emoji-icon`；风格侧 `resource`/`color`/`font`/`spacing`/`radius`/`icon`/`component`/`interaction`/`token`。
其余 17 条工艺规则全部 deferred。

### 6.2 漂移检测强化

| 项 | 落地 | 验证 |
|---|---|---|
| 组件契约产物 | `dist/design/components/contract.json`（26 条，含 id/base/classes/states/stateAttrs/tokens；**不含** example/slots/variants） | `test/design.catalog.test.mjs` 新增产物断言（含「不得携带示例」的负向断言） |
| 运行时读取 | `src/design/components.ts`（校验 schemaVersion，缺失时报可读错误） | 被 drift 与 DESIGN.md 复用 |
| 快照三字段 | `schemaVersion: 2` + `modes` / `usedStates` / `browserSurfaces` | `test/drift.test.mjs`（8 项纯函数） |
| 口径复用 | `STATE_MARKERS` / `ALL_STATES` / `selectorTexts` 从 `scripts/design/design-validate.mjs` **导出**，运行时 import 同一份 | 构建期与运行时不再各写一套 |
| 报告按严重度排序 | 越界 > 未使用 > 移除 > 新增；未使用补名单；模式/组件状态/浏览器表面各单列 | 同上；`test/audit.contract.test.mjs` 既有 drift 断言通过 |
| 旧快照兼容 | `readSnapshot` 校验 schemaVersion，v1 补齐字段并置内存标记，报告注明「基线来自旧版快照，已升级」 | `test/drift.test.mjs` 的升级用例 |

### 6.3 DESIGN.md 兼容导出

| 项 | 落地 | 验证 |
|---|---|---|
| 投影生成器 | `src/designDoc.ts`（纯函数，零新依赖，手写 YAML） | `test/design-doc.test.mjs`（7 项） |
| frontmatter 只五组 | colors / typography / rounded / spacing / components；原语不进 frontmatter | 白名单断言 + 「原语只在正文表格」断言 |
| 组件子 token 八属性 | `backgroundColor/textColor/typography/rounded/padding/size/height/width`；`size` 解析成 px 字面量（不编造引用） | 键集合 ⊆ 八属性断言 + 引用路径存在性断言 |
| 八节固定英文标题 | Overview / Colors / Typography / Layout / Elevation & Depth / Shapes / Components / Do's and Don'ts | 顺序与原文断言；缺数据的整节省略（最小 tokens 用例） |
| 命名规则 | 每节最多 3 条 `**The X Rule.**`，中文教义原创 | 人工复核 |
| export 接入 | 品牌包同目录写 `DESIGN.md`；**已存在时不覆盖**并明确提示 | `test/design.custom.test.mjs` 新增 e2e（含二次导出不覆盖人工内容） |
| 工具描述同步 | `tools.ts` 与 `tianshu.plugin.json` 逐字一致 | `npm run check:plugin` 通过（124 文件 4847.2 KiB） |

## 验收（对应项目规则）

1. **复现**：先写 6 份 golden 输入并**人工复核报告**再落基线；先写「deferred 不提示 / 漂移要提示」两条失败用例再改 `craftHint`；先写 drift 三字段的失败断言再改 `diffSnapshots`。
2. **回归**：`npm test` 全量绿；`verify:prototypes` 44/44、`verify:codegen` 6 项、`check:plugin`、`notices:check` 全过；既有 drift 断言（首次快照 / 无漂移 / 改风格）全部保留并通过。
3. **复发**：golden 连续两次运行一致；`buildDesignDoc` 与 `writeSnapshot` 同输入两次字节相同（单测断言）。
4. **验证**：真实跑 `canvas_upsert_page` 三种页面（immediate 命中 / deferred 命中 / 设计系统漂移）、`canvas_audit action=drift`（模式变化 + 组件状态变化）、`canvas_design_system action=export`（生成八节 DESIGN.md 并二次导出验证不覆盖）。
5. **核实**：`check:plugin` 逐字节比对通过；`git diff --stat -- dist` 确认新产物已提交。
6. **归族**：22 条规则 tier 全表核对；9 条风格规则常量与 detector 表不冲突；`STATE_MARKERS` 只有一份定义（构建期导出、运行时 import）。
7. **时间维 / 基线**：新增 `dist/design/components/contract.json` 使发行包从 123 → 124 个文件（4814.8 → 4847.2 KiB）；漂移报告格式变化（新增模式/状态/表面三行、四段顺序）已在 `docs/rule-sources.md` 与本文件记录。
8. **假绿**：负例都真失败——deferred 规则写入不提示（真阴）、设计系统漂移写入要提示（真阳）、golden 改一个字符即失败、输入 sha256 不匹配即失败、`DESIGN.md` 已存在时不覆盖。

## 未测项补齐（本轮追加）

原本列的六项，逐条处置如下：

| 原未测项 | 处置 | 证据 |
|---|---|---|
| 规则命中精度 / 伤害率未统计 | **部分补齐**：新增 `scripts/rule-precision.mjs`（`npm run verify:precision`），在 44 份自建语料上测干净命中、88 份 flag 测召回、110 份 pass 测误报 | `docs/rule-precision.md`：干净语料 0/44、召回 88/88、阴性误报 0/110 |
| 渲染级报告无 golden | **补齐 a11y / states**：`test/golden/render/` 两个页面 × 两个 action，报告逐字节比对（页面 id/标题归一化） | `test/golden.render.test.mjs`（5 项，需浏览器） |
| DESIGN.md 未做 round-trip | **补齐**：`parseDesignDoc` 回读 + `validateDesignDoc` 结构校验（五组/八属性/引用路径/八节顺序） | `test/design-doc.test.mjs`（新增 7 项，含 5 个负例） |
| Stitch 实际解析未验证 | **仍不可测**：本机无 Stitch，只在文档里标明「结构自检 ≠ 官方校验器」 | — |
| usedStates 只反映设计系统侧 | **补齐**：快照加 `pageStates`（页面实际出现的状态信号），报告单列增减 | `test/drift.test.mjs`（新增 1 项） |
| browserSurfaces 只做存在性探测 | **仍保持**：不判断取值合理性（例如滚动条颜色对比度），属渲染级判断 | — |

### 精度实测的诚实边界

`docs/rule-precision.md` 写明了三点：干净语料零命中是**选择偏倚**的结果（语料本身按规范写成）、
召回 100% 只证明 fixture 与实现一致、阴性零误报证明豁免逻辑没坏。
**真实世界精度与伤害率仍无法测**——需要外部站点语料与人工判读，本项目不具备。

实测过程中发现的真实缺陷：`rule-precision.mjs` 最初对所有规则硬编码 `tianshu-original` 风格，
把 `overused-font` 的「品牌字体豁免」阴性样本误判成 1 条误报；改为逐规则读取 fixture 的 `meta.json` 后归零。
这说明**测试口径与 fixture 不一致会制造假信号**。

## 仍未覆盖（不得当成通过）

- **真实站点语料**：精度与伤害率无法外推。
- **Stitch 官方解析器**：本机无该工具，`validateDesignDoc` 只是按 spec 文本的结构自检。
- **`quality` / `review` 的报告 golden**：quality 依赖字体加载与几何测量（跨机器有 1px 级差异），review 是多视口截图，逐字节比对成本高于收益。
- **渲染级 golden 只在 Chromium 跑过**：Safari / Firefox 排版差异未测。
- **`browserSurfaces` 取值合理性**：只探测存在性。
- **旧快照升级只做字段补齐**：不做语义迁移；v1 快照缺少状态/表面数据，升级后首轮比较会出现「新增」噪声。

## 已知取舍

- **写入仍不阻塞**：immediate 只是「更早提示」，`canvas_upsert_page` 永不 `isError`。impeccable 的写前门禁（含 6 次后放行）不移植——天枢没有 hook 生命周期，拦截会打断创作流程。
- **golden 只锁格式不锁语义**：它保证「报告文本变了必须有人看」，不保证报告内容正确；正确性仍由 fixture（4 flag + 5 pass）与规则单测负责。
- **组件契约进 dist 但裁剪**：不带 `example`/`slots`/`variants`，避免把示例 HTML 塞进发行包；DESIGN.md 需要的子 token 属性以 `tokens` 字段单独携带。
- **DESIGN.md 的 typography frontmatter 只写字族**：字阶放在正文表格里，因为 Stitch 的 `typography` 组期望的是样式条目，把 9 档字号硬塞进去会被解析器当成坏结构。
