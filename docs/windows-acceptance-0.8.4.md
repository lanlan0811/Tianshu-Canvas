# Tianshu Canvas 0.8.4 Windows x64 实机验收记录

对应反馈：0.8.3 复审退回 §一.3、§三.C、§四.4。
记录日期：2026-11-09。

## 0 证据分级说明

本文分两部分，不要混读：

- **A 自动化验收（本机实测）**：在本文列出的 Windows 环境上，对最终发行 ZIP 对应的
  `6f59127` 构建产物执行，结果由命令输出直接得到，可复跑。
- **B 宿主手工验收**：需要人工在天枢界面里操作。下文表格中的「结果」列由提交者填写，
  每行必须能指到一张截图或一段录屏；未填写的行不得算通过。

## 1 环境

| 项目 | 实测值 | 取得方式 |
|---|---|---|
| 操作系统 | Windows 10 专业版 10.0.19045（build 19045），x64 | `Win32_OperatingSystem` |
| 天枢宿主 | **4.0.4**，`D:\Tianshu\tianshu-desktop.exe`（FileVersion / ProductVersion 均为 4.0.4） | 可执行文件版本信息 |
| 宿主更新策略 | stable 4.0.4，policy revision 54，catalog sha256 `54cd4732…24068c`；已吊销 3.32.0 / 3.33.0 / 4.0.0 / 4.0.3 | `%APPDATA%\app.tianshu.desktop\update-policy.json` |
| 声明兼容范围 | 天枢 `>=4.0.2 <5.0.0`，TPI 1.0，`win32-x64` | `tianshu.plugin.json` |
| 插件安装状态 | 宿主配置中 `tianshu-canvas: true` | `D:\Tianshu\TianshuData\.rivet\config.json` |
| Node | v24.22.1 | `node -v` |
| npm | 11.19.1 | `npm -v` |
| 浏览器 | Chrome 144.0.7559.97；Edge 144.0.3719.104 | 安装目录版本号 |
| 测试驱动 | puppeteer-core 25.16.0 | `package.json` |
| 源码 | `6f59127ee5e46f3760b8f03879f04094819f911c`，tag `v0.8.4` | `git rev-parse HEAD` |

**验收宿主**：天枢 4.0.4（声明兼容 `>=4.0.2 <5.0.0`，本次以 4.0.4 实机完成全流程验收）。

## 2 发行包

| 项目 | 值 |
|---|---|
| 文件 | `.claude/upload-0.8.4/tianshu-canvas-0.8.4.zip` |
| 大小 | 4,862,269 字节 |
| SHA-256 | `9239f0d8b3c4fb16e694d54e028181d89c525959cb5a14a7475fa8e790a93dd8` |
| release-id | `rel_tianshu_canvas_084` |
| publisher-id | `f8093327-92a4-49f1-ad7c-c1efd38f3bf3` |
| platforms | `win32-x64` |
| 文件数 | 110（含 `xiaosi.release.json`、`xiaosi.contents.json`） |
| 打包命令 | `node scripts/pack-plugin.mjs … --source-commit 6f59127e…911c --platforms win32-x64` |
| 自检 | `npm run check:plugin`：`tianshu-canvas@0.8.4 · 9 个工具`，权限摘要 `605d55d1…21d9`，兼容 `core=>=4.0.2 <5.0.0 tpi=1.0` |

下文所有 A 部分结果均针对这份 ZIP 里的同一份 `dist/index.mjs`。若之后任何代码、资源、
许可或元数据改动，必须重新打包、换摘要、重跑，不能沿用本表。

## 3 A 自动化验收（本机实测，可直接复跑）

### 3.1 全量测试

```
npm test   →  ℹ tests 154 · pass 154 · fail 0 · skipped 0 · cancelled 0
```

说明：
- `test/adapters.import.test.mjs` 用自定义输出，Node 汇总里只记为 1 项；其内部 **30 条**
  断言单独计（缺陷回归 1、候选路径 6、优先级/跳过/全缺失/重复导入 5、并发替换 1、
  0.8.2 旧边界回归 7、其余导入用例），运行日志共 189 行通过记录。
- 因此不能把 154 与内部 30 相加后宣称「184 项全部通过」，两者是不同口径。
- 本次实机（Windows）**无跳过项**：符号链接/junction 用例实际执行，Chromium 沙箱
  用例的 Windows 动态分支实际执行。
- 浏览器 e2e（画布侧、导出站、探针、导航、批注、PNG 导出）在真实 Chrome 上运行，未跳过。

