# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
每个版本的详细发布说明见 `release/release-<版本>.md`。

## [v0.7.3] - 2026-11-06

画布换上专属应用图标（顶栏品牌标 / favicon / 空态插画统一），并修复 Windows 上 `dist/` 换行符导致 CI 误判「产物与源码不一致」。详细说明见 [release-0.7.3.md](release/release-0.7.3.md)。

### 新增

- **专属应用图标**：顶栏品牌标（22px）、浏览器 favicon（64px）、空态插画（132px，含浮动与投影）三处统一为应用图标，替换原先的手绘占位方块 / 线框 favicon / 虚线画板。
- 三张手绘便签小方片保留，改为绕图标分布（右上琥珀 / 右侧薄荷 / 左下天蓝），各自倾角与错开的浮动动画。
- README 顶部加横幅头图（`assets/banner.png`）与应用图标（`assets/icon.png` + `icon-512.png`，透明底）。

### 变更

- 图标由 esbuild 的 `dataurl` loader 在构建期内联进 `canvas.js`（`web/src/brand-icon.png`，384px 量化 256 色，约 12KB），不新增静态资源路由，符合画布 CSP `img-src 'self' data: blob:`。
- favicon 改由 `scripts/build.mjs` 的 `__FAVICON__` 占位替换（源 `web/favicon.png`），`web/index.html` 不再内嵌 base64。

### 修复

- **`dist/` 换行符导致 CI 失败**：`web/index.html` 在 Windows（`core.autocrlf=true`）下是 CRLF，构建直接复制会让 `dist/web/index.html` 带 CRLF 入库，与 Linux CI 重建的 LF 逐字节不等。构建时统一归一化为 LF。

## [v0.7.2] - 2026-11-06

修复技能（skill）流程契约失效：把「先给画布链接、再问设计风格」等硬顺序从**懒加载的技能正文**搬进**始终注入的工具描述与参数描述**。详细说明见 [release-0.7.2.md](release/release-0.7.2.md)。

### 修复

- **技能正文不进上下文**：宿主只把每个技能的一行 `description` 注入 `<available-skills>`，正文需模型主动 load。原先 10898 字符的流程约束（执行顺序 / 禁止事项）全部只在正文里，模型不 load 就等于零 → 表现为「不先给画布链接」「风格模糊时不询问，自行挑一套」。
- 把顺序契约下沉到**永远在上下文**的层：
  - `canvas_open` 描述标注「【第一步】……必须先把 URL 单独一行发给用户，再开始设计」。
  - `canvas_upsert_page` 描述加「调用前必须先 canvas_open，并已确认设计风格」。
  - `canvas_style` 描述加「用户未指定风格时先用 action=list 列出并把风格名作为选项问用户一次，等回答后再继续」。
  - `canvas_style` 的 `stack` 参数加「多端导出前必须先问用户选哪种技术栈并等回答，不得替用户决定」。
  - `canvas_design_system` 的 `dry_run` 加「建议默认先传 true 让用户确认后再正式执行」；`action=create` 加「必须先一次性问清配置并等回答……不要拆成多轮反复追问」。
- 技能 `description` 同步压入硬顺序（该行必定注入）。

### 变更

- `<available-skills>` 注入块占用 1482 → 1489 字符（预算 1500），未挤出其它技能。
- 工具描述均在 200 字上限内；运行时与清单描述仍逐字一致。

## [v0.7.1] - 2026-11-06

三套原创设计风格：天枢·砚、天枢·雾、天枢·麦；内置风格 7 → 10 套。详细说明见 [release-0.7.1.md](release/release-0.7.1.md)。

### 新增

- **`tianshu-inkstone` 天枢·砚**：石墨纸 + 朱砂，小圆角、衬线标题、极轻投影；含深色模式。
- **`tianshu-vapor` 天枢·雾**：雾蓝 + 靛紫，大圆角、柔和投影；含深色模式，主操作在深色下反转为浅靛。
- **`tianshu-saffron` 天枢·麦**：麦纸 + 藏红花，中等圆角、舒适行高；面向内容与阅读场景。
- 三套均为从零设计，不复用任何既有风格配色；共享组件契约、图标几何与模板结构，跨风格切换保持同构。

### 变更

