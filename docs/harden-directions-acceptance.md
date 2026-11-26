# 阶段 4（鲁棒性）+ 阶段 5（视觉方向与反收敛）验收记录

日期：2026-11-26 · 版本：0.9.6（未发版，功能入库）
复刻来源：`D:\Trae项目\impeccable`（Apache-2.0，Paul Bakaus，提交 `b49177d`）。规范源以 `skill/reference/` 为准。
只移植判据、阈值与流程约束；中文文案、JSON 结构、实现代码与 6 份示例全部原创。

## 交付内容

### 阶段 4 · 鲁棒性

| 项 | 落地 | 验证 |
|---|---|---|
| 布局韧性工具类 | `components.css` 新增 `.ts-shrink`（min-width/min-height:0）、`.ts-clamp-1/2/3`、`.ts-wrap-anywhere`；5 个类登记进 `sharedClasses` | `test/design.states.test.mjs`（4 项 + 1 负例） |
| 移动端输入地板 | `@media (max-width: 768px)` 下 `.ts-input/.ts-select/textarea` 用 `max(16px, var(--ts-fs-md))`；token 不动 | 同上；原因（iOS Safari 强制缩放）写进 SKILL.md |
| i18n 四条源码规则 | `src/rules/i18n.ts`：`rtl-physical-direction`（只对 `dir="rtl"`，`left:50%+translateX` 豁免）、`fixed-text-width`、`plural-concat`、`western-digits-rtl`；注册进 registry + engine 的 CHECKS | 每条 **4 flag + 5 pass**，共 36 个新 fixture；`rules.fixtures` 242 项全绿 |
| i18n 参考文档 | `skills/reference/i18n-hardening.md`：德语 30%/预留 30–40%、ZWNJ 必须保留、波斯/阿拉伯同形字母、东阿拉伯数字与 Jalali/Hijri 历、lang 不表示方向 | 人工复核；随 `skills/` 自动打包 |
| 状态完整性审计 | 新 `canvas_audit action=states`（`src/audit/states.ts`）：空态无提示、空态无动作、加载未播报、大数据集未分页、表单防重复提交；权限三态与并发竞态写进 skipped | `test/states.audit.test.mjs`（16 项）、`test/audit.states.e2e.test.mjs`（4 项） |
| a11y 间距豁免 | `analyze()` 实现 WCAG 2.5.8 的 24px 圆算法（不与任何其他目标包围盒相交、不与其他欠尺寸目标的圆相交）；行内文字链接豁免 | `test/audit.a11y.test.mjs`（原生 16px 孤立目标通过、4px 间距命中、10px 间距通过） |
| a11y 移动轮次 | `A11yOptions` 加 `viewport`/`only`/`spacingExemption`/`viewportLabel`；`action=a11y` 跑 1440 全量 + 375×812 的 44px 设计地板 | `test/audit.a11y.e2e.test.mjs`（36px 按钮移动命中、桌面不报；间距充足的小目标桌面不报） |
| SKILL.md | 新增「溢出与布局韧性」「多语言（i18n）」两节；审计节补 states 与两轮视口 | 人工复核 |

### 阶段 5 · 视觉方向与反收敛

| 项 | 落地 | 验证 |
|---|---|---|
| 世界推导流程 | `skills/reference/world-derivation.md`：点名窠臼（标配页 + 反面剔除）、7 个具体视觉系统、跨 3 个材质族、两个强制问题、operate/read/experience 各自的借与不借、骨架测试、反收敛自检 6 问 | 人工复核 |
| SKILL 流程升级 | 第 4 步改为「先推导世界，再出双首屏」；operate/read/experience 按模式约束直接深化；特异性自检旁加骨架测试与两个强制问题 | 人工复核 |
| 三个新方向 | `directions/index.json` 加 `operate-instrument` / `read-reference` / `experience-gallery`，每条带 `suitableModes` 与 7 个文本字段 | `test/prototypes.test.mjs`（id 顺序 + suitableModes 合法性） |
| 6 份原创示例 | 每个方向 zh-CN + en 两份（body.html + layout.css + meta.json），共 6 个目录 | `npm run verify:prototypes` 44/44 客观检查通过（1440/768/390 三档截图） |
| 硬编码点同步 | `build-prototypes.mjs` 的 DIRECTIONS、`brief.ts` 的 DIRECTION_IDS、`tools.ts` 三处 enum、5 个测试/脚本的计数 | 全绿 |

