# 天枢画布设计 v0.7.4

> 2026-11-07 · Apache-2.0

针对 XiaoSi 插件库「免费插件审核」技术反馈（0.7.1 复审）的安全修复版本：
修掉两条已复现的安全边界问题（SSRF 映射地址绕过、工作区符号链接越界读写），
恢复截图/视觉回归的 Chromium 沙箱，并按平台要求补齐第三方许可与数据用途说明。

---

## 安全修复

### 01 网络访问边界 —— 映射地址按实际 IP 值判定

**已复现（0.7.1）**：`::ffff:127.0.0.1` 这类 IPv4 映射 IPv6 地址被判定为公网，
对只监听 `127.0.0.1` 的本地服务可抓取成功；URL 把映射地址规范化成 `::ffff:7f00:1`
（十六进制）后同样绕过——旧实现只识别点分十进制写法。

**根因**：判定基于字符串前缀（`/^::ffff:(\d+\.\d+\.\d+\.\d+)$/`），而地址有大量等价写法。

**修复**（`src/netFetch.ts`）：把 IPv6 文本统一解析成 8 个 16 位整数组，**按实际 IP 值归类**，
覆盖 `::ffff:0:0/96`（IPv4-mapped，点分与十六进制）、`::/96`（IPv4-compatible）、
`64:ff9b::/96`（NAT64）、`2002::/16`（6to4，含内嵌 IPv4 与内嵌环回）、`2001:0::/32`（Teredo）、
`fc00::/7` / `fe80::/10` / `fec0::/10` / `ff00::/8` 与文档段；解析失败一律按不安全处理（fail-closed）。

### 01 域名兼容性 —— 钉住的 lookup 兼容 Node 的 all 回调

**已复现**：默认连接设置下，合法域名解析后报 `Invalid IP address: undefined`，即真实域名一律抓不到。

**根因**：Node 24 的 `autoSelectFamily`（默认开启）调用 `lookup` 时带 `all: true`，
期望回调返回**地址数组**；旧实现恒定回调 `(null, address, family)`，地址参数为 `undefined`。

**修复**：`pinnedLookup` 按 `opts.all` 分支返回数组或单值；配合 `assertUrlAllowed`
把连接固定到已核验的地址族，逐跳重定向仍重新校验。

### 02 工作区文件边界 —— 拒绝符号链接 / 目录联接越界

**已复现**：
- 在 `.tianshu-canvas/pages/` 放一个指向工作区外文件的符号链接，`/api/page-html` **返回了外部文件内容**；
- 把页面的固定 `<id>.html.tmp` 路径预置为符号链接，调用 `canvas_upsert_page` 后
  **链接指向的外部文件被覆盖**（`writeFileSync(tmp)` 会跟随叶子符号链接）。

**修复**（新增 `src/paths.ts`，接入 `project.ts` / `export.ts` / `server.ts`）：
- 读/写/导出前按**真实路径**校验包含关系，并逐级拒绝符号链接与 Windows 目录联接（junction）；
- 写入改用**独占创建的随机临时文件**（`open(..., 'wx')`）再 rename：预置链接会让 open 直接
  `EEXIST` 失败，随机名也让替换点不可预测；rename 前再拒一次叶子链接，堵住「校验后被替换」；
- 越界属调用方输入问题：HTTP 侧返回 403（不再是 500），工具侧返回可读错误。

### 03 截图与视觉回归 —— 恢复 Chromium 沙箱

**代码审查发现**：截图与视觉回归共用的启动参数里**硬编码** `--no-sandbox`，
而这两条路径会渲染可能含脚本的原型，等于关闭进程沙箱。

**修复**：移除硬编码的 `--no-sandbox`，默认保留沙箱；环境确实无法安全启动时
**明确报错并停止**截图/视觉回归，不再静默降级。仅在此类受限环境可用
`TIANSHU_CANVAS_ALLOW_NO_SANDBOX=1` 显式放开。已在 Windows x64 实测截图与视觉回归均可运行。

## 变更

### 04 第三方许可与数据用途说明

- **新增 `THIRD-PARTY-NOTICES.md`（随发行 ZIP 提交）**：列出所有**实际内联进 `dist/`** 的
  37 个第三方组件（Node 侧 20 个 + 画布前端 17 个，含 React Flow / `@xyflow/react`）
  及其许可与版权全文。该文件由 `scripts/gen-third-party.mjs` 依据 esbuild metafile 生成，
  CI 用 `git diff --exit-code` 校验其与依赖一致，避免清单过期。
- **打包清单**加入 `THIRD-PARTY-NOTICES.md`（`scripts/check-plugin.mjs` / `pack-plugin.mjs`）。
- **README 新增「数据用途与外部访问」**：单列资源内联与设计系统反抽取的触发条件、
  抓取目标、随请求发出的数据，并明确与遥测分开——**本插件不上报任何遥测/统计/崩溃信息**。

## 兼容性

- **无接口、参数与数据格式变更**：工具名、参数、行为、项目数据格式、设计系统契约全部不变。
- 发行 ZIP 新增一个文件 `THIRD-PARTY-NOTICES.md`；其余打包内容不变。
- 安全行为收紧（可能被拒的输入）：指向内网/映射地址的重定向、以及经符号链接/目录联接
  指向工作区外的页面读写。
- **需重装插件 + 新建会话**才生效。

## 发版检查单

1. `npm run verify`（typecheck + build + notices + test）—— 131/131 通过。
2. `npm run check:plugin`（清单/入口/握手/路径/体积自检）。
3. 产物与源码一致（CI 用 `git diff --exit-code -- dist` 校验）。
4. `npm run notices:check`（第三方许可声明与依赖一致）。

## 复测记录（对应反馈第 2 页清单）

| 反馈项 | 复测方式 | 结果 |
|---|---|---|
| 01 回环（普通/映射）被拒 | 起只监听 `127.0.0.1` 的服务，分别用 `127.0.0.1`、`[::ffff:127.0.0.1]`、`[::ffff:7f00:1]` 抓取 | 三者均被拒（禁止访问内网/保留地址）；`test/net-fetch.test.mjs` |
| 01 指向内网的重定向被拒 | 逐跳重新校验 `assertUrlAllowed` | 通过（既有测试覆盖重定向校验） |
| 01 正常公网资源可加载 | 钉住的 lookup 兼容 `all` 回调 | 真实 socket 回归通过（`Invalid IP address: undefined` 已消除） |
| 02 符号链接越界读 | `.tianshu-canvas/pages/` 内符号链接指向外部文件 | 403 拒绝，外部内容不外泄 |
| 02 符号链接越界写 | 预置 `<id>.html.tmp` 为符号链接后 upsert | 写入不跟随链接，外部文件保持原值 |
| 02 目录联接越界 | `pages/` 为 junction 指向外部 | 写入被拒，工作区外无文件产生 |
| 03 Chromium 安全启动 | 抓取运行中 Chromium 命令行 | 无 `--no-sandbox`（`test/chromium-sandbox.test.mjs`） |
| 03 Windows x64 截图/视觉回归 | 真实导出 PNG + 写/比视觉基线 | 均 OK，沙箱保留 |
| 04 第三方许可 | 依打包产物生成许可清单 | `THIRD-PARTY-NOTICES.md`（37 个组件，随 ZIP 分发） |