- `design-systems/index.json` 与 `dist/design/` 更新为 10 套风格。
- README / `design-systems/README.md` / 技能文档的风格清单同步；技能里的风格选项扩充为 8 项（含自由发挥）。
- 测试（目录契约 / 服务端 catalog / 图标注入）同步到 10 套。

## [v0.7.0] - 2026-11-06

护城河版：真实代码库适配器（shadcn / AntD）、Design CI（`canvas_audit`）、品牌记忆与可移植品牌包。工具数 8 → 9。详细说明见 [release-0.7.0.md](release/release-0.7.0.md)。

### 新增

- **适配器**：`canvas_style` 的 `codegen` 新增 `shadcn`、`antd` 两个 target，按真实组件 props 生成可编译代码；基于新增的 HTML 节点树（`src/htmlTree.ts`）按结构选组件。
- **从仓库导入主题**：`canvas_design_system` 的 `action=import`，自动探测 shadcn/Tailwind 或 Ant Design，颜色归一化为 `#hex` 并通过 token 契约；AntD 找不到项目主题时明确标注默认种子 token。
- **Design CI**：新增 `canvas_audit`（contract / a11y / visual / baseline / drift），自研零依赖 a11y 规则集与 `node:zlib` PNG 像素 diff；`contract` 可落盘自包含的 `*.audit.test.mjs`。
- **品牌记忆**：`.tianshu-canvas/memory/brand.json` 累加使用统计；`canvas_design_system` 新增 `export` / `import_pack`，单 JSON 品牌包带 checksum、无时间戳、可复现。
- **编译验收**：`npm run verify:codegen`（进 CI，声明桩 + tsc，含必失败的反向用例）与 `npm run verify:codegen:real`（发版前真实安装）。

### 变更

- 工具数 8 → 9；清单与运行时描述仍逐字一致且 ≤200 字。
- `canvas_design_system` 的 `pathParams` 新增 `source_path` / `pack_path` / `out_dir`。
- 画布支持 `?page=<id>&export=1` 单页导出模式（供视觉回归使用）。
- 自定义风格 `meta.json` 新增可选 `adapter` 字段；旧 library 不受影响。
- CI 在测试后新增 `npm run verify:codegen`。

## [v0.6.0] - 2026-11-06

发行形态对齐版：让插件能通过天枢官方插件库的打包与验包，功能与 0.5.0 一致（仍 8 个工具）。详细说明见 [release-0.6.0.md](release/release-0.6.0.md)。

### 修复

- **清单补 `engines.tianshu`**（`>=4.0.2 <5.0.0`）：官方打包器对缺此项的包直接拒绝，发行记录的 `compatibility.core` 由它派生。
- **入口改为 `dist/index.mjs`**：发行 ZIP 内没有 `package.json`，模块格式只能按扩展名判定。
- **`puppeteer-core` 内联进单文件 bundle**：旧实现是运行时从 `node_modules` 动态 import，而官方包不携带依赖目录，装完插件导出 PNG 会失败。现已在无 `node_modules` 的空目录实测通过。
- **`permissions.shell` 改为 `true`**：确实会 spawn 系统浏览器、启动无头 Chrome、在 Windows 上调用 `taskkill`。
- **工具描述与清单逐字一致且 ≤200 字**（官方示例按 `{ name, description }` 深比较）；详细契约移入 `inputSchema` 参数说明与技能。
- **路径参数声明**：`canvas_style.out_dir` → `write`，`canvas_design_system.path` → `read`，宿主据此做路径守卫。
- **`canvas_open` 改为非并发安全**：会启动服务并写 `url.txt`。全部工具补 `timeoutMs`，`inputSchema` 补 `additionalProperties: false`。
- **日志改走 `host.log`**（新增 `src/host.ts`，宿主外回落 stderr）；`isWorker` 会话不写 `url.txt`。

### 新增

- `npm run check:plugin`：发行前自检（清单/入口/握手/路径/体积），已接入 CI 与 Release 工作流。
- `scripts/pack-plugin.mjs`：按官方规则生成发行 ZIP 与 `xiaosi.release.json`、`xiaosi.contents.json`；同源码两次打包字节一致。

### 说明

- 工具名与行为对用户不变，无项目数据迁移；已安装 0.5.0 可直接覆盖升级，新建会话后生效。
- 官方套件 `validate --lane official_reviewed` 返回 `valid: true`；`npm run verify` 95/95 通过。

## [v0.5.0] - 2026-11-06

