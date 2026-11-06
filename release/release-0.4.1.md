# 天枢画布设计 v0.4.1

> 2026-11-06 · Apache-2.0

小版本。新增**元素批注**：在画布上直接圈出要改的地方，AI 一次读回全部批注并逐条修改。工具由 8 个增至 **9 个**。

---

## 新增

### 元素批注（画布上直接跟 AI 说改哪里）

以前改设计只能选中一处、点「复制修改请求」把文本粘给 AI，一次一处、来回切换。现在可以：

- **打图钉**：在画布上选中元素，面板里写一句话（如「这个按钮改成主色、字号加大」），点「添加批注」。
  元素左上角出现**编号图钉**，节点标题栏显示「批注 N」。
- **批量交给 AI**：**`canvas_comments`** 工具（`action`: list / resolve / reopen / remove）。
  `action=list` **一次读回全部待处理批注**，含所属页面标题、标签、`xpath`、当前文本与批注内容；
  AI 按 xpath 逐条修改（通常用 `canvas_upsert_page` 重写该页），改完再用 `action=resolve` 传 ids 批量标记已解决。
- **图钉由探针在 iframe 内绘制**：按 `xpath` 定位、用文档坐标绝对定位，因此不受画布缩放、平移或页面滚动影响；
  已解决的批注不再显示图钉。

批注存在 `project.json` 的 `comments[]`（随项目版本化、随导出 ZIP 一起带走），缺省即没有批注，旧项目无需迁移。

## 变更

- **工具数 8 → 9**：新增 `canvas_comments`。
- **`project.json` 新增可选字段** `comments: Comment[]`；`Comment` 含 `id / pageId / xpath / tagName / textContent? / note / createdAt / resolved / resolvedAt?`。
- `canvas_get_state` 末尾会提示「待处理批注：N 条」，AI 无需额外调用即可察觉。
- 新增 `GET /api/comments`（读）与 `POST /api/comments`（op: add / resolve / remove），沿用既有的自定义头 CSRF 防护。

## 修复

- **批量改错一处**：无效批注（缺 id / 非字符串 xpath / 空批注内容）在读取时被静默过滤，不影响其余条目。
- **删除页面后残留批注**：`canvas_arrange`（action=remove）现在会连带删除该页的所有批注。

## 说明

- 图钉只做展示、不拦截点击：它落在元素左上角外沿，点击仍能正常选中元素。
- 面板里每条批注可单独「解决 / 重开 / 删除」；AI 侧与画布侧的状态通过 SSE 实时同步。
- 测试由 62 个增至 63 个，新增元素批注（list / resolve / reopen / remove、非法条目归一化、节点连带删除、`/api/comments` 读写往返）。

---

## 升级后你需要做的

通过天枢「插件中心 → 社区插件 → 从其他来源安装」：填本仓库地址（可指定标签 `v0.4.1`），或填本仓库根目录的绝对路径。已安装旧版的需**先卸载再安装**，并**新建会话**生效。

## 许可

Apache License 2.0（见 [LICENSE](../LICENSE)）。设计系统数据说明见 [design-systems/README.md](../design-systems/README.md) 与 [NOTICE.md](../design-systems/NOTICE.md)。
