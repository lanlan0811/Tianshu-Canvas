# 0.9.4 审查修复验收记录

本记录对应 2026-11-11 的 0.9.3 审查修复。起始基线为 main 的 `de95ded838d0380d1543ae65a918fb798d48d27a`，初始工作区干净。源码、构建产物和真实执行证据必须对应同一批次；尚未执行的检查不能记录为通过。

## 交付约束

- 保留项目格式 v1、九工具契约、Node >=24.22.1 <27 与 Windows x64 声明。
- 最终 HTML 以 UTF-8 字节计，最多 8 MiB；项目最多 1000 页。
- 锁争用立即返回可重试错误；遗留锁须关闭所有相关宿主后人工清理。
- 只在 main 提交，中文提交后立即推送；每批远端同 SHA CI 成功后再推进交付。
- 不读取、修改或构建 official-website；不以代理宿主测试代替真实宿主验收。

## 验收证据规则

每项记录旧基线复现、修复验证、同族回归、重复与重启行为、命令及独立退出码。性能使用固定 50/200/1000 页夹具和同机对照，不以单次耗时作为通过条件。正式 Windows 浏览器测试必须零失败、零取消、零跳过。

原始日志和临时证据保存在 `.tmp/review-0.9.4/`，提交前将结论、统计与哈希写回本文；临时文件不是已发布证据。

## 第一批复现

- 原始 `de95ded` 产物上，新增原始工具错误测试全部红灯（5 项，退出码 1）：目录替换导致工具 reject、绝对路径泄露、错误恢复边界。日志 `batch1-errors-baseline.log`。
- 同一旧产物上，真实 Edge 键盘与拒绝反馈测试红灯（退出码 1）：三个缩放按钮的 aria-label 均为 null，变更失败没有可见 alert。日志 `frontend-baseline-red.log`。
- 全量基线尝试因源码与依赖正在并行调整而停止，未将混合状态运行记为通过。保留原产物、专项红灯和中断说明。
- `npm ci` 退出 0。依赖审计发现 esbuild 0.24.2 的 GHSA-67mh-4wv8-2f99，定向升级到 0.25.12；安装后审计为 0 漏洞。
- 首次候选 typecheck、build 退出 0；定向回归发现旧导出边界测试期望 500 与本版 403 契约不符，以及并发主题读取出现 1 次外部内容泄露。后者按安全根因修复处理，不能忽略为抖动。

## 第一批验收结果

环境：Windows 10 x64，Node 24.22.1，npm 11.19.1，Edge 144.0.3719.104，`TIANSHU_CANVAS_REQUIRE_BROWSER=1`。

- 最终全量 `npm test`：247/247 通过，0 失败、0 取消、0 跳过，1076782.0132ms，独立退出码 0（`batch1-full-test.log`）。
- 画布键盘与拒绝反馈专项连续两轮 2/2 通过；原始九工具/HTTP/启动/工作区边界专项 23/23 通过，均零跳过。
- 文件读取竞态由两个独立旧/新源码时序探针证明：旧实现可读外部内容，修复后拒绝；真实 worker 四轮共 240 次导入，0 泄露。保留 open 前后文件身份核对与 fd 读取，不以重试测试掩盖旧缺陷。
- typecheck、build、notices、notices:check、verify:codegen、check:plugin 退出码均为 0。
- 本批 Node/Web/CSS SHA-256：`8f78bedc0e8600fb386d665dbffa9223d1d4216a0931b8e6639c05dfd6c56969` / `99f3d1b186bf380d13bd235e025e373afc298bed0643a1bc4f90c43890a2b7f4` / `b429a60d5852d4c82c41f7d6b9e8091c1f6e6c7c680255a458b7f0c4f2d5b130`。

远端 CI 结论在推送后按同一提交另行核实；本地通过不代替远端 CI。

## 已知历史边界