三个新能力：**真实资源内联**、**设计系统反抽取**、**导出生产代码（Web + 多端）**。工具名不变（仍 8 个），新能力以参数 / `action` 形式并入现有工具。详细说明见 [release-0.5.0.md](release/release-0.5.0.md)。

### 新增

- **资源内联**（`canvas_upsert_page` 的 `inline_assets`）：把原型里会被画布 CSP 拦截的外链/相对路径资源抓取并内联为 `data:` URI（图片 / 字体 / CSS / SVG / 脚本）。**默认关闭，仅显式传参才触发**；相对路径需 `inline_assets_origin`；抓不到或超限的资源保留原引用并在返回里说明。
- **设计系统反抽取**（`canvas_design_system` 的 `action=extract`）：从现有 HTML/CSS（`source` / `path`）或一个 URL 反推出一套**能通过严格 token 契约校验**的设计系统并创建。支持 `dry_run` 预览；返回里区分「观测 N 项 / 推断 M 项」。
- **导出生产代码**（`canvas_style` 的 `action=codegen`）：
  - Web：`target=react`（HTML→JSX 组件）/ `css-vars`（CSS 变量 + 无框架 HTML）/ `tailwind`（Tailwind 配置）。
  - 多端：`target=ios|android|miniprogram` + `stack=swiftui|uikit|compose|xml|weapp|uniapp|taro`，产出**主题/Token 文件 + `design-spec.md` 规格清单**（确定性、已校验）；页面代码由 AI 按规格编写。
  - 默认内联返回文件内容；`write_files=true` / `out_dir` 时落到 `.tianshu-canvas/exports/`。
- **SSRF 安全抓取**（新模块 `src/netFetch.ts`）：协议白名单、内网/回环/链路本地拦截、连接钉在校验过的 IP（防 DNS rebinding）、重定向逐跳复验、体积与超时上限。

### 变更

- 抽出共享 CSS 解析器（`src/cssParse.ts`），由 `src/lint.ts` 与反抽取共用（行为不变）。
- 技能新增两节**硬流程**：导出代码必须先问「目标」（多端再问「技术栈」）才可调用 `codegen`；反抽取建议先 `dry_run`。
- 工具数仍为 8 个；`tianshu.plugin.json` 仅更新描述与版本。

### 说明

- 无 `project.json` 字段变化，旧项目无需迁移。
- 反抽取是**确定性**的（同输入同输出）；多端 HTML→原生**必然有损**，产物明确标注保真度与人工校对点，不宣称像素级还原。
- 测试由 63 个增至 95 个。

## [v0.4.2] - 2026-11-06

移除 AI 侧的导出工具 `canvas_export`：导出改由用户在画布顶栏自行操作。工具由 9 个回到 8 个。详细说明见 [release-0.4.2.md](release/release-0.4.2.md)。

### 变更

- **移除 `canvas_export`**：导出不再由天枢本体触发，只由用户在画布顶栏点「导出」完成。
- 工具数由 9 个降至 8 个；技能与文档明确「导出没有对应工具，不要替用户导出」。
- 画布 UI 导出按钮、`/api/export` 与 `/api/export-file` 路由、导出实现**保留**，功能对用户无变化。

### 说明

- 移除能力，不涉及 `project.json` 字段变化，旧项目无需迁移。
- 测试数不变（63 个）；导出测试改走画布顶栏所用的 `POST /api/export` 路由。

## [v0.4.1] - 2026-11-06

新增**元素批注**：在画布上直接圈出要改的地方，AI 一次读回全部批注并逐条修改。工具由 8 个增至 9 个。详细说明见 [release-0.4.1.md](release/release-0.4.1.md)。

### 新增

- **元素批注**：选中元素后写一句话即可打图钉（元素左上角显示编号、节点标题栏显示「批注 N」），存于 `project.json` 的 `comments[]`。
- **`canvas_comments`**（`action`: list / resolve / reopen / remove）：`list` 一次读回全部待处理批注（含页面标题 / 标签 / xpath / 当前文本），AI 逐条改完后用 `resolve` 批量标记已解决。
- **图钉由注入探针在 iframe 内绘制**：按 xpath 定位、文档坐标绝对定位，不受画布缩放 / 平移 / 页面滚动影响；已解决的不再显示。
- 新增 `GET /api/comments` 与 `POST /api/comments`（op: add / resolve / remove）。

### 变更