## 验收（对应项目规则）

1. **复现**：先写规则判据与 fixtures（4 flag 必须真命中、5 pass 必须真不命中）再写实现；先写间距豁免的失败用例（孤立 16px 目标被旧实现误报）再改 `analyze`；先写状态规则单测的假证据再写 `states.ts`。过程中修掉 4 个真实缺陷：
   - 间距豁免阈值算错（16px 目标间隙 10px 时两圆仍相交，应为 ≤8px 才相交）；
   - 状态审计的「防重复提交」用页面级 `aria-busy` 判定，导致骨架屏替表单背了书（改为限表单内）；
   - `western-digits-rtl` 把 `<style>` 与 `<script>` 里的数字算成正文（改为只扫正文）；
   - 画布服务在自动分配端口时会落到 Chrome 的屏蔽端口（实测 2049），浏览器直接 `ERR_UNSAFE_PORT`、画布打不开；
     现按 Chrome 的 restricted ports 表跳过并重试（`src/server.ts` 的 `isSafePort`），server 测试改为以首选端口 2049 启动来真实验证。
2. **回归**：全量 `npm test` 绿；`verify:prototypes` 44/44；`verify:codegen` 6 项；`check:plugin` 逐字节通过（123 个文件，4813.3 KiB）。
3. **复发**：`analyzeStates` 与 `analyze` 同输入两次结果一致（单测断言）；i18n 规则 fixtures 自带「连续两次一致」。
4. **验证**：真实跑 `canvas_audit action=states`（空/加载/表单/分页四类页面）、`action=a11y`（两轮视口）、`canvas_check_style`（4 条新规则各真阳真阴）、`canvas_style action=direction`（6 个方向与 6 份示例 HTML）。
5. **核实**：`check:plugin` 与 `notices:check` 通过；`git diff --stat -- dist` 生成物已提交。
6. **归族**：同类问题全族排查——4 条 i18n 规则覆盖 harden.md 的可检测项；状态五类逐条给出口（2 条 skipped 写明原因）；a11y 例外清单逐条注明实现或跳过。
7. **时间维 / 基线**：`components.css` 与示例 CSS 改动会改变渲染，**视觉基线需重跑 `canvas_audit action=baseline`**；方向 3→6 使 codegen 资源 38→44、交互条目仍 23、组件仍 26。
8. **假绿**：负例都真失败——fixtures 4 flag 真命中/5 pass 真不命中；`design.states` 删除工具类定义后构建期报错；状态规则用「无分页 1000 行表格」真命中；a11y 用「4px 间距的 16px 图标」真命中。

## 未测项（不得当成通过）

- **权限三态与并发竞态静态不可测**：`states` 报告把它们列入「未判定」，需人工核实。
- **RTL 只有源码级检查**：没有真正切换 `dir="rtl"` 跑浏览器渲染，镜像后的实际布局未测。
- **ZWNJ 与波斯/阿拉伯字形等价**：属存储与搜索层，只在 `i18n-hardening.md` 说明，无自动检测。
- **44px 只测 375×812 一个窄屏档**：真实设备与横屏未覆盖。
- **i18n 四条规则是启发式判断**：`fixed-text-width` 与 `plural-concat` 仅为 advisory，可能漏报或误报。
- **新方向示例是原创演示**：`verify:prototypes` 只证明客观检查通过（无外链、无脚本、可渲染、三档截图），**不代表审美通过**，仍需人工读图。
- **世界推导流程无自动化门禁**：靠 SKILL.md 与参考文档约束，代理是否照做无法由工具验证。
- **`suitableModes` 只作指导**：不阻断选择，也不参与检测器画像。

## 已知取舍

- 移动端 16px 地板用 `max()` 覆盖而非改 token：token 是桌面值，改了会影响所有风格与已验收的桌面基线。
- 间距豁免只在 24px 档启用；44px 设计地板不套用 WCAG 例外（例外是 AA 最低值的宽免，不是设计底线的宽免）。
- i18n 规则不引入 locale 参数：页面语言从 `<html lang>` 读，`dir` 从 `<html|body dir>` 读。
- 三个新方向各只给 2 份示例（中英各一），与既有三方向一致；不额外增加原型。
- 世界推导不移植 impeccable 的 `concept-seed` 随机掷骰脚本（离线可复现性优先），改为流程文档 + 自检问题。