0.9.3 的 Windows 使用验收位于 `docs/aesthetic-upgrade-acceptance.md`。GUI 安装、操作验收，宿主手工读图，以及人工审美评审是不同检查，不合并为一个通过结论，也不复制旧版结果作为本版证明。

## 第二批存储与容量专项

执行日期为 2026-11-11 至 2026-11-12（Asia/Shanghai），环境为 Windows 10 x64、Node 24.22.1、npm 11.19.1。本节是自动化存储、公开工具和 HTTP 专项结果，不代替完整浏览器回归、天枢 0.9.4 真实宿主安装升级与人工操作验收。

### 基线复现与修复反验

- 独立旧 `887317a` 构建产物探针仅导入 `dist/index.mjs`，两项确定性红灯：8 MiB + 1 字节 HTML 被接受，已有 1000 页的复制操作生成第 1001 页。命令 `node --test .tmp/review-0.9.4/batch2-baseline.mjs`，2 项失败、独立退出码 1；日志 `batch2-capacity-baseline-isolated.log`。最初源码并行调整时的加载失败另外保留，不认定为产品基线缺陷。
- 首轮新专项为 18 项中 17 项通过、1 项失败，独立退出码 1，日志 `batch2-capacity-transactions.log`。真实缺陷是显式 upsert 与旧超限 HTML 字节相同，变化短路绕过容量校验。修复后所有显式提供的最终 HTML 在比较字节前校验，纯元数据更新仍允许保留旧超限正文；原断言不放宽，完整复测通过。

### 已执行验证

- `node --test --test-concurrency=1 test/project-capacity.test.mjs test/project-transactions.test.mjs test/project-async-pipeline.test.mjs`：22/22 通过，0 失败、0 取消、0 跳过，155872.8827 ms，独立退出码 0；日志 `batch2-storage-complete.log`。随后再补通用 `stageFile` 容量绕过与重叠写删回归，事务和异步管线以最终测试文件重复运行 12/12 通过，0 失败、0 取消、0 跳过，3796.023 ms，独立退出码 0；日志 `batch2-storage-repeat-final.log`。最终三文件共 23 项，均至少一次实际通过；全量绿色由后续统一门禁另记。
- 普通批次由文件打开和最终替换计数证明仅一次项目 inspection、一次 project.json 提交；read/check/write 复用事务模型。坏 UTF-8、BOM 与换行的备份严格按原 Buffer 比较，即使 inspection 后路径被外部改写，仍备份本次读取字节。损坏根、无效节点、无效简报的只读和隐式视口不覆盖或备份原盘。
- 两个独立 Node 进程用屏障形成真实持锁争用，竞争进程立即得到 `WORKSPACE_BUSY`，释放后重试保留双方更新；另以强杀制造遗留锁验证不自动抢占，人工清理后恢复。异常回调、异步回调拒绝、多工作区、畸形锁、Windows junction 锁、替换锁及同 inode/同长度仅 token 改变均有回归，不能凭 inode 或文件大小删除另一持有者锁。
- 容量覆盖最终 HTML 的 8 MiB - 1、精确 8 MiB、8 MiB + 1，中文 UTF-8 字节、`html_path`、资源内联膨胀、设计注入、999/1000/1001 页、复制、旧超限读取和减量；容量与最终输入拒绝前后项目和页面 SHA-256 一致，批量中前面的暂存页不提前落盘，删除也不提前执行。
- 切换风格、自定义风格创建、覆盖和品牌包导入因后续页面注入超限时，`library/`、`memory/`、项目及所有页面的逐文件 SHA-256 全部保持不变；没有新增风格目录或残留锁。
- 同族锁争用覆盖页面 upsert、复制/删除、连线、批注、简报、切换风格、自定义风格创建/覆盖/删除，以及 HTTP 视口、批注、节点、连线；公开工具返回可重试错误，HTTP 返回 409，1000 页 HTTP 复制返回 400；所有正式数据字节不变，清锁后正常恢复。
- 异步管线仅将 `fetchUrl` 替换为可控响应，真实 `inlineAssets`、工具、导航、设计注入和事务继续执行：网络等待前后均无锁；等待期间另一个写入修改标题、位置、尺寸、风格与目标页，恢复时采用锁内最新状态；新页自动布局使用最新页数；Base64 膨胀后工具仍拒绝超限。这是确定性并发/管线验收，不宣称测试触达真实外网或替代 SSRF 网络回归。
- 通用 `stageFile` 直接指定 `pages/<id>.html` 同样受限；父子路径重叠写删在任何正式文件变更之前拒绝。