- 工具数由 8 个增至 9 个；`canvas_get_state` 末尾提示「待处理批注：N 条」。
- `project.json` 新增可选字段 `comments: Comment[]`；缺省即没有批注，旧项目无需迁移。

### 修复

- 无效批注（缺 id / 非字符串 xpath / 空内容）读取时静默过滤，不影响其余条目。
- 删除页面时连带删除该页批注。

### 说明

- 图钉只做展示、不拦截点击；面板里每条批注可单独解决 / 重开 / 删除。
- 测试由 62 个增至 63 个。

## [v0.4.0] - 2026-11-06

正式版：引入项目级设计系统（7 套内置风格 + 用户自定义设计系统），工具由 5 个增至 8 个。详细说明见 [release-0.4.0.md](release/release-0.4.0.md)。

### 新增

- **自定义设计系统**：`canvas_design_system`（create / list / get / remove）—— 用户描述配色与配置，AI 生成只属于当前工作区的风格，存 `.tianshu-canvas/library/<id>/`，默认锁定为当前项目风格。仅改 token（组件与图标共享、不可扩展），支持**浅色 + 深色两套**（深色根元素加 `class="dark"` 切换），写入前校验对比度、尺度与变量覆盖。
- **设计风格 4 → 7 套**：新增芭比风（`barbie`，亮粉 + 超大圆角）、NERV 风（`nerv`，首套深色：深灰底 + 霓虹红）、极简风（`minimalist`，黑白灰单色）。
- **`canvas_style` / `canvas_check_style`**：列出 / 查看 / 锁定 / 切换 / 解绑项目级风格，取页面模板；只读校验风格一致性。
- **写入自动注入**：锁定风格后 `canvas_upsert_page` 自动内联 token 与组件样式，并把 `<svg data-icon="名字">` 展开为当前风格的内联 SVG。
- **画布顶栏风格切换器**：显示当前风格与色卡，可切换内置 / 自定义风格或回到「自由发挥」。

### 变更

- 「天枢原创」重新设计为「宣纸青绿（东方文人）」：原设计与 Claude 风撞色，现改用冷绿宣纸底 `#f0f2ea` + 青绿主色 `#0f766e`。
- 工具数由 5 个增至 8 个；`canvas_style` / `canvas_check_style` 的 `style_id` 不再固定枚举（改为执行期校验），以接受工作区自定义风格 id。
- `project.json` 新增可选字段 `design: { styleId, updatedAt }`；缺省即自由发挥，旧项目无需迁移。

### 修复

- 设计系统注入：图标描边属性堆叠、展开破坏 `<script>` 字符串、片段页面把样式块插到 doctype 之前（合并社区 PR #4）。
- 画布状态：`spawn` 失败打垮宿主、保存视口广播导致平移丢选中且视口从未读回（合并社区 PR #5）。
- 风格校验：漏检多值简写 / 命名色 / 现代色函数；误报 id 选择器 / 注释 / `data-style` / 负值；尺度校验漏检重复档位。
- 技能流程：强制「先给画布链接 → 再问风格 → 最后写页面」的顺序。
- 测试基建：浏览器 e2e 改为串行，修复并发导致的 `page.goto` 超时。

### 说明

- 未锁定风格时行为完全不变；切换风格不改写页面已有的裸色值。
- 测试由 35 个增至 62 个。

## [v0.4.0-beta.4] - 2026-11-06

设计风格由 4 套增至 7 套：新增芭比风、NERV 风、极简风。详细说明见 [release-0.4.0-beta.4.md](release/release-0.4.0-beta.4.md)。

### 新增

- **芭比风（`barbie`）**：亮粉与腮红色阶、超大圆角（24–32px）、粉色投影，衬线标题带编辑感。
- **NERV 风（`nerv`）**：本项目**首套深色风格**——深灰底 `#0f0f10` + 近白文字，霓虹红主操作，等宽字体用于数据读数。
- **极简风（`minimalist`）**：纯中性黑白灰单色系统，层级靠明度与细边框，12px 圆角与极轻分层投影。

### 变更

- 三套新风格沿用共享的图标 / 组件 / 模板，与既有风格变量集合完全一致（各 116 个），切换时只替换样式块。
- 主色按 4.5 对比度门槛调深：芭比 `#d81b60`（4.95）、NERV `#cc363b`（5.05）；品牌亮色保留在图表色阶与强调位。
- 登记 `index.json`，补充 `NOTICE.md` 无隶属声明，更新 `README.md` 表述。

