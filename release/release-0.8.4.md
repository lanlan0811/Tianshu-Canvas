# 天枢画布设计 v0.8.4

> 2026-11-09 · Apache-2.0

针对 XiaoSi 插件库「免费插件审核」技术反馈（0.8.3 复审退回）的修复版本：
**0.8.3 的边界加固把「安全但不存在」的候选路径当成命中，导致正常主题被误报为不存在**。
本版修复该回归，保留全部工作区边界检查，并补齐反馈点名但未获证明的并发替换证据。

---

## 一 已复现缺陷：正常主题被误报为不存在

**复现（0.8.3 原包）**：工作区只有 `package.json`（声明 `tailwindcss` /
`class-variance-authority`）与 `src/index.css` 时，调用
`canvas_design_system { action: "import", stack: "shadcn", id: "audit", dry_run: true }`
返回 `isError: true`「没有找到可导入的主题」；相同内容放在 `app/globals.css` 则成功。
仅放 `styles/globals.css` 同样失败。

**根因**：`src/adapters/tailwind-shadcn.ts` 的 `resolveCssPath()` 以
`confineToWorkspace()` 的返回值作为命中判据。该函数按设计允许「安全但尚不存在」的路径
（新建文件场景），于是候选列表第一位 `app/globals.css` 即使不存在也被选中，
后续候选没有机会被读取。

**修复**：`resolveCssPath` 改为 `resolveCssFile`——对每个候选调用 `readConfined`，
**读到内容才算命中并直接返回内容**；缺失、不可读、越界、父目录或叶子是链接/联接、
非普通文件一律跳过并继续下一候选。`collectTheme` 与 `detect` 都使用同一份读取结果，
不再「选中后按裸路径再读一次」。边界检查一项未撤销。

## 二 顺带收紧的两处

- **`source_path` 单次安全读取**：`importTokens` 指定的来源文件原先「先
  `existsConfinedPath` 检查、再 `readTextInWorkspace` 读取」，两次解析之间可被替换；
  现改为单次 `readConfined`，内容取自已校验的 fd。
- **并发替换绑定（反馈 §3B 并发项）**：`readConfined` 在 `fstat(fd)` 之后增加与
  当前路径 `statSync` 的 `dev`/`ino` 比对。若 open 与 realpath 之间路径被换成另一个
  文件对象（例如先指向工作区外的链接、随后恢复），fd 与路径不再指向同一文件，按
  「未找到」处理。Windows 上 `dev`/`ino` 可用（已实测非 0），该比对在声明支持的
  `win32-x64` 上生效。

说明：本次反馈明确「本轮没有复现并发泄露，也没有将它列为已证实漏洞」。以上是对
证据要求的回应，不声称已证明所有时序。

## 三 验收用例（`test/adapters.import.test.mjs`，16 → 30 条）

| 用例 | 覆盖 |
|---|---|
| 0.8.3 缺陷回归 | 仅有 `src/index.css` + `dry_run=true`：成功导入、不落盘 |
| 候选矩阵 ×6 | `app/`、`src/app/`、`styles/`、`src/styles/globals.css`、`src/index.css`、`index.css` 分别独立存在时，显式 `stack=shadcn` 与自动探测都能导入，且证据行指向真实文件 |
| 候选优先级 | `components.json` 指定的安全 CSS 优先于默认候选 |
| 候选跳过 | `components.json` 相对越界 + `app/globals.css` 为目录 + `src/index.css` 为外部链接 + `styles/globals.css` 正常 → 仍导入安全候选，外部哨兵色不出现 |
| 全部候选缺失 | 明确报错，不创建主题、不改动已有 `library/` 内容 |
| 重复导入 | 同一输入两次产物字节一致；未传 `overwrite` 不替换已有主题 |
| 并发替换 | worker 线程持续把候选文件在「指向外部主题的链接」与「工作区正常文件」之间切换，主线程导入 60 次：泄露 0 次；正常读取未被误伤 |

本轮完整 Node 汇总：**176 项：175 通过、1 跳过、0 失败**（跳过项为当前权限下无法创建
符号链接的用例；本次 Windows 环境可创建符号链接，全部边界用例实际执行）。
`test/interaction.e2e.test.mjs` 首次运行出现一次 8s 等待超时，单独重跑 2/2 通过，
判为浏览器启动抖动，非本版改动引入。

## 变更

- 版本号 0.8.3 → 0.8.4（`package.json`、`tianshu.plugin.json`）。
- AntD 源码扫描改用显式 `import { readdirSync } from 'node:fs'`，不再依赖 CJS `require`。
- 测试数 161 → 176。

## 兼容性

- **无接口、参数与数据格式变更**：工具名、参数、行为语义、项目数据格式、设计系统契约不变。
- 行为变化只发生在错误路径：不存在的候选不再被当作命中；读取期间被替换的候选按缺失处理。
- 安全行为不变：工作区外路径、符号链接与目录联接候选仍一律不读取。
- **需重装插件 + 新建会话**才生效。
