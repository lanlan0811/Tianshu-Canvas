# 设计系统数据说明

本目录是「天枢画布设计系统」的源数据，构建期编译到 `dist/design/`，随插件分发。

- 用户在对话里选择风格（苹果风 / 谷歌风 / Claude 风 / 天枢原创 / 芭比风 / NERV 风 / 极简风 / 天枢·砚 / 天枢·雾 / 天枢·麦 / 自由发挥）。
- 风格以**项目级**锁定，写入 `project.json` 的 `design` 字段。
- 写入页面时工具自动把 `tokens.css`、`components.css` 与使用到的图标内联进 HTML。
- 原型运行在严格 CSP 的 iframe 中（`default-src 'none'`），因此**禁止外链**：样式必须内联，图标由 `data-icon` 占位后在写入时展开。

## 目录

```
design-systems/
├─ index.json                 风格清单（画布与工具共用；与 styles/<id>/meta.json 必须一致）
├─ NOTICE.md                  无隶属声明与图标来源
├─ icons/core.json            共享图标几何（按名字引用）
├─ components/
│  ├─ components.json         组件契约（23 个组件，全部风格共享）
│  └─ components.css          组件样式（只使用 --ts-* 变量，全部风格共享）
├─ templates/
│  ├─ dashboard.html          数据看板骨架（body 片段）
│  └─ landing.html            落地页骨架（body 片段）
└─ styles/<id>/
   ├─ meta.json               展示元数据
   └─ tokens.json             Token 唯一真源
```

> 组件与模板为全部风格共享：风格差异全部来自 token（颜色、字体、圆角、阴影、间距、尺寸），
> 这样能保证各风格的类名与 DOM 结构完全同构，切换风格时只替换样式块。

## tokens.json 约定

- 各风格的 **key 集合必须完全一致**，只有值不同。构建会逐项比对变量名集合。
- 颜色分两层：`color.primitives`（`neutral/brand/success/warning/danger/info/chart`）与 `color.semantic`。
- 语义色的值有两种写法：`"组.步"` 引用原色（生成 `var(--ts-color-组-步)`），或 `rgba()`/`#hex` 字面量。
- 统一前缀 `--ts-`，不占用画布外壳的 `--paper/--ink/--accent`。
- `modes.dark` 仅为后续预留，v1 生成器忽略。

## 新增风格

1. 在 `styles/` 下建目录，复制一份 `tokens.json` 与 `meta.json` 改值。
2. 在 `index.json` 增加条目（与 `meta.json` 一致）。
3. `npm run build` → 校验通过即自动进入 `dist/design/`，无需改任何代码。

## 校验

构建期会拒绝：缺字段、语义引用不可解析、非 `--ts-` 前缀变量、对比度不足（正文 < 4.5）、
组件类与 CSS 不一致、模板引用未知类/图标/token、模板含外链或脚本、跨风格 key 集合不一致。