### 说明

- 无工具接口 / 数据格式变更，`project.json` 结构不变；工具数仍为 7 个；测试数仍为 52（断言覆盖 7 套产物）。

## [v0.4.0-beta.3] - 2026-11-06

合并社区 PR #4 / #5，修复设计系统注入、画布状态与风格校验的缺陷。详细说明见 [release-0.4.0-beta.3.md](release/release-0.4.0-beta.3.md)。

### 修复

- **设计系统注入（PR #4）**：切换风格后图标描边不生效（属性堆叠）；图标展开会破坏 `<script>` 里的字符串；无 `<html>`/`<head>` 的片段页面把样式块与探针插到 doctype 之前（怪异模式）。注入现在可逆、幂等，并跳过脚本 / 样式 / 注释。
- **画布状态（PR #5）**：`spawn` 失败走异步 `error` 事件会打垮宿主（`canvas_open`、PNG 导出、`taskkill`）；保存视口广播导致平移后丢失选中，且视口从未读回。现在失败返回可读错误、不重试；保存视口不再广播，刷新保留客户端状态并恢复上次视口。
- **风格校验（PR #5）**：漏检多值简写 / 命名色 / 现代色函数 / 逻辑属性；误报 id 选择器 / 注释 / `data-style` / 负值 / emoji 掩码错位；未知 `style_id` 显示通过。`style_id=free` 如实说明只查资源。

### 说明

- 无工具接口 / 数据格式变更，`project.json` 结构不变；工具数仍为 7 个。
- 测试由 35 个增至 52 个。

## [v0.4.0-beta.2] - 2026-11-05

修复实测暴露的流程问题：模型会跳过「先给画布链接」与「先询问风格」。详细说明见 [release-0.4.0-beta.2.md](release/release-0.4.0-beta.2.md)。

### 修复

- **强制「先给画布链接 → 再问风格 → 最后写页面」的顺序**：执行顺序改为编号硬约束；新增「禁止」清单，明确禁止在用户选定风格前调用 `canvas_style` 的 `set` / `get` / `template`，并写明即使模型认为某套更合适也必须先问；抛出选项后须停下等回答。
- 「工作流」一节收敛为第 3 步的写法细节，去掉与硬约束重复的宽松表述。
- `canvas_open` 返回文本改为「请立刻把下面这一行原样发给用户」，并提示下一步先确认风格。

### 说明

- 仅涉及技能文本与提示文案，无工具接口 / 数据格式变更。
- 设计系统与 v0.4.0-beta 完全一致。

## [v0.4.0-beta] - 2026-11-05

引入项目级设计系统：四套风格、写入自动注入、画布可切换、只读风格校验。详细说明见 [release-0.4.0-beta.md](release/release-0.4.0-beta.md)。

### 新增

- **设计系统（4 套风格）**：苹果风 / 谷歌风 / Claude 风 / 天枢原创，统一 `--ts-*` 变量与 `ts-*` 组件类；每套含颜色、字体、间距、圆角、阴影、尺寸 token，23 个组件类，60–80 个内联 SVG 图标，2 个页面模板（数据看板 / 落地页）。
- **`canvas_style` 工具**：列出 / 查看 / 锁定 / 切换项目级风格，或取页面模板 HTML（`action`: list / get / set / template）。
- **`canvas_check_style` 工具**：只读检查页面是否符合当前风格（裸色值、非 token 字体、越界间距 / 圆角、目录外图标与组件类、未知变量、会被 CSP 拦截的资源）。
- **写入自动注入**：锁定风格后 `canvas_upsert_page` 自动内联 token 与组件样式，并把 `<svg data-icon="名字">` 展开为当前风格的内联 SVG，原型保持自包含。
- **画布顶栏风格切换器**：显示当前风格与色卡，可切换或回到「自由发挥」。

### 变更

- `project.json` 新增可选字段 `design: { styleId, updatedAt }`；缺省即自由发挥，旧项目无需迁移。
- 工具数由 5 个增至 7 个；`canvas_get_state` 新增「设计风格」段。
- 发布工作流把含连字符的标签标记为预发布。

### 说明

- 未锁定风格时行为完全不变：不注入、不改写 HTML。
- 切换风格只替换可用的 token 与组件实现，不会改写页面里已有的裸色值。
- 风格为独立整理的视觉方案，与各品牌无隶属关系；详见 `design-systems/NOTICE.md`。

