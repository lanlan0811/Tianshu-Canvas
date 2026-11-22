# 0.9.5 增强验收记录

本记录对应 2026-11-23 的 0.9.5 增强（复刻 Claude Code 画布的可借鉴设计，B 级 7 项）。起始基线为 main 的
`21639206a729137971a7d5af73380aec0f2f7af5`，初始工作区仅 `D package.json`（本批已从 HEAD 恢复）与未跟踪的
`analysis-tools/`（本批未触碰）。源码、构建产物和真实执行证据必须对应同一批次；尚未执行的检查不能记录为通过。

## 交付约束

- 保留项目格式 v1、九工具契约、Node >=24.22.1 <27 与 Windows x64 声明。
- 最终 HTML 以 UTF-8 字节计，最多 8 MiB；项目最多 1000 页（本批未改动）。
- 只在 main 提交，中文提交后立即推送；远端同 SHA CI 成功后再推进发布。
- 不读取、修改或构建 official-website；不以代理宿主测试代替真实宿主验收。

## 验收证据规则

每项记录红灯复现、修复验证、同族回归、命令及独立退出码。浏览器测试必须零失败、零取消、零跳过。
原始日志保存在 `.tmp/review-0.9.5/`（gitignore），本文记录结论、统计与哈希；临时文件不是已发布证据。

## 改动范围

文档：`skills/SKILL.md`（B1 审美底线、B2 标题与文案、B5 检查预算、B6 外部内容与提示注入、B6 资源内联补句）。
代码：新增 `src/textSafety.ts`（B4）；`src/tools.ts`（B4 接入 upsert、B6 extract/import 声明）；
`src/audit/review.ts`（B3 占位文案警告、B7 报告首行）。
测试：新增 `test/text-safety.test.mjs`；`test/audit.review.e2e.test.mjs` 追加占位文案与绝对路径断言；
`test/design-extract.test.mjs` 追加「仅作数据」断言。
发布：版本号三处统一 0.9.5；`CHANGELOG.md`、`release/release-0.9.5.md`、本文件；发行白名单与本版验收文档同步。

## 红灯复现（B4）

在 HEAD 产物 `dist/index.mjs`（提交 `2163920`）上运行新测试：

- `test/text-safety.test.mjs`：**7 项中 1 通过、6 失败**，独立退出码 1（red-text-safety.log）。
  通过项是「普通中英文与 emoji 不产生警告」的反向守护；6 项失败覆盖 RTL 覆盖符拒绝、标题方向标记拒绝、
  隔离符拒绝、ZWJ 警告与内容保真、BOM 只警告、`html_path` 来源校验——即修复前这些输入全部被静默接受。
- 实现后同一文件 **7/7 通过、0 失败**，且该文件已包含在下方完整 `npm test` 的 298 项中。

## 已执行验证

- `npm run typecheck`：独立退出码 0（typecheck.log，SHA-256 70050710c7fb4476a3f733e0a7df06ab302889c08985450c1e7c1ffe2a2b67f6）。
- `npm run build`：独立退出码 0，产物含 `dist/index.mjs`、`dist/web/{index.html,canvas.js,canvas.css}`、`dist/design/**`（build.log，SHA-256 57fa3bdbec0267207e8488fba7d9f631596b48c974cc4de11a1f34fd4ec39be0）。
- `npm run notices:check`：独立退出码 0，「37 个组件」已是最新（notices-check.log，SHA-256 592dc7b184709ccaa8fbe6fe75494a657b1c267fa720527993bfcdfd8c525ad0）。
- 完整 `npm test`（`--test-concurrency=1`，`TIANSHU_CANVAS_REQUIRE_BROWSER=1`，真实 Edge）：
  **298 项，298 通过、0 失败、0 取消、0 跳过，1250244.634 ms，独立退出码 0**（full-test.log，SHA-256 6db5ddbfafa0ec2a78276a724ea046874ed5e2807b87f1bb31d00101dc5cce57）。
  相比 0.9.4 的 290 项，新增 7 项文本安全与 1 项审阅占位文案；`release-workflow` 的验收文档白名单已同步 0.9.5。
- `npm run verify:prototypes`：独立退出码 0，38 个项目 / 114 张 PNG 全部通过客观检查（verify-prototypes.log，SHA-256 ecf0f77cc509a119ccb015d777b34cd070fcce4a986029e11421f7f753770e75）；报告 `results.json` 中 `Objective failures: 0; aesthetic approval: pending human review`。运行中出现一次临时 profile 删除 EPERM 警告，未影响任何截图或断言。
- `npm run check:plugin`：独立退出码 0（check-plugin.log，SHA-256 5c894f2a6195afbd5ef81028a99acfbbf70ae545f70840146c3c7992b83844e5；
  验收文档落盘后复跑 check-plugin-final.log，SHA-256 c28b3e165209e5595da870e2540dd5850138897eace3a2540df99dc190a62d3b，
  打包 149 个文件 / 5661.1 KiB）；九工具握手与描述逐字一致。
