# 天枢画布设计 v0.8.2

> 2026-11-08 · Apache-2.0

针对 XiaoSi 插件库「免费插件审核」技术反馈（0.8.1 复审）的修复版本：**修掉阻断项一**
（「打开画布」仍可经预置的 `.tianshu-canvas/url.txt` 链接覆盖工作区外的文件）与**阻断项二**
（网络用途说明与实际请求不符）。同时把反馈点名的「其他隐式读写入口」全部纳入统一边界保护，
并补齐端到端安全回归。

---

## 阻断项一：工作区外文件覆盖

**已复现（0.8.1）**：`.tianshu-canvas/url.txt` 若已被创建为指向工作区外文件的符号链接，
调用 `canvas_open` 会**跟随该链接**写入画布地址，覆盖目标文件。

复现脚本与反馈给出的 PoC 完全一致（本机 Windows x64 实测）：

```
node reproduce-url-txt.mjs <dist/index.mjs 绝对路径>
修复前： outside unchanged: false      ← 外部文件被覆盖
修复后： outside unchanged: true       ← 外部文件字节不变，画布 URL 仍正常返回
```

**根因**：`writeUrlHint` 用 `writeFileSync(join(cwd, '.tianshu-canvas', 'url.txt'), …)`
直接写入固定路径。`writeFileSync` 会**跟随**叶子符号链接，因此写入落到了链接指向的外部文件。
同类写法在 `<id>.html.tmp`、品牌记忆 `.tmp`、漂移快照 `.tmp`、自定义设计系统 `writeJsonAtomic`、
代码生成落盘、审计落盘中重复出现——反馈指出的「其他文件入口」正是这些。

**修复**：

1. **统一边界模块**（`src/paths.ts`）扩展为所有隐式读写的唯一入口：
   - `assertInsideWorkspace` 按**真实路径**校验包含关系，逐级拒绝符号链接与 Windows 目录联接（junction）；
   - 写入一律 `writeFileAtomic` / `writeFileInWorkspace`：**独占创建随机临时文件**（`open(…, 'wx')`）
     再 rename。预置的固定 `.tmp` 链接会让 open 直接 `EEXIST` 失败，随机名也让替换点不可预测；
   - rename 前**再拒一次**叶子链接，堵住「校验后被替换」的竞态；
   - 用户**显式指定**的工作区外落点（`out_dir` / `pack_path`）不按工作区边界拒绝，
     但**仍然**走独占随机临时文件，且拒绝叶子链接。
2. **接入全部隐式入口**：

   | 入口 | 位置 | 原实现 | 现实现 |
   |---|---|---|---|
   | 画布地址 `url.txt` | `tools.ts` | `writeFileSync` | `writeFileInWorkspace` |
   | 品牌记忆 `memory/brand.json` | `brand.ts` | 固定 `.tmp` + rename | `writeFileInWorkspace` |
   | 品牌包导出 | `brand.ts` | 固定 `.tmp` + rename | `writeFileInWorkspace` / `writeFileAtomic` |
   | 自定义设计系统 `library/<id>/*` | `designCustom.ts` | 固定 `.tmp` + rename | `writeFileInWorkspace` |
   | 删除自定义风格 | `designCustom.ts` | 直接 `rmSync` | 删前边界校验 |
   | 代码生成落盘 | `tools.ts` | `writeFileSync` | `writeFileAtomic` |
   | 审计产物落盘 | `tools.ts` | `writeFileSync` | `writeFileAtomic` |
   | 导出 PNG / ZIP | `export.ts` | 已部分加固 | PNG 写前加边界校验 |
   | 漂移快照 | `audit/drift.ts` | 固定 `.tmp` + rename | `writeFileInWorkspace` |
   | 视觉基线 | `audit/visual.ts` | `writeFileSync` | `writeFileInWorkspace`（读也校验） |
   | project.json 备份 | `project.ts` | `copyFileSync` 跟随链接 | 读校验 + `writeFileAtomic` |
   | 读取入口（项目/页面/选中/导出物/来源文件/主题文件/品牌包） | 多处 | `readFileSync` | 边界校验后读，越界拒绝 |

**验收**：`test/workspace-boundary.test.mjs` 新增 8 条端到端用例（13 条全绿），
以**实际发行入口**（`dist/index.mjs` + 宿主包装）执行，覆盖叶子链接、父目录链接、
Windows 目录联接、固定 `.tmp` 预置、品牌记忆 / library / codegen / 导出 / 快照、
以及「无链接时正常读写不受影响」的误伤回归。

## 阻断项二：网络用途说明

**问题**：原说明称设计系统反抽取「只请求用户提供的 URL」。实际实现会读取页面中**最多 3 个**
外部样式表（`<link rel=stylesheet>`），**逐跳**处理重定向，且目标可能是**其它主机**；
HTTP 请求也会把目标 URL 的**路径与查询参数**发给目标主机。

**实测确认**（`test/design-extract.test.mjs`）：

```
输入 https://site.example.com/dir/page.html（页面含 4 个 <link rel=stylesheet>，其中一个跨站）
请求序列：
  https://site.example.com/dir/page.html        ← 用户给出的页面
  https://site.example.com/local.css            ← 相对路径按页面 URL 解析
  https://cdn.other.example/lib.css             ← 跨站（CDN 主机）
  https://site.example.com/up.css               ← ../ 相对路径
第四个样式表被截断（上限 3 个）
```