## [v0.3.3] - 2026-11-05

放大画布待机态，让顶部浮动动画更明显。详细说明见 [release-0.3.3.md](release/release-0.3.3.md)。

### 变更

- **待机态整体放大**：插画区 `168×116 → 260×180`、画板 SVG `120×84 → 180×126`；便签 `22px → 34px`、浮动幅度 `3px → 6px`；标题 `20px → 26px`；说明 `13px → 15px`、宽 `420 → 460`；键帽 `26px → 32px`、鼠标图标 `11×14 → 13×17`。
- 仅调整尺寸，结构与文案不变；无破坏性工具/接口变更。

## [v0.3.2] - 2026-11-05

新增画布待机态：空画布不再只是一张小插图，而是「顶部手绘动画 + 标题 + 说明 + 4 行快捷键说明」。详细说明见 [release-0.3.2.md](release/release-0.3.2.md)。

### 新增

- **画布待机态**：等原型出现前的空态改为手绘风待机态。顶部为手绘虚线画板（`#sketch` 抖动滤镜）+ 3 张便签小方片（琥珀/薄荷/天蓝）轻微浮动；标题与说明沿用原文案；下方新增 4 行快捷键说明（空格/中键拖拽·平移 · Ctrl+滚轮·缩放 · 滚轮·平移 · 点击·选中元素），配手绘键帽与纯 CSS 鼠标图标。
- 快捷键文案逐字沿用原左下角提示条，保证两处一致。

### 变更

- **空态时隐藏左下角 `.hint`**：与待机态里的 4 行快捷键重复，空态下只显示待机态；有页面节点后 `.hint` 自动恢复。

### 说明

- 顶部视觉为纯内联 SVG + CSS，无外部资源、无 video、无 emoji（画布 CSP 未放宽）。
- 动画仅用 `transform`/`opacity`，`prefers-reduced-motion` 下停止浮动；导出模式隐藏待机态。
- 无破坏性工具/接口变更；工具仍为 5 个。

## [v0.3.1] - 2026-11-05

合并两个社区修复 PR（#2、#3），修掉本地服务崩溃、项目文件被静默覆盖、画布编辑丢内容等问题。详细说明见 [release-0.3.1.md](release/release-0.3.1.md)。

### 修复

- **本地服务不再被打垮**：`/page/:id` 畸形百分号编码返回 400，`GET //` 返回 400，JSON `null` 等非对象请求体返回 400；`handleRequest` 加顶层兜底（服务端故障返回 500 且不泄露路径）。请求体超限先返回 413 再断连（修 Windows 上 RST 导致客户端读不到 413）。
- **`project.json` 不再被静默覆盖**：读取不改动磁盘；覆盖有问题的文件前先复制备份为 `project.json.corrupt-<时间戳>`；单个节点/连线无效时同样备份并提示，不再静默丢弃；画布界面与 `canvas_get_state` 会给出提示。
- **连线与选中校验**：`addEdge` 校验端点存在、拒绝自环；`/api/selection` 校验 `pageId`；旧版遗留的悬空连线/自环仍可删除。
- **改文案不再丢内容**：只允许改不含子元素的元素，输入框显示完整原文；含子元素的区块提示改用 Ctrl 点击具体文字。
- **回写源 HTML**：编辑改为由 `web/src/sourceEdit.ts` 用 `DOMParser` 修改源 HTML（不再序列化运行时 DOM，脚本生成内容不会重复、临时状态不被固化）；确认保存成功才更新预览；页面脚本无法伪造 `__vd_edit_applied` 改写原型。
- **节点高度不再失控**：探针只在页面加载完成时测量一次高度（不再监听 resize，避免 `100vh` 页面形成高度反馈循环）；节点不低于设计高度。
- **页面更新后自动刷新**：节点新增 `htmlRev`，写入新 HTML 时 iframe 重新加载；`/page/:id` 加 `Cache-Control: no-store`。
- **CSP 与文档一致**：文档改为要求原型自包含；`canvas_upsert_page` 检测到外链/相对路径时提示。

## [v0.3.0] - 2026-11-05

画布界面全面推翻重做：改为**手绘白板 / 便签风**并重排交互外壳。详细说明见 [release-0.3.0.md](release/release-0.3.0.md)。

### 变更

