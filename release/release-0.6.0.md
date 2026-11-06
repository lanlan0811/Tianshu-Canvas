# 天枢画布设计 v0.6.0

> 2026-11-06 · Apache-2.0

发行形态对齐版。功能与 0.5.0 一致（仍是 8 个工具），重点是让插件**能通过天枢官方插件库的打包与验包**（`XPI` 的 `official_reviewed` 分区）。

此前版本以「仓库根目录直接安装」为目标；官方发行包的限制完全不同：不许依赖目录、不许运行时安装、不许包脚本与锁文件。0.5.0 的产物在官方打包器上会直接失败。

---

## 修复

### 1. 清单补 `engines.tianshu`

官方打包器对没有声明核心版本范围的包**直接拒绝**：

```json
"engines": { "tianshu": ">=4.0.2 <5.0.0" }
```

发行记录里的 `compatibility.core` 由它派生，两者必须归一化后一致。

### 2. 入口改为 `dist/index.mjs`

官方发行 ZIP 里**没有 `package.json`**（清单、锁文件都在禁止列表里），Node 只能按扩展名判定模块格式。改为 `.mjs` 后模块格式是明确的，不再依赖语法探测；这也是官方手册推荐的做法。

### 3. `puppeteer-core` 内联进 bundle

这是最致命的一条：旧实现把它声明为 esbuild 的 `external`，运行时从 `node_modules` 动态 import。官方包不携带 `node_modules`，用户装完插件后**点导出 PNG 会直接失败**。

现在整条依赖树打进单文件 bundle（约 2.4 MB，总包 3.3 MB，远低于 20 MiB 压缩 / 64 MiB 解包上限）。解包到无 `node_modules` 的空目录后实测：启动画布、写页面、导出 PNG 全部通过。

### 4. 权限如实声明

`permissions.shell` 由 `false` 改为 `true`。代码确实会 spawn 系统浏览器（`cmd /c start` / `open` / `xdg-open`）、启动无头 Chrome，并在 Windows 上调用 `taskkill` 结束进程树。权限是安装时给用户看的用途声明，不能少报。

### 5. 工具描述与清单逐字一致

官方示例测试按 `{ name, description }` **深比较**清单与运行时工具。此前 8 个工具的描述全部不一致（最长的 `canvas_design_system` 有 1397 字，而清单上限是 200 字）。

现在两侧用同一段文本，全部 ≤200 字；原本塞在描述里的详细契约（tokens 结构、codegen 目标与栈、目录约定）移到 `inputSchema` 的参数说明和技能文档里，模型看到的信息没有减少。

### 6. 路径参数与并发标记

- `canvas_style.codegen` 的 `out_dir` 声明 `pathParams: { out_dir: 'write' }`；
  `canvas_design_system.extract` 的 `path` 声明 `pathParams: { path: 'read' }`。
  未声明的路径参数宿主不做路径守卫。声明后宿主会传规范化绝对路径，代码已相应处理。
- `canvas_open` 由「并发安全」改为**非并发安全**：它会启动服务并写 `url.txt`，不符合「只读且无副作用」的判据。
- 8 个工具补 `timeoutMs`；`inputSchema` 补 `additionalProperties: false`，与官方示例一致。

### 7. 日志走宿主通道

`console.error` 全部改为 `host.log.warn`（新增 `src/host.ts`）。宿主之外（单测、本地脚本）自动回落到 stderr。清单相应声明 `log` 能力。

`host.isWorker` 为真时**不写 `url.txt`** —— 子会话不重复写用户数据。

---

## 新增

- `npm run check:plugin`：发行前自检。校验清单字段、`engines`、入口格式与 UTF-8、握手（名称 + 描述）、`pathParams` 指向真实参数、路径段规则、体积与文件数。已接入 CI 与 Release 工作流。
- `scripts/pack-plugin.mjs`：按官方规则生成发行 ZIP，只收 `tianshu.plugin.json`、`dist/`、`skills/`、`LICENSE`，并生成 `xiaosi.release.json` / `xiaosi.contents.json`。固定时间戳、只存储不压缩，**同一份源码产物字节一致**（已实测）。

```bash
npm run build && npm run check:plugin
node scripts/pack-plugin.mjs ./tianshu-canvas-0.6.0.zip \
  --release-id rel_tianshu_canvas_060 --publisher-id <发布者 ID> \
  --source-commit "$(git rev-parse HEAD)" --platforms win32-x64
```

---

## 验证

- `npm run verify`：95/95 通过。
- 官方套件 `validate --lane official_reviewed`：`valid: true`，`artifact_bytes` 3.3 MB，`compatibility.core >=4.0.2 <5.0.0`。
- 发行包解压到无 `node_modules` 目录后，真实 Edge 完成「打开画布 → 写页面 → 导出 PNG」（63 KB）全链路。
- 同一份源码连续打包两次，SHA-256 一致。

## 兼容性

- 工具名、参数与行为对用户**完全不变**，无项目数据迁移。
- 新增 3 个发行期开发依赖（`json-canonicalize`、`semver`、`yazl`、`zod`），仅用于打包与自检，不进发行包。
- 已安装 0.5.0 的用户可直接覆盖升级；**新建会话**后生效。
