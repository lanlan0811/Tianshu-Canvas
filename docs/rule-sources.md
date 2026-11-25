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