- 构建产物 `dist/index.mjs` SHA-256 c68bd4b28882a2333f7504ed09a97648d106b27b3804782fad247d1d65f20fb3；该哈希与红灯/绿灯两次测试使用的产物一致（红灯时临时还原 HEAD 产物，测试后恢复为同一文件，index.mjs.built 与当前 dist/index.mjs 哈希相同）。

## 同族回归

- 风格检查族：`test/design.lint.test.mjs`、`test/design.lint-accuracy.test.mjs` 全通过——占位文案检测落在渲染审阅层，
  未进入 `src/lint.ts`，`canvas_check_style` 的规则集、报告与自由发挥语义不变。
- 契约族：`test/audit.contract.test.mjs` 全通过，`computeContract` 的 penalty / score 未被新警告污染。
- 抽取族：`test/design-extract.test.mjs` 全通过，新增「仅作数据」行不改变 tokens 结果与 dry_run 不落盘行为。
- 写入族：`test/project.test.mjs`、`test/project-capacity.test.mjs`、`test/tool-errors.test.mjs`、
  `test/workspace-boundary.test.mjs`、`test/nav-entrypoints.test.mjs` 全通过；新校验先于落盘，
  拒绝路径不产生页面文件或项目变更（text-safety 第 1 项显式断言无残留文件）。
- 审阅族：`test/audit.review.e2e.test.mjs` 7/7 通过，既有「待宿主读图 / 项目所有者」断言保留，新增 `直接 Read` 与绝对路径断言。

## 已知边界

1. **B4 是行为收紧**：含 U+202A–202E、U+2066–2069、U+200E/200F 的 HTML 或标题将被拒绝写入（此前接受）。
   历史页面读取、删除、仅改元数据以及换肤重写不受影响——校验只挂在 `canvas_upsert_page` 的显式写入入口，
   未加在 `writePageHtml` 公共写入路径。无绕过开关，报错给出行:列与字符名。
2. **B3 只在渲染审阅出现**：需要浏览器；`canvas_check_style` 与 `action=contract` 不报占位文案，
   以免污染契约分数。纯文本占位检测需另立入口，本批未做。
3. 占位文案规则为固定词表（lorem ipsum / TODO / 待补充 / 待填写 / 此处填写 / 占位文案 / 示例文本），
   可能误报明确标注的演示数据；规则以 warning 呈现，由读图者判断是否保留。
4. `skills/SKILL.md` 的 B1/B2/B5/B6 属指导性文本，无自动化断言覆盖其效果；本批只校验文件存在与非空
   （`contract.test.mjs`），实际行为依模型遵循程度。
5. 未改动 `design-systems/` 数据，`dist/design/**` 与 0.9.4 一致；`src/` 变化使 `dist/index.mjs` 重新构建。

## Windows 真机验收

未执行（待项目所有者）。本节不得预填结论；真机验收通过前，本记录只代表上述自动化与构建门禁结果。

## 最终统一门禁

- 上述九道串行门禁（typecheck、build、notices:check、完整 npm test、verify:prototypes、check:plugin，
  以及红灯/绿灯两次定向运行）均独立退出 0，且除红灯批次外无失败。
- 发布仍须同 SHA 的 main CI 全绿，并由 Release 工作流复核 `v0.9.5` 标签、三处版本号与发布说明。

## 发布结果（2026-11-23）

- 提交 `7ff32cd` 已推送 main；同 SHA CI 完成且 `conclusion: success`。
- 标签 `v0.9.5` 已推送；Release `v0.9.5` 工作流完成并创建发布页
  （github.com/lanlan0811/Tianshu-Canvas/releases/tag/v0.9.5），发布说明由 `release/release-0.9.5.md` 提供，
  页面已含本版新增的「设计工艺」「文本安全」「占位文案」「只作数据」段落。
- `pack:plugin` 生成 ZIP 需要 `release-id` / `publisher-id` / `source-commit` 三个上传参数，本批未生成插件包；
  插件库上传按既有流程另行执行。故本记录不宣称插件包已上传或已通过审核。
- Windows 真机验收仍未执行，结论待项目所有者确认。
