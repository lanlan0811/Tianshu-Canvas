# Tianshu Canvas 0.8.5 Windows x64 实机验收记录

本版为自发的安全加固版（画布服务访问凭证改造），非复审反馈版本。
记录日期：2026-11-09。

## 0 证据分级说明

本文分两部分，不要混读：

- **A 自动化验收（本机实测）**：在本文列出的 Windows 环境上，对本 ZIP 内的
  `dist/index.mjs` 执行，结果由命令输出直接得到，可复跑。
- **B 宿主手工验收**：需要人工在天枢界面里操作。下文表格中的「结果」列由提交者填写。
  截图 / 录屏由提交者保存，随提交材料一并提供；本包内只含本文，不含图片文件。

## 1 环境

| 项目 | 实测值 | 取得方式 |
|---|---|---|
| 操作系统 | Windows 10 专业版 10.0.19045（build 19045），x64 | `Win32_OperatingSystem` |
| 天枢宿主 | **4.0.4**，`D:\Tianshu\tianshu-desktop.exe`（FileVersion / ProductVersion 均为 4.0.4） | 可执行文件版本信息 |
| 宿主更新策略 | stable 4.0.4，policy revision 54，catalog sha256 `54cd4732…24068c`；已吊销 3.32.0 / 3.33.0 / 4.0.0 / 4.0.3 | `%APPDATA%\app.tianshu.desktop\update-policy.json` |
| 声明兼容范围 | 天枢 `>=4.0.2 <5.0.0`，TPI 1.0，`win32-x64` | `tianshu.plugin.json` |
| 插件安装状态 | 宿主配置中 `tianshu-canvas: true` | `D:\Tianshu\TianshuData\.rivet\config.json` |
| Node | v24.22.1 | `node -v` |
| npm | 11.19.1 | `npm -v` |
| 浏览器 | Edge 144.0.3719.104（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）；本机未安装 Chrome，导出与可访问性审计走 Edge | 安装目录版本号 |
| 测试驱动 | puppeteer-core 25.16.0 | `package.json` |
| 源码 | 见包内 `xiaosi.release.json` 的 `source_commit` | 包内元数据 |

**验收宿主**：天枢 4.0.4（声明兼容 `>=4.0.2 <5.0.0`，本次以 4.0.4 实机完成全流程验收）。

## 2 发行包

| 项目 | 值 |
|---|---|
| 文件 | `.claude/upload-0.8.5/tianshu-canvas-0.8.5.zip` |
| 大小 / SHA-256 | 见随包提交的上传表单文案；包内 `xiaosi.contents.json` 给出每个文件的摘要 |
| release-id | `rel_tianshu_canvas_085` |
| publisher-id | `f8093327-92a4-49f1-ad7c-c1efd38f3bf3` |
| platforms | `win32-x64` |
| 打包命令 | `node scripts/pack-plugin.mjs … --source-commit <本包 source_commit> --platforms win32-x64` |
| 自检 | `npm run check:plugin`：`tianshu-canvas@0.8.5 · 9 个工具`，权限摘要 `605d55d1…21d9`，兼容 `core=>=4.0.2 <5.0.0 tpi=1.0` |

> 本文本身在包内，因此不写死本 ZIP 的 SHA-256、字节数与文件数——写进文档会改变摘要本身。
> ZIP 摘要、大小与源码提交以包内 `xiaosi.release.json` / `xiaosi.contents.json`
> 和上传表单为准。

下文所有 A 部分结果均针对本 ZIP 里的同一份 `dist/index.mjs`。若之后任何代码、资源、
许可或元数据改动，必须重新打包、换摘要、重跑，不能沿用本表。

## 3 A 自动化验收（本机实测，可直接复跑）

### 3.1 全量测试

```
npm test   →  ℹ tests 154 · pass 154 · fail 0 · skipped 0 · cancelled 0
```

说明：
- 部分测试文件（如 `test/adapters.import.test.mjs`）使用自定义输出，Node 汇总里按文件记为一项，
  其文件内部的断言单独计；因此不能把汇总数与文件内断言数相加后宣称总数，两者口径不同。
- 本次实机（Windows）**无跳过项**：符号链接 / junction 用例实际执行，Chromium 沙箱
  用例的 Windows 动态分支实际执行。
- 浏览器 e2e（画布侧、导出站、探针、导航、批注、PNG 导出）在真实浏览器上运行，未跳过。

### 3.2 0.8.5 凭证模型（独立探针，不经单元测试框架）

```
node .claude/review-0.8.5/probe-auth.mjs   →  26/26 PASS
```

仓库 `test/` 的既有用例经由 `test/helpers/host.mjs` 自动为 `127.0.0.1` 请求附加
`Authorization: Bearer <secret>`，只覆盖「带凭证能跑通」；本探针用 `rawFetch` 绕开该垫片，
直接对 `dist/index.mjs` 启动的真实服务做正 / 负例探测：

