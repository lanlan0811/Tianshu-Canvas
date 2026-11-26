# 评审体系与交互动效：阶段 2 + 阶段 3 验收记录

日期：2026-11-26 · 版本：0.9.6（未发版，功能入库）
复刻来源：`D:\Trae项目\impeccable`（Apache-2.0，Paul Bakaus）。只移植判据与阈值；中文文案、JSON 结构、实现代码为原创。

## 交付内容

### 阶段 2 · 评审体系

| 项 | 落地 | 验证 |
|---|---|---|
| 评审量表 | `design-systems/rubrics/ux-review.json` → 构建到 `dist/design/rubrics/`；10 条启发式各 5 个分数档、8 项认知负荷、5 个 persona、6 行界面映射、P0–P3、审美下限 9 项、硬禁令与默认值分离 | `test/design.rubric.test.mjs`（14 项，含 10 个负例） |
| 量表校验 | `validateRubric()` 构建期门禁：缺分数档 / persona 红旗 / 映射引用 / 档位顺序 / 硬禁令清空都失败 | 同上 |
| 三段式门禁 | `phase=a` 首调出截图 + 中性事实 + 模板（**物理剥离** review 的 issues）→ 回填 `a_assessment` → `phase=b`（无 `a.json` 直接拒绝）→ `phase=synthesize` | `test/audit.ux.test.mjs`（16 项纯逻辑）、`test/audit.ux.e2e.test.mjs`（4 项） |
| 算分 | n/a 重算分母（9 项 → /36）、百分比判档、n/a 过多时警告"代表性不足" | 纯逻辑测试覆盖 90/70/50/30 边界 |
| 人读量表 | `skills/reference/ux-rubric.md` + `skills/SKILL.md` 三段式流程与隔离规则 | 人工复核 |

### 阶段 3 · 交互与动效

| 项 | 落地 | 验证 |
|---|---|---|
| ARIA 契约 | `interactions.json` 23 条各带 `a11y`（roles / attrs / keys / focusReturn / live / gesture） | `test/design.interact.a11y.test.mjs`（18 项，含 7 个负例） |
| 契约校验 | `validateInteractionA11y()`：先剥注释，再按**值级**匹配（`role="x"` / `setAttribute('role','x')` / `attr=`）；类名不能冒充实现；`focusReturn` 必须有 `focus()`；`gesture: cancellable` 必须处理 `pointercancel` 与 `lostpointercapture` | 同上（含「类名不能冒充 role」负例） |
| 焦点陷阱 | modal / drawer / 窄屏 mobile-nav / 窄屏 toc 共用 `trapFocus` + 背景 `inert` + 关闭后焦点归还；inert 按所有者记账，可多个浮层并存 | `test/interaction-aria.e2e.test.mjs` 读真实 DOM |
| 外部点击 | dropdown 与所有浮层；触发按钮自身不重复处理；触发按钮只绑一次（modal/drawer 各初始化一遍） | 静态断言 + 打开态 e2e |
| 表单 | `aria-invalid` + `aria-describedby` + 错误容器 `role=alert`；保留 `data-ts-invalid` 作为样式钩子 | `test/interaction-aria.e2e.test.mjs` |
| tooltip | **运行时真实实现**：生成 `role="tooltip"` 气泡、触发元素 `aria-describedby` 指向它、纯图标触发器补 `tabindex=0`；CSS `::after` 降级关闭 | `test/interaction-aria.e2e.test.mjs`（默认态 + 聚焦可见） |
| date-picker | 网格 ←→↑↓ / Home / End / PageUp / PageDown；**roving tabindex**（网格里只有一个 Tab 停靠点）；今天 `aria-current="date"`；选中 `aria-pressed`；输入框 `aria-haspopup` + `aria-controls` | `test/interaction-aria.e2e.test.mjs` |
| sortable-table | `th` 可聚焦 + Enter/Space + 重排后 `aria-live` 播报 | `test/interaction-aria.e2e.test.mjs` |
| scroll-progress | **修复真实违规**：`role=button tabindex=0` 上切 `aria-hidden` 会留下不可聚焦陷阱；改为隐藏时同时 `tabindex=-1` | 静态断言 + e2e 读初始态 |
| 其他 | toast 区域 `role=status`；**danger/error 变体 `role=alert` + `assertive`**（静态与 `window.tsToast` 两条路径）；Esc 关闭（与是否自动消失无关）；hover/focus 暂停；copy 成功写共享 `aria-live`；stepper 去掉 `aria-current="false"`；segmented 补 Home/End | `test/interaction-aria.e2e.test.mjs` |
| 手势中断 | `bindPointerDrag`（follow 模式供 tilt 悬停跟随）+ tilt-card 迁移：第二指针不夺取、`pointercancel` / `lostpointercapture` / 离场 / 失焦全部复位、取消后再拖仍生效；`.ts-i-tilt--armed` 带 `touch-action: none` | `test/gesture-interrupt.e2e.test.mjs`（2 项，合成 PointerEvent） |
| reduced-motion | `interactions.css` 三处 `none` 全改为 `0.01ms`，并补齐 tooltip / 移动菜单 / 目录 / 复制 / tilt 五处 | `validateReducedMotionPolicy()` + 测试 |
| 动效抓帧 | `canvas_audit action=motion`：帧序列 + filmstrip + 拖帧查看器 + report.json；5 个相对指标（start-jump / end-jump / mid-step / clipped-midway / reduced-motion-ignored） | `test/motion.analyze.test.mjs`（14 项）、`test/audit.motion.e2e.test.mjs`（3 项） |
| PNG 编码 | `encodeImage`：任意像素往返、RGB/灰度/灰度+alpha 补成 RGBA | `test/audit.png.test.mjs`（9 项） |
| 文档 | SKILL.md 动效三条反直觉规则 + delight 克制条款 + 验证方法 | 人工复核 |