本批专项起止 Node/Web/CSS 产物 SHA-256 保持一致：`a49c997f71ef8b6b277be38dd159735a4033e13379b21efaa25da14c0cb82988` / `857deeb390383b75bf6b2923b674af56f6403fc6672d932da14f4f27cf53366a` / `b429a60d5852d4c82c41f7d6b9e8091c1f6e6c7c680255a458b7f0c4f2d5b130`。

日志 SHA-256：基线 `7fc345680158c963ae314faa1e31f91b7c187ad1683e961b4bc0aaf4e17d6e27`；完整专项 `b94531800d69aeb92940fff9cda3f60647466462a711b803a6b58f8a127dfe1f`；最终重复 `e39317bde9c98701286c16063ed94cad8409a0d54bfd422384301b8182951c7b`。原始日志保留在 `.tmp/review-0.9.4/`；本节结论与哈希随源码提交，临时日志本身不作为发行包内证据。

本节不将多文件提交描述为崩溃回滚；锁保障合作插件进程的同步读改写互斥，不约束外部编辑器，也不提供跨进程实时广播。专项运行期间其他代码生成/导航检查造成的耗时变化不作为 50/200/1000 页性能基准。

## 第三批：增量导航与性能边界（2026-11-12）

### 修复与专项验证

- 新增独立导航缓存模块，单批共享 ID/slug 解析索引；按工作区维护未解析/歧义引用及已解析目标的反向依赖。缓存仅在事务成功提交后发布；失败、重启和最终实例退出不留下错误缓存。
- 热态依靠文件 dev/ino、mtime、ctime、size 指纹识别外部修改，仅读取改变的正文和真正受影响的引用来源。原子替换在长度与 mtime 保持一致时仍能识别。页面移动不重读正文；不把项目解析、指纹检查宣传为 O(1)。
- 复现性对照：旧基线固定夹具每次 HTML 更新均读取全部 50/200/1000 页；候选每次仅读取目标旧正文 1 页，未重复读取无关正文。候选源码专项同时验证前向引用、中文编码 slug、歧义整页保留、改名/删除解除、复制、外部编辑、换肤、重启、多工作区及事务失败后重试。
- AI 与 HTTP 的改名、复制、删除共用同一事务内回填；受影响 HTML 和 htmlRev 在同次项目提交中更新。最终 HTML 字节不变不写、不递增 htmlRev；旧超 8 MiB 页自动补齐仍超限时保留原字节和版本并明确告警。
- 最终冻结产物之后执行 `node --test --test-concurrency=1 test/nav-entrypoints.test.mjs test/nav-incremental.test.mjs`：**11/11 通过，0 失败、0 取消、0 跳过，15797.1094 ms，退出码 0**。日志 `.tmp/review-0.9.4/navigation-final.log`，独立退出码 `navigation-final.exit`。
- 冻结源码 SHA-256：nav.ts `2e5f4b9a7efdeba8c6492d142e6a3a21acffb086cb898d4e1fe94eadb31ffdb9`；navigation.ts `6b996a9f25d3b7cc122a4c5a870257d4f1473ee092ed46a7964cd66fe5ebb26b`。最终专项对应 dist/index.mjs `0eb05d3566371c88afa1a5cab79d1a8addc7f06d6790e5a8c8dffbc7fc67a006`，完整清单 `navigation-final-hashes.json`。

