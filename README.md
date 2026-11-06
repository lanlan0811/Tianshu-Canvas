# Tianshu-Canvas · 画布设计

天枢（Tianshu）插件：把**前端设计原型**写入一块可平移缩放的**无限画布**。
每个原型是一个画布节点，节点内以 iframe 渲染真实 HTML；画布在浏览器中打开。

> 画布内核为 [React Flow](https://github.com/xyflow/xyflow)（`@xyflow/react`，MIT）。

## 安装

插件通过天枢「插件中心 → 社区插件 → 从其他来源安装」安装，支持两种方式：

| 方式 | 操作 |
|---|---|
| **Git URL** | 填本仓库地址（可选分支/标签）→「读取清单并审阅」→ 确认安装 |
| **本地路径** | 填本仓库根目录的**绝对路径** → 审阅 → 安装 |

> **要求**：仓库根目录就是插件根（`tianshu.plugin.json` 在根目录）。
> 安装后需**新建会话**才生效。

## 使用

在对话里让天枢做前端设计，或直接调用工具：

1. `canvas_open` — 启动/复用本地画布服务，返回浏览器 URL（用浏览器打开）。
2. 让天枢生成原型 HTML，并直接内联传给 `canvas_upsert_page`（只存放在 `.tianshu-canvas/pages/`，不会在工作区产生其他文件夹）。
3. `canvas_upsert_page` — 新增或更新页面节点（`html_path` 或 `html`，可选 `title` / `device_type`；对已有 `id` 可省略 html，仅改标题/位置/尺寸）。
4. `canvas_get_state` — 读取页面节点、连线、当前选中项与画布 URL。

> **原型必须自包含**：画布 CSP 会拦截外链（CDN、字体、图片）和相对路径，资源请内联。`canvas_upsert_page` 检测到这类引用时会提示。

### 设计风格

项目可锁定一套**设计风格**，让所有页面视觉统一；未锁定时为「自由发挥」。

- 内置 7 套风格可供选择，也可在画布顶栏直接切换：
  苹果风、谷歌风、Claude 风、天枢原创（宣纸青绿）、芭比风、NERV 风（深色）、极简风。
- `canvas_style` — `list` 列出可选风格、`get` 查看 token 与组件类、`set` 锁定/切换/解绑、`template` 取页面骨架 HTML。
- `canvas_check_style` — 只读检查页面是否符合当前风格（裸色值、越界间距、目录外图标等），只报告不阻塞。
- 锁定后写入页面时，工具会**自动内联** token 与组件样式，并把 `<svg data-icon="名字">` 展开为当前风格的内联 SVG。
- 风格数据说明与无隶属声明见 [`design-systems/`](design-systems/README.md)。

#### 自定义设计系统

想要内置风格之外的专属视觉时，可用**自定义设计系统**：AI 会先问清配色与配置，再生成一套只属于当前工作区的风格。

- `canvas_design_system` — `create` 创建（传完整 token）、`list` 列出、`get` 查看、`remove` 删除；创建后默认锁定为当前项目风格。
- 存于 `.tianshu-canvas/library/<id>/`，**仅当前项目生效**（随项目数据一起被 gitignore，不随仓库分发）。
- **只能改 token**：组件类（`ts-*`）与图标为共享资源，不支持扩展；变量名须与内置风格一致，值自由。
- **浅色 + 深色两套**：深色在页面根元素加 `class="dark"` 即切换。
- 创建时会校验对比度（浅色与深色各一遍）、尺度递增与变量覆盖，不通过返回逐条错误。

**画布操作**：空格/中键拖拽平移 · Ctrl+滚轮缩放 · 普通滚轮平移 · 顶栏缩放百分比 · 右下角缩略图（MiniMap）。
界面为手绘白板/便签风：顶栏含品牌与导出，左侧页面列表点击定位，右下角缩放控件，节点右键菜单（重命名/复制/删除/置于顶层）。

### 迭代与交付

- **选中反馈**：在画布上点击页面/元素（Ctrl 点击选最内层），用 `canvas_get_state` 读回；
  或点面板「复制修改请求」粘给 AI。
- **可视化编辑**：选中元素后直接改样式，不含子元素的元素还可改文案，修改回写到原型源文件（脚本生成的元素无法回写，会提示交给 AI）；面板可用头部「×」收起为右上角小标签，点击再展开。
- **编排**：节点工具栏重命名/复制/删除；页面间连线。AI 侧用 `canvas_arrange`（`action`: remove / duplicate / link / unlink）。
- **导出**：`canvas_export` 产出画布截图 PNG 与/或原型打包 ZIP。

> PNG 导出需系统安装 Chrome/Edge；可用 `TIANSHU_CANVAS_BROWSER` 指定路径。ZIP 不依赖浏览器。

## 项目数据

存于工作区内，可版本化：

```
<cwd>/.tianshu-canvas/
├── project.json          画布模型（节点/视口/风格锁定）
├── pages/<id>.html       每个页面的原型 HTML
└── library/<id>/         自定义设计系统（tokens.json + meta.json，可选）
```

## 开发

```bash
npm install
npm run verify   # typecheck + build + test
```

- **技术栈**：TypeScript（Node 侧 + React 侧），esbuild 打包。
- **构建产物 `dist/` 必须提交进仓库**：天枢安装插件时只跑
  `npm install --ignore-scripts --omit=dev`，**不会执行构建脚本**，因此
  `dist/`（`entry` 指向 `dist/index.js`）必须随仓库分发。CI 会用
  `git diff --exit-code -- dist` 校验产物与源码一致。
- **Node 侧是单文件 bundle**：`src/server.ts` 是模块级单例，多文件会产生重复单例。

### 目录

```
src/             Node 侧（入口/工具/本地服务/项目模型/设计系统/校验/探针/导出）→ dist/index.js
web/             画布前端（React + React Flow）→ dist/web/canvas.js
design-systems/  设计系统源数据（风格 token / 组件 / 图标 / 模板）→ dist/design/
dist/            构建产物（提交进仓库）
test/            契约 / 项目 / 服务 / 设计系统 / 选中 / 导出 / 探针 e2e 测试（node:test，跑构建产物）
scripts/         build.mjs、build-design.mjs、lib/、verify-web.mjs、extract-release-notes.mjs
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
