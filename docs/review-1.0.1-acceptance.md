# 1.0.1 验收记录

本记录对应 1.0.0 审查反馈（`.claude/upload-1.0.0/01-tianshu-canvas-1.0.0-审查报告.md` 与
`02-给作者的改进项.md`）的处置。审查结论为**无阻断项**，本版只做说明性改进，另含一处
因本机实测暴露的端口回退鲁棒性修复。未执行的检查不记录为通过。

## 环境

| 项目 | 实测 |
|---|---|
| 系统 | Windows 10 专业版 10.0.19045，x64 |
| Node / npm | v24.22.1 / 11.19.1 |
| 浏览器 | Microsoft Edge（puppeteer-core 25.16.0，候选路径探测） |
| 声明兼容 | Windows x64，天枢 >=4.0.2 <5.0.0，TPI 1.0 |
| 基线 | v1.0.0（commit `759dd6a`） |

## 处置项与验证

| 审查项 | 改动 | 复现（改前） | 验证（改后） |
|---|---|---|---|
| P3-4 `shell` 用途 | `tianshu.plugin.json` 的 `description` 追加用途说明 | `grep -c "浏览器" tianshu.plugin.json` → 0 | → 1 |
| P2-2 浏览器依赖 | 清单 `description` + `canvas_audit` 描述披露；新增包内文档 | `grep -ci "chrome\|edge\|TIANSHU_CANVAS_BROWSER" tianshu.plugin.json` → 0 | → 2 |
| P3-5 ACL 不生效 | `docs/permissions-and-dependencies.md` 如实记录，不改写入逻辑 | `icacls` 0o600 与默认对照，两次输出逐行相同（均含 `Authenticated Users:(I)(M)`） | 文档记录与实测一致 |
| P3-1 单文件 bundle | 同一文档标注 vendor 区间与定位命令，不引入 source map | `grep -n "^// src/" dist/index.mjs \| head -1` → 自身源码起点 | 文档给出命令，行号现查 |
| P3-2 机检假阳性 | 审查方工具口径，不在本仓库；文档说明 vendor 边界 | — | 自身源码区实测无 `new Function` / `eval(` / `vm.run` / `createRequire` |

### 文案一致性与负向用例

- 清单与 `src/tools.ts` 的 `canvas_audit` 描述逐字一致（`test/contract.test.mjs` 深比较 + `check:plugin` 握手）。
- 新增回归断言：清单 `description` 必须含 `shell` / `Chrome\/Edge` / `TIANSHU_CANVAS_BROWSER`；
  `canvas_audit` 描述必须含 `Chrome\/Edge`。**负向实测**：临时只改清单描述一处，
  `node --test test/contract.test.mjs` 必须以「运行时工具描述必须与清单完全一致」失败；还原后通过。
- 打包白名单测试：`docs/` 项必须恰为 `permissions-and-dependencies.md` 与 `review-1.0.1-acceptance.md`
  且文件真实存在，旧版验收文档不得进包。

### 附带修复：端口回退兼容 EACCES

- **复现**：本机 MuMuPlayer（`MuMuRemoteBackend.exe`，pid 5172）绑定 `::` 的 2050 端口后，
  `server.listen('127.0.0.1', 2050)` 返回 `EACCES`；`listenWithFallback` 原先只对 `EADDRINUSE`
  继续换端口，导致 `canvas_open`（`test/server.test.mjs` 传首选端口 2049）整体失败。
  `node -e "net.createServer().listen(2050,'127.0.0.1')"` 复现 `EACCES`。
- **修复**：`src/server.ts` 的 `listenWithFallback` 对 `EACCES` 与 `EADDRINUSE` 一视同仁地继续
  扫描候选端口；其他错误码仍向上抛出。
- **回归**：新增 `test/server-port-fallback.test.mjs` 3 项——EACCES/EADDRINUSE 换端口、
  其他错误码不吞、候选区间全占用时降级到系统分配端口。
- **时间维**：修复前 `test/server.test.mjs` 失败、修复后通过，且在全量测试（含浏览器 e2e）中复跑通过。

## 门禁结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run build` + `git diff --exit-code -- dist` | 产物与源码一致 |
| `npm test` | 785 项 → 784 pass / 0 fail / 1 skip（Windows 专属沙箱用例在非 Windows 上跳过），耗时约 19 分钟 |
| `npm run check:plugin` | 125 文件 / 4846.3 KiB；9 工具握手一致，描述逐字相同 |
| `npm run notices:check` | 通过（37 个组件） |
| `npm run verify:codegen` | 正向编译 2 项、反向拒绝 4 项 |
| `npm run verify:prototypes` | 44/44 通过，客观失败 0（首次尝试有 1 次评审截图拼接失败，重跑通过，见下） |

### 需要如实记录的一次失败

`verify:prototypes` 首次以新代码运行（与全量测试并行）时，在 `[5/44] pricing-reference` 的
`captureScroll` 抛出「页面滚动后的像素重叠不一致」。该检查用于拒绝未完成的合成帧，
属**保守失败**而非放宽；单独重跑 44/44 全绿。判定：并行负载下 Chromium 合成时序抖动，
不改变产品行为，但为保证证据可复核，记录此次失败与重跑结果。

## 未测项（不得当成通过）

- **macOS / Linux 平台**：未声明、未测试；Windows ACL 结论只对 Windows 成立。
- **Safari / Firefox**：渲染级 golden 只在 Chromium 上跑过。
- **无障碍 WCAG AA 的人工评审**：渲染级检查能覆盖对比度与目标尺寸等客观项，
  焦点顺序的合理性仍需人工判断（沿用 1.0.0 验收的边界说明）。
- **性能容量**：1000 页上限处的响应曲线未实测（沿用 1.0.0 验收的边界说明）。
- **Windows ACL 改造**：本版按审查建议只做文档说明，未实现 `icacls` 收紧。

## 与 1.0.0 的差异

- 清单：`version` 1.0.1；`description` 追加权限用途与浏览器依赖；`canvas_audit` 描述追加浏览器依赖。
- 包内容：新增 `docs/permissions-and-dependencies.md`；验收文档换为本文档。
- 行为：`canvas_open` 在首选端口被 `EACCES` 占用时不再失败，继续扫描候选端口。
- 工具数量、项目格式、权限三布尔、`engines.tianshu` 均不变。
