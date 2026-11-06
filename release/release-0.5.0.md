# v0.5.0 发布说明

三个新能力：**真实资源内联**、**设计系统反抽取**、**导出生产代码（Web + 多端）**。

工具名**不变**（仍 8 个）——新能力以参数 / `action` 的形式并入现有工具，安装后**新建会话**才生效。

---

## 1. 真实资源内联 · `canvas_upsert_page` 的 `inline_assets`

原型里外链（CDN 字体/图片）与相对路径都会被画布 CSP 拦截，一直加载不到。现在可以把它们**抓取并内联**为 `data:` URI。

| 参数 | 说明 |
|---|---|
| `inline_assets` | 布尔，**默认 false**；只有显式传 `true` 才触发 |
| `inline_assets_origin` | 可选：解析相对路径的基准地址（如 `https://example.com/page`） |
| `inline_assets_max_kb` | 可选：单资源体积上限（KB，默认 2048，硬顶 5120） |

- 处理对象：`<img>`、CSS / `style=` 里的 `url()`、`@font-face`、`<script src>`、`<link rel=stylesheet>`（递归内联其 `url()`）。
- 内联脚本/样式会正确转义 `</script` / `</style>`，不会破坏宿主标签。
- `iframe / video / audio / source / embed / object` **不处理**（体积与语义风险），保留原引用并说明。
- 抓取失败、超限或相对路径缺 `origin` 时：**保留原引用 + 返回里说明原因**，不会静默丢弃。
- 返回含「已内联 N 项 / 跳过 M 项（附原因）」。

> 开启前请确认来源可信：插件会真的发起网络请求。相对路径资源来自 `origin` 指定的站点。

## 2. 设计系统反抽取 · `canvas_design_system` 的 `action=extract`

用户说「照这个站点的风格做」「用这个页面的配色」时的能力：**从现有 HTML/CSS（或一个 URL）反推出一套设计系统**。

- 来源三选一（至少给一个）：`source`（内联 HTML/CSS）、`path`（工作区内 `.html`/`.css`）、`url`（远程页面，仅 http/https，**SSRF 防护：禁内网/回环/链路本地**）。
- 建议先 `dry_run=true`：返回**摘要**（观测 N 项 / 推断 M 项）+ 完整 tokens，**不落盘**；确认后去掉 `dry_run` 再执行。
- 产出**一次通过严格契约校验**（对比度、尺度递增、变量覆盖全部内置变量），随后创建并默认锁定为当前项目风格。
- **确定性**：同一份输入永远产出同一套 tokens（便于复现与回归）。
- 所有色值来源标 `observed` 或 `synthesized`，如实上报；低对比配色会被后处理到达标。

## 3. 导出生产代码 · `canvas_style` 的 `action=codegen`

**必须先问用户要哪种目标**（技能里是硬约束），不要自行假定。

| `target` | 产物 |
|---|---|
| `react` | HTML→JSX 组件（`class→className`、`style` 字符串→对象、void 自闭合、SVG 属性驼峰） |
| `css-vars` | `index.html` + `tokens.css` + `components.css`（`--ts-*` 变量） |
| `tailwind` | `tailwind.config.js`（colors/fontFamily/fontSize/spacing/borderRadius/boxShadow） |
| `ios` / `android` / `miniprogram` | **主题/Token 文件 + `design-spec.md` 规格清单** |

多端需再问技术栈并传 `stack`：

- iOS：`swiftui`（`DesignTokens.swift`）/ `uikit`（`DesignTokens.h/.m`）
- Android：`compose`（`Theme.kt`/`Color.kt`/`Type.kt`）/ `xml`（`res/values/*.xml`）
- 小程序：`weapp`（`app.wxss`）/ `uniapp`（`uni.scss`）/ `taro`（`app.scss`）

其它参数：`page_id`（省略时若画布只有一个页面则用它）、`html`（直接传源）、`write_files` / `out_dir`（落盘，默认直接返回文件内容）。

> **多端保真度**：插件只保证主题/Token 与规格清单确定性正确；**页面代码需按 `design-spec.md` 编写**。
> HTML→原生不是自动转换，flex/grid、伪元素、自定义滚动等无法 1:1 映射，不宣称像素级还原，请真机校对。

---

## 安全

新增 SSRF 安全抓取（`src/netFetch.ts`）：仅 http/https、拒绝 URL 内凭据、拦截内网/回环/链路本地（IPv4+IPv6）、连接钉在校验过的 IP（防 DNS rebinding）、重定向逐跳复验（≤3 跳）、体积与超时上限、`Accept-Encoding: identity`（防 gzip 炸弹）。

## 兼容性

- 无 `project.json` 字段变化，**旧项目无需迁移**。
- 工具数仍为 8 个；未显式传参 / 未用新 `action` 时行为与 0.4.2 完全一致。
- 测试由 63 个增至 **95 个**。
