# 贡献指南

感谢你有兴趣为 **Tianshu-Canvas（天枢画布设计）** 做贡献。
本文说明本地开发、测试与提交流程。

## 环境要求

- Node.js >= 24（见 `package.json` 的 `engines`）
- 可选：系统安装 Chrome 或 Edge，用于 PNG 导出与浏览器端到端测试

## 本地开发

```bash
npm install
npm run verify   # typecheck + build + test
```

`verify` 是提交前必须通过的完整门禁：

- `npm run typecheck`：Node 侧与 Web 侧类型检查
- `npm run build`：esbuild 打包，产物写入 `dist/`
- `npm test`：`node:test` 契约 / 项目 / 服务 / 选中 / 导出 / 探针 e2e 测试（跑的是**构建产物**）

端到端（真实浏览器）单独验证：

```bash
npm run build
node scripts/verify-web.mjs            # 自动探测 Chrome/Edge
node scripts/verify-web.mjs <chrome.exe>
```

## 目录结构

| 路径 | 说明 |
|---|---|
| `src/` | Node 侧（入口 / 工具 / 本地服务 / 项目模型 / 探针 / 导出）→ `dist/index.js` |
| `web/` | 画布前端（React + React Flow）→ `dist/web/canvas.js` |
| `dist/` | 构建产物（**必须提交进仓库**） |
| `test/` | 测试（跑构建产物） |
| `scripts/` | 构建与验证脚本 |
| `release/` | 每个版本的发布详情文档 |

## 重要约定

1. **`dist/` 必须与源码一同提交。** 天枢安装插件时只执行
   `npm install --ignore-scripts --omit=dev`，**不会执行构建脚本**，因此产物必须随仓库分发。
   CI 会用 `git diff --exit-code -- dist` 校验产物与源码一致；本地改完源码请务必
   `npm run build` 并提交 `dist/`。
2. **Node 侧保持单文件 bundle。** `src/server.ts` 是模块级单例；若拆成多文件，入口会内联出
   第二份单例，导致测试与运行时行为不一致。
3. **图标一律使用 SVG，不使用 emoji。**
4. **提交信息使用中文**，简洁说明「为什么」。
5. 本仓库只在 `main` 分支提交与推送。

## 提交 Pull Request

1. Fork 本仓库，在你的分支上开发。
2. 确保 `npm run verify` 全绿，且 `dist/` 已随源码更新并提交。
3. 提交 PR，并按 PR 模板填写验证信息。

## 发布流程（维护者）

1. 更新 `CHANGELOG.md`，并在 `release/` 下新增发布详情文档 `release-<版本>.md`。
2. 同步 `package.json` 与 `tianshu.plugin.json` 的版本号。
3. 提交并推送 `main`，确认 CI 全绿。
4. 打 tag（如 `v0.2.4`）并推送，触发 `.github/workflows/release.yml` 自动创建 GitHub Release。

## 安全问题

请勿用公开 Issue 报告安全漏洞，参见 [SECURITY.md](SECURITY.md)。

## 许可

贡献即表示同意你的贡献以 [Apache License 2.0](LICENSE) 许可发布。