### 固定规模性能记录

环境沿用本机 Windows x64、Node 24.22.1。`.tmp/review-0.9.4/benchmark.mjs` 使用同一 seeded-fixed-size-warm-html-update 夹具，各规模独立三轮、每轮 10 次更新；统计拦截路径/URL/Buffer/fd 读取和 project.json rename 次数。旧基线为 de95ded 产物，候选测量的 dist/index.mjs SHA-256 为 `a49c997f71ef8b6b277be38dd159735a4033e13379b21efaa25da14c0cb82988`（**最后一次已解析 ID 删除缓存修补之前的候选；不冒充最终冻结产物性能**）。两者均受同机其他验收与系统负载影响，时间只作边界记录；核心断言是正文读取与提交次数。

| 页数 | 旧基线各轮中位数 ms | 候选各轮中位数 ms | 候选各轮 p95 ms | 每轮正文读取旧→新 | 每轮项目提交 |
|---|---|---|---|---|---|
| 50 | 852.2 / 491.4 / 414.8 | 185.5 / 185.2 / 194.0 | 201.7 / 199.7 / 400.9 | 500 → 10 | 10 |
| 200 | 2237.4 / 1486.7 / 2100.1 | 986.4 / 1095.1 / 1231.3 | 1227.2 / 1486.0 / 1598.4 | 2000 → 10 | 10 |
| 1000 | 12916.3 / 9479.9 / 5057.2 | 6030.0 / 5829.0 / 5079.0 | 10583.5 / 8317.6 / 7575.6 | 10000 → 10 | 10 |

- 上述命令退出码 0，证据 `performance-candidate-fixed.json/.log/.exit`；JSON SHA-256 `b188f19b3355d4bb2c3bdebaf0aaa5d0eaab7d30681c63f1093dfd956cf8c062`。不因 1000 页其中一轮时间接近旧版就宣称失败，也不隐去该结果；**1000 页依然是数秒级，指纹/项目处理仍随规模增长**。
- 可复跑的 `node scripts/benchmark-navigation.mjs .tmp/review-0.9.4/navigation-operation-performance.json` 额外覆盖 50/200/1000 页、各三轮改名与移动，退出码 0：每次改名仅读取 1 个受影响来源、每次移动 0 正文读取且 0 解析，每事务项目提交 1 次；冷启动正文读取恰为页数。该次也在上述最终删除依赖修补前运行，原始样本保留不覆盖。

### 200 节点真实浏览器记录

- 使用已有 browser-scale.mjs，候选与旧基线各三轮、每轮独立 Edge 无头实例，1600×1000 视口、固定 200 页夹具。候选命令 `node .tmp/review-0.9.4/browser-scale.mjs candidate dist/index.mjs 3` 退出码 0，开启 `TIANSHU_CANVAS_REQUIRE_BROWSER=1`，证据 `browser-scale-candidate.json` 与 `browser-scale-candidate-three.log/.exit`。
- 候选 200 节点 DOM 就绪各轮 5.03 / 11.93 / 4.47 秒；首个可见 iframe 内容实际就绪 8.30 / 15.13 / 9.10 秒；4 个首屏可见 iframe 全部就绪 8.42 / 15.70 / 9.45 秒。旧基线首个可见内容为 12.82 / 4.10 / 4.25 秒；本次没有 iframe 虚拟化，**不据交错负载测量声称首屏性能提升**。
- 每轮验证 200 节点、iframe `sandbox="allow-scripts"`、不透明源与父子 DOM 互相拒绝读取，pageErrors 均为 0。原生 lazy loading 意味着节点就绪不等于 200 个 iframe 全部完成渲染。
- 约 10 秒时主画布 CDP 目标 JS heap 为 81.0 / 19.0 / 19.6 MB，CDP 浏览器进程合计 WorkingSet64 为 662.6 / 618.7 / 647.1 MB。heap 不含全部子框架/GPU；WorkingSet 含共享页，非私有内存。第二轮约 10 秒采样实际延迟至 11.88 秒，JSON 明确记录请求/观测时刻，不伪称精确 10 秒。
- 浏览器候选与性能候选为同一 `a49c997f…` 产物，Web JS `857deeb390383b75bf6b2923b674af56f6403fc6672d932da14f4f27cf53366a`、CSS `b429a60d5852d4c82c41f7d6b9e8091c1f6e6c7c680255a458b7f0c4f2d5b130`。browser-scale-candidate.json SHA-256 `34d2279792b667cdb65cb37179d88875c4bda98f7e862824fc3a9ab31666ab64`。

