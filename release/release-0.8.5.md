# 天枢画布设计 v0.8.5

> 2026-11-09 · Apache-2.0

安全加固版：画布服务不再用「可离线复算的路径哈希」当凭证。
工作区访问改为**随机路径 + 256 位凭证 + HttpOnly Cookie 授权**，并收紧跨源、缓存与实例生命周期。
工具名、参数、项目数据格式与导出行为一律不变。

---

## 一 原问题：凭证可从工作区路径推导

0.8.4 的服务地址是 `http://127.0.0.1:<port>/?ws=<token>`，其中

```
token = sha256(cwd).slice(0, 16)
```

两点后果：

1. **token 可离线复算**。同机任意进程只要知道工作区绝对路径，就能算出 token；
   再按默认端口 8123 与顺序回退试几个端口，即可猜中服务地址。
2. **token 本身就是读取凭证**。`/api/project`、`/api/events`、`/page/:id`、
   `/api/export-file` 只校验 token 是否存在，不校验调用方是否被授权。
   猜中地址即可读取项目模型、页面 HTML 与导出文件。

另外，`dispose` 原先**不关闭**服务（为避免浏览器标签失效），端口与 token 在整个
宿主进程生命周期内持续有效；临时目录清理还会按 `tsc-png-*` 名称扫描 `tmpdir()`，
删除本实例之外的目录。

## 二 修复

### 2.1 随机 scope + 256 位凭证

每个工作区首次被访问时生成：

| 值 | 生成方式 | 作用 |
|---|---|---|
| `scope` | `randomBytes(16)` → 32 位十六进制 | URL 路径段 `/w/<scope>/`，与工作区路径无关 |
| `secret` | `randomBytes(32)` → 64 位十六进制（256 位） | 真正的读取凭证 |
| `token` | `randomBytes(16)` → 32 位十六进制 | 工作区标识，出现在查询串里 |

服务地址：`http://127.0.0.1:<port>/w/<scope>/?ws=<token>#<secret>`

- `secret` **只出现在链接片段**（`#` 之后），浏览器不会把片段发给服务器。
- 凭证与工作区路径彻底解耦：知道路径也推不出 scope / token / secret。
- 比较用 `crypto.timingSafeEqual`，不接受不等长的写法。

### 2.2 片段换 Cookie，地址栏不留凭证

打开链接后，浏览器向 `/api/auth` POST 片段里的 secret，换取会话 Cookie：

```
Set-Cookie: canvas_<token>=<secret>; HttpOnly; SameSite=Strict; Path=/w/<scope>/
```

- `HttpOnly`：页面脚本读不到；`SameSite=Strict`：跨站请求不携带。
- `Path` 限定到该工作区的 scope，同一服务的其它工作区收不到这个 Cookie。
- 成功后前端清掉地址栏片段，书签或历史记录里不会留下凭证。

此后所有数据接口（`/api/project`、`/api/events`、`/page/:id`、`/api/selection`、
`/api/comments`、`/api/export-file`、`/api/page-html`）都要求：**scope 与 token 匹配**
且 **secret 校验通过**（Cookie 或 `Authorization: Bearer`）。缺一即 404 / 404 语义的
`unknown workspace`，不泄露「存在但这个凭证错」。

光标同步、视口、批注等写接口同时仍需自定义头 `X-Tianshu-Canvas: 1`（跨源无法带自定义头）。

### 2.3 跨源与缓存

- 浏览器发送 `Origin` 时，必须与监听地址 `http://127.0.0.1:<port>` 完全一致，否则 403。
- 静态资源（含 `index.html`）加 `Referrer-Policy: no-referrer`——链接里哪怕残留凭证也不外泄。
- 导出文件、静态资源与所有错误响应加 `Cache-Control: no-store`。
- `index.html` 的 CSP 保持不变（`default-src 'self'`，无 `unsafe-eval`）。

### 2.4 实例生命周期与临时目录

- 多个插件实例共享同一服务；用引用计数，**最后一个实例 `dispose` 时**关闭监听、
  断开全部事件流并撤销所有工作区凭证（旧链接和旧 Cookie 立即失效）。
- `ensureServer` 并发调用合并到同一个 `starting` Promise，`shutdown` 期间的新请求等其结束；
  关闭用 `closeAllConnections()`，不会因为挂着一条 SSE 而卡住。
- 浏览器临时目录只清理**本实例自己创建的** profile，删掉按 `tsc-png-*` 名称扫描删除的逻辑。
- `canvas_open` 的返回文案明确提示：链接含访问凭证，只给本机授权使用者。

### 2.5 `url.txt` 不再落盘凭证