**修复**：更新 README「数据用途与外部访问」与 `skills/SKILL.md`：
- 反抽取的抓取目标从「用户给出的那个 URL」改为「该页面 + 其中最多 3 个外部样式表（可跨主机）」；
- 明确两个抓取功能都**跟随重定向（最多 3 跳）**、**每一跳都可能换主机**、**每跳都重新校验**；
- 明确请求会携带目标 URL 的**路径与查询参数**，提示**不要把敏感信息放进 URL**。
- 说明内容与平台提交的表单披露一致。

**验收**：新增 3 条反抽取请求面回归（跨站样式表、相对路径、路径与查询参数），
新增 3 条真实网络路径的逐跳校验回归（**真实公网 IPv6 首跳 → 回环第二跳被拒且未连上**、
映射回环十六进制写法、公网地址仍可抓取）。

## 变更

- 版本号 0.8.1 → 0.8.2（`package.json`、`tianshu.plugin.json`）。
- 测试数 141 → **154**（新增 8 条边界回归 + 5 条网络回归）。

## 兼容性

- **无接口、参数与数据格式变更**：工具名、参数、行为语义、项目数据格式、设计系统契约全部不变。
- 安全行为收紧（可能被拒的输入）：指向工作区外的符号链接 / 目录联接现在覆盖全部读写入口；
  经链接指向工作区外的页面、项目、导出物、快照、基线、品牌记忆一律拒绝。
- 正常场景（工作区内、无链接）的读写行为**逐字节不变**。
- **需重装插件 + 新建会话**才生效。

## 复测记录

| 反馈项 | 复测方式 | 结果 |
|---|---|---|
| 阻断项一：url.txt 覆盖工作区外文件 | 反馈 PoC 脚本（`canvas_open`，`url.txt` 为链接）实测 | **通过**：外部文件 `ORIGINAL` 未被覆盖（修复前为 `false`） |
| 阻断项一：正常工作区仍能打开画布 | 同一脚本 / 端到端用例断言返回画布 URL | **通过**：返回 `http://127.0.0.1:<port>/?ws=<token>` |
| 阻断项一：无链接场景不受影响 | `url.txt 无链接时正常写入画布地址` | **通过**：写入内容匹配画布 URL |
| 阻断项一：叶子符号链接 | 页面文件 / project.json / 品牌记忆 / codegen 产物 为叶子链接 | **通过**：4 条用例均拒绝且外部文件字节不变 |
| 阻断项一：父目录链接 | `pages/` 为 junction；深层写入（叶子不存在） | **通过**：拒绝写入，工作区外无产物 |
| 阻断项一：Windows 目录联接 | `pages/`、`library/`、`exports/` 为 junction | **通过**：3 条用例均拒绝 |
| 阻断项一：固定临时文件预置 | 预置 `<id>.html.tmp` 为链接 | **通过**：不被跟随，正常写入落在工作区内 |
| 阻断项一：检查后替换 | 写入用独占**随机**临时文件 + rename 前复检 | **通过**：替换点不可预测；rename 前再拒叶子链接 |
| 阻断项一：其他入口（反馈「排查范围」） | codegen / 审计落盘 / 导出 PNG+ZIP / 漂移快照 / 视觉基线 / 品牌包 / 抽取来源 / 适配器来源 | **通过**：全部接入统一边界，逐条用例或代码审查确认 |
| 阻断项二：说明与实际请求相符 | 用受控页面（含跨站样式表、相对路径）记录请求序列 | **通过**：请求为 页面 + 最多 3 个样式表（含跨主机） |
| 阻断项二：跨站样式表 | 页面 `<link>` 指向 `cdn.other.example` | **通过**：确实发出跨站请求（说明已披露） |
| 阻断项二：相对路径 | `/local.css`、`../up.css` | **通过**：按页面 URL 解析后请求 |
| 阻断项二：重定向逐跳校验 | 真实公网 IPv6 首跳 302 → `127.0.0.1` 第二跳 | **通过**：第二跳被拒且**未真正连上**回环服务 |
| 阻断项二：映射回环（真实路径） | `::ffff:7f00:1` / `::ffff:127.0.0.1` / `::7f00:1` / `64:ff9b::7f00:1` | **通过**：真实 `fetchUrl` 路径全部拒绝 |
| 阻断项二：合法域名 / 公网地址仍可用 | 真实 IPv6 字面量 + 真实 HTTP | **通过**：`PUBLIC-OK` 正常抓取 |
| 阻断项二：路径与查询参数如实披露 | 输入带 `?theme=dark&token=…` 的 URL | **通过**：请求确实携带，说明已提示 |
| 回归：既有 141 项测试 | `npm run verify` | **通过**：154 项全绿（0 失败 / 0 跳过） |
| 浏览器沙箱：Chromium 命令行无 `--no-sandbox` | `test/chromium-sandbox.test.mjs`（Windows 抓取真实命令行） | **通过**：真实 Chromium 命令行不含 `--no-sandbox` |
| 发布材料：第三方许可 | `npm run notices:check` | **通过**：37 个组件，声明与依赖一致 |
| 发布材料：插件自检 | `npm run check:plugin` | **通过**：9 个工具握手一致 |

## 发版检查单

1. `npm run verify`（typecheck + build + notices + test）—— **154/154 通过**。
2. `npm run verify:codegen`（适配器编译验收）—— 正向 2 项、反向拒绝 4 项全过。
3. `npm run check:plugin` —— 9 个工具握手一致。
4. 复现脚本实测：`outside unchanged: true`（修复前 `false`）。