### 保持兼容的解析边界

项目格式 v1 没有链接来源标记：一个 href 字面值既可能是用户标题 slug，也可能是以前规范化的页面 ID。因此保留原有 ID 优先、缺失后 slug 回退规则，不凭 ID 形状改语义。现存 ID 的改名/重名不会重绑；删除后恰有同字面标题 slug 时可能回退到该页。新增测试锁定热缓存与冷启动一致，显式 data-nav 只接受精确 ID、不会回退。需要持久稳定且删除后不回退的引用应使用 data-nav。

## Windows 真机验收（2026-11-12）

验收主体：项目所有者本人于 2026-11-12 在本机 Windows 10 x64、天枢 4.0.4 真实宿主中完成安装、操作与清理验收，全部流程通过。以下按验收结论整理为记录，不冒充代理执行的 GUI 操作，也不复用 0.9.3 历史通过记录；自动化与浏览器证据见上文各批专项，两者不能互相替代。

| 流程 | 结果 | 实测要点 |
|---|---|---|
| 安装与加载 | 通过 | 版本 0.9.4、入口 `dist/index.mjs`、9 个工具与清单一致，宿主加载无异常 |
| 打开与复用 | 通过 | `canvas_open` 返回带随机路径的链接；重复打开复用同一本地服务 |
| 键盘与无障碍 | 通过 | 缩放、节点工具栏等图标按钮可读出名称；重命名输入有标签；画布控件可见焦点；导出菜单 Esc 关闭且焦点返回 |
| 错误反馈 | 通过 | 重命名、移动、复制与批注失败均显示可见错误并重新核对服务端状态；输入错误给出中文原因与操作指引，未知错误不暴露绝对路径 |
| 事务与并发写入 | 通过 | 同一工作区连续写入按序完成；并发写入立即返回可重试提示，无部分更新，释放后重试成功 |
| 容量边界 | 通过 | 接近 8 MiB 的页面可正常写入，超限写入被拒绝且项目与页面字节不变；1000 页项目可读，复制第 1001 页被拒绝 |
| 导航回填 | 通过 | 页面改名、复制、删除后引用页链接同步更新；`data-nav` 按精确 ID 命中；无关页面不刷新、不重写 |
| 升级与数据 | 通过 | 0.9.3 项目升级到 0.9.4 无需迁移，页面、批注、简报、自定义风格与品牌记忆均保留 |
| 数据边界 | 通过 | 项目数据仅写入工作区 `.tianshu-canvas/`，不离开本机；本版未新增网络请求、持久化或表单提交行为 |
| 卸载与清理 | 通过 | 最后一个会话结束后本地服务停止、凭证失效；用户项目与导出文件保留 |

真机验收不覆盖：macOS / Linux 平台、匿名人工审美评审、外部编辑器并发修改与多文件断电场景。

代理此前仅核实本机存在天枢 4.0.4 并读取插件中心界面，该诊断本身不构成安装、升级、操作和清理验收通过；本节结论以项目所有者本人在真实宿主上的验收为准。

## 最终统一门禁

