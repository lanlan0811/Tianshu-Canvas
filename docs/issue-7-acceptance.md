# Issue #7 修复与验收记录

记录日期：2026-11-10（Asia/Shanghai）。关联：https://github.com/lanlan0811/Tianshu-Canvas/issues/7。

## 1. 证据与适用范围

- 调查与修复基线：`272eed7a58e474f8ba6219964ef39176a34004f4`，分支 `main`，版本 `0.9.1`。
- 本文随修复提交保存，最终提交以 Git 历史中包含本文的交付提交为准；不把基线提交号冒充修复提交号。
- 自动化检查针对本次源码构建的 `dist/`；原版失败用例在重建前针对基线产物执行。
- 本轮不升级版本、不创建 tag、不发布 Release，不使用旧版验收文档作为本次通过证据。
- 本地计划：`.codex/plans/issue-7-workspace-preview-fix.md`；该目录保持 Git 忽略，不随提交分发。

## 2. 环境

| 项目 | 本机实测值 |
|---|---|
| 操作系统 | Windows 10 专业版 10.0.19045，64 位 |
| Node / npm | v24.22.1 / 11.19.1 |
| 浏览器 | Microsoft Edge 144.0.3719.104 |
| 浏览器路径 | `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` |
| Puppeteer | puppeteer-core 25.16.0 |
| 本机宿主文件版本 | 天枢 4.0.4（只读取可执行文件版本；不代表已完成宿主手工验收） |
| 预览矩阵 | DPR 1 / 1.25 / 2；窗口 1400×900 / 800×600 / 1280×500；网页 / 平板 / 手机 / 自定义 |

本机环境与原始证据保存在 `.tmp/issue-7/`，该目录被 Git 忽略，不能假设其他机器已有这些证据。

## 3. 根因与修复边界

### 3.1 点击报错

编辑态 `resolveAtPoint` 负责选中区块，但链接应从实际事件目标向上查找。原版从区块 `el` 调用 `nearestAnchor`，首次点 `div > a > span` 时遗漏链接；浏览器执行相对地址导航后丢掉 `ws`，服务端按既有鉴权规则返回 `404 unknown workspace`。预览态本来从 `e.target` 查找，因而表现不同。

修复保留区块选中与 Ctrl/Meta 最内层选中，使用实际点击目标识别链接。导航链接先阻止浏览器默认导航；仅普通点击发站内导航消息。纯锚点与原生控件保持原行为。没有修改服务端鉴权、scope、cookie、CSP 或 sandbox，没有增加默认工作区回退。

### 3.2 预览显示

原版手机、平板、自定义默认适配缩小；目标 iframe 逻辑尺寸和宿主 DPR 已正确，无证据支持伪造 DPR 或切换 CSS zoom。按用户确认，默认及跨设备切换改为 100%，同设备点击和页面切换保留已选缩放，重新打开重置为 100%。100% 不建立 transform 层；手动适配和百分比缩放仍可用。

舞台采用起始对齐和设备 auto margin，小内容居中、超大内容从左上滚动可达。保留外伸拖拽手柄，移除 fit 的 5% 下限，使合法大尺寸可以完整适配。新增四角真实命中验收进一步发现右下角被既有固定缩放按钮覆盖，因此非网页模式底部留白增至 72px，网页模式仍为 0 留白。预览不写回页面 HTML、节点尺寸或项目文件。

## 4. 复现、回归与防假绿

实施前只读基线：导航、预览、探针、服务相关测试 4 项通过、0 跳过；类型检查、许可检查、插件自检通过。这些结果仅说明原测试漏测，不是修复通过证据。

### 4.1 原版红灯

| 复现 | 原版结果 | 证据 |
|---|---|---|
| 首次嵌套链接及 Ctrl 链接 | 3 条实质回归失败：未取消默认导航；原生控件对照通过。Node 汇总 5 tests / 1 pass / 4 fail（含父测试失败） | `nav-red-baseline.log` |
| 手机默认尺寸 | 期望 100%，原版实际 96%，断言失败 | `preview-red-mobile-default.log` |
| 小窗口手选 100% | 滚动起点 iframe 顶部为 -134px，不可达，断言失败 | `preview-red-mobile-overflow.log` |
| 100% transform | 原版仍有 identity matrix，期望 none 的断言失败 | `preview-red-baseline.log` |

导航红灯使用从 Git 基线 `272eed7` 导出的完整独立 `dist`（`.tmp/issue-7/baseline-dist`），临时测试只替换产物根目录和 helper 导入路径，不覆盖修复后的产物。第一次补存曾因并行构建读到新产物而通过，此结果已作废；上述日志为隔离基线的有效失败结果。

### 4.2 修复后针对性验收

