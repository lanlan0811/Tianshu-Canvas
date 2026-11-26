# 天枢画布设计 v1.0.0

> 2026-11-27 · Apache-2.0

1.0.0 把设计能力从「风格一致」推进到「可评审、可审计、扛得住真实输入、能防止所有页面长得一样」。
本版完成阶段 2–6 共五轮交付：UX 评审体系、交互 a11y 与动效、鲁棒性、视觉方向与反收敛、治理与回归。
工具仍是 9 个（新增能力全在现有工具的 action 内），项目格式保持 v1，无存储迁移。

## 阶段 2 · UX 评审体系

- **可打分的评审量表**：`design-systems/rubrics/ux-review.json` 落到 `dist/design/rubrics/`，
  10 条启发式各 5 个分数档、8 项认知负荷、5 个 persona、6 行界面映射、P0–P3、审美下限 9 项。
  构建期 `validateRubric` 校验结构，缺分数档或档位顺序错会中断构建。
- **三段式隔离门禁**：`canvas_audit action=ux`，`phase=a` 出截图与空模板（**物理上不含**任何 lint/a11y/quality
  结论，避免检测结果锚定设计判断）→ 回填 `a_assessment` → `phase=b` 跑确定性检测 → `phase=synthesize`
  算分并落盘 `ux.json`。`n/a` 只允许量表指定的两条启发式且必须给理由；分母按实际计分项重算，
  **绝不写 /40 覆盖部分集合**。
- 工具只做算术与结构校验；`ux.json` 的 `limitations` 明确写着「评分来自代理判断，不能替代项目所有者」。

## 阶段 3 · 交互 a11y 与动效

- **23 条交互的 ARIA 契约**：每条带 `roles / attrs / keys / focusReturn / live / gesture`，
  构建期按**值级**校验声明必须真在运行时或骨架里出现（类名不能冒充 `role`）。
- **真实运行时补齐**：modal/drawer/mobile-nav/toc 的焦点陷阱 + 背景 `inert` + 焦点归还；
  dropdown 外部点击与 `aria-activedescendant`；表单 `aria-invalid` + `aria-describedby` + `role=alert`；
  tooltip 生成真实 `role="tooltip"` 气泡并接 `aria-describedby`；date-picker roving tabindex；
  scroll-progress 修复 `role=button` 上的 `aria-hidden` 焦点陷阱；toast 错误态 `role=alert`。
- **中断手势**：`bindPointerDrag` 统一处理第二指针不夺取、`pointercancel`、`lostpointercapture`、
  离场与失焦；`.ts-i-tilt--armed` 带 `touch-action: none`。
- **reduced-motion**：所有 `animation/transition: none` 改为 `0.01ms`（事件仍触发，状态机不卡死），
  构建期门禁禁止回退。
- **动效抓帧审计**：`canvas_audit action=motion`，点击选择器后按固定采样抓帧，产出帧序列、
  filmstrip、拖帧查看器与 5 个**相对**指标（start-jump / end-jump / mid-step / clipped-midway /
  reduced-motion-ignored）。报告写明「不证明平滑」。

## 阶段 4 · 鲁棒性

- **布局韧性**：`.ts-shrink`（`min-width/min-height: 0`）、`.ts-clamp-1/2/3`、`.ts-wrap-anywhere`；
  移动端输入框 16px 地板（`max(16px, var(--ts-fs-md))`），修 iOS Safari 聚焦缩放。
- **i18n 四条源码规则**：`rtl-physical-direction`（只对 `dir="rtl"`，居中写法豁免）、
  `fixed-text-width`、`plural-concat`、`western-digits-rtl`。
  `skills/reference/i18n-hardening.md` 记录不可自动检测的部分：德语长度膨胀 30%、**ZWNJ 必须保留**、
  波斯/阿拉伯同形字母存储保留原形、东阿拉伯数字与 Jalali/Hijri 历。
- **状态完整性**：新增 `canvas_audit action=states`——空态无提示/无下一步、加载态未播报、
  1000+ 行未分页、表单未防重复提交。权限三态与并发竞态写入「未判定」，**不假装通过**。
