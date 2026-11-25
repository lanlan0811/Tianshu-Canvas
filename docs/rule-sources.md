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