| 检查 | 结果 |
|---|---|
| 导航、修饰键、原生控件、退出预览后复发 | 20 tests / 20 pass / 0 fail / 0 skip，含首次真实鼠标点击 |
| 预览几何、状态交互、fit、截图、现有预览 | 8 tests / 8 pass / 0 fail / 0 skip |
| DPR × 窗口 × 四设备 | 36 / 36 组合通过；iframe 内部视口、CSS 及显示尺寸、DPR、375px 断点、四角真实命中 |
| 预览手动交互 | 75% 站内跳转、切页保留、跨设备重置、重开 100%、按钮、输入、滚轮、四手柄、50% 拖拽逆算及全部缩放选项通过 |
| 极大尺寸 | 10000×10000 手动适配、反复窗口变化、无尺寸振荡、原尺寸四角可达、项目文件不变通过 |
| 安全反例 | 编辑及预览无凭证/错凭证/跨 scope 404，正确 scope/凭证 200，通过 |
| 既有浏览器回归及服务 | 探针、渲染、画布状态、画布及导出交互、服务共 6 tests / 6 pass / 0 fail / 0 skip |
| 类型、许可、代码生成、插件自检 | 通过；代码生成包含 2 项正向和 4 项反向拒绝，不是无类型桩假绿 |

### 4.3 清晰度核实

真实 Edge 在 DPR 1 / 1.25 / 2 生成 6 张手机 100% 与同为 375×812 直连页面的对照 PNG，文件清单在 `.tmp/issue-7/screenshots/preview-clarity-manifest.json`，36 组合数据在同目录 `preview-geometry-matrix.json`。逐一查看三对截图，文字、SVG 与细线未见预览额外缩放模糊；可见差异为预览的设备圆角裁切。此结论是固定合成原型和所列环境的视觉核实，不是对任意原型或其他浏览器的无条件保证。

另用仓库已有 PNG 解码器比较排除四周 20 CSS px 的内部 RGB 像素：DPR 1 为 258620 像素、差异 0；DPR 2 为 1034480 像素、差异 0；DPR 1.25 为 404335 像素、差异 200（约 0.0495%），最大通道差 15。未将小数 DPR 的抗锯齿差异表述为逐像素完全一致。原始结果在同目录 `clarity-interior-pixel-comparison.json`。

### 4.4 构建产物 SHA-256

| 文件 | SHA-256 |
|---|---|
| `dist/index.mjs` | `18d61edb8de6d879d0d818741d3f235702e82d059e7c72a5de6be19a7680fbe0` |
| `dist/web/canvas.js` | `57dddd1705d1b21409200138822033141b8b0f86d9700a32bebf8586bfb387ae` |
| `dist/web/canvas.css` | `3f6f0dbcdaa281d28e66db95954f42114ff0c32324953a15483804fc941776d8` |

### 4.5 严格全量验收

本机按正式浏览器环境运行 `npm test`，结果 **186 tests / 186 pass / 0 fail / 0 skipped / 0 cancelled**，耗时 298455.8466ms。日志为 `.tmp/issue-7/full-test.log`。其中 Windows 动态 Chromium 沙箱、符号链接/junction 及全部浏览器 E2E 实际执行，没有以跳过替代通过。

本地类型检查、构建、第三方许可一致性、代码生成正反向验收和插件自检均成功。提交包含对应源码、重建产物和本文；远端提交 SHA 与 CI run 以 Git 历史和该提交的 GitHub Actions 为准。远端 CI 结论需在推送后核实，不把本地成功冒充远端成功。

### 正式本地验证命令

```powershell
$env:TIANSHU_CANVAS_REQUIRE_BROWSER = '1'
$env:TIANSHU_CANVAS_BROWSER = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:TIANSHU_CANVAS_PREVIEW_EVIDENCE = '.tmp/issue-7/screenshots'
npm run typecheck
npm run build
npm run notices:check
node --test --test-concurrency=1 test/nav.e2e.test.mjs test/preview.e2e.test.mjs test/preview-geometry.e2e.test.mjs test/probe.e2e.test.mjs test/rendering.e2e.test.mjs test/canvas-state.e2e.test.mjs test/interaction.e2e.test.mjs
npm test
npm run verify:codegen
npm run check:plugin
```

新增共享浏览器入口：CI 或 `TIANSHU_CANVAS_REQUIRE_BROWSER=1` 缺浏览器硬失败；显式路径无效硬失败，不能回退后假绿。关键 E2E 接入该入口。CI 在测试前定位可执行浏览器、输出版本、传入显式路径和严格标志。

安全负例使用 `rawFetch` 绕过 Node 测试客户端的 Bearer 垫片，编辑态与预览态分别验证无凭证、错凭证、跨 scope 均被拒绝，并有正确 scope/凭证的 200 正例。

## 5. 尚未覆盖与发布限制

- 天枢宿主内的手工安装、原生窗口交互验收未完成；文件版本检查和浏览器 E2E 不能代替宿主手工操作。
- 系统设置下的 Windows 经典原生滚动条需要单独人工确认；测试中的舞台滚动与稳定 gutter 不能冒充该系统配置。
- 手动适配或百分比缩小时受物理像素限制，不承诺与 100% 相同的文字像素表现。
- 未读取、未修改 `official-website`。不改变 HTTP API、插件接口、项目格式及版本，不新增运行依赖。
- 本次不是 Release；未来发布仍必须有对应版本的 `release/release-<版本>.md`，并在相同提交 CI 全绿后由 `release.yml` 执行。