- **触控**：a11y 实现 WCAG 2.5.8 的 24px 圆间距豁免与行内文字例外；新增 375×812 移动轮次，
  只判 44px 设计地板。

## 阶段 5 · 视觉方向与反收敛

- **世界推导流程** `skills/reference/world-derivation.md`：点名这个类别的窠臼（标配页 + 它的反面，
  两者剔除）、从受众文化世界列 7 个具体视觉系统、跨至少 3 个材质族、回答两个强制问题
  （做成实物长什么样 / 有网页之前长什么样）。
- **三个新方向**，各配中英两份原创示例：`operate-instrument`（仪表操作台——世界只借 type/palette/
  density/一个签名动作）、`read-reference`（参考文档——世界拥有框，阅读栏冷静）、
  `experience-gallery`（作品陈列——作品领跑，界面后退）。方向总数 3 → 6，方向示例 6 → 12。
- 骨架测试进入自检清单：抽掉全部文案只看结构，还能说出这段是什么吗。

## 阶段 6 · 治理与回归

- **规则两档**：`RuleDef.tier` 必填。immediate（机械、无歧义、就地可改）在写入后提示一行；
  deferred（口味与叙事判断）留到交付前一次性报告。两档都不阻塞写入。
- **golden 逐字节基线**：`test/golden/check-style/` 6 组输入，`test/golden/render/` 覆盖
  a11y 与 states 报告。每个用例带输入 sha256 指纹——输入改了没重录基线会直接失败。
  README 明令禁止「仅为让测试通过而重录」。
- **漂移检测**：快照升 schemaVersion 2，增加页面模式、设计系统侧状态覆盖、浏览器表面、页面侧状态信号；
  报告按严重度排序（越界 > 未使用 > 移除 > 新增）；旧快照读入后补齐并注明「基线已升级」。
- **DESIGN.md 导出**：`canvas_design_system action=export` 同目录产出 DESIGN.md——YAML frontmatter
  五组机器层 + 八节中文正文（英文标题原样），组件子 token 只允许八个属性，缺数据的整节省略。
  已存在时不覆盖。另提供 `parseDesignDoc` / `validateDesignDoc` 做结构回读与自检。
- **规则精度实测**：`npm run verify:precision`——干净语料 0/44 命中、构造缺陷召回 88/88、
  阴性语料误报 0/110。文档明确写了这不能外推成真实世界精度。

## 兼容性

- 工具仍为 9 个；新增能力在 `canvas_audit`（`ux` / `motion` / `states`）与 `canvas_design_system`（DESIGN.md 导出）内。
- 项目格式 v1，无存储迁移；`.tianshu-canvas/` 布局不变。
- 权限（fs / net / shell）、权限摘要、平台 `win32-x64`、宿主 `>=4.0.2 <5.0.0`、TPI 1.0 全部不变。
- 行为变化三处：写入提示改为只报 immediate 档；漂移报告按严重度排序并新增三行维度；
  `DESIGN.md` 已存在时拒绝覆盖。
- 设计系统计数：组件 26（+5 个共享布局工具类）、交互 23、源码级规则 18 → 22、方向 3 → 6、
  原型 32、方向示例 6 → 12。

## 已知边界

- **规则精度与伤害率未在真实站点语料上验证**：自建语料按规范写成，零命中是选择偏倚。
- **DESIGN.md 未跑过 Stitch 官方解析器**：结构校验是按 spec 文本自写的，不等于官方校验。
- **`quality` / `review` 无报告 golden**：几何测量跨机器有差异。
- **Safari / Firefox 未测**：渲染级 golden 与 reduced-motion 只在 Chromium 上跑过。
- **macOS / Linux 未声明、未测试**。
- **静态不可测的两类**：权限三态、并发竞态——`action=states` 只列为「未判定」。

## 验收与门禁

命令、通过计数与未覆盖项见 [验收记录](../docs/review-1.0.0-acceptance.md)。
发布仍须同 SHA 的 main CI 全绿，并由 Release 工作流复核版本号、发布说明与标签指向。
