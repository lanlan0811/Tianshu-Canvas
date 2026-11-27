# 天枢画布设计 v1.0.1

> 2026-11-28 · Apache-2.0

补丁版：处置 1.0.0 审查报告中 4 条非阻断建议（P3-4 / P2-2 / P3-5 / P3-1），
并修复本机实测暴露的端口回退鲁棒性问题。工具仍是 9 个、项目格式保持 v1、权限三布尔不变。

## 处置项

### 端口回退兼容 EACCES

`canvas_open` 传首选端口时，若端口被其他进程独占绑定，Windows 上 `listen` 返回 `EACCES`
而不是 `EADDRINUSE`（本机实测 MuMuPlayer 占用 2050 时复现）。原先只对 `EADDRINUSE` 继续换端口，
会把环境占用误报成工具失败。现在两种错误码都继续扫描候选端口，其他错误码仍向上抛出。
新增 `test/server-port-fallback.test.mjs` 3 项覆盖（含「其他错误码不得被吞」的负向用例）。

### P3-4 · 说明 `shell` 权限的用途

`tianshu.plugin.json` 的 `description` 末尾追加：需要 shell 权限用于调起本机浏览器打开画布与无头截图
（不执行用户输入的命令）。两处进程启动均为固定 argv：`canvas_open` 的 `cmd /c start <画布URL>`
与 headless Chromium 启动参数（不含 `--no-sandbox`）。

### P2-2 · 披露 Chrome/Edge 前置依赖

清单 `description` 与 `canvas_audit` 工具描述均写明：审计与截图需本机安装 Chrome/Edge，
可用 `TIANSHU_CANVAS_BROWSER` 指定浏览器路径。逐字同步 `src/tools.ts` 与清单，握手测试守住一致性。

### P3-5 · Windows 上 `0o600` 不映射 ACL（文档说明）

新增 `docs/permissions-and-dependencies.md`，如实记录：写入使用 `openSync(..., 'wx', 0o600)`，
Windows 不把 POSIX mode 映射为 ACL，生成文件与默认写文件 ACL 相同（`Authenticated Users:(I)(M)`）。
影响限于同机多用户场景；`.tianshu-canvas/` 不含凭据（`url.txt` 写入前已剥离 token 与 secret）。
多用户机器建议自设 ACL 或用独立账户。本版不改写入逻辑。

### P3-1 · 单文件 bundle 的审计指引（文档标注）

同一份文档标注 `dist/index.mjs` 的 vendor 区间：vendor 段以 `// node_modules/` 注释开头，
自身源码从 `// src/` 起；给出定位命令与「行号随构建变化、以命令现查为准」的说明。
本版不引入 source map、不拆 chunk。

### P3-2（审查方工具口径，不属本仓库）

审查报告建议 `audit.mjs` 增加 vendor 区识别。该工具不在本仓库，本版仅通过文档标注 vendor 边界，
供后续审查直接跳过；插件自身源码区仍经实测不含 `new Function` / `eval(` / `vm.run` / `createRequire`。

## 包内容变化

- 新增 `docs/permissions-and-dependencies.md`（进发行包）。
- 验收文档随版本更新为 `docs/review-1.0.1-acceptance.md`（进发行包；1.0.0 验收文档不再打包）。
- `scripts/check-plugin.mjs` 的 `PACKAGE_ENTRIES` 同步为两项 docs。

## 复测记录

对应审查报告各条的「验证方式」：

| 审查项 | 复测方式 | 结果 |
|---|---|---|
| P3-4 | `grep -c "浏览器" tianshu.plugin.json` | 0 → 1（改前/改后） |
| P2-2 | `grep -ci "chrome\|edge\|TIANSHU_CANVAS_BROWSER" tianshu.plugin.json` | 0 → 2 |
| P3-5 | `icacls` 复跑 0o600 与默认对照 | ACL 逐行相同（均含 `Authenticated Users:(I)(M)`），已在包内文档如实记录 |
| P3-1 | `grep -n "^// src/" dist/index.mjs \| head -1` | 已写入包内文档，供审查现查 |
| 回归 | `npm run typecheck && npm run build && npm test` | 785 项 → 784 pass / 0 fail / 1 skip |
| 契约 | `npm run check:plugin` | 125 文件 / 4846.3 KiB，9 工具握手一致 |
| 产物审计 | 自身源码区扫描 | 无 `new Function` / `eval(` / `vm.run` / `createRequire` |

命令与通过计数以 `docs/review-1.0.1-acceptance.md` 的实测为准。
