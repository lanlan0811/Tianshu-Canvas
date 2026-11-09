<img src="assets/banner.png" alt="Tianshu-Canvas — 让 AI 拥有一个可视化的前端设计工作台" width="100%">

<p align="center">
  <a href="https://github.com/lanlan0811/Tianshu-Canvas/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/lanlan0811/Tianshu-Canvas/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D24.22.1%20%3C27-339933?logo=node.js&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black">
  <img alt="React Flow" src="https://img.shields.io/badge/React%20Flow-12-FF0072?logo=reactflow&logoColor=white">
  <img alt="esbuild" src="https://img.shields.io/badge/esbuild-0.24-FFCF00?logo=esbuild&logoColor=black">
  <img alt="license" src="https://img.shields.io/badge/license-Apache--2.0-blue">
</p>

# Tianshu-Canvas · 画布设计

天枢（Tianshu）插件：把**前端设计原型**写入一块可平移缩放的**无限画布**。
每个原型是一个画布节点，节点内以 iframe 渲染真实 HTML；画布在浏览器中打开。

> 画布内核为 [React Flow](https://github.com/xyflow/xyflow)（`@xyflow/react`，MIT）。

> **Tianshu-Canvas 官网**：<https://tianshu-canvas.lanaiw.top>

## 安装

插件通过天枢「插件中心 → 社区插件 → 从其他来源安装」安装，支持两种方式：

| 方式 | 操作 |
|---|---|
| **Git URL** | 填本仓库地址（可选分支/标签）→「读取清单并审阅」→ 确认安装 |
| **本地路径** | 填本仓库根目录的**绝对路径** → 审阅 → 安装 |

> **要求**：仓库根目录就是插件根（`tianshu.plugin.json` 在根目录）。
> 安装后需**新建会话**才生效。

> 天枢 Harness 官方仓库：<https://github.com/huiliyi37/Tianshu-harness>

## 如何使用 Tianshu-Canvas

不用记工具名，直接用自然语言提需求即可。下面是几组可直接复制粘贴的示例，
覆盖「从零开始」「锁定风格」「改稿」「批注」「编排」「自定义设计系统」几条主线。

**1. 需求未知时 —— 会先问你要哪种风格**

```
帮我做一套 SaaS 后台的页面原型：一个数据看板、一个用户列表页，
数据用假数据即可，要能直接在画布上看到效果。
```

没有提任何配色/风格线索时，天枢会先 `canvas_open` 给出画布链接，再用
`canvas_style`（`list`）问你：「这次用哪种风格？A 苹果风 B 谷歌风 C Claude 风
D 天枢原创 E 自由发挥」，选定后才开始写页面。

**2. 需求明确时 —— 不问风格，直接锁定**

```
帮我做一套 SaaS 后台的页面原型：数据看板 + 用户列表页。
风格走苹果风，主色用系统蓝 #0071e3，整体克制留白，数据用假数据。
```

已经指定风格与主色时不追问，直接 `canvas_style`（`set`）锁定 `apple` 后开始写；
产出使用 `--ts-*` 变量而非裸色值。

**3. 风格自检 —— 能不能抓出违规**

```
做一页定价页，故意在标题和按钮里各写一个裸色值 #ff0000，
做完后用 canvas_check_style 检查能不能抓出来。
```

预期：`canvas_check_style` 精确命中这 2 处裸色值（带行号），不误报正常的 token 使用。

**4. 定点改稿 —— 只改一处，不动全身**

```
先做一个个人博客文章详情页。做完后，只把正文里第一个小标题的
字号调大、颜色换一个更深的，别动其他任何地方。
```

预期：用元素选中 + 面板编辑把修改**写回原型源文件**，只改那一个元素，其余不变。

**5. 批注闭环 —— 定位准、改得对、能销账**

```
【先手动】在画布上 Ctrl 点击某个按钮，写批注「按钮太小、文案太啰嗦」。
然后让天枢读批注并逐条修改。
```

预期：`canvas_comments`（`list`）列出待办（含 xpath 与原文案）→ 按 xpath 定位修改 →
`resolve` 标记已解决、图钉消失。

**6. 编排 —— 把页面关系画出来**

```
做三个页面：商品列表 → 商品详情 → 结算页。
然后把它们按流转顺序连起来，连线上标出动作名。
```

预期：三节点自动排布不重叠，连线方向正确、带标签；`canvas_get_state` 能读回连线。

**7. 自定义设计系统 · 反抽取 —— 观测不掺假**

```
从我这个登录页里把配色和字体反抽成一套自定义设计系统，
先 dry_run 预览，我要看哪些是观测到的、哪些是推断的。
```

预期：`canvas_design_system`（`extract`）返回观测/推断计数与逐组来源；观测到的品牌色
应等于页面真实颜色，而不是拿默认种子冒充。

**8. 自定义设计系统 · 仓库导入 —— 读真仓库，不套默认**

```
我这个仓库有一套 shadcn 主题，帮我导入成设计系统，再按它做一页。
```

预期：自动探测到 `shadcn`，读 `globals.css` 的 `:root` 变量（兼容 `oklch()` 与旧版
裸三元组），归一化为 `#hex`；找不到的项明确标注为推断，不假装是仓库原值。

## 使用

在对话里让天枢做前端设计，或直接调用工具：

1. `canvas_open` — 启动/复用本地画布服务，返回浏览器 URL（用浏览器打开）。
2. 让天枢生成原型 HTML，并直接内联传给 `canvas_upsert_page`（只存放在 `.tianshu-canvas/pages/`，不会在工作区产生其他文件夹）。
3. `canvas_upsert_page` — 新增或更新页面节点（`html_path` 或 `html`，可选 `title` / `device_type`；对已有 `id` 可省略 html，仅改标题/位置/尺寸）。
4. `canvas_get_state` — 读取页面节点、连线、当前选中项与画布 URL。

> **原型必须自包含**：画布 CSP 会拦截外链（CDN、字体、图片）和相对路径，资源请内联。`canvas_upsert_page` 检测到这类引用时会提示。
>
> 需要真实图片/字体时，可传 `inline_assets=true`（+ `inline_assets_origin` 解析相对路径），
> 工具会抓取这些资源并内联为 `data:` URI。默认关闭，仅在显式传参时触发。

### 设计风格

项目可锁定一套**设计风格**，让所有页面视觉统一；未锁定时为「自由发挥」。

- 内置 11 套风格可供选择，也可在画布顶栏直接切换：
  苹果风、谷歌风、Claude 风、天枢原创（宣纸青绿）、芭比风、NERV 风（深色）、极简风，
  以及四套原创风格：天枢·砚（石墨纸 + 朱砂，含深色）、天枢·雾（雾蓝 + 靛紫，含深色）、
  天枢·麦（麦纸 + 藏红花）、天枢·霞光（岚蓝 + 樱粉）。
- `canvas_style` — `list` 列出可选风格、`get` 查看 token/组件类/图标/交互清单、`set` 锁定/切换/解绑、
  `template` 取页面骨架 HTML、`interaction` 取交互模式骨架。
- `canvas_check_style` — 只读检查页面是否符合当前风格（裸色值、越界间距、目录外图标等），只报告不阻塞。
- 锁定后写入页面时，工具会**自动内联** token 与组件样式，并把 `<svg data-icon="名字">` 展开为当前风格的内联 SVG。
- 风格数据说明与无隶属声明见 [`design-systems/`](design-systems/README.md)。

### 交互库

页面内交互（tab / 弹窗 / 抽屉 / 下拉 / 折叠面板 / 轻提示 / 骨架屏 / 进度条 / 表单校验 / 分段控件 /
开关 / 步骤条 / 分页 / 可排序表格 / 日期选择 / 提示气泡 / 滚动进度 / 吸顶头部 / 视口渐显 / 倾斜卡片 /
移动端菜单 / 代码复制 / 大纲侧栏，共 23 种）用**声明式标记**（`data-ts-*` + `ts-*` 类）
声明，**不需要手写交互 JS**：写入时工具会按「页面是否用到」自动注入共享样式与**单一共享运行时**，
并随设计系统注入块一起幂等剥离。运行时遵守画布沙箱：不发起网络请求、不读写本地存储。

### 多页前端

页面之间可用**真实链接**互跳（`<a href="page-xxxx.html">` / `<a data-nav="page-xxxx">` / `<a href="标题.html">`）。
画布上点击链接会选中并定位到目标页面节点；写入时链接会被规范化成目标页面 id（换标题 slug 也可，
重名会报错；目标页稍后创建会自动补齐）。用户在画布顶栏「导出」时，这些页面会被打成**一套可直接打开的多页站**：
`index.html` 导航首页 + `pages/*.html` 真实互链 + 共享 `assets/*.css`（旧 iframe 画廊保留为 `overview.html`）。

#### 自定义设计系统

想要内置风格之外的专属视觉时，可用**自定义设计系统**：AI 会先问清配色与配置，再生成一套只属于当前工作区的风格。

- `canvas_design_system` — `create` 创建（传完整 token）、`extract` **从现有 HTML/CSS/URL 反抽取**、`import` **从仓库现有 shadcn/Tailwind 或 AntD 主题导入**、`export` / `import_pack` **品牌包导出/导入**、`list` 列出、`get` 查看、`remove` 删除；创建后默认锁定为当前项目风格。
- 存于 `.tianshu-canvas/library/<id>/`，**仅当前项目生效**（随项目数据一起被 gitignore，不随仓库分发）。
- **只能改 token**：组件类（`ts-*`）与图标为共享资源，不支持扩展；变量名须与内置风格一致，值自由。
- **浅色 + 深色两套**：深色在页面根元素加 `class="dark"` 即切换。
- 创建时会校验对比度（浅色与深色各一遍）、尺度递增与变量覆盖，不通过返回逐条错误。
- **反抽取**（`action=extract`）：`source`（内联 HTML/CSS）/ `path`（工作区内文件）/ `url`（远程页面）；
  建议先 `dry_run=true` 预览，返回里区分「观测 / 推断」。确定性输出，一次通过校验。
- **从仓库导入**（`action=import`）：自动探测技术栈（`stack=shadcn|antd` 可显式指定）。
  shadcn 读 CSS 变量（`oklch()` / 旧版裸三元组）或 `tailwind.config.*`；AntD 读 `ConfigProvider theme.token` 字面量，
  找不到时明说用的是默认种子 token。颜色统一归一化为 `#hex` 后过同一套 token 契约校验。

#### 品牌记忆与品牌包

- 每次反抽取、导入、导出代码都会在 `.tianshu-canvas/memory/brand.json` 累加使用记忆（常用组件/图标/变量、反复命中的审计规则）；
  `canvas_design_system`（`action=get`）与 `canvas_get_state` 会展示摘要。记忆是缓存，损坏会静默重建。
- `action=export` 导出**可移植品牌包**（单 JSON：tokens + meta + 使用记忆 + checksum，无时间戳、可复现）；
  `action=import_pack` 导入时校验 checksum 与 token 契约，重名默认拒绝（`overwrite=true` 才覆盖），导入后自动锁定。

### Design CI（`canvas_audit`）

交付前把「这套设计能不能进生产」变成可执行的检查：

| action | 作用 | 需要浏览器 |
|---|---|---|
| `contract` | 源码级设计契约：token 使用、裸色值、间距越界、图标来源、组件类；可落盘可独立运行的 `*.audit.test.mjs` | 否 |
| `a11y` | 可访问性：对比度（向上追溯真实背景）、可访问名、表单标签、焦点可见性、目标尺寸、标题层级、`lang` | 是 |
| `baseline` / `visual` | 视觉回归：逐页截图基线，与当前逐像素比较，输出偏离度分数与变化区域 bbox | 是 |
| `drift` | 设计漂移：与上次快照比较，输出新增 / 移除 / 未使用 / 越界四类差集 | 否 |

视觉基线默认在 `.tianshu-canvas/audit/baseline`（被 gitignore）；团队要共享基线时传 `baseline_dir` 指到仓库内可提交目录。

**画布操作**：空格/中键拖拽平移 · Ctrl+滚轮缩放 · 普通滚轮平移 · 顶栏缩放百分比 · 右下角缩略图（MiniMap）。
界面为手绘白板/便签风：顶栏含品牌与导出，左侧页面列表点击定位，右下角缩放控件，节点右键菜单（预览/预览设备/重命名/复制/删除/置于顶层）。

### 画布内预览

页面节点右键「**预览**」即可在画布内打开全屏可交互预览：按钮、tab、弹窗、滚动都按原型真实行为生效，
点击不再选中元素。右键「**预览设备**」可选 **网页 / 平板 / 手机 / 自定义** 四种视口：

- 顶栏左侧下拉切换预览页面；中间图标切换设备；「自定义」时可直接输入 `W` / `H`（1–10000），
  也可拖拽预览右侧竖条、底部横条伸长/缩短；右侧「退出预览」（`Esc` 同样退出）。
- 右下角缩放：适应窗口 / 50% / 75% / 100% / 125% / 150% / 200%；平板与手机会显示设备外框。
- 预览内点站内链接在当前预览层内切页（设备与缩放保持）；外链被拦截并提示。
- 预览设备只影响预览视口，**不修改**节点尺寸 / 设备类型，也不写入项目文件；预览没有对应的 AI 工具，纯用户在画布上操作。

### 迭代与交付

- **选中反馈**：在画布上点击页面/元素（Ctrl 点击选最内层），用 `canvas_get_state` 读回；
  或点面板「复制修改请求」粘给 AI。
- **元素批注**：选中元素后在面板写一句话即可打图钉（元素左上角显示编号、节点标题栏显示「批注 N」），
  存在 `project.json` 的 `comments[]`；AI 用 `canvas_comments`（`action`: list / resolve / reopen / remove）
  一次读回全部待处理批注，逐条改完后标记已解决。面板不提供元素级文案/样式编辑——修改统一以批注表达，
  由 AI 回写原型；面板可用头部「×」收起为右上角小标签，点击再展开。
- **编排**：节点工具栏重命名/复制/删除；页面间连线。AI 侧用 `canvas_arrange`（`action`: remove / duplicate / link / unlink）。
- **导出**：在画布顶栏点「导出」自行产出画布截图 PNG 与/或原型打包 ZIP。导出只由用户在画布上操作，**没有对应的 AI 工具**。
- **导出生产代码**：`canvas_style`（`action=codegen`）把设计转成可交付代码。**会先问你目标**：React + TSX / CSS 变量 + 无框架 HTML / Tailwind / 直接进现有代码库（shadcn / Ant Design），或多端（iOS / Android / 小程序，需再选技术栈）。
  - Web 目标是确定性转换；`shadcn` / `antd` 会按真实组件 props 生成（`@/components/ui/*`、`ConfigProvider` 主题），并在 CI 里用声明桩 + `tsc` 验收。
  - 多端产出**主题/Token 文件 + `design-spec.md` 规格清单**，页面代码由 AI 按规格编写（HTML→原生有损，不宣称像素级还原）。
  - 默认直接返回文件内容；传 `write_files=true` / `out_dir` 落到 `.tianshu-canvas/exports/`。

> PNG 导出需系统安装 Chrome/Edge；可用 `TIANSHU_CANVAS_BROWSER` 指定路径。ZIP 不依赖浏览器。
> 截图与视觉回归**保留 Chromium 进程沙箱**（不传 `--no-sandbox`）。若所在环境确实无法启动沙箱，
> 导出会**明确报错并停止**，而不是静默降级为无沙箱；仅在此类受限环境可用
> `TIANSHU_CANVAS_ALLOW_NO_SANDBOX=1` 显式放开。

## 数据用途与外部访问

**本插件不上报任何遥测、统计数据或崩溃信息**，不连接插件作者的任何服务器；
除下述两类显式触发的抓取外，不产生任何出站网络请求。

### 会访问外部 URL 的两处功能

| 功能 | 触发条件 | 抓取目标 | 随请求发出的数据 |
|---|---|---|---|
| **资源内联**（`canvas_upsert_page` 的 `inline_assets=true`） | 仅当显式传参时 | 页面 HTML 里的外链资源（`<img>` / `<script src>` / `<link rel=stylesheet>` / CSS 与 `style` 里的 `url()`）；相对路径按 `inline_assets_origin` 解析 | 仅 HTTP GET 目标 URL（**含其路径与查询参数**）+ 固定 `User-Agent: tianshu-canvas`；不发送页面内容、项目数据或任何凭据 |
| **设计系统反抽取**（`canvas_design_system`，`action=extract` 且来源为 URL） | 仅当用户把 URL 作为抽取源时 | **不止一个 URL**：先取用户给出的那个页面，再取该页面里 `<link rel=stylesheet>` 引用的**最多 3 个外部样式表**（相对路径按页面 URL 解析）。这些样式表**可以位于其它主机**（例如 CDN 域名） | 同上：每个请求只发 GET 目标 URL（含路径与查询参数）+ 固定 UA |

两个功能都**跟随重定向**（最多 3 跳），每一跳的目标主机都可能与上一跳不同，
且**每一跳都会重新执行下面的 SSRF 校验**。

抓取前会做 SSRF 校验：仅允许 http/https、拒绝内网/回环/链路本地地址及其映射形式
（含 `::ffff:` 十六进制与点分两种写法、NAT64、6to4、Teredo 等），逐跳重定向重新校验，
并把连接固定到已核验的 IP，防 DNS rebinding。

> **不要把敏感信息放进 URL**：HTTP 请求会把目标 URL 的**路径与查询参数**原样发给目标主机
> （这是 HTTP 协议本身的行为），因此这些内容必须视为已对外披露——令牌、密钥、隐私数据不要写进
> 被抽取或被内联的 URL。
>
> **与遥测的区别**：上表是「用户显式要求抓取某个 URL」时的正常网络行为，起始目标由用户
> 输入决定；本插件**没有**任何后台遥测/心跳/更新检查。字体或图片等**相对路径**资源在内联时
> 会按 `inline_assets_origin` 解析，请勿把该参数指向非预期站点。

## 项目数据

存于工作区内，可版本化：

```
<cwd>/.tianshu-canvas/
├── project.json          画布模型（节点/视口/风格锁定/元素批注）
├── pages/<id>.html       每个页面的原型 HTML
├── library/<id>/         自定义设计系统（tokens.json + meta.json，可选）
├── memory/brand.json     品牌记忆（使用统计 + 审计命中，缓存性质）
└── audit/                设计快照与视觉基线（baseline 可指定到仓库内目录）
```

上述所有读写都限定在工作区内：路径按真实路径解析，任一级父目录或目标文件若是指向工作区外的
符号链接 / Windows 目录联接，一律拒绝；写入用独占创建的随机临时文件 + rename，防止校验后被替换。

## 开发

```bash
npm install
npm run verify                # typecheck + build + notices + test
npm run notices               # 重新生成 THIRD-PARTY-NOTICES.md（随发行 ZIP 提交）
npm run notices:check         # 校验第三方许可声明与当前依赖一致（CI 用）
npm run verify:codegen        # 适配器产物编译验收（声明桩 + tsc，离线）
npm run verify:codegen:real   # 发版前：真实 npm install + tsc（需联网）
npm run check:plugin          # 官方发行约束自检（清单/入口/握手/路径/体积）
```

- **技术栈**：TypeScript（Node 侧 + React 侧），esbuild 打包。
- **构建产物 `dist/` 必须提交进仓库**：天枢安装插件时只跑
  `npm install --ignore-scripts --omit=dev`，**不会执行构建脚本**，因此
  `dist/`（`entry` 指向 `dist/index.mjs`）必须随仓库分发。CI 会用
  `git diff --exit-code -- dist` 校验产物与源码一致。
- **Node 侧是单文件 bundle**：`src/server.ts` 是模块级单例，多文件会产生重复单例。

### 发行打包（天枢插件库）

官方发行包不允许依赖目录、运行时安装、包脚本和锁文件，所以 **不能直接打包仓库根目录**。
`puppeteer-core` 已内联进 `dist/index.mjs`，运行时节点侧零依赖。

```bash
npm run build
node scripts/pack-plugin.mjs ./tianshu-canvas-0.7.0.zip \
  --release-id rel_tianshu_canvas_070 --publisher-id <发布者 ID> \
  --source-commit "$(git rev-parse HEAD)" --platforms win32-x64
```

打包器只收 `tianshu.plugin.json`、`dist/`、`skills/`、`LICENSE`、`THIRD-PARTY-NOTICES.md`，并生成
`xiaosi.release.json` 与 `xiaosi.contents.json`。打包前请确认 `npm run notices` 已执行
（`npm run verify` 会自动带上），该文件列出所有实际内联进 `dist/` 的第三方组件及其许可全文。
若本地有官方开发套件，可再复核一次：

```bash
node ".claude/天枢插件开发指南(天枢harness官方版)/cli.mjs" validate ./tianshu-canvas-0.7.0.zip --lane official_reviewed
```

### 目录

```
src/             Node 侧（入口/工具/本地服务/项目模型/设计系统/校验/探针/导出/抓取/内联/反抽取/代码生成/审计）→ dist/index.mjs
  host.ts          宿主桥（host.log / isWorker）
  netFetch.ts      SSRF 安全抓取（内联与反抽取共用）
  inlineAssets.ts  资源内联为 data: URI
  extract.ts       设计系统反抽取
  htmlTree.ts      轻量 HTML 树解析（适配器与审计共用）
  adapters/        真实代码库适配器（shadcn/Tailwind、Ant Design）
  audit/           Design CI（契约 / a11y / PNG diff / 视觉回归 / 漂移）
  brand.ts         品牌记忆与可移植品牌包
  nav.ts           页面间跳转解析与写入时规范化
  site.ts          多页静态站组装（导航首页 + 共享资源标签）
  codegen*.ts      React/TSX、CSS 变量、Tailwind、多端主题与规格
web/             画布前端（React + React Flow）→ dist/web/canvas.js
design-systems/  设计系统源数据（风格 token / 组件 / 图标 / 模板 / 交互库）→ dist/design/
assets/          应用图标与横幅（icon.png 透明底源图 + icon-512.png 展示版 + banner.png 头图）
dist/            构建产物（提交进仓库）
test/            契约 / 项目 / 服务 / 设计系统 / 选中 / 导出 / 抓取 / 内联 / 反抽取 / 代码生成 / 适配器 / 审计 / 品牌 / 探针 e2e 测试（node:test，跑构建产物）
scripts/         build.mjs、build-design.mjs、check-plugin.mjs、pack-plugin.mjs、verify-web.mjs、verify-codegen*.mjs、extract-release-notes.mjs
release/         每个版本的发布详情文档（release-<版本>.md）
```

### 端到端验证（真实浏览器）

```bash
npm run build
node scripts/verify-web.mjs            # 自动探测 Chrome/Edge
node scripts/verify-web.mjs <chrome.exe>
```

用无头浏览器打开画布，断言 React Flow 真正渲染、节点出现、iframe 指向原型页、无 JS 报错。

## 许可

Apache License 2.0（见 [LICENSE](LICENSE)）。

发行包内联了若干第三方组件（画布内核 [React Flow](https://github.com/xyflow/xyflow) / `@xyflow/react`（MIT）、
`react` / `react-dom`（MIT）、`puppeteer-core` 与 `chromium-bidi`（Apache-2.0）、`ws`（MIT）等）。
完整清单与各组件许可全文见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)，随发行 ZIP 一并分发；
该文件由 `npm run notices` 依据实际打包产物生成，不是手工清单。
