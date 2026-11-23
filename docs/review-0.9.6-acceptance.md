# 0.9.6 审核整改验收记录

本记录对应 2026-11-23 对审核清单四项问题的整改。起始基线为 main 的
`b1f6d5fa6972931ae91661346eacbd0e84d157e9`（0.9.5 发布后），初始工作区干净（仅未跟踪的 `analysis-tools/`，
本批未触碰）。源码、构建产物和真实执行证据必须对应同一批次；尚未执行的检查不能记录为通过。

## 交付约束

- 保留项目格式 v1、九工具契约、Node >=24.22.1 <27 与 Windows x64 声明。
- 最终 HTML 以 UTF-8 字节计，最多 8 MiB；项目最多 1000 页（本批未改动）。
- 只在 main 提交，中文提交后立即推送；远端同 SHA CI 成功后再推进发布。
- 不读取、修改或构建 official-website；不以代理宿主测试代替真实宿主验收。

## 验收证据规则

每项记录复现、修复验证、同族回归、命令及独立退出码。浏览器测试必须零失败、零取消、零跳过。
原始日志保存在 `.tmp/review-0.9.6/`（gitignore），本文记录结论、统计与哈希；临时文件不是已发布证据。

## 整改项与证据

### P1 僵尸锁不被回收

- **复现**：`project.lock` 记录 `pid` 但代码从不读取；进程在事务窗口被强杀后锁残留，后续写入永久
  `WORKSPACE_BUSY`，报错只提示人工清理。原测试「强杀独立持锁进程保留遗留锁…人工清理后恢复」正是把该缺陷
  固化为预期行为。
- **修复**：`src/transaction.ts` 遇 `EEXIST` 时按严格前提回收——锁须为普通文件（非符号链接/目录联接）、
  读取前后 dev/ino/size 一致、记录为 `version:1` 且含正整数 `pid` 与 16+ 位 hex `token`、pid 非本进程，
  再用 `process.kill(pid, 0)` 探活；仅 `ESRCH` 才重新核对身份后删除并重试创建。`EPERM`/其它错误视为存活。
  回收事件经 `warnUser` 写入宿主日志（含绝对路径与 pid），用户可见消息保持相对路径与脱敏。
- **验证**（`test/project-transactions.test.mjs`，9/9 通过）：
  - 改写后的「强杀独立持锁进程后，下一次写入自动回收遗留锁」通过，断言写入成功且锁最终消失；
  - 新增 `pid = 0 / -1 / -4242 / "dead" / null / 1.5` 六种非法取值 → 仍 `WORKSPACE_BUSY` 且锁字节逐字不变
    （防止 `process.kill(0)` 误发进程组信号）；
  - 新增「缺 token 的死 pid 记录」→ 仍 busy，不回收；
  - 原样保留：畸形 JSON、目录联接、被替换、同 inode 同长度改写 → 仍 busy 且字节不变；活进程持锁 → 仍 busy；
    争用 2 s 内失败。
- **同族回归**：`test/project-transaction-integrity.test.mjs` + `test/project-capacity.test.mjs` 共 20/20 通过
  （含「锁初始化 fstat/随机数失败不遗留锁」「锁未写 record 时被替换不得删除」）。

### P2 对比度未生效

- **复现**：`src/audit/a11y.ts` 采集选择器只有交互元素、标题与图片，普通 `<p>/<span>/<div>` 正文完全不参与
  判定，1.6:1 的正文不会产生 `contrast` 条目。修复前用合成 `RawScan` 的单元测试无法暴露该缺口，因为
  它直接构造条目、绕过了浏览器采集。
- **修复**：采集脚本新增「含直接文本节点的可见元素」（跳过主集合内元素与 script/style/svg），上限 800，
  超出写入 `skipped`；这些条目带 `textOnly: true`，只参与对比度，不参与可访问名/焦点/标题/点击目标规则。
  报告新增 `textElements` 计数并在首行展示。
- **验证**：新增 `test/audit.a11y.e2e.test.mjs`（真实 Edge，3/3 通过）：
  - 1.6:1 正文 → 命中 `contrast` 且消息含「对比度 1.xx 低于 4.5」；
  - 正常正文 → 无 `[error] contrast`；
  - 渐变背景 → 不误报且报告含「跳过对比度」。
  `test/audit.a11y.test.mjs` 15/15 通过，新增两项：`textOnly` 条目只产生 contrast、`textElements` 回落为 0。

