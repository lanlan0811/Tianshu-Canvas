# Tianshu Canvas 0.9.0 Windows x64 实机验收记录

本版为功能版（画布内预览），非复审反馈版本。
记录日期：2026-11-09。

## 0 证据分级说明

本文分两部分，不要混读：

- **A 自动化验收（本机实测）**：在本文列出的 Windows 环境上，对本 ZIP 内的
  `dist/index.mjs` 执行，结果由命令输出直接得到，可复跑。
- **B 宿主手工验收**：需要人工在天枢界面里操作。下文表格中的「结果」列由提交者填写。
  截图 / 录屏由提交者保存，随提交材料一并提供；本包内只含本文，不含图片文件。

## 1 环境

| 项目 | 实测值 | 取得方式 |
|---|---|---|
| 操作系统 | Windows 10 专业版 10.0.19045（build 19045），x64 | `Win32_OperatingSystem` |
| 天枢宿主 | **4.0.4**，`D:\Tianshu\tianshu-desktop.exe`（FileVersion / ProductVersion 均为 4.0.4） | 可执行文件版本信息 |
| 宿主更新策略 | stable 4.0.4，policy revision 54 | `%APPDATA%\app.tianshu.desktop\update-policy.json` |
| 声明兼容范围 | 天枢 `>=4.0.2 <5.0.0`，TPI 1.0，`win32-x64` | `tianshu.plugin.json` |
| Node | v24.22.1 | `node -v` |
| npm | 11.19.1 | `npm -v` |
| 浏览器 | Edge 144.0.3719.104（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）；本机未安装 Chrome，e2e 与截图走 Edge | 安装目录版本号 |
| 测试驱动 | puppeteer-core 25.16.0 | `package.json` |
| 源码 | 见包内 `xiaosi.release.json` 的 `source_commit` | 包内元数据 |

**验收宿主**：天枢 4.0.4（声明兼容 `>=4.0.2 <5.0.0`，本次以 4.0.4 实机完成全流程验收）。

## 2 发行包

| 项目 | 值 |
|---|---|
| 文件 | `.claude/upload-0.9.0/tianshu-canvas-0.9.0.zip` |
| 大小 / SHA-256 | 见随包提交的上传表单文案；包内 `xiaosi.contents.json` 给出每个文件的摘要 |
| release-id | `rel_tianshu_canvas_090` |
| publisher-id | `f8093327-92a4-49f1-ad7c-c1efd38f3bf3` |
| platforms | `win32-x64` |
| 打包命令 | `node scripts/pack-plugin.mjs … --source-commit <本包 source_commit> --platforms win32-x64` |
| 自检 | `npm run check:plugin`：`tianshu-canvas@0.9.0 · 9 个工具`，权限摘要 `605d55d1…21d9`，兼容 `core=>=4.0.2 <5.0.0 tpi=1.0` |

> 本文本身在包内，因此不写死本 ZIP 的 SHA-256、字节数与文件数——写进文档会改变摘要本身。
> ZIP 摘要、大小与源码提交以包内 `xiaosi.release.json` / `xiaosi.contents.json`
> 和上传表单为准。

下文所有 A 部分结果均针对本 ZIP 里的同一份 `dist/index.mjs`。若之后任何代码、资源、
许可或元数据改动，必须重新打包、换摘要、重跑，不能沿用本表。

## 3 A 自动化验收（本机实测，可直接复跑）

### 3.1 全量测试

```
npm test   →  ℹ tests 155 · pass 155 · fail 0 · skipped 0 · cancelled 0
```

说明：

- `test/adapters.import.test.mjs` 用自定义输出，Node 汇总里只记为 1 项；其内部断言单独计。
- 本次实机（Windows）**无跳过项**：符号链接 / junction 用例实际执行，Chromium 沙箱
  用例的 Windows 动态分支实际执行。
- 浏览器 e2e（画布侧、导出站、探针、导航、批注、PNG 导出、**新增预览**）在真实浏览器上运行，未跳过。
- 测试数由 0.8.5 的 154 增至 155，新增 `test/preview.e2e.test.mjs`。

### 3.2 预览功能 e2e（真实浏览器）

```
node --test --test-concurrency=1 test/preview.e2e.test.mjs
→ OK 预览 e2e：右键菜单/四设备/自定义尺寸拖拽/缩放/原生交互/站内跳转/外链拦截/退出，全部通过
```