工作区里 `.tianshu-canvas/url.txt` 原先直接写完整地址，等于把 secret 落盘。
现在写入的是 `http://127.0.0.1:<port>/?ws=<token>`：**去掉 `/w/<scope>/` 路径段与
`#<secret>` 片段**，只保留来源与工作区标识（`ws` 仅用于前端选择工作区，单独持有它
读不到任何数据）。该文件泄露不再等同于凭证泄露。工作区边界保护
（固定临时文件 + 不跟随链接）不变。

## 三 验收

### 3.1 自动化

`npm run verify`（typecheck + build + notices + test）全绿。
`npm test` 的 Node 汇总原样为：**`tests 154` / `pass 154` / `fail 0` / `skipped 0`**
（本机 Windows 10 x64，Node v24.22.1；`test/*.test.mjs` 共 34 个文件，其中 22 个用
`node:test` 声明用例，其余在文件顶部直接断言）。

`npm run check:plugin` 通过：`tianshu-canvas@0.8.5 · 9 个工具`，兼容
`core=>=4.0.2 <5.0.0`、`tpi=1.0`，打包 108 个文件、解包 4723.7 KiB。
`git diff --exit-code -- dist` 为空——提交的 `dist` 与源码构建结果一致。

### 3.2 凭证模型独立验收（`node .claude/review-0.8.5/probe-auth.mjs`）

仓库 `test/` 的既有用例是通过 `test/helpers/host.mjs` 的垫片**自动**为 127.0.0.1 请求
补上 `Authorization: Bearer <secret>` 的——它只证明「带着凭证能跑通」，**不覆盖无凭证
被拒**这条路径。为此另写独立探针，用 `rawFetch` 绕开垫片，直接对 `dist/index.mjs`
启动的真实服务做正/负例探测：**26 项全部通过**。

| 组 | 断言 |
|---|---|
| URL 形状 | `/w/<32hex>/?ws=<32hex>#<64hex>`，scope / token / secret 三者独立随机 |
| 无凭证读取 | `/api/project`、`/api/events`、`/api/selection`、`/api/comments` 全部 404 |
| 无凭证响应 | `Cache-Control: no-store`；正文只有 `{"error":"unknown workspace"}`，不含工作区路径 |
| 错误凭证 | 错 secret → 404；token 与 secret 都对但 scope 不符 → 404；正确凭证 → 200 |
| 跨源 | `Origin: http://evil.test` → 403；`Origin` 与监听地址一致 → 200 |
| 片段换 Cookie | 正确 secret → 200 且 `Set-Cookie` 含 `HttpOnly`、`SameSite=Strict`、`Path=/w/<scope>/`、值即 secret；错误 secret → 404 且不下发 Cookie |
| Cookie 访问 | 带正确 Cookie → 200；Cookie 值错误 → 404 |
| 静态资源 | 首页 200、`Referrer-Policy: no-referrer`、HTML 正文不含 secret |
| `url.txt` | 只含 `http://127.0.0.1:<port>/?ws=<token>`——无 secret、无 `/w/` 路径段 |

### 3.3 宿主实机验收

Windows 10 x64 + 天枢 4.0.4 上完成全流程验收（安装与加载、打开与复用、画布访问凭证、
页面与画布、风格与设计系统、导出与代码生成、Chromium 沙箱、重启与多工作区、升级与回退、
卸载与清理），全部通过。记录随包：`docs/windows-acceptance-0.8.5.md`。

### 3.4 已知残留

- macOS / Linux 未声明、未测试；声明范围仍为 `win32-x64` + 天枢 `>=4.0.2 <5.0.0`。
- 旧版本 `dist` 与本版不兼容：本版改了 URL 形状，**必须重装插件 + 新建会话**；
  升级前打开的画布页会收到 404，刷新页面重新从 `canvas_open` 取链接即可。

## 变更

- 版本号 0.8.4 → 0.8.5（`package.json`、`tianshu.plugin.json`）。
- URL 形状变更：`/?ws=<token>` → `/w/<scope>/?ws=<token>#<secret>`。
- `url.txt` 写入内容去掉 `/w/<scope>/` 路径段与 `#<secret>` 片段。
- 移除 `tsc-png-*` 陈旧目录扫描清理；浏览器 profile 只清理本实例创建的。

## 兼容性

- **工具层无变更**：9 个工具的名称、描述、参数、返回结构与错误语义不变。
- **项目数据无变更**：`.tianshu-canvas/` 下的文件格式、设计系统契约、品牌包格式不变。
- **行为变化**：服务地址带随机路径与片段；页面首次打开需要一次片段换 Cookie 的往返；
  服务在最后一个插件实例 dispose 时关闭（此前常驻）。
- **需重装插件 + 新建会话**才生效。