### P3-a create 参数契约

- **复现**：`iconStyle` 只接受顶层参数，但报错文案写「缺少 meta.iconStyle.strokeWidth」，调用方会尝试
  嵌套写法而失败；`tokens.size` 使用 camelCase，与 `--ts-size-icon-sm` 的 kebab 变量名看似不一致，
  未知键静默不生效。
- **修复**：新增可选 `meta` 参数（顶层优先）；报错改为「请在工具参数传 `iconStyle.strokeWidth`…也可用
  `meta.iconStyle` 嵌套传入」；schema 说明 `iconStyle` 会写入风格 `meta.json` 的 `meta.iconStyle`；
  `tokens.size` 未知键返回警告并列出全部内置键名。
- **验证**（`test/design.custom.test.mjs`，10/10 通过）：新增嵌套写法成功、顶层优先、`meta` 名称生效、
  未知键 `iconXL` 只警告且不生成 `--ts-size-icon-xl`；原「缺 strokeWidth」用例改匹配新文案并断言含 `meta.iconStyle`。

### P3-b 风格资产重复

- **复现**：`dist/design/styles/<id>/` 中 5 个文件在 11 套风格间逐字节相同
  （components.css 14,972 B、interactions.css 24,885 B、interactions.js 45,609 B、
  interactions.json 34,958 B、templates.json 8,548 B），重复 1,344,614 B，占 dist/design 79%。
- **修复**：构建期按内容 sha256 前 16 位写入 `dist/design/shared/<hash>/`，各风格写 `assets.json` 引用；
  新增 `src/designAssets.ts` 解析并强制引用落在 `dist/design` 内，缺失/损坏时回退旧路径。
- **验证**：
  - `dist/design` 由 **1,704,217 B / 99 文件** 降至 **1,157,359 B / 101 文件**（含 5 个共享文件）；
  - 共享目录 5 个文件的目录名与内容 sha256 前 16 位逐一相符（构建后脚本校验）；
  - `test/design.catalog.test.mjs` 6/6 通过（新增内容寻址校验）；
  - 新增 `test/design.assets.test.mjs` 4/4 通过（回退、共享解析、越界/绝对路径拒绝、损坏回退）；
  - `test/design.inject.test.mjs`、`design.interact.inject.test.mjs`、`design.custom.test.mjs`、
    `adapters.import.test.mjs`、`adapters.codegen.test.mjs` 共 24/24 通过；
  - 打包文件数 151 → **101**，`check:plugin` 解包 5,804 KiB → **4,414.5 KiB**。

### P4 无操作审计日志

- **复现**：项目只有 `updatedAt`，无任何操作历史文件；`.tianshu-canvas/` 下不存在追加式记录。
- **修复**：新增 `src/history.ts` 与 `.tianshu-canvas/history.jsonl`；在 `ProjectTransaction.commit()`
  由前后模型差异推导，覆盖工具与 HTTP 全部写入口；只记录 ts/pid/action/changes（id、标题、字段名、字节数），
  不含 HTML 正文；与业务同批原子 rename 提交，失败只告警；上限 1 MiB 并写 `trimmed` 标记；
  `canvas_get_state` 展示最近 5 条。
- **验证**：新增 `test/project-history.test.mjs` 6/6 通过：
  - 成功写入追加 1 行，含 `actor: local`、`pid`、`ts`、`page.add`（含字节数），且日志不含页面正文标记；
  - 改名/移动/换风格/批注 → 差异类型齐全；
  - 回滚与最终校验失败 → 不产生日志且项目字节不变；
  - 畸形行保留、后续追加可用；
  - 6,000 行 >1 MiB → 裁剪后 ≤1 MiB 且含 `trimmed` 与新记录；
  - `history.jsonl` 被预置为符号链接 → 业务成功、外部文件字节不变。
- **同族回归**：`test/brief.test.mjs`、`test/project-capacity.test.mjs`、`test/project-async-pipeline.test.mjs`
  共 23/23 通过（这些用例的目录/字节快照均属拒绝路径，不产生日志）。

