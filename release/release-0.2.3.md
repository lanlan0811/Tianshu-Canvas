# 天枢画布设计 v0.2.3

> 2026-11-04 · MIT

修复**使用画布设计时，工作区里多出 `design/` 等文件夹**的问题。设计原型只需要存放在 `.tianshu-canvas/` 里。

---

## 原因

技能说明（`skills/SKILL.md`）的工作流里写着「把设计原型写成 HTML 文件放进工作区（例如 `<cwd>/prototype/login.html`）」，再用 `html_path` 导入画布。AI 照做，就会在工作区另建 `design/`、`prototype/` 之类的文件夹。

而 `canvas_upsert_page` 本来就会把原型 HTML 保存到 `.tianshu-canvas/pages/<id>.html`，工作区里的那份是多余的副本。

---

## 修复

- 技能说明改为：直接写好完整 HTML，用 `html` 参数内联传入 `canvas_upsert_page`；明确禁止在工作区另建 `design/`、`prototype/` 等目录存放原型。
- `canvas_upsert_page` 工具描述同步调整：`html`（内联）为推荐方式，`html_path` 仅用于导入已有文件。
- README 使用步骤同步更新。

工具参数没有变化，`html_path` 仍然可用，没有破坏性变更。

---

## 升级后你需要做的

已经生成的 `design/` 等文件夹不会被自动删除。里面的内容在 `.tianshu-canvas/pages/` 中已有一份，确认画布显示正常后可以手动删除。

通过天枢「插件中心 → 社区插件 → 从其他来源安装」：填本仓库地址（可指定标签 `v0.2.3`），或填本仓库根目录的绝对路径。已安装旧版的需**先卸载再安装**，并**新建会话**生效；旧会话仍按旧技能说明工作。

## 许可

MIT（见 [LICENSE](../LICENSE)）。工具与用法见 [release-0.2.0.md](release-0.2.0.md)。
