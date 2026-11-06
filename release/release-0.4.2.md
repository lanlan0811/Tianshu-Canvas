# 天枢画布设计 v0.4.2

> 2026-11-06 · Apache-2.0

小版本。移除 AI 侧的导出工具 `canvas_export`：导出改由用户在画布顶栏自行操作。工具由 9 个回到 **8 个**。

---

## 变更

### 移除 `canvas_export` 工具

导出（画布截图 PNG / 原型打包 ZIP）不再由天枢本体触发，**只由用户在画布顶栏点「导出」自行完成**。

- AI 侧工具数 **9 → 8**：`canvas_export` 从工具清单与插件清单中移除。
- **画布 UI 的导出按钮、`/api/export` 与 `/api/export-file` 路由、导出实现完全保留**，功能对用户无变化。
- 技能与文档同步：明确「导出没有对应工具，不要尝试替用户导出」。

## 说明

- 这是**移除能力**，不涉及 `project.json` 字段变化，旧项目无需迁移。
- 其余 8 个工具（open / upsert_page / get_state / arrange / style / check_style / design_system / comments）不变。
- 测试数不变（63 个）；导出测试改为直接验证画布顶栏所走的 HTTP 路由（`POST /api/export`），
  启动失败的回归用例同样改走该路由，覆盖率不降。

---

## 升级后你需要做的

通过天枢「插件中心 → 社区插件 → 从其他来源安装」：填本仓库地址（可指定标签 `v0.4.2`），或填本仓库根目录的绝对路径。已安装旧版的需**先卸载再安装**，并**新建会话**生效。

> 注意：本次是移除工具，进程内已加载的旧工具清单不会自动刷新，务必**新建会话**。

## 许可

Apache License 2.0（见 [LICENSE](../LICENSE)）。设计系统数据说明见 [design-systems/README.md](../design-systems/README.md) 与 [NOTICE.md](../design-systems/NOTICE.md)。