- **视觉**：奶油纸底 + 墨色 + 便签色，暖色强调 `#e07a3f` 取代原蓝色；直线网格改点阵纸；节点改为纸质卡片 + 手绘非对称圆角 + 胶带标题（按设备着色）；连线改墨色手绘（双 path 抖动 + 墨色箭头）；字体改系统手写体栈（无外链）。
- **结构**：新增顶栏（品牌/页面列表开关/适应视图/缩放百分比/导出）、左侧页面列表（点击定位）、右下角缩放控件、右键菜单（节点：重命名/复制/删除/置于顶层；空白：适应视图）；选中面板、节点工具栏、下拉菜单、空态、缩略图全部重绘。
- 交互语义不变（空格/中键平移、Ctrl+滚轮缩放、普通滚轮平移、12px 吸附）。

### 修复

- PNG 导出此前只按节点本体裁剪，悬于节点上方的标题栏被切掉；现在把标题栏一并纳入裁剪范围，导出包含标题与胶带。

### 说明

- 「置于顶层」为客户端行为，不写入项目数据，刷新后复位；导出模式隐藏全部新增外壳；无破坏性工具变更。

## [v0.2.5] - 2026-11-05

修复 PNG 导出在 Windows 上稳定失败（`Failed to launch the browser process: Code: 0`，stderr 为空）。详细说明见 [release-0.2.5.md](release/release-0.2.5.md)。

### 修复

- PNG 导出不再依赖 puppeteer 对 Chromium stdout 那一行 `DevTools listening on ws://…` 的等待——改为自己启动浏览器、读 `DevToolsActivePort` 拿调试端点再 `puppeteer.connect` 接入，宿主进程内拿不到该行也能正常导出。
- 启动失败时把浏览器 stderr 带进错误信息，不再出现「stderr 为空」这种无法诊断的失败。
- 失败路径强杀浏览器进程树（Windows `taskkill /T`），临时 profile 清理失败改为记日志，不再静默吞掉、不再堆积孤儿进程。
- 导出前清理超过 2 小时的陈旧 `tsc-png-*` 临时目录（旧版本失败遗留）。

## [v0.2.4] - 2026-11-05

选中面板可收起，不再常驻遮挡画布。详细说明见 [release-0.2.4.md](release/release-0.2.4.md)。

### 新增

- 选中面板头部新增「×」收起按钮：收起后缩为右上角浮动小标签「选中面板」，点击即可展开，已填写的文案/样式不丢失。
- 切换选中项时自动展开面板，避免收起后误以为点击元素无反应。

## [v0.2.3] - 2026-11-04

不再在工作区产生多余的原型文件夹。详细说明见 [release-0.2.3.md](release/release-0.2.3.md)。

### 修复

- 技能说明不再引导 AI 把原型先写成工作区里的 HTML 文件（如 `prototype/`、`design/`），改为直接用 `html` 内联传入 `canvas_upsert_page`；原型只存放在 `.tianshu-canvas/pages/`。
- `canvas_upsert_page` 的工具描述同步调整：`html` 为推荐方式，`html_path` 仅用于导入已有文件。
- README 使用步骤同步更新。

## [v0.2.2] - 2026-11-04

修复 PNG 导出偶发失败（Failed to launch the browser process / The browser is already running）。详细说明见 [release-0.2.2.md](release/release-0.2.2.md)。

### 修复

- PNG 导出串行排队：同一时刻只启动一个无头浏览器，避免并发导出互相争抢。
- 每次启动使用独立的临时 profile，启动失败自动清理并重试（最多 3 次）。
- 关闭浏览器加 10 秒超时，超时后强杀进程并清理 profile，不再留下孤儿 Edge/Chrome 进程。
- 修复 PNG 文件名与实际路径可能不一致的问题（原先跨秒时会两次取时间戳）。

## [v0.2.1] - 2026-11-04

修复画布节点标题栏被页面内容遮挡。详细说明见 [release-0.2.1.md](release/release-0.2.1.md)。

### 修复

- 节点标题栏改为悬于节点上方、不参与布局：高度不再被 flex 压缩（原来 28px 被压到约 21px），
  也不会被 iframe 内容区覆盖；任何缩放下都恒为 28px 屏幕高度。
- 标题栏与节点工具栏间距改为随缩放反算，避免低缩放下工具栏压住标题栏。
- e2e 测试新增标题栏几何断言（高度 28px、不被 iframe 覆盖）防止回归。

