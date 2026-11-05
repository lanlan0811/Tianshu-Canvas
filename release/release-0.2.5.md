# 天枢画布设计 v0.2.5

> 2026-11-05 · Apache-2.0

修复 **PNG 导出在 Windows 上稳定失败**（`Failed to launch the browser process: Code: 0`，stderr 为空）。

---

## 原因

`canvas_export(kind="png")` 返回 `已导出 0 个文件` 与一条没有任何线索的错误：

```
注意：PNG 导出未完成——Failed to launch the browser process:  Code: 0

stderr:

```

排查确认**浏览器其实启动成功了**：失败的 profile 目录里都写下了 `DevToolsActivePort`（这是 Chromium 成功绑定调试端口之后才会写的文件），`Code: 0` 是正常退出码。

真正的症结在于 puppeteer 判定"启动成功"的方式——它不读 `DevToolsActivePort`，而是等 Chromium 往 **stdout 打印一行** `DevTools listening on ws://…`：

```
node_modules/@puppeteer/browsers/lib/launch.js
CDP_WEBSOCKET_ENDPOINT_REGEX = /^DevTools listening on (ws:\/\/.*)$/
```

在天枢宿主进程内这一行拿不到，于是 Chromium 明明已就绪，puppeteer 却只等到进程退出事件，抛出上面那条无信息的错误。同一台机器、同一份参数，在独立 node 进程里用 `puppeteer.launch` 却完全成功——差异正来自宿主进程内的 stdout 管道。

## 修复

**不再依赖 stdout 那一行。** 改为自己 `spawn` 浏览器，读 profile 里的 `DevToolsActivePort` 拿到调试端点，再用 `puppeteer.connect` 接入：

- 启动判定改为轮询 `DevToolsActivePort`（Chromium 真实就绪的信号），与 stdout 无关，宿主环境如何都不受影响。
- 超时/异常时把浏览器 **stderr** 一并带进错误信息，不再出现"stderr 为空"这种无法诊断的失败。
- 失败路径同样强杀浏览器进程树（Windows `taskkill /T`），临时 profile 清理失败时记日志而非静默吞掉。
- 导出前顺带清理超过 2 小时的陈旧 `tsc-png-*` 临时目录（旧版本失败遗留的堆积），不误删正在使用的 profile。

同时移除了 `--disable-dev-shm-usage` 等无用参数，并补齐 `--headless=new`、`--hide-scrollbars` 等截图所需参数。

## 影响

- `kind="png"` 与 `kind="both"` 恢复正常，PNG 产出为整幅画布（实测 3652×1208、约 100–115 KB，页面内容正常渲染）。
- 不再留下孤儿浏览器进程与临时 profile 目录。
- ZIP 导出不受影响，行为不变。
- 工具与接口无变化，无破坏性变更。

---

## 升级后你需要做的

通过天枢「插件中心 → 社区插件 → 从其他来源安装」：填本仓库地址（可指定标签 `v0.2.5`），或填本仓库根目录的绝对路径。已安装旧版的需**先卸载再安装**，并**新建会话**生效；旧会话仍按旧技能说明工作。

## 许可

Apache License 2.0（见 [LICENSE](../LICENSE)）。工具与用法见 [release-0.2.0.md](release/release-0.2.0.md)。