## 验收（对应项目规则）

1. **复现**：量表先写 JSON 再写校验；ARIA 契约先写 23 条字段与负例再改运行时。过程中修掉 6 个真实缺陷：scroll-progress 的 aria-hidden 焦点陷阱、form-validation 缺 `aria-invalid`、date-picker 只能 Tab 逐格、**tooltip 的契约靠类名假绿（运行时根本不存在）**、**触发按钮被 modal/drawer 各绑一次导致一次点击开两层（关闭后背景 inert 撤不掉、焦点无法归还）**、**不自动消失的 toast 无法用 Esc 关闭**。
2. **回归**：`npm test` 全量 667 项通过（666 pass / 0 fail / 1 skip=Windows 专属沙箱用例，浏览器 e2e 均真跑）；`test/audit.contract.test.mjs` 契约分数不变（detector 仍显式关闭）；23 个交互的既有 e2e（`interaction.e2e` / `aesthetic.bindings` / `aesthetic.capabilities` / `prototypes`）全绿。
3. **复发**：`analyzeMotion` 与 `uxSynthesize` 在相同输入下两次结果完全一致（确定性断言）。
4. **验证**：真实跑通 `canvas_open` → `canvas_upsert_page(surface_mode=operate)` → `ux phase=a` → 回填 → `phase=b` → `synthesize`（27/36 · 良好 · 不写 /40）；`motion` 产出 5 帧 + filmstrip + 查看器 + normal/reduced 两套报告；`interaction-aria.e2e` 在真实 iframe 里逐个读默认态/打开态的 ARIA。
5. **核实**：`npm run check:plugin` 逐字节比对通过（112 个文件，4634.6 KiB）。
6. **归族**：`docs/rule-sources.md` 已记录阶段 2/3 的溯源。
7. **时间维 / 基线**：`interactions.css` 的动效改动会改变渲染，**视觉基线需重跑 `canvas_audit action=baseline`**。
8. **假绿**：见下节未测项。

## 未测项（不得当成通过）

- **A/B 隔离只保证调用时序，不保证代理诚实**：门禁能强制「先写 A 再跑 B」，但无法证明代理没在私下先跑 lint。报告首行强制声明方法学。
- **评分来自代理判断**：工具只做算术与结构校验，`ux.json` 落盘的 limitations 明确写了「不能替代项目所有者」。
- **手势测试是合成 PointerEvent**：验证的是我们自己的处理器逻辑，**不是**浏览器的原生手势仲裁（`touch-action`、滚动接管、指针捕获的内核行为）。真机与多浏览器差异未测。
- **`prefers-reduced-motion` 只在 Chromium 上模拟**：Safari / Firefox 的差异未测。
- **motion 采样帧数固定**：只证明这些帧上的变化，不证明动画平滑；`elapsedMs` 是实测值不是标称时长；只测了一个选择器的一次点击，键盘序列与多步交互未覆盖。
- **ARIA e2e 断言的是 DOM 语义，不是读屏播报**：`interaction-aria.e2e` 读真实 iframe 里的 role/属性/焦点位置，但 NVDA / VoiceOver 的实际播报顺序、`aria-activedescendant` 的读屏行为未测。
- **无 Chrome 的 CI 环境**：`ux phase=b`、`motion`、`a11y`、`quality` 都会跳过并说明原因，不会假通过。

## 已知取舍

- **`::selection` 用 `action.ghost-hover`**：在 11 套内置风格里都是品牌浅色调；自定义风格若该值过深需人工复核选中文字的对比度。
- **tooltip 是渐进增强**：有脚本时用真实 `role="tooltip"` 元素 + `aria-describedby`；无脚本时只剩 CSS `::after`（视觉可见、读屏不可见），`requiresScript` 已标为 `true`。页面自己已写的 `aria-describedby` 会被追加而不是覆盖。
- **date-picker 的网格导航按 Date 计算**：跨月时自动翻页；跨年同样成立，但没有为「闰年 2 月 29 日」单独写用例（由 `Date` 语义保证）。
- **tilt-card 同时监听 `pointermove` 与 `mousemove`**：前者经 `bindPointerDrag(follow)` 统一处理中断，后者只兼容仅派发 MouseEvent 的环境与自动化测试。
- **mobile-nav / toc 的焦点陷阱与 inert 是无条件挂的**：宽屏下 toc 是常驻侧栏、mobile-nav 的 toggle 是 `display:none`，都打不开，因此不会误触；窄屏打开才真正生效。
