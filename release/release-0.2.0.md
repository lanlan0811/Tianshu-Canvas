# 天枢画布设计 v0.2.0

> 2026-11-04 · Apache-2.0

**工具精简**：AI 可调用的工具从 10 个合并为 5 个，画布功能与浏览器端体验不变。
这是一次**破坏性变更**：旧工具名全部移除，不提供别名。

---

## 为什么精简

- 重命名、移动本质上都是修改同一个节点，与新增页面重复。
- 列表与读取选中都是只读查询，没必要分成两次调用。
- 删除、复制、连线同属画布编排。
- 工具越少，模型选择越准，清单、技能说明、测试的维护成本也越低。

---

## 工具一览（5 个）

| 工具 | 用途 |
|---|---|
| `canvas_open` | 启动/复用本地画布服务，返回浏览器 URL（不变） |
| `canvas_upsert_page` | 新增或更新页面节点：写入 HTML，或仅改标题/位置/尺寸/设备 |
| `canvas_get_state` | 读取页面列表、连线、用户当前选中项与画布 URL |
| `canvas_arrange` | 编排画布：`action` 为 `remove` / `duplicate` / `link` / `unlink` |
| `canvas_export` | 导出画布 PNG 与/或原型 ZIP（不变） |

---

## 旧名到新名对照

| 旧工具 | 新用法 |
|---|---|
| `canvas_add_page` | `canvas_upsert_page`（参数不变） |
| `canvas_rename_page` | `canvas_upsert_page`，传 `id` + `title`，省略 html |
| `canvas_move_page` | `canvas_upsert_page`，传 `id` + `x` + `y`，省略 html |
| `canvas_list_pages` | `canvas_get_state` |
| `canvas_get_selection` | `canvas_get_state`（返回内的「当前选中」段） |
| `canvas_remove_page` | `canvas_arrange`，`action: remove`，传 `id` |
| `canvas_duplicate_page` | `canvas_arrange`，`action: duplicate`，传 `id`，可选 `title` |
| `canvas_link_pages` | `canvas_arrange`，`action: link`，传 `source` + `target`，可选 `label` |
| `canvas_link_pages`（`remove: true`） | `canvas_arrange`，`action: unlink`，传 `source` + `target` |

---

## 行为说明

- `canvas_upsert_page` 对**已存在的 id**：未指定 `device_type` / `width` / `height` 时沿用节点原有设备与尺寸，只改标题不会把尺寸重置为默认值；未指定 `x` / `y` 时保持原位置。
- 对**不存在的 id 且没有 html** 会报错，不会创建空节点。
- `canvas_arrange` 按 `action` 校验必填参数，缺失时返回错误并指明该 action 需要哪些字段。
- 浏览器端的拖拽、重命名、复制、删除、连线等交互不受影响。

---

## 安装 / 升级

通过天枢「插件中心 → 社区插件 → 从其他来源安装」：

- **Git URL**：填本仓库地址（可指定标签 `v0.2.0`）。
- **本地路径**：填本仓库根目录的绝对路径。

> 已安装旧版的需**先卸载再安装**，并**新建会话**生效；旧会话里记住的旧工具名将不可用。

---

## 工程与验证

- 测试同步迁移到新工具名，并新增：upsert 仅改元数据（HTML 与尺寸不被重置）、切换设备预设、不存在 id 报错；arrange 四个 action 的正常与错误路径、删除节点连带删边与文件、重复连线去重与 label 更新。
- 契约测试确认握手恰好为 5 个工具且与清单一致。
- 构建产物 `dist/` 已随仓库更新。

## 许可

Apache License 2.0（见 [LICENSE](../LICENSE)）。功能与使用见 [release-0.1.2.md](release-0.1.2.md)。