## 已执行验证

- `npm run typecheck`：退出码 0（typecheck.log，SHA-256 64673f612fdea051bce798f4e266f75b7ef51154f397b66b4149fa2b2c524d9f）。
- `npm run build`：退出码 0（build.log，SHA-256 ac99572724ec4e3ea7b9431a110b59324b1e62886c82f7512f9dbfded86fb953）。
- `npm run notices:check`：退出码 0（notices.log，SHA-256 d3d7eefd1b8f13d54956d6397e81374444f980ef5308826b6d63d3f8009ad8ff）。
- `npm run check:plugin`：退出码 0，9 工具握手、描述逐字一致，打包 109 文件 / 4,414.5 KiB
  （check-plugin.log，SHA-256 a4eccd2a9fcf3d356da394af7422aa2faca47f1ac3d1e0dc9eeaff493e163508）；
  验收文档落盘后复跑 110 文件 / 4,426.3 KiB（check-plugin-final.log，
  SHA-256 8bfa8a4f73e715aaad1dc8c75c46aa1c34e31cc5f3ffdcb18c242c398a3613a0）。
- 构建产物 `dist/index.mjs`：SHA-256 de036311c094ccf9370ebad849e4018a6abd98505318a54e5f6c3f16fcef3e58，
  2,822,702 字节；`dist/design` 56 个文件变更（删 55 个重复资产、新增 5 个共享文件与 11 份 assets.json）。
- `npm run verify:prototypes`：首轮在 [1/38] 后失败——`openReviewFrame` 等待画布 `.page-node__iframe`
  15 s 超时（verify-prototypes.log，SHA-256 9c25df84725c2020bb993c98fb3de3b4fd2db1072e1fe6e7157d4df9d901ba84），
  属画布外壳启动抖动，与本次改动无因果关系（该路径不经过设计资产解析）。原样重跑第二轮：
  独立退出码 0，**38 个项目、1440/768/390 三尺寸全部通过客观检查，0 客观失败**
  （verify-prototypes-2.log，SHA-256 e1b81fab27e3177d3ca0a98e75f26d7f624318ba8b9b9067a3a7a8a87b5d60f6），
  报告 `results.json` 记录 `Objective failures: 0; aesthetic approval: pending human review`。

### 完整测试：首轮 312/313，次轮 313/313

- 首轮（`TIANSHU_CANVAS_REQUIRE_BROWSER=1 npm test`，真实 Edge，`--test-concurrency=1`）：
  **313 项，312 通过、1 失败、0 取消、0 跳过，637,116 ms，退出码 1**（full-test.log，
  SHA-256 c295fb2fcdf0405182572d2a94d5bbb96c0a62c2ef280d903ac3029cd7b7d55f）。
  唯一失败是既有画布拖拽 e2e `test/canvas-errors.e2e.test.mjs:14` 在 `expectAlert('验收拒绝 move')`
  处 `waitForFunction` 30 s 超时——属浏览器拖拽落点抖动（全量长时间运行后指针释放的 position 变更未触发），
  与本次改动无因果关系：该用例单独运行 9.4 s 通过，且同轮其余 312 项（含全部锁、a11y、去重与日志新测试）全绿。
- 次轮同一命令：**313 项，313 通过、0 失败、0 取消、0 跳过，618,113 ms，退出码 0**
  （full-test-2.log，SHA-256 37eb4d0fbd6bf130223c0f650a12f81bdda08686aa9c1452034a3d0b710d189c）。
- 处理方式：不修改该测试、不放宽断言、不以单次通过掩盖；记录两轮证据，以包含全部 313 项的绿色轮次
  作为门禁结论，并把首轮的抖动性质如实写入本记录（未归因为代码缺陷，也未宣称已修复）。

## 已知边界

1. **PID 复用**：纯 Node 侧无法识别 pid 被复用；复用后判为存活、不回收（更保守，不会误删活锁）。
   不引入时间阈值。
2. **锁回收仅限自己格式**：缺 token、畸形、链接、目录联接、被替换、字节被篡改一律不回收。
3. **对比度覆盖范围**：只判定可见元素的直接文本节点；不判定伪元素、图片内文字、阴影/渐变叠加背景；
   800 个文字元素之外不判定并在报告注明。
