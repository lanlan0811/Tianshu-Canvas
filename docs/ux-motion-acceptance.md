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
| ARIA 契约 | `interactions.json` 23 条各带 `a11y`（roles / attrs / keys / focusReturn / live / gesture） | `test/design.interact.a11y.test.mjs`（17 项，含 6 个负例） |
| 契约校验 | `validateInteractionA11y()`：声明必须真在运行时或骨架里出现；`focusReturn` 必须有 `focus()`；`gesture: cancellable` 必须处理 `pointercancel` 与 `lostpointercapture` | 同上 |
| 焦点陷阱 | modal / drawer 引入 overlay 栈 + `trapFocus` + 背景 `inert` + 关闭后焦点归还到 opener | `test/interaction.e2e.test.mjs` 回归通过 |
| 外部点击 | dropdown 与所有浮层；触发按钮自身不重复处理 | 静态断言覆盖调用次数 |
| 表单 | `aria-invalid` + `aria-describedby` + 错误容器 `role=alert`；保留 `data-ts-invalid` 作为样式钩子 | 同上 |
| tooltip | 触发元素接 `aria-describedby`，气泡 `role=tooltip` | 契约校验 |
| date-picker | 网格 ←→↑↓ / Home / End / PageUp / PageDown；今天 `aria-current="date"`；选中 `aria-pressed`；输入框 `aria-haspopup` + `aria-controls` | 契约校验 |
| sortable-table | `th` 可聚焦 + Enter/Space + 重排后 `aria-live` 播报 | 契约校验 |
| scroll-progress | **修复真实违规**：`role=button tabindex=0` 上切 `aria-hidden` 会留下不可聚焦陷阱；改为隐藏时同时 `tabindex=-1` | 静态断言 |
| 其他 | toast 区域 `role=status` + hover/focus 暂停 + Esc；copy 成功写共享 `aria-live`；stepper 去掉 `aria-current="false"`；segmented 补 Home/End | 契约校验 |
| 手势中断 | `bindPointerDrag` 工具 + tilt-card 接入：第二指针不夺取、`pointercancel` / `lostpointercapture` / 离场 / 失焦全部复位、取消后再拖仍生效 | `test/gesture-interrupt.e2e.test.mjs`（2 项，合成 PointerEvent） |
| reduced-motion | `interactions.css` 三处 `none` 全改为 `0.01ms`，并补齐 tooltip / 移动菜单 / 目录 / 复制 / tilt 五处 | `validateReducedMotionPolicy()` + 测试 |
| 动效抓帧 | `canvas_audit action=motion`：帧序列 + filmstrip + 拖帧查看器 + report.json；5 个相对指标（start-jump / end-jump / mid-step / clipped-midway / reduced-motion-ignored） | `test/motion.analyze.test.mjs`（14 项）、`test/audit.motion.e2e.test.mjs`（3 项） |
| 文档 | SKILL.md 动效三条反直觉规则 + delight 克制条款 + 验证方法 | 人工复核 |

## 验收（对应项目规则）

1. **复现**：量表先写 JSON 再写校验；ARIA 契约先写 23 条字段与 6 个负例再改运行时。过程中修掉 3 个真实缺陷：scroll-progress 的 aria-hidden 焦点陷阱、form-validation 缺 `aria-invalid`、date-picker 只能 Tab 逐格。
2. **回归**：`npm run verify` 659 项通过；`test/audit.contract.test.mjs` 契约分数不变（detector 仍显式关闭）；23 个交互的既有 e2e（`interaction.e2e` / `aesthetic.bindings` / `aesthetic.capabilities` / `prototypes`）全绿。
3. **复发**：`analyzeMotion` 与 `uxSynthesize` 在相同输入下两次结果完全一致（确定性断言）。
4. **验证**：真实跑通 `canvas_open` → `canvas_upsert_page(surface_mode=operate)` → `ux phase=a` → 回填 → `phase=b` → `synthesize`（27/36 · 良好 · 不写 /40）；`motion` 产出 5 帧 + filmstrip + 查看器 + normal/reduced 两套报告。
5. **核实**：`npm run check:plugin` 逐字节比对通过（112 个文件，4627 KiB）。
6. **归族**：`docs/rule-sources.md` 已记录阶段 2/3 的溯源。
7. **时间维 / 基线**：`interactions.css` 的动效改动会改变渲染，**视觉基线需重跑 `canvas_audit action=baseline`**。
8. **假绿**：见下节未测项。

## 未测项（不得当成通过）

- **A/B 隔离只保证调用时序，不保证代理诚实**：门禁能强制「先写 A 再跑 B」，但无法证明代理没在私下先跑 lint。报告首行强制声明方法学。
- **评分来自代理判断**：工具只做算术与结构校验，`ux.json` 落盘的 limitations 明确写了「不能替代项目所有者」。
- **手势测试是合成 PointerEvent**：验证的是我们自己的处理器逻辑，**不是**浏览器的原生手势仲裁（`touch-action`、滚动接管、指针捕获的内核行为）。真机与多浏览器差异未测。
- **`prefers-reduced-motion` 只在 Chromium 上模拟**：Safari / Firefox 的差异未测。
- **motion 采样帧数固定**：只证明这些帧上的变化，不证明动画平滑；`elapsedMs` 是实测值不是标称时长；只测了一个选择器的一次点击，键盘序列与多步交互未覆盖。
- **无 Chrome 的 CI 环境**：`ux phase=b`、`motion`、`a11y`、`quality` 都会跳过并说明原因，不会假通过。

## 已知取舍

- **`::selection` 用 `action.ghost-hover`**：在 11 套内置风格里都是品牌浅色调；自定义风格若该值过深需人工复核选中文字的对比度。
- **tooltip 的 `aria-describedby` 指向运行时生成的 id**：若页面自己已经写了 `aria-describedby`，运行时会追加而不是覆盖（追加逻辑在 `initTooltips` 之外，未改动）。
- **date-picker 的网格导航按 Date 计算**：跨月时自动翻页；跨年同样成立，但没有为「闰年 2 月 29 日」单独写用例（由 `Date` 语义保证）。
- **tilt-card 同时监听 `pointermove` 与 `mousemove`**：前者是主路径，后者兼容只派发 MouseEvent 的环境与自动化测试；两者都受同一组取消守卫保护。