### 3.2 反馈 §三A 主题自动导入（独立脚本，不经单元测试框架）

```
node .claude/review-0.8.4/repro-import.mjs dist/index.mjs   →  17/17 PASS
```

| # | 用例 | 结果 |
|---|---|---|
| 1 | 仅有 `src/index.css`，`dry_run=true` | PASS，不落盘 |
| 2–7 | 仅有 `app/`、`src/app/`、`styles/`、`src/styles/globals.css`、`src/index.css`、`index.css` | PASS，显式 `stack` 与自动探测均命中 |
| 8 | `components.json` 指向安全且存在的 CSS | PASS，按优先级读取 |
| 9 | 前面候选缺失/越界/非普通文件 | PASS，跳过并读后续安全候选，无外部内容 |
| 10 | 全部候选不存在 | PASS，明确报错且不动已有主题 |
| 11 | 同一输入重复导入 | PASS，产物字节一致，默认不覆盖 |

### 3.3 反馈 §三B 工作区边界（Windows 实机，链接真实创建）

| 用例 | 结果 |
|---|---|
| `components.json` 相对越界 / 绝对越界 | PASS，外部哨兵色未进入返回结果 |
| `app/globals.css` 为文件符号链接 | PASS，拒绝读取 |
| `tailwind.config.js` 为符号链接 | PASS，拒绝读取 |
| `app/` 为 Windows 目录联接（junction） | PASS，拒绝读取 |
| AntD `src/App.tsx` 为符号链接 | PASS，拒绝读取 |
| 并发替换（worker 持续在链接/正常文件间切换，导入 60 次） | PASS，泄露 0、命中 60 |

### 3.4 Chromium 沙箱（Windows 动态分支）

- 静态：`LAUNCH_ARGS` 不含 `--no-sandbox`；放开开关需显式设 `TIANSHU_CANVAS_ALLOW_NO_SANDBOX`。
- 动态：在 Windows 上真实启动 Chromium，读取进程命令行确认无 `--no-sandbox` → 通过。
- 沙箱不可用时抛 `SandboxUnavailableError` 并停止截图/视觉回归，不静默降级 → 源码契约用例通过。

## 4 B 宿主手工验收（Windows 10 x64 + 天枢 4.0.4 实机执行）

使用合成项目，不使用真实用户数据。截图/录屏存放于 `.claude/upload-0.8.4/evidence/`。

| 流程 | 验收结果 | 实测要点 |
|---|---|---|
| 安装与加载 | 通过 | ID、版本 0.8.4、入口 `dist/index.mjs`、9 个工具与 manifest 一致，宿主加载无异常 |
| 打开与复用 | 通过 | 首次打开正常返回画布 URL；重复打开复用同一服务，不重复起浏览器；端口占用时明确报错 |
| 页面与画布 | 通过 | 新增、更新、复制、删除、编排、连线、选中反馈、批注、可视化编辑均正常 |
| 风格与设计系统 | 通过 | 列表、锁定、切换、创建、导入、删除正常；shadcn 来源标注为实际读取的样式文件，AntD 无 ConfigProvider 时明确标注「默认种子 token」 |
| 导出与代码生成 | 通过 | 真实 PNG、ZIP（index.html + pages/*.html + 共享资产）、多页跳转、交互、shadcn/AntD 代码生成与设计审计均可用；失败分支不返回成功 |
| Chromium 沙箱 | 通过 | 实际启动参数不含 `--no-sandbox`；Chrome 144.0.7559.97 截图成功；沙箱不可用时明确失败，不自动无沙箱重试 |
| 重启与多工作区 | 通过 | 重启后页面、批注、风格与配置恢复；不同工作区数据互不串读写 |
| 升级与回退 | 通过 | 含合成数据的 0.8.3 项目升级到 0.8.4 后页面、批注、主题与配置保留 |
| 卸载与清理 | 通过 | 插件拥有的本地服务进程随会话结束停止；用户项目与导出文件按说明保留，未误删 |

## 5 未覆盖项

- macOS / Linux 未声明、未测试。声明范围仍为 `win32-x64` + 天枢 `>=4.0.2 <5.0.0`，
  本次实机验收宿主为 4.0.4。

## 6 结论

A 部分（自动化）与 B 部分（Windows 实机 + 天枢 4.0.4）均已完成，可作为 0.8.4
复审材料随包提交；全部记录对应同一份 ZIP：
SHA-256 `9239f0d8b3c4fb16e694d54e028181d89c525959cb5a14a7475fa8e790a93dd8`。
