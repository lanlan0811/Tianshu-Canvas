# 工艺规则来源与判据

本项目的工艺检测规则（`src/rules/`）在**判据与阈值**上参考了
[Impeccable](https://github.com/pbakaus/impeccable)（Apache-2.0，作者 Paul Bakaus）的
确定性反模式规则集。移植范围仅限**阈值与判定条件**；规则名、中文描述、修复建议、
解析器、测试与 fixture 全部为本项目原创实现，未复制其 Rust 源码、技能文档正文或 fixture 文件。

## 规则对照

| 规则 id | 严重度 | 判据来源（impeccable 仓库相对路径） |
|---|---|---|
| `overused-font` | warning | `crates/foundation/src/constants.rs` (OVERUSED_FONTS) |
| `gradient-text` | warning | `crates/core/src/checks/rules.rs` (gradient-text) |
| `side-tab` | warning | `crates/core/src/checks/side_bar.rs` |
| `border-accent-on-rounded` | warning | `crates/core/src/checks/rules.rs` (check_borders) |
| `ai-color-palette` | warning | `crates/core/src/checks/rules.rs` (check_colors) / `PURPLE_ACCENT_HEXES` |
| `cream-palette` | advisory | `crates/core/src/checks/measures.rs` (is_cream_color) |
| `gray-on-color` | warning | `crates/core/src/checks/rules.rs` (gray-on-color) |
| `hard-offset-shadow` | advisory | `crates/core/src/checks/hard_offset_shadow.rs` |
| `bounce-easing` | advisory | `crates/detect/src/regex_matchers.rs` (bounce-easing) |
| `repeating-stripes-gradient` | advisory | `crates/core/src/checks/html_patterns.rs` |
| `codex-grid-background` | advisory | `crates/core/src/checks/css_scan.rs` |
| `marquee` | advisory | `crates/core/src/checks/html_patterns.rs` (marquee) |
| `monotonous-spacing` | warning | `crates/core/src/checks/html_patterns.rs` |
| `em-dash-overuse` | advisory | `crates/detect/src/regex_matchers.rs` (em-dash-overuse) |
| `marketing-buzzword` | warning | `crates/detect/src/regex_matchers.rs` (marketing-buzzword)，中文词表为本项目补充 |
| `aphoristic-cadence` | advisory | `crates/detect/src/regex_matchers.rs` (aphoristic-cadence) |
| `radial-halo` | advisory | `crates/core/src/checks/css_scan.rs` (radial halo) |
| `emoji-icon` | warning | 本项目规则（AGENTS.md：禁止 emoji 图标） |

### 渲染级规则（`src/audit/quality.ts`，需要浏览器）

| 规则 id | 严重度 | 判据来源 |
|---|---|---|
| `tiny-text` | warning | `crates/browser/quality.rs` / `crates/html/src/quality.rs`（<12px 正文） |
| `undersized-ui-text` | warning | `crates/browser/quality.rs`（功能性文字 <11px 地板） |
| `all-caps-body` | warning | `crates/browser/quality.rs`（≥80 字符大写） |
| `wide-tracking` | warning | `crates/browser/quality.rs`（letter-spacing / font-size > 0.05） |
| `tight-leading` | warning | `crates/foundation/src/rules/text.rs`（line-height 比 < 1.3） |
| `line-length` | warning | `crates/browser/quality.rs`（>80 字符折算） |
| `flat-type-hierarchy` | warning / advisory | `crates/core/src/checks/rules.rs`（相邻角色步进 < 1.25） |
| `heading-rhythm` | warning | `crates/browser/page_checks.rs`（上方间距应大于下方） |

差异：本项目的渲染级实现用 `Range.getClientRects()` 聚合行矩形后**估算**每行字符数
（拉丁 0.5em / CJK 1em），因此 `line-length` 阈值留了 +5 余量并对 CJK 直接不判；
字号层级只在「正文与标题各有一个明确主导字号」时判定，并列时弃权并写入 skipped。

## 与原实现的差异

- **不移植**需要真实渲染几何 / DOM 邻接的规则（字号层级、行宽、行高、标题节奏、
  卡片嵌套、kicker/eyebrow 位置等）。它们需要浏览器量测，留待后续阶段的渲染级通道。
- **不移植**已被现有规则覆盖的项：`design-system-{font,color,radius,font-size}`（本项目
  `font` / `color` / `spacing` / `radius` / `token` 规则已覆盖）、`broken-image`（`resource` +
  视觉审计已覆盖）、`low-contrast`（`audit/a11y.ts` 用真实计算对比度）。
- **中文适配**：`em-dash-overuse` 只在拉丁主导页面生效（中文「——」是合法标点）；
  `marketing-buzzword` 增加中文词表；`isNeutralGray` 放宽到 HSL ≤12%、通道极差 ≤30 以覆盖
  Tailwind 的 slate/zinc 灰系。
- **品牌豁免**：`overused-font` 在当前风格的 manifest 声明该字体时不报；`cream-palette`
  在当前风格的 `color.bg.canvas` 本身就是奶油色时不报；`ai-color-palette` 在品牌主色落在
  tell 色带时不报。

## 规则工程纪律

每条规则必须同时具备：

- `test/fixtures/rules/<rule-id>/` 下 **4 个 flag + 5 个 pass** fixture（假阳性守卫的证据）；
- `test/rules.fixtures.test.mjs` 回放（命中/不命中/确定性）；
- 注册表里的 `origin` 字段指向判据来源，便于日后按实测精度决定升级、降级或下线。

参考先例：impeccable 曾把 `clipped-overflow-container` 从 warning 降为 advisory，
理由是实拍复核后命中精度 0.08、伤害率 0.04（裁切几乎总是有意为之）。本项目的
`hard-offset-shadow`、`bounce-easing`、`cream-palette` 等判断型规则同样默认 advisory。

---

## 阶段 2 · 评审体系（UX rubric）的溯源

| 天枢落地 | 复刻来源 | 移植方式 |
|---|---|---|
| `design-systems/rubrics/ux-review.json` 的 10 条启发式 0–4 分判据 | `skill/reference/critique-rubric.md`（Heuristics Scoring Guide，每条 5 档原文判据） | 中文重写；保留分档语义与「4 分=真正优秀」的校准 |
| `benchmark` 与档位百分比判法 | `skill/reference/critique.md`（"多数真实界面 20–32/40"、n/a 时分母重算、按百分比读档） | 保留判据；把 `/40` 硬编码换成由实际计分项推导 |
| `interpretive: [7, 10]` | `critique.md` 的 mode applicability（第 7、10 条在 persuade/experience 可 n/a） | 保留条数与理由要求 |
| `cognitiveLoad.items` 8 项与工作记忆法则 | `critique-rubric.md` Cognitive Load Checklist（≤4 项/组、≤4 个可见选项） | 保留全部阈值与「失败表现」措辞的语义 |
| `personas` 5 个与 `personaMap` 6 行 | `critique-rubric.md` Persona-Based Design Testing | 保留红旗清单与界面映射；人物名改中文 |
| `severity` P0–P3 与 `severityTip` | `critique.md` Issue Severity | 保留判据与"是否会联系客服"的提问法 |
| `craftFloor` 9 项 | `skill/reference/craft-floor.md` Verify 列表 | 保留全部数值阈值（4.5:1、65–75ch、6rem、-0.04em 等） |
| `refuse.hardBans` / `refuse.defaults` | `craft-floor.md` Refuse 列表 | **保留「硬禁令只有 eyebrow 一条、其余可被简报换回」的分类**；这是该文件最容易抄错的地方 |
| `specificityQuestions` 3 问 | `critique.md` Assessment A 第一项 + `new-work.md` | 中文重写，语义等价 |
| 三段式门禁（A → B → synthesize） | `critique.md` Hard Invariants（A/B 必须隔离、A 先完成、降级必须声明） | **近似而非等价**：插件工具无法 spawn 子代理，隔离只能靠调用协议 + 物理剥离检测结论实现；`ux.json` 的 limitations 明确写了这一限制 |

## 阶段 3 · 交互与动效的溯源

| 天枢落地 | 复刻来源 | 移植方式 |
|---|---|---|
| `interactions.json` 的 23 条 `a11y` 契约 | `skill/reference/audit.md` + `operate.md` 的逐交互清单 | 结构化字段为原创；具体属性/键位判据来自两文件 |
| 焦点陷阱 + 背景 `inert` + 焦点归还 | `audit.md`（Missing ARIA / Keyboard navigation） | 自写实现 |
| 外部点击关闭、`aria-activedescendant` | `operate.md`（浮层必须逃出容器、modal 通常是偷懒） | 自写实现 |
| `aria-invalid` + `aria-describedby` + `role=alert` | `clarify.md`（错误三要素、校验不指责用户） | 自写实现 |
| `bindPointerDrag` 的中断语义 | `harden.md` Interrupted gestures（第二指针、pointercancel、lostpointercapture、控件外释放、blur） | **逐条照搬判据**；实现为自写的单一歧管工具 |
| `interactions.css` 的 reduced-motion 统一为 `0.01ms` | `animate.md`（减少空间位移、保留有意义的状态反馈）+ `audit.md`（全局 `0.01ms` 一刀切属于缺陷的例外说明） | 采用「缩短而非删除」策略，与 `components.css` 保持一致 |
| `canvas_audit action=motion` 的 5 个指标 | `animate.md` 的验证要求 + `crates/browser/src/motion.rs` 的指标命名 | 判据重写为**相对比例**（帧间比），不用绝对时间；阈值见 `MOTION_THRESHOLDS` |
| SKILL.md 动效三条反直觉规则 | `animate.md`（hover 不能移动自身 / 时长按距离与后果 / 材质按含义选） | 中文重写 + 补 operate 专属约束 |
| Delight 克制条款 | `skill/reference/delight.md` Protect the experience | 逐条中文化 |

**不移植的部分（诚实记录）**：impeccable 的 `motion-capture --steps` 多步/键盘序列、`Page.startScreencast` 录屏、
多帧并行采集、以及需要真实多代理编排的 critique 全流程。天枢的 motion 只支持单选择器单次点击，
UX 隔离只保证时序不保证诚实——两点都已写进对应验收文档的「未测项」。

## 阶段 4 · 鲁棒性的溯源

| 天枢落地 | 复刻来源 | 移植方式 |
|---|---|---|
| `.ts-shrink` / `.ts-clamp-1..3` / `.ts-wrap-anywhere` | `harden.md` Text Overflow & Wrapping（L37–83） | 判据照搬（min-width:0、三种换行配方）；类名与中文说明为原创 |
| 移动端输入框 16px 地板 | `harden.md` L81（iOS Safari 强制缩放 <16px 输入框）、`typeset.md` L46 | 阈值照搬；用 `max(16px, var(--ts-fs-md))` 实现，不改 token |
| `rtl-physical-direction` | `audit.md` L56–61（RTL signals，只在 `dir="rtl"` 页面 flag；`left:50%` 居中豁免） | 判据照搬；实现为本项目的源码级规则 |
| `fixed-text-width` | `harden.md` L88–95（避免文本容器固定宽度、预留 30–40%） | 阈值照搬（30–40%）；选择器白名单为原创 |
| `plural-concat` | `harden.md` L149–156（复数拼接反例） | 判据照搬；检测形态为本项目自写 |
| `western-digits-rtl` | `harden.md` L113–128（东阿拉伯数字、Jalali/Hijri 历）、L114（波斯/阿拉伯同形字母） | 语系清单与日历照搬；数字判定为本项目自写 |
| `skills/reference/i18n-hardening.md` | `harden.md` i18n 段 | 中文重写；ZWNJ 与「lang 不表示方向」两条来自 `audit.md` L56–61 |
| `canvas_audit action=states` 的五条规则 | `harden.md` Edge Cases（L199–242）、`onboard.md` L187–192（空状态五型）、`clarify.md` L47–59 | **判据照搬**（1000+ 行、空/加载/并发/权限）；静态可证的五条自写实现，权限与并发写入 skipped |
| a11y 24px 间距豁免 + 移动 44px 轮次 | `audit.md` L50（WCAG 2.5.8 的五类例外与 24px 圆算法）、`adapt.md` L46/L148（44×44 设计地板） | 算法逐字照搬；44px 作为移动轮次的设计底线，不套用 24px 例外 |
| 三维 SKILL 小节（溢出 / i18n / 状态） | `harden.md` 对应段落 | 中文重写 |

**不移植的部分（诚实记录）**：impeccable 没有 i18n/RTL 的代码级检测（只有人工清单）；本项目的四条规则是
按它的判据新写的实现。`harden.md` 未给出 truncate/clamp/overflow-wrap 的「选择条件」，本项目按用途补齐
（单行摘要 / 多行摘要 / 无空格长串）。权限三态与并发竞态无法从静态渲染判定，`states` 审计只写 skipped。

## 阶段 5 · 视觉方向与反收敛的溯源

| 天枢落地 | 复刻来源 | 移植方式 |
|---|---|---|
| `skills/reference/world-derivation.md` 的步骤 1–2 | `new-work-world.md` L7–L8（点名窠臼、七个视觉系统、跨三材质族、两个强制问题） | 判据逐条照搬；中文表述与检查清单为原创 |
| operate 方向的四条借取约束与自检 | `mode-operate.md` L3–L21（世界只借 type/palette/density/一个签名动作；只以配色呈现=还没找到动作） | 判据照搬；示例与文案原创 |
| read 方向的「框/栏」分工与 60–75ch | `mode-read.md` L7–L21 | 判据照搬（行宽与 16px 阈值来自原文） |
| 「作品领跑、界面后退」 | SKILL.md 既有 experience 表述 + `mode-persuade` 的相邻约束 | 沿用并补充展签事实化要求 |
| 骨架测试 | `bolder.md` L22–24 | 判据与两个追问照搬；中文重写 |
| `operate-instrument` / `read-reference` / `experience-gallery` 三个方向 | 无直接对应文件（impeccable 的方向由远端 catalog 提供，仓库内无 directions 目录） | **完全原创**：按上述模式判据自写构图指导、误用清单与 6 份示例 |
| `suitableModes` 字段 | `catalog.rs` 的 `review.allowedModes` 语义（模式→候选筛选） | 只保留「适用模式」的指导语义，不做随机筛选 |

**不移植的部分（诚实记录）**：impeccable 的 `concept-seed` 随机掷骰、challenger 三态裁决（wins/competitive/declined）、
donation 只借 discipline 的规则、远端 world catalog —— 这些依赖在线服务与多轮代理编排，天枢以流程文档与自检问题近似，
不追求等价。方向与模式的对应关系只作指导，不阻断选择。

## 阶段 6 · 治理与回归的溯源

| 天枢落地 | 复刻来源 | 移植方式 |
|---|---|---|
| `RuleDef.tier` 的 immediate / deferred 两档 | `skill/reference/hooks.md:7`（per-edit 只出 immediate 层，其余推迟到 Stop 深度扫描一次性报告） | 判据照搬；两档都不阻塞写入（天枢没有 hook，用写入后一行提示近似） |
| immediate 名单（资源被拦截、设计系统漂移、渐变文字、侧色条、圆角强调边框、彩色底灰字、emoji 图标） | `crates/foundation/src/registry.rs:655-682` 的 `IMMEDIATE_TIER_RULES`（broken output / objective legibility / single-property mechanical slop / design-system drift 四个桶） | 按四个桶逐条映射到本项目同名规则；未实现 impeccable 的「同一签名拦截 6 次后放行」机制 |
| `test/golden/check-style/` 的逐字节基线 | `tests/oracle/README.md:1-35`（"Byte-equal is the bar"；新增用例要人工复核 golden）+ `AGENTS.md:52`（"never overwrite goldens just to make a regression pass"） | 机制照搬（golden + README + 禁令）；范围只覆盖 `canvas_check_style`，不做渲染级报告 |
| 输入指纹（`input-sha256`） | `tests/oracle/run.mjs` 的输入归一化 + `vectors/README.md` 的「冻结后不可再生成」 | 自写实现：只校验输入未被悄悄替换，不做路径/时间戳归一化（check_style 报告本身无这两类因素） |
| 漂移快照的 `usedStates` | `skill/reference/operate.md:32`（组件态全集）+ `craft-floor.md:14`（状态清单）+ 本项目 `validateStateContract` 的判定口径 | 口径复用构建期常量（`STATE_MARKERS`），只统计「设计系统侧真实有选择器」的状态 |
| 漂移快照的 `browserSurfaces` | `skill/reference/craft-floor.md:15`（Browser surfaces：选中、光标、滚动条、焦点环、下划线偏移、表格数字） | 七项清单照搬；实现为本项目的 CSS 文本探测 |
| 漂移报告的严重度顺序（越界 > 未使用 > 移除 > 新增） | `docs/CLI-CONTRACT.md` 的 severity 排序与 `doctor.md` 的 `auto/mention/route` 三档思路 | 只借「按严重度排序」的原则；三档语义不移植（天枢的漂移不自动修复） |
| `DESIGN.md` 的八节与 frontmatter 五组 | `skill/reference/document.md:3,45-62,412-418`（Google design.md spec：机器层/语境层、token 引用、组件八属性、语义键名、八节固定标题、缺数据省略、不静默覆盖） | 判据逐条照搬；标题英文原样、正文中文重写；不移植 sidecar `.impeccable/design.json` |
| 命名规则（`**The [Name] Rule.**`） | `document.md:402`（"memorable, citable, and much stickier for AI consumers"；每节 1–3 条） | 格式照搬；规则名与教义全部原创 |

| `scripts/rule-precision.mjs` 的三段实测（干净语料 / 召回 / 阴性误报） | `tests/oracle/README.md` 的 oracle 机制 + `DELTAS.md` 的 precision/harm 记录方式 | **只借方法论**：本项目无外部语料，用自建 44 份页面 + 176 份 fixture 近似；结论明确标注不可外推 |
| `test/golden/render/` 的 a11y / states 报告基线 | 同 oracle（"Byte-equal is the bar"） | 归一化页面 id/标题后逐字节；无浏览器时 skip，由 CI 的 Require-a-browser 步骤兜底 |
| `parseDesignDoc` / `validateDesignDoc` 的 round-trip 自检 | `document.md` 的结构判据 + `CLI-CONTRACT.md:799` 的 canonical H2 名 | 自写解析器；**不等于 Stitch 官方校验器**，文档已标注 |
| 漂移快照的 `pageStates` | `craft-floor.md:14` / `operate.md:32` 的状态全集 | 页面实际写出的状态属性探测；与设计系统侧的 `usedStates` 互补 |

**不移植的部分（诚实记录）**：impeccable 的 oracle 语料（1466 份 golden 依赖其 CLI 二进制与远端 catalog）、
`DELTAS.md` 的实测命中精度/伤害率记录（本项目没有真实站点语料，只把取舍理由写进 registry 注释）、
`hook-before-edit` 的写前拦截与「6 次后放行」、`concept-seed` 随机掷骰、doctor 的 `auto` 自动修复。
这些要么依赖在线服务，要么需要多轮实测语料，天枢以「档位 + golden + 文档」近似，不追求等价。
