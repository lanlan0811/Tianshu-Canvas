# 天枢画布设计 v0.9.6

> 2026-11-23 · Apache-2.0

本版逐项处置外部审核清单：僵尸锁自动回收（P1）、对比度覆盖正文（P2）、自定义设计系统 create 参数契约
（P3）、风格资产内容寻址去重（P3），并新增本地操作审计日志（P4）。项目格式保持 v1，工具名与描述不变。

## P1 僵尸锁自动回收

- 根因：`project.lock` 里写了 pid，但代码从不读取；进程在事务窗口内被强杀后锁永久残留，项目从此不可写，
  报错只提示人工清理。
- 现在遇 `EEXIST` 会做一次有严格前提的回收：锁必须是普通文件（非符号链接/目录联接）、读取前后文件身份
  （dev/ino/size）一致、记录为 `version:1` 且含**正整数** `pid` 与 16+ 位 hex `token`、pid 不是本进程，
  再用 `process.kill(pid, 0)` 探活。只有返回 `ESRCH`（进程确已退出）才重新核对身份并删除，然后重试创建。
- 保守边界：畸形、链接、被替换、字节被篡改、pid 为 0/负数/非整数（避免误发进程组信号）、进程存活
  （Windows 上存活但无权限即 `EPERM`）一律报 `WORKSPACE_BUSY` 且不改动锁。不引入时间阈值；PID 复用只会
  更保守（判为存活），不会误删活锁。
- 报错文案保持脱敏（只给相对路径 `.tianshu-canvas/project.lock`），绝对路径与 pid 只进宿主日志。

## P2 对比度覆盖正文

- 根因：可访问性审计的采集选择器固定为 `a[href], button, input, select, textarea, [tabindex], [role=…],
  h1–h6, img`，普通 `<p>/<span>/<div>` 正文不在集合内，1.6:1 的正文永远不会产生 `contrast` 条目。
- 现在额外采集含直接文本节点的可见元素（跳过已在主集合内的元素与脚本/样式/SVG），上限 800 个，
  超出时在报告 `skipped` 中注明「文字元素超过 800 个，其余未做对比度判定」。这些条目只参与对比度，
  不参与可访问名、焦点、标题层级、点击目标规则，避免新的误报。
- 报告首行改为「扫描 N 个元素 + M 个文字元素」；背景为图片、渐变或半透明层时照旧跳过并写明原因。

## P3 create 参数契约

- 新增可选参数 `meta`（对象）：`name / tagline / description / tags / swatches / iconStyle / license / notice`
  既可像以前一样按顶层传，也可嵌套在 `meta` 下；两处都传时顶层优先。
- 缺描边宽度的报错改为「请在工具参数传 `iconStyle.strokeWidth`…；也可用 `meta.iconStyle` 嵌套传入」，
  去掉此前有歧义的 `meta.` 前缀；`iconStyle` 的 schema 说明同步注明它会写入风格 `meta.json` 的 `meta.iconStyle`。
- `tokens.size` 含未知键（如 `iconXL`）时返回警告并列出内置键名 `controlSm…sidebar`；未知键不会生成
  `--ts-*` 变量，也不阻断创建。

## P3 风格资产内容寻址去重

- 11 套风格的 `components.css`、`interactions.css`、`interactions.js`、`interactions.json`、`templates.json`
  此前逐字节相同（重复约 1.34 MB）。现在构建期按 sha256 前 16 位写入 `dist/design/shared/<hash>/`，
  每个风格目录只保留 `tokens.css`、`tokens.manifest.json`、`icons.json`（描边宽度按风格不同）、`meta.json`
  与一份 `assets.json` 引用表。
- 新增 `src/designAssets.ts` 统一解析资产引用：拒绝绝对路径与越出 `dist/design` 的 `../` 引用；
  `assets.json` 缺失或损坏时回退到旧路径布局，因此 0.9.5 已安装的 dist 与测试夹具仍然可用。
- 结果：`dist/design` 由 1,704,217 字节 / 99 文件降至 1,157,359 字节 / 101 文件（含 5 个共享文件），
  插件包文件数 151 → 101，解包体积减少约 1.28 MB。

## P4 操作审计日志

- 新增 `.tianshu-canvas/history.jsonl`，追加式，每行一个 JSON 事件：`{ ts, pid, actor: "local", action, changes[] }`。
- 变更在 `ProjectTransaction.commit()` 由前后模型差异自动推导，覆盖全部写入口（九个工具与画布 HTTP）：
  `page.add / page.rename / page.move / page.html / page.remove / edge.add / edge.remove / style.set /
  comment.add / comment.resolve / comment.remove / brief.update`。每项只含 id、标题、字段名与字节数，
  **不含 HTML 正文**。
- 日志与业务写入在同一把锁、同一批原子 rename 中提交；被拒绝或回滚的事务不产生日志；日志写入失败
  只经宿主日志告警，绝不改变业务结果。
- 上限 1 MiB：超出时丢弃最旧记录并写一条 `{"trimmed":true,…}` 标记行。畸形行原样保留并在读取时跳过。
- `canvas_get_state` 增加「最近操作」摘要（最近 5 条）。
- 限制：插件没有登录体系，只能记录「何时、哪个进程、改了什么」，**不能记录「谁」**；日志是本地明文，
  不上传，随 `.tianshu-canvas/` 一起被 gitignore。

## 兼容性

- 工具名与描述不变；唯一 schema 变更是 `canvas_design_system` 新增可选 `meta`。
- 项目格式 v1，无存储迁移；新增 `history.jsonl` 属可删除的派生记录，缺失会自动重建。
- 权限（fs / net / shell）、权限摘要、平台 `win32-x64`、宿主 `>=4.0.2 <5.0.0`、TPI 1.0 全部不变。
- 行为变化两处：死进程遗留锁从「永久占用」变为「下一次写入自动回收」；含双向控制字符的 HTML/标题
  仍按 0.9.5 的策略拒绝写入。

## 已知边界

- PID 复用无法在纯 Node 侧识别；复用后判为存活、不回收（更保守，不会误删）。
- 对比度只覆盖可见元素与直接文本节点，不判定伪元素、图片内文字、阴影/渐变叠加背景；800 个上限之外的
  文字元素不判定并在报告注明。
- 操作日志无用户身份、无跨机器合并语义；多文件断电下的日志与业务一致性依赖同一批 rename，不作跨盘事务承诺。
- macOS / Linux 平台未声明、未测试；匿名人工审美评审仍未完成，本版不宣称整体审美优于直接生成。

## 验收与门禁

命令、通过计数、日志摘要与未覆盖项见 [验收记录](../docs/review-0.9.6-acceptance.md)。
发布仍须同 SHA 的 main CI 全绿，并由 Release 工作流复核版本号、发布说明与标签指向。
