# 1.0.0 验收记录

本记录对应阶段 2–6 的六个阶段交付（阶段 2/3、阶段 4/5、阶段 6 及其未测项补齐）。
起始基线为 main 的 `987979b`（0.9.6 之后第一轮阶段 4/5 之前），全部交付已完成并推送。
源码、构建产物与执行证据对应同一批次；未执行的检查不记录为通过。

## 环境

| 项目 | 实测 |
|---|---|
| 系统 | Windows 10 专业版 10.0.19045，x64 |
| Node / npm | v24.22.1 / 11.19.1 |
| 浏览器 | Microsoft Edge 144.0.3719.104（puppeteer-core 25.16.0） |
| 声明兼容 | Windows x64，天枢 >=4.0.2 <5.0.0，TPI 1.0 |
| 发行包 | 124 个文件，约 4849.8 KiB（`check:plugin` 实测） |

## 交付范围（阶段 2–6）

| 阶段 | 交付 | 验收文档 |
|---|---|---|
| 2 · 评审体系 | `design-systems/rubrics/ux-review.json`、`canvas_audit action=ux` 三段式门禁 | `docs/ux-motion-acceptance.md` |
| 3 · 交互与动效 | 23 条交互 a11y 契约、焦点陷阱/inert、中断手势、`action=motion` 抓帧 | 同上 |
| 4 · 鲁棒性 | 布局韧性工具类、4 条 i18n 规则、`action=states`、a11y 间距豁免与移动轮次 | `docs/harden-directions-acceptance.md` |
| 5 · 视觉方向 | 世界推导流程、3 个新方向 + 6 份原创示例 | 同上 |
| 6 · 治理与回归 | immediate/deferred 两档、golden 基线（check_style + a11y/states）、漂移三字段、DESIGN.md 导出 | `docs/governance-acceptance.md` |
| 6 · 未测项补齐 | 规则精度实测、渲染级 golden、DESIGN.md round-trip、页面侧状态 | 同上 |

## 关键计数

| 项 | 数量 |
|---|---|
| 工具 | 9（未新增） |
| 组件 | 26（+5 个共享布局工具类，非组件） |
| 交互 | 23 |
| 源码级规则 | 22（18 阶段 1 + 4 阶段 4 i18n） |
| 视觉方向 | 6（3 persuade + operate/read/experience 各 1） |
| 原型 | 32 |
| 方向示例 | 12 |
| 渲染级规则 | quality 8 / states 5 / a11y 12 |
| 测试文件 | 81 |

## 验收证据

- **全量测试**：`npm test` 782 项 → 781 pass / 0 fail / 1 skip（Windows 专属沙箱用例在非 Windows 上跳过）。
- **渲染级 golden**：`test/golden/render/` 5 项全绿（CI run 112 验证）。
- **源码级 golden**：`test/golden/check-style/` 8 项全绿，含输入 sha256 校验。
- **规则精度**：`npm run verify:precision` → 干净语料 0/44、召回 88/88、阴性误报 0/110。
- **原型客观检查**：`npm run verify:prototypes` 44/44（1440/768/390 三档截图）。
- **代码生成**：`npm run verify:codegen` 6 项（正向 2、反向拒绝 4）。
- **插件自检**：`npm run check:plugin` 124 文件 / 4849.8 KiB，工具描述逐字节一致。
- **第三方许可**：`npm run notices:check` 通过（37 个组件）。

## Windows 真机验收

用户已在 Windows 10 x64 上完成真机验收，结论为通过。逐流程：

| 流程 | 结果 |
|---|---|
| 画布打开与页面写入 | 通过 |
| 设计风格切换与自定义设计系统 | 通过 |
| 交互库（tabs / modal / drawer / dropdown / toast / 表单校验等） | 通过 |
| 预览与导出（多页站、资源内联、生产代码） | 通过 |
| 交付前审计（contract / a11y / quality / states / ux / motion / drift / review） | 通过 |
| 品牌包导出 / 导入 | 通过 |
| 批注与选中反馈 | 通过 |

证据边界：真机验收由用户执行并告知结论；本文件不复制未留存的截图或日志，也不把自动测试结果当作真机替代。

## 未测项（不得当成通过）

- **真实站点语料的规则精度**：自建语料零命中是选择偏倚；召回 100% 只证明 fixture 与实现一致。
- **Stitch 官方 DESIGN.md 解析器**：本机无该工具，`validateDesignDoc` 只是按 spec 文本的结构自检。
- **`quality` / `review` 的报告 golden**：几何测量跨机器有 1px 级差异，逐字节比对成本高于收益。
- **Safari / Firefox**：渲染级 golden 与 `prefers-reduced-motion` 只在 Chromium 上跑过。
- **macOS / Linux 平台**：未声明、未测试。
- **`browserSurfaces` 取值合理性**：只探测存在性，不判断取值。
- **权限三态与并发竞态**：静态渲染无法判定，`action=states` 只列入「未判定」。

## 兼容性

- 项目格式 v1，无存储迁移。
- 工具名与描述：`canvas_audit` 与 `canvas_design_system` 的描述随功能扩充更新，逐字节同步 `tianshu.plugin.json`。
- `canvas_audit` 新增两个 action：`states`（阶段 4）、`ux` / `motion`（阶段 2/3）。
- 权限（fs / net / shell）、权限摘要、平台 `win32-x64`、宿主 `>=4.0.2 <5.0.0`、TPI 1.0 全部不变。
- 行为变化：写入提示从「非 advisory」改为「immediate 档」；漂移报告改为按严重度排序；`DESIGN.md` 已存在时不覆盖。

## 验收与门禁

命令、通过计数与未覆盖项见各阶段验收文档。发布须同 SHA 的 main CI 全绿，并由 Release 工作流复核版本号、
发布说明与标签指向。