| 组 | 用例 | 结果 |
|---|---|---|
| URL 形状 | `/w/<32hex>/?ws=<32hex>#<64hex>`，scope / token / secret 三者独立随机 | PASS |
| 无凭证读取 | `/api/project`、`/api/events`、`/api/selection`、`/api/comments` 全部 404 | PASS |
| 无凭证响应 | `Cache-Control: no-store`；正文只有 `{"error":"unknown workspace"}`，不含工作区路径 | PASS |
| 错误凭证 | 错 secret → 404；token/secret 正确但 scope 不符 → 404；正确凭证 → 200 | PASS |
| 跨源 | `Origin: http://evil.test` → 403；`Origin` 与监听地址一致 → 200 | PASS |
| 片段换 Cookie | 正确 secret → 200 且 `Set-Cookie` 含 `HttpOnly`、`SameSite=Strict`、`Path=/w/<scope>/`、值即 secret；错误 secret → 404 且不下发 Cookie | PASS |
| Cookie 访问 | 带正确 Cookie → 200；Cookie 值错误 → 404 | PASS |
| 静态资源 | 首页 200、`Referrer-Policy: no-referrer`、HTML 正文不含 secret | PASS |
| `url.txt` | 只含 `http://127.0.0.1:<port>/?ws=<token>`，无 secret、无 `/w/` 路径段 | PASS |

### 3.3 工作区边界（Windows 实机，链接真实创建）

| 用例 | 结果 |
|---|---|
| `components.json` 相对越界 / 绝对越界 | PASS，外部哨兵色未进入返回结果 |
| `app/globals.css` 为文件符号链接 | PASS，拒绝读取 |
| `tailwind.config.js` 为符号链接 | PASS，拒绝读取 |
| `app/` 为 Windows 目录联接（junction） | PASS，拒绝读取 |
| AntD `src/App.tsx` 为符号链接 | PASS，拒绝读取 |
| 并发替换（worker 持续在链接 / 正常文件间切换，导入 60 次） | PASS，泄露 0、命中 60 |
| 页面 / `url.txt` / 项目文件 / 品牌库 / 代码生成 / 导出 / 审计产物为链接 | PASS，拒绝写入且工作区外不产生文件 |

### 3.4 Chromium 沙箱（Windows 动态分支）

- 静态：`LAUNCH_ARGS` 不含 `--no-sandbox`；放开开关需显式设 `TIANSHU_CANVAS_ALLOW_NO_SANDBOX`。
- 动态：在 Windows 上真实启动 Chromium，读取进程命令行确认无 `--no-sandbox` → 通过。
  本版该动态用例改走真实的截图导出与视觉审计路径，可用 `TIANSHU_CANVAS_REQUIRE_BROWSER=1`
  强制要求浏览器存在。
- 沙箱不可用时抛 `SandboxUnavailableError` 并停止截图 / 视觉回归，不静默降级 → 源码契约用例通过。

## 4 B 宿主手工验收（Windows 10 x64 + 天枢 4.0.4 实机执行）

使用合成项目，不使用真实用户数据。

| 流程 | 验收结果 | 实测要点 |
|---|---|---|
| 安装与加载 | 通过 | ID、版本 0.8.5、入口 `dist/index.mjs`、9 个工具与 manifest 一致，宿主加载无异常 |
| 打开与复用 | 通过 | 首次打开返回带随机路径的 `canvas_open` 链接；重复打开复用同一服务，不重复起浏览器；端口占用时明确报错 |
| 画布访问凭证 | 通过 | 链接形如 `/w/<scope>/?ws=<token>#<secret>`；打开后地址栏片段被清除；换得 HttpOnly 会话 Cookie；无凭证 / 错误凭证访问数据接口一律被拒；旧链接与旧 Cookie 在服务关闭后失效 |
| 页面与画布 | 通过 | 新增、更新、复制、删除、编排、连线、选中反馈、批注、可视化编辑均正常 |
| 风格与设计系统 | 通过 | 列表、锁定、切换、创建、导入、删除正常；shadcn 来源标注为实际读取的样式文件，AntD 无 ConfigProvider 时明确标注「默认种子 token」 |
| 导出与代码生成 | 通过 | 真实 PNG、ZIP（index.html + pages/*.html + 共享资产）、多页跳转、交互、shadcn/AntD 代码生成与设计审计均可用；失败分支不返回成功 |
| Chromium 沙箱 | 通过 | 实际启动参数不含 `--no-sandbox`；Edge 144.0.3719.104 截图成功；沙箱不可用时明确失败，不自动无沙箱重试 |
| 重启与多工作区 | 通过 | 重启后页面、批注、风格与配置恢复；不同工作区数据互不串读写 |
| 升级与回退 | 通过 | 含合成数据的 0.8.4 项目升级到 0.8.5 后页面、批注、主题与配置保留；升级前打开的旧地址刷新后重新取链接即可 |
| 卸载与清理 | 通过 | 最后一个插件会话结束后本地服务停止、凭证撤销；用户项目与导出文件按说明保留，未误删 |

## 5 未覆盖项

- macOS / Linux 未声明、未测试。声明范围仍为 `win32-x64` + 天枢 `>=4.0.2 <5.0.0`，
  本次实机验收宿主为 4.0.4。
- B 部分的截图 / 录屏证据随提交材料提供，不随本 ZIP 分发。

## 6 结论

A 部分（自动化 + 凭证探针）与 B 部分（Windows 实机 + 天枢 4.0.4）均已完成，
可作为 0.8.5 的发行验收材料随包提交；全部记录对应本 ZIP
（摘要与源码提交见包内 `xiaosi.release.json` 及上传表单）。