- 首次冻结产物完整 Windows 浏览器全量：286 项，284 通过、2 失败、0 取消、0 跳过，1062746.446 ms，独立退出码 1（batch23-formal-full-test.log）。两处故障注入仍只拦截 readFileSync 的文件路径参数，而新读取链使用受检查的文件描述符，注入未命中；不能将这次运行记为通过。保留原断言、修复注入并断言实际命中后重新完整运行。后续发布验证队列按失败退出，未绕过继续发布。
- 用户已授权完成发布，版本 package.json、tianshu.plugin.json、lockfile 根与 packages[""] 已统一为 0.9.4；发行白名单和测试只包含本版验收文档。其余最终结果将在实际完成后追加。

- 故障注入专项先复现 6/8 通过、2 失败（退出 1，tool-errors-fd-baseline.log）；仅修测试拦截器，记录 openSync 返回的 fd 与路径对应关系，readFileSync 按实际目标注入，closeSync 清理映射。每个权限或 HTTP 故障请求断言命中计数增加，原隐私、错误状态与恢复断言均保留。两轮专项均 8/8、0 失败/取消/跳过，退出 0，分别 2376.5028 / 2521.1457 ms（tool-errors-fd-fixed-1/2.log）。测试 SHA-256 为 a38f1a0b018fbc7cd7e909260d8c98dfd7db84360cadcb7e3dac166583064db3；两轮日志 SHA-256 为 73f671e022f06d616368d7aa5c505e627255fcb501d09a3eb7198ee321bf3684 / b7bcb269f3653cb0292d96239fd94a7470b316656be8c7574808c1caea3ff8a4。生产源码未因此改变。

- 发布前独立复核发现相邻前缀干扰重叠路径预检：父路径 style、相邻 style-alt/meta.json、子路径 style/meta.json 的普通字典序使祖先栈提前弹出。新增父删子写、父写子删各正逆暂存顺序四项，在原算法下 9 项中 5 过、4 失败（overlap-baseline.log，退出 1）；改为写删路径 Set 加逐级 dirname 检查真实祖先。修复后事务和完整性专项 18/18 通过，0 失败/取消/跳过，4295.3443 ms，退出 0（overlap-fixed.log）；拒绝前后递归目录条目和全部正式字节一致。原 release-final 队列主动终止，不计最终绿色；修复后以 release-final3 独立重跑完整门禁。project.ts SHA-256 为 048981ac15eef2d6828ea3f5dba564903abb8ee4d467c0b1368d0228aa3527df，完整性测试为 50a5116577fdc69c9512966958e1ce253c4ba264f9f11036ca4c997950daaecf。

- 重叠修复后重新构建的最终产物 SHA-256：dist/index.mjs 为 b60bb12715094e224e0c73058f1284a7275998f85d443eff09d1883e23ccd932，Web JS 为 857deeb390383b75bf6b2923b674af56f6403fc6672d932da14f4f27cf53366a，CSS 为 b429a60d5852d4c82c41f7d6b9e8091c1f6e6c7c680255a458b7f0c4f2d5b130。源码、测试、脚本、工作流、技能和产物 302 文件归一化文本换行冻结清单的集合 SHA-256 为 999dcdc3af7a0c5d6b57607337c4714971a8c44e72f124c9985a4393649f25f6；二进制按原字节计。此前专项及性能数据保留各自候选哈希，不重标为本次最终产物。原算法重叠红灯日志 SHA-256 32131dd175cecff86007aaf102ab4386f548f0b87a1fcf8b8012c228dc0e67fc；修复绿灯日志 ad13fba3322814d9f73078a2418d459881e228ae1c0973ec5dd5c239c8b21cdc。

### 修复后最终统一结果（release-final3）

