# Tianshu Canvas 0.9.1 Windows x64 实机验收记录

本版为交互精简版（选中面板只留批注、右键菜单只留预览、设计风格画布只读），非复审反馈版本。
记录日期：2026-11-10。

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
| 文件 | `.claude/upload-0.9.1/tianshu-canvas-0.9.1.zip` |
| 大小 / SHA-256 | 见随包提交的上传表单文案；包内 `xiaosi.contents.json` 给出每个文件的摘要 |
| release-id | `rel_tianshu_canvas_091` |
| publisher-id | `f8093327-92a4-49f1-ad7c-c1efd38f3bf3` |
| platforms | `win32-x64` |
| 打包命令 | `node scripts/pack-plugin.mjs … --source-commit <本包 source_commit> --platforms win32-x64` |
| 自检 | `npm run check:plugin`：`tianshu-canvas@0.9.1 · 9 个工具`，权限摘要 `605d55d1…21d9`，兼容 `core=>=4.0.2 <5.0.0 tpi=1.0` |

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

- 本次实机（Windows）**无跳过项**：符号链接 / junction 用例实际执行，Chromium 沙箱
  用例的 Windows 动态分支实际执行。
- 浏览器 e2e（画布侧、导出站、探针、导航、批注、PNG 导出、预览）在真实浏览器上运行，未跳过。

### 3.2 本版行为回归（真实浏览器）

```
node --test --test-concurrency=1 test/rendering.e2e.test.mjs
→ OK 渲染 e2e: 面板只留批注、批注落盘不改文件、高度稳定、自动刷新

node --test --test-concurrency=1 test/probe.e2e.test.mjs
→ OK 探针 e2e: 两层选择（div / button）+ 面板只读（无编辑入口）

node --test --test-concurrency=1 test/preview.e2e.test.mjs
→ OK 预览 e2e：右键菜单/四设备/自定义尺寸拖拽/缩放/原生交互/站内跳转/外链拦截/退出，全部通过
```

| 组 | 断言 | 结果 |
|---|---|---|
| 选中面板只读 | 选中元素后没有样式/文案编辑输入框，没有「应用修改」；只有批注输入框 | PASS |
| 批注闭环 | 填批注 → 写入 `project.json` 的 `comments[]`，原型文件字节不变 | PASS |
| 伪造消息 | 页面脚本伪造 `__vd_edit_applied` / `__vd_apply_edits` 不能改写页面文件 | PASS |
| 两层选择回归 | 普通点击选中区块、Ctrl 点击选最内层；面板出现且为只读 | PASS |
| 右键菜单 | 节点右键**恰好**两项：`预览`、`预览设备`；四设备二级菜单与打勾正常 | PASS |
| 预览功能回归 | 网页/平板/手机/自定义、缩放、预览内交互、站内跳转、外链拦截、Esc 退出均正常 | PASS |
| 高度与刷新 | 节点高度稳定无反馈循环；只改标题不刷新 iframe，改 HTML 自动刷新 | PASS |
| 接口移除 | `GET/POST /api/page-html`、`POST /api/design` 均 404；`/api/design-systems` 正常 | PASS |

### 3.3 回归

既有 e2e 与单测全部通过，重点：

| 测试 | 覆盖 | 结果 |
|---|---|---|
| `test/nav.e2e.test.mjs` | 画布内链接跳节点、Ctrl 点击只选中、外链不跳、`<details>` 原生行为 | PASS |
| `test/canvas-state.e2e.test.mjs` | 平移 / 项目刷新不丢选中、视口恢复 | PASS |
| `test/interaction.e2e.test.mjs` | 交互库（tabs/modal/滚动/指针） | PASS |
| `test/comments.test.mjs` | `canvas_comments` list/resolve/reopen/remove 与 `/api/comments` 往返 | PASS |
| `test/server.test.mjs` | `/page/:id` 探针注入、鉴权、CSP、CSRF 头、已移除接口返回 404 | PASS |
| `test/contract.test.mjs` | 清单 9 个工具握手一致（名称 + 描述逐字） | PASS |

### 3.4 构建与产物一致性

```
npm run typecheck         → 通过（Node + Web 两套 tsconfig）
npm run build             → 通过
git diff --exit-code -- dist → 空（提交产物与源码一致）
npm run check:plugin      → OK tianshu-canvas@0.9.1 · 9 个工具，打包 109 个文件，解包 4739.1 KiB
```

## 4 B 宿主手工验收（Windows 10 x64 + 天枢 4.0.4 实机执行）

使用合成项目，不使用真实用户数据。

| 流程 | 验收结果 | 实测要点 |
|---|---|---|
| 安装与加载 | 通过 | ID、版本 0.9.1、入口 `dist/index.mjs`、9 个工具与 manifest 一致，宿主加载无异常 |
| 打开与复用 | 通过 | 首次打开返回带随机路径的 `canvas_open` 链接；重复打开复用同一服务 |
| 选中面板 | 通过 | 选中元素后只显示选中信息、「复制修改请求」、批注输入与批注列表；无文案/样式编辑，无「应用修改」 |
| 批注闭环 | 通过 | 写批注后图钉与「批注 N」徽标出现；AI 读回并逐条修改后标记解决，列表状态同步 |
| 右键菜单 | 通过 | 页面节点右键只有「预览」「预览设备」；重命名/复制/删除仍可在节点悬浮工具栏完成 |
| 设计风格只读 | 通过 | 顶栏徽标带锁图标、不可点击、无下拉；风格切换由 AI 侧 `canvas_style` 完成，页面视觉正常 |
| 预览回归 | 通过 | 预览、四设备切换、自定义尺寸、跳转、外链拦截、退出均正常 |
| 画布编排 | 通过 | 节点拖拽移动、工具栏重命名/复制/删除、页面连线均正常 |
| 数据边界 | 通过 | 批注写入 `project.json`；预览与风格展示不写盘；`selection.json` 不含 `editableText` |
| 升级与回退 | 通过 | 含合成数据的 0.9.0 项目升级到 0.9.1 后页面、批注、主题与配置保留 |
| 卸载与清理 | 通过 | 最后一个插件会话结束后本地服务停止、凭证撤销；用户项目与导出文件按说明保留 |

## 5 未覆盖项

- macOS / Linux 未声明、未测试。声明范围仍为 `win32-x64` + 天枢 `>=4.0.2 <5.0.0`，
  本次实机验收宿主为 4.0.4。
- 画布上不提供元素级写操作（改文案/改样式/增删页面由 AI 或节点工具栏完成），属本版设计。
- 预览设备选择只保存在前端内存，刷新后回到「网页」（设计如此，不写盘）。
- B 部分的截图 / 录屏证据随提交材料提供，不随本 ZIP 分发。

## 6 结论

A 部分（自动化 + 本版行为回归 + 既有回归）与 B 部分（Windows 实机 + 天枢 4.0.4）均已完成，
可作为 0.9.1 的发行验收材料随包提交；全部记录对应本 ZIP
（摘要与源码提交见包内 `xiaosi.release.json` 及上传表单）。
