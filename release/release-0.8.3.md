# 天枢画布设计 v0.8.3

> 2026-11-08 · Apache-2.0

针对 XiaoSi 插件库「免费插件审核」技术反馈（0.8.2 复审退回）的修复版本：
**设计系统自动导入仍可读取工作区外文件**。反馈点名的 `components.json` 配置路径、
`app/globals.css`、`tailwind.config.js`、`src/App.tsx`（AntD）以及 Windows 目录联接
全部覆盖，并补齐原入口回归与「正常导入不受影响」的验证。

---

## 问题：自动导入读取工作区外文件

**已复现（0.8.2）**：`canvas_design_system` 的 `action=import` 在**自动发现**主题文件时，
完全按拼出来的路径读取，不做任何边界检查。三条真实可利用路径：

| 入口 | 复现方式 | 0.8.2 结果 |
|---|---|---|
| `components.json` 的 `tailwind.css` | 写成 `../outside/private-theme.css` | **外部 CSS 的 `--primary` 进入返回结果** |
| `app/globals.css` | 预置为指向工作区外文件的符号链接 | **外部文件内容被读取** |
| `src/App.tsx`（AntD 候选） | 预置为指向工作区外的符号链接 | **外部 `colorPrimary` 被读取** |

**根因**：`tailwind-shadcn.ts` / `antd.ts` 里所有「自动发现」的读取都用裸
`readFileSync(join(cwd, rel))`：
- `components.json` 的 `tailwind.css` 是**工作区内容**，可以写成 `../outside/x.css`（词法越界）；
- 候选文件（`app/globals.css`、`tailwind.config.*`、`src/App.tsx`、`src/**` 扫描结果）
  可以是**符号链接或 Windows 目录联接**，`readFileSync` 会跟随它读到工作区外。

这与 0.8.2 修复的 `url.txt` 是**同一类缺陷**——只是 0.8.2 只覆盖了「插件自己写的路径」，
漏掉了「按工作区内容去发现并读取」的路径。

**修复**：

1. 新增两个专用入口（`src/paths.ts`）：
   - `confineToWorkspace(cwd, abs)`：把候选路径收敛到工作区内；词法越界、父目录或叶子是
     链接、或真实路径落在工作区外，一律返回 `null`（调用方按「该候选不存在」跳过，不抛错，
     避免让整次导入失败）；
   - `readConfined(cwd, abs)`：**先打开再校验**——`O_NOFOLLOW`（支持的平台）让叶子链接
     直接 open 失败；打开后 `fstat` 必须是普通文件，并对打开后的路径再 realpath 复检仍在
     工作区内，内容从 **fd** 读取（不再按路径二次解析），堵住「检查后替换」。
2. **全部自动发现读取**改走 `readConfined`：`package.json`、`components.json`、
   `tailwind.config.*`、`app|src` 下的 globals.css 候选、`src/**` 扫描结果与 AntD 的
   `ConfigProvider` 候选。`walkFiles` 也先对目录做收敛，不再深入被替换成链接的目录。

**验收**：`test/adapters.import.test.mjs` 新增 7 条用例（反馈点名的每个入口 + junction +
正常导入回归），并用独立复现脚本对 `dist/index.mjs` 实测 7/7 通过。

## 变更

- 版本号 0.8.2 → 0.8.3（`package.json`、`tianshu.plugin.json`）。
- 测试数 154 → **161**（新增 7 条自动导入边界回归）。

## 兼容性

- **无接口、参数与数据格式变更**：工具名、参数、行为语义、项目数据格式、设计系统契约不变。
- 安全行为收紧（可能被拒的输入）：`components.json` 指向工作区外的样式路径、
  以及指向工作区外的 `globals.css` / `tailwind.config.*` / 源码候选，现在一律不读取。
- 正常场景（工作区内、无链接）导入行为**逐字节不变**：同工作区两次导入产物一致。
- **需重装插件 + 新建会话**才生效。

## 复测记录

| 反馈项 | 复测方式 | 结果 |
|---|---|---|
| `components.json` 的 `tailwind.css` 指向工作区外（相对） | `action=import, stack=shadcn, dry_run=true`，写 `../outside/private-theme.css` | **通过**：外部色值未进入返回结果（修复前为泄漏） |
| 同上（绝对路径） | 配置写成工作区外绝对路径 | **通过**：未读取 |
| `app/globals.css` 为符号链接 | 预置链接指向工作区外文件 | **通过**：未读取 |
| `app/globals.css` 所在目录为目录联接 | `app/` 为 junction 指向工作区外 | **通过**：未读取 |
| `tailwind.config.js` 为符号链接 | 预置链接指向工作区外文件 | **通过**：未读取 |
| AntD：`src/App.tsx` 为符号链接 | 预置链接指向工作区外文件 | **通过**：未读取 |
| 检查后替换（TOCTOU） | `readConfined` 先 open 再 fstat + realpath 复检，内容取自 fd | **通过**：`O_NOFOLLOW` 下叶子链接无法 open；复检覆盖替换 |
| 回归：正常导入不受影响 | 工作区内 `app/globals.css` 正常导入 | **通过**：主色被正确读取为 `#7f00ff` |
| 回归：确定性 | 同工作区两次导入 | **通过**：产出的 tokens 字节一致（既有用例） |
| 回归：既有 154 项测试 | `npm run verify` | **通过**：161 项全绿（0 失败 / 0 跳过） |
| 发布材料：第三方许可 / 插件自检 | `npm run notices:check` / `npm run check:plugin` | **通过**：37 个组件；9 个工具握手一致 |

## 发版检查单

1. `npm run verify`（typecheck + build + notices + test）—— **161/161 通过**。
2. 复现脚本实测：`.claude/review-0.8.3/repro-import.mjs` → 7/7 通过。
3. `npm run check:plugin` —— 9 个工具握手一致。
4. 官方开发套件 `validate --lane official_reviewed` → `valid: true`。