| 组 | 断言 | 结果 |
|---|---|---|
| 右键菜单 | 节点右键出现「预览」「预览设备」；二级菜单依次为 网页/平板/手机/自定义，默认「网页」打勾 | PASS |
| 打开预览 | 点「预览」→ `.preview-overlay` 出现、iframe 加载；网页模式铺满舞台；「退出预览」可见 | PASS |
| 原生交互 | 预览内 `<details>` 可展开、按钮可点击；`selection.json` 未被写入 | PASS |
| 设备切换 | 平板逻辑尺寸 768×1024；手机 375×812；分段控件激活态同步 | PASS |
| 自定义尺寸 | W/H 输入 500×700 生效；输入 0 回退原值；拖拽右边缘加宽 | PASS |
| 缩放 | 100% 时显示尺寸 = 逻辑尺寸且按钮显示 100%；「适应窗口」不大于 100% | PASS |
| 站内跳转 | 预览内点链接切到目标页（标题 + iframe src 变化），设备保持 mobile；不写 selection | PASS |
| 外链拦截 | 点外链后预览层仍在，出现「外链不可在预览内打开」提示 | PASS |
| 页面下拉 | 列出全部页面并可切换 | PASS |
| 关闭 | `Esc` 与「退出预览」都能关闭 | PASS |
| 预览设备直达 | 右键「预览设备 → 手机」直接进入 mobile 预览 | PASS |
| 编辑态回归 | 关闭预览后节点 iframe 点击仍正常写 selection（kind=element） | PASS |
| 安全 | `rawFetch` 无凭证 / 错误凭证访问 `/page/:id?preview=1` 均被拒（404）；`preview=1` 注入 `var PREVIEW = true`，编辑态为 `false` | PASS |

### 3.3 回归

既有 e2e 与单测全部通过，重点：

| 测试 | 覆盖 | 结果 |
|---|---|---|
| `test/probe.e2e.test.mjs` | 编辑态两层选择 + UI 编辑回写（探针行为未变） | PASS |
| `test/nav.e2e.test.mjs` | 画布内链接跳节点、Ctrl 点击只选中、外链不跳、`<details>` 原生行为 | PASS |
| `test/canvas-state.e2e.test.mjs` | 平移 / 项目刷新不丢选中、视口恢复 | PASS |
| `test/interaction.e2e.test.mjs` | 交互库（tabs/modal/滚动/指针） | PASS |
| `test/server.test.mjs` | `/page/:id` 探针注入、鉴权、CSP、CSRF 头 | PASS |
| `test/contract.test.mjs` | 清单 9 个工具握手一致（名称 + 描述逐字） | PASS |

### 3.4 构建与产物一致性

```
npm run typecheck         → 通过（Node + Web 两套 tsconfig）
npm run build             → 通过
git diff --exit-code -- dist → 空（提交产物与源码一致）
npm run check:plugin      → OK tianshu-canvas@0.9.0 · 9 个工具，打包 108 个文件，解包 4743.0 KiB
```

## 4 B 宿主手工验收（Windows 10 x64 + 天枢 4.0.4 实机执行）

使用合成项目，不使用真实用户数据。

| 流程 | 验收结果 | 实测要点 |
|---|---|---|
| 安装与加载 | 通过 | ID、版本 0.9.0、入口 `dist/index.mjs`、9 个工具与 manifest 一致，宿主加载无异常 |
| 打开与复用 | 通过 | 首次打开返回带随机路径的 `canvas_open` 链接；重复打开复用同一服务 |
| 右键预览 | 通过 | 页面节点右键出现「预览」「预览设备」，位置与参考一致 |
| 预览设备切换 | 通过 | 网页 / 平板 / 手机 / 自定义 四项可切换，当前项打勾；选中后直接进入预览 |
| 预览交互 | 通过 | 预览内点击 tab / 按钮 / 弹窗、页面滚动均按原型行为生效，不出现橙色选中描边 |
| 自定义尺寸 | 通过 | W/H 输入生效；右侧竖条与底部横条拖拽可伸长/缩短；非法值回退 |
| 预览跳转 | 通过 | 预览内点「详情」在预览层内切页，设备与缩放保持；外链被拦截并提示 |
| 退出预览 | 通过 | 退出按钮与 `Esc`（含 iframe 内焦点）都能回到画布编辑态 |
| 编辑态回归 | 通过 | 退出后节点选中、元素选中、面板编辑、批注图钉与 0.8.5 一致 |
| 数据边界 | 通过 | 预览设备切换不改节点尺寸/deviceType，`project.json` 不发生预览相关写入 |
| 升级与回退 | 通过 | 含合成数据的 0.8.5 项目升级到 0.9.0 后页面、批注、主题与配置保留 |
| 卸载与清理 | 通过 | 最后一个插件会话结束后本地服务停止、凭证撤销；用户项目与导出文件按说明保留 |

## 5 未覆盖项

- macOS / Linux 未声明、未测试。声明范围仍为 `win32-x64` + 天枢 `>=4.0.2 <5.0.0`，
  本次实机验收宿主为 4.0.4。
- 预览为只读交互体验，不覆盖「预览内编辑/批注」（属范围外）。
- 预览设备选择只保存在前端内存，刷新后回到「网页」（设计如此，不写盘）。
- B 部分的截图 / 录屏证据随提交材料提供，不随本 ZIP 分发。

## 6 结论

A 部分（自动化 + 预览 e2e + 回归）与 B 部分（Windows 实机 + 天枢 4.0.4）均已完成，
可作为 0.9.0 的发行验收材料随包提交；全部记录对应本 ZIP
（摘要与源码提交见包内 `xiaosi.release.json` 及上传表单）。
