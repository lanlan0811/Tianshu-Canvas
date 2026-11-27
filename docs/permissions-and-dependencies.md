# 权限用途与前置依赖

本文件面向安装者与审查者，说明 `tianshu.plugin.json` 中 `permissions` 的真实用途、
运行所需的前置依赖、写入文件的权限边界，以及发行产物 `dist/index.mjs` 的审计指引。

## 1. 权限声明与实际用途

清单声明三个布尔（`tianshu.plugin.json` 的 `permissions`）：

| 字段 | 声明值 | 实际用途 |
|---|---|---|
| `fs` | `true` | 读写工作区内的 `.tianshu-canvas/`（页面 HTML、项目状态、审计报告、截图、导出物），以及用户显式指定的路径 |
| `net` | `true` | 仅在用户显式触发时，经 SSRF 白名单抓取外部 URL：`canvas_upsert_page` 的 `inline_assets` 资源内联、`canvas_design_system` 的从 URL 反抽取 |
| `shell` | `true` | 仅两处进程启动，见下 |

### `shell` 权限的真实用途

1. **调起系统默认浏览器打开画布**：`canvas_open`（`open: true` 时）与画布内「打开」操作。
   Windows 上执行 `cmd /c start "" <画布URL>`，其他平台把 URL 交给系统默认打开方式。
   argv 全部是常量或插件自造的本地 URL（`http://127.0.0.1:<port>/w/<32位hex>/?ws=<32位hex>#<64位hex>`）。
2. **启动 headless Chromium 做截图与审计**：PNG 导出、`canvas_audit` 的渲染类 action。
   启动参数固定（`--headless=new --disable-extensions --no-first-run` 等，**不含** `--no-sandbox`），
   页面来自本地画布服务或工作区内文件。

**不接收用户输入的命令**：这两处都不经过 shell 解析用户提供的字符串，也不存在"执行任意命令"的工具入口。

### TPI 1.0 下的语义

天枢 TPI 1.0 的 `permissions` 三布尔**只用于安装审查展示，运行时不强制**（插件与内核同进程，
宿主源码 `src/plugins/manifest.ts` 对该 schema 的注释写明 "Informational only — NOT enforced"）。
真实能力面等于完整 Node 进程能力；本文件披露的是插件**实际用到**的部分，而不是授权边界。
TPI 2.x 起 `permissions` 变为强制授权清单。

## 2. 前置依赖：Chrome/Edge

以下功能需要本机安装 Chrome 或 Edge（Chromium 内核），或通过环境变量 `TIANSHU_CANVAS_BROWSER`
指定浏览器可执行文件路径：

| 功能 | 触发方式 |
|---|---|
| 可访问性审计 | `canvas_audit`，`action=a11y` |
| 渲染工艺审计 | `canvas_audit`，`action=quality` |
| 状态完整性审计 | `canvas_audit`，`action=states` |
| 动效抓帧 | `canvas_audit`，`action=motion` |
| UX 评审 B 阶段渲染检测 | `canvas_audit`，`action=ux`，`phase=b` |
| 视觉基线 / 回归 / 多尺寸评审截图 | `canvas_audit`，`action=baseline` / `visual` / `review` |
| PNG 导出（画布顶栏「导出」，无对应 AI 工具） | 用户在画布上操作 |

不需要浏览器：`action=contract`（源码级契约）、`action=drift`（设计漂移比较）、
页面写入、风格管理、设计系统、批注、代码生成、ZIP 导出。

缺失浏览器时工具返回可读的中文错误（`isError: true`），不静默降级。

### 沙箱语义

截图与视觉回归**保留 Chromium 进程沙箱**；沙箱启动失败时操作整体报错停止，不会无沙箱重试。
仅在确实无法启用沙箱的受限环境，可用 `TIANSHU_CANVAS_ALLOW_NO_SANDBOX=1` 显式放开。

## 3. 写入文件的权限边界

- 所有工作区写入经统一原子写入入口：独占创建随机临时文件（`openSync(..., 'wx', 0o600)`）→ 写入 → `rename`，
  写入前后校验工作区边界与符号链接，防 TOCTOU 替换。
- **Windows 上 `0o600` 不映射为 ACL**：Node 在 Windows 不支持 POSIX mode 位，生成文件的 ACL 与默认写文件相同
  （实测含 `NT AUTHORITY\Authenticated Users:(I)(M)` 与 `BUILTIN\Users:(I)(RX)`）。
  影响限于同机多用户场景：`.tianshu-canvas/` 下的页面 HTML、审计报告、截图对其他本机用户可读可改。
- **目录内不含凭据**：画布访问令牌（token / secret）只在内存与返回给用户的 URL 中存在；
  落盘的 `.tianshu-canvas/url.txt` 在写入前已把 `pathname` 改为 `/`、清空 `hash`，内容为 `http://127.0.0.1:<port>/`。
- 多用户共用机器的用户，建议自行对该目录设置 ACL，或使用独立账户运行天枢。
  单用户机器上无实际影响。

## 4. 发行产物审计指引（`dist/index.mjs`）

发行包内的 `dist/index.mjs` 是单文件 ESM bundle（约 3.0 MB / 75 000 行），由 esbuild 把插件源码与
内联依赖（`puppeteer-core`、`@puppeteer/browsers`、`ws` 等）打进一个文件，不含 source map。

- **vendor 段**以 `// node_modules/...` 注释开头，位于文件前部（约前 6 万行）；
- **插件自身源码**从 `// src/tpi.ts` 起，`// src/` 注释标记各源模块。

定位命令（行号随每次构建变化，以命令现查为准）：

```bash
grep -n "^// src/" dist/index.mjs | head -1   # 自身源码起点
grep -c "^// node_modules/" dist/index.mjs    # vendor 段数量
```

**已知的机检假阳性**：对 bundle 做文本匹配式扫描（如 `new Function` / `eval(`）时，
命中集中在 vendor 段（puppeteer 内部工具函数、内联的 evaluator 源码字符串、API 文档注释），
输入不经过用户。自身源码区（`// src/` 之后）不含 `new Function`、`eval(`、`vm.run`、`createRequire`。
审查时可按上述命令先划出 vendor 区间再逐条定位。

## 5. 不上报任何数据

本插件不发送遥测、统计或崩溃信息，不连接插件作者的任何服务器。
出站网络请求只发生在第 1 节 `net` 所述的两处显式触发场景。