- Windows 10 x64、Node 24.22.1、npm 11.19.1、Edge 144.0.3719.104；严格设置 TIANSHU_CANVAS_REQUIRE_BROWSER=1，显式指定实际 Edge。源码重建后完整 npm test：**290/290 通过，0 失败、0 取消、0 跳过、0 todo，643288.2033 ms，独立退出码 0**（release-final3-test.log / .exit.txt）。新增四项路径顺序反例包含在此次完整运行中。
- typecheck、build、notices、notices:check 分别独立退出 0；verify:codegen 独立退出 0，正向编译 2 项、反向拒绝 4 项全部通过。负例日志中的预期 TypeScript 错误不当作未执行或忽略错误；真实依赖编译结果另记。

- verify:codegen:real 独立退出 0：32 个原型加 6 个方向示例使用真实 React 类型编译通过，shadcn 真实 React 类型与 AntD 真实依赖编译均通过；脚本总耗时 172.1556475 s（release-final3-verify-codegen-real.log）。shadcn 组件仍为脚本中本地最小实现，不能称为在线下载全部官方组件。check:plugin 独立退出 0（release-final3-check-plugin.log），九工具握手、清单及发行白名单通过。

- verify:prototypes 独立退出 0，517.3616554 s：38 个项目（32 原型加 6 方向示例）、1440/768/390 三尺寸共 **114 张完整 PNG**，0 客观失败；再次核对每张 PNG 文件长度、头部实际宽高、捕获高度并生成逐图 SHA-256。报告确认源码与产物均未在截图期间改变，设计、Node 入口和 Web 产物与源码一致。报告 SHA-256 63597530de605af06a81ba4b217e2e5fa1df374387b1d1895c6221384839c625，逐图清单集合 SHA-256 d8779c8c0c71b63acbef7f97a973b5da6a9b2f8835f0b8e89eb8e8bdeb21f3ba，文件 final3-prototypes/results.json 与 final3-screenshot-integrity.json。
- 保留客观告警：knowledge-workspace、mobile-content、developer-workbench 三尺寸未发现可见 h1；developer-workbench 三尺寸三个区域被标记为顺序键盘焦点候选。报告无 error，不把 warning 删除或等同人工审美通过；人工审美仍独立记录，用户的真机确认不外推为匿名审美评审。
- 最终九道串行门禁均独立退出 0；302 个冻结输入再次核对无变更。原始日志 SHA-256：

| 最终日志 | SHA-256 |
|---|---|
| release-final3-typecheck.log | f25affca887dc98e63e67b1876643dbca478fa4f9af59c6505d34c55a2abcedb |
| release-final3-build.log | 7af2acc38b672e9d0bd48e8c26b60f82da12e7f67c94c6df61493953737239fb |
| release-final3-notices.log | 7e27bf2690fac96e2097efd2c156d00cacd590e72533dac96e96f1e7611144cd |
| release-final3-notices-check.log | 00aa02e36de570b4cc6d254d83b10aee5e53cf3a01e4a7a95710de69ad0d9021 |
| release-final3-test.log | bc802b8ebc8264ae2d46b7bedddc435d98e2b1e5e1e9f2889cf4f898057d8a80 |
| release-final3-verify-codegen.log | 13997f8979d119e23bf36ced154076fa637f905979e448b6cfba8989bd432c57 |
| release-final3-verify-codegen-real.log | d25af884b492b0a46d4a5c0c8c0cc751753ed90f634a94cb5f8d2e32c4f0ad09 |
| release-final3-check-plugin.log | d320826c7476ab31e550325df0d89a6bb4be3968cc9d4032d26a3aa1c60ff920 |
| release-final3-verify-prototypes.log | 7709082d7911919aeb94df14ed49a308eb32e1c2ef18af167b67affd84530d7c |

- 提交与标签按发布流程执行：仅 main 中文提交并立即推送；提交后验证干净重建，远端最新同 SHA main push CI 必须成功才推送 v0.9.4，Release 只能由 release.yml 再次复核和执行。远端实际结果以该提交和标签的 GitHub Actions/Release 为准，不预写未来状态。