## [v0.2.0] - 2026-11-04

工具精简：10 个工具合并为 5 个，业务能力不变。详细说明见 [release-0.2.0.md](release/release-0.2.0.md)。

### 变更（破坏性）

- 工具由 10 个精简为 5 个：`canvas_open`、`canvas_upsert_page`、`canvas_get_state`、`canvas_arrange`、`canvas_export`。
- `canvas_add_page` / `canvas_rename_page` / `canvas_move_page` 合并为 `canvas_upsert_page`：已有 id 可省略 html，仅更新标题/位置/尺寸/设备；未指定的字段保持原值。
- `canvas_list_pages` / `canvas_get_selection` 合并为 `canvas_get_state`：一次返回页面、连线、选中项和画布 URL。
- `canvas_remove_page` / `canvas_duplicate_page` / `canvas_link_pages` 合并为 `canvas_arrange`（`action`: remove / duplicate / link / unlink）。
- 旧工具名不再保留，升级后需新建会话。

### 工程

- 测试同步改用新工具名；新增 upsert 仅改元数据（HTML 与尺寸不被重置）、arrange 各 action 及错误路径的覆盖；共 5 个工具握手一致。

## [v0.1.2] - 2026-11-04

画布交互闭环：选中反馈 + 可视化编辑 + 编排 + 导出。详细说明见 [release-0.1.2.md](release/release-0.1.2.md)。

### 新增

- **选中元素 → 加入对话**：iframe 探针支持两层选择（无修饰键=区块，Ctrl/meta=最内层元素）、
  悬停高亮、滚轮转发；选中经 `/api/selection` 落盘，AI 用 `canvas_get_selection` 读取；
  面板提供「复制修改请求」。
- **可视化编辑**：选中元素后可改文案与样式（颜色/字号/内边距/圆角等），回写原型 HTML（剥离探针痕迹）。
- **画布编排**：节点重命名/复制/删除（含工具栏）、页面连线；工具
  `canvas_remove_page`/`canvas_rename_page`/`canvas_duplicate_page`/`canvas_move_page`/`canvas_link_pages`。
- **导出交付**：整块画布截图 PNG（无头浏览器）+ 原型打包 ZIP（含 index.html 画廊）；
  工具 `canvas_export`。

### 工程

- 探针注入 `/page/:id`；新增路由 `/api/selection`、`/api/page-html`、`/api/nodes`、`/api/edges`、`/api/export`、`/api/export-file`；SSE 增 `selection` 事件。
- `puppeteer-core` 移入 `dependencies`，esbuild `external`。
- 测试：新增 selection、export、probe.e2e（真实浏览器两层选择 + UI 编辑回写）；共 10 个工具握手一致。

## [v0.1.1] - 2026-11-04

修复工作流顺序：先启动画布、给用户链接，再做原型设计。详细说明见 [release-0.1.1.md](release/release-0.1.1.md)。

### 修复

- 技能说明强制「第一步调用 `canvas_open`」：未拿到链接前不得开始原型/写入画布。
- `canvas_add_page` 自动确保画布服务在运行，返回里必带可点击的画布 URL。
- 工具描述补充顺序提示。

## [v0.1.0] - 2026-11-04

首个版本：无限画布设计工作台。详细说明见 [release-0.1.0.md](release/release-0.1.0.md)。

### 新增

- 无限画布（基于 React Flow）：空格/中键拖拽平移、Ctrl+滚轮缩放、普通滚轮平移、12px 网格吸附、右下角 MiniMap。
- `canvas_open`：启动/复用本工作区的本地画布服务，返回可在浏览器打开的 URL。
- `canvas_add_page`：把 HTML 原型作为页面节点加入画布，节点内以沙箱 iframe 渲染。
- `canvas_list_pages`：列出画布上已有的页面节点。
- 实时刷新：项目变更经 SSE 推送到浏览器自动刷新。
- 项目存储：工作区 `<cwd>/.tianshu-canvas/`（`project.json` + `pages/*.html`），原子写。

### 工程

- TypeScript（Node 侧 + React 侧），esbuild 打包，构建产物 `dist/` 提交进仓库。
- `node:test` 测试：契约（握手一致）、项目模型、本地服务。
- CI（typecheck + build + dist 一致性 + test）与 Release（tag 触发）工作流。