4. **去重兼容**：`assets.json` 缺失或损坏时回退旧路径布局，0.9.5 已安装的 dist 与测试夹具仍可用。
5. **操作日志**：无登录身份，只能记录「何时、哪个进程、改了什么」，不记录「谁」；1 MiB 上限会裁剪最旧
   记录；日志属本地明文派生数据，删除后自动重建。
6. 未改动 `official-website`、`analysis-tools/`；未改变工具名与描述（仅新增可选 `meta`）。

## Windows 真机验收（2026-11-23）

验收主体：项目所有者本人于 2026-11-23 在本机 Windows 10 x64、天枢 4.1.54 真实宿主中完成 0.9.6 真机验收，
结论为通过。本记录按所有者确认整理，不冒充代理执行的 GUI 操作；逐项操作细节未在本次会话中逐条回传，
因此下表只记录确认覆盖的范围与结论，不复述未取得的实测细节。自动化与浏览器证据见上文，两者不能互相替代。

| 覆盖范围 | 结论 | 说明 |
|---|---|---|
| 安装与加载 | 通过 | 0.9.6 在天枢 4.1.54 中安装并加载正常，9 个工具与清单一致 |
| 审核清单整改复核（P1–P4） | 通过 | 锁回收、a11y 对比度、create 参数契约、资产去重与本地操作日志按建议纳入验收范围 |
| 升级与数据 | 通过 | 由 0.9.5 升级无需迁移，页面、批注、简报、自定义风格与品牌记忆保留；`history.jsonl` 随操作生成 |
| 数据边界与清理 | 通过 | 项目数据仅写入工作区 `.tianshu-canvas/`；会话结束后的本地服务与凭证清理正常 |

真机验收不覆盖：macOS / Linux 平台、匿名人工审美评审、外部编辑器并发修改与多文件断电场景。
天枢 4.1.54 高于清单声明下限（>=4.0.2 <5.0.0），兼容范围本身未改动。

## 发布门禁

- 上述门禁（typecheck、build、notices:check、完整 npm test、verify:prototypes、check:plugin）除已说明的
  两处浏览器启动抖动（首轮完整测试的单点用例、首轮原型截图的画布外壳）外均独立退出 0；两者原样重跑后
  分别 313/313 与 38/38 通过，未修改测试、未放宽断言。

## 发布结果（2026-11-23）

- 提交 `c807889` 推送后，同 SHA CI **失败**：`Test` 步骤在 Linux 上退出 1。定位为新增测试的真实缺陷——
  `test/design.assets.test.mjs` 的越界用例使用 `C:\Windows\win.ini`，而 POSIX 上该值不是绝对路径，
  会被当作普通相对路径放行。修复方式是在 `src/designAssets.ts` 显式拒绝盘符前缀（`/^[A-Za-z]:[\\/]/`）
  并简化一处无意义的平台判断，提交 `9c504df`。
- `9c504df` 同 SHA CI **completed success**，Release `v0.9.6` 工作流 **completed success**，
  发布页 github.com/lanlan0811/Tianshu-Canvas/releases/tag/v0.9.6 已创建。
- 插件包 `.claude/upload-0.9.6/tianshu-canvas-0.9.6.zip`：112 个文件、4,563,147 字节、
  SHA-256 `f99b572c95aef72aeb751b46a8868a7ba23546dee5f32a7f5861f3ee4fa39e48`；
  官方开发套件 `validate --lane official_reviewed` 返回 `valid: true`，
  `manifest_sha256 = b7b39e28670a956ce0572edeb75ce42b42c9661cb8ef6d06049eb70a5133e7e6`。
- 本地完整测试与原型截图结果对应提交 `c807889`（差异仅为 `designAssets.ts` 的盘符判断与测试简化），
  `9c504df` 的 Linux CI 已从头重跑全部门禁并通过。
- Windows 真机验收已于 2026-11-23 由项目所有者在天枢 4.1.54 上完成并通过，详见上方「Windows 真机验收」；
  本记录仍不宣称插件已上传或已通过平台审核。
