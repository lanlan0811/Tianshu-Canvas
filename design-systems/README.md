# 设计系统数据说明

本目录是「天枢画布设计系统」的源数据，构建期编译到 `dist/design/`，随插件分发。

- 先按内容选择原创原型与视觉方向，营销页面默认双首屏选稿；已有品牌和指定布局优先。token 风格可单独选择（苹果风 / 谷歌风 / Claude 风 / 天枢原创 / 芭比风 / NERV 风 / 极简风 / 天枢·砚 / 天枢·雾 / 天枢·麦 / 天枢·霞光 / 自由发挥）。
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
│  ├─ components.json         组件契约（26 个组件，全部风格共享）
│  └─ components.css          组件样式（只使用 --ts-* 变量，全部风格共享）
├─ interactions/
│  ├─ interactions.json       交互库契约（23 个交互模式，全部风格共享）
│  ├─ interactions.css        交互样式（只使用 --ts-* 变量，全部风格共享）
│  └─ interactions.js         单一共享运行时（原生 JS，存在性守卫）
├─ templates/
│  ├─ dashboard.html          数据看板骨架（body 片段）
│  └─ landing.html            落地页骨架（body 片段）
└─ styles/<id>/
   ├─ meta.json               展示元数据
   └─ tokens.json             Token 唯一真源
```

> 组件、图标、模板、交互均为全部风格共享：风格差异全部来自 token（颜色、字体、圆角、阴影、间距、尺寸），
> 这样能保证各风格的类名与 DOM 结构完全同构，切换风格时只替换样式块。

## interactions（交互库）

- 23 个模式：tabs / modal / drawer / dropdown / accordion / toast / tooltip / loading-skeleton /
  progress / form-validation / segmented / switch / stepper / pagination / sortable-table / date-picker /
  scroll-progress / sticky-header / scroll-reveal / tilt-card / mobile-nav / copy-code / toc-outline。
- 声明式：页面用 `data-ts-*` 根标记 + 交互 `ts-*` 类；写入时工具按「页面是否用到」决定是否注入
  `interactions.css` 与 `interactions.js`（幂等，随 ds 注入块一起剥离）。
- **复用**组件目录已有类（`ts-tabs`/`ts-tab`/`ts-dialog`/`ts-toast`/`ts-switch`/`ts-progress`/`ts-table`），
  交互独有结构/状态类统一用 `ts-i-` 前缀，避免与组件契约冲突。
- 运行时沙箱约束：禁 `fetch`/XHR、禁本地存储/cookie、不外链；构建期强制校验。

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
交互库另有校验：条目必须 23 个且 id 唯一、类名 `ts-` 前缀且在 CSS 中定义、复用类必须存在于组件契约、
骨架只用已声明类、`interactions.css` 变量必须已定义、`interactions.js` 禁 `fetch`/XHR/本地存储/cookie/外链/`</script`。

## 原创原型与视觉方向

- `prototypes/`：32 个原型，每个包含 `meta.json`、无脚本的 `body.html` 与以 `:scope` 开头的布局 CSS；构建为一次共享资源，不按 11 套风格复制。`tp-*` 类明确登记，不放宽旧模板或 `ts-*` 契约。
- `directions/`：编辑叙事、产品证据、品牌海报；每类两个中英原创示例与适用条件、误用、移动端及素材指导。
- `interactions/bindings.json`：登记搜索/筛选、实际行分页、纯文本聊天演示与本地表单反馈。只用内存，不联网、不保存，不放开 iframe 的 `allow-forms` 或同源权限。
- `canvas_style prototype / direction` 按需读取；`brief` 保存指定页面简报，只有明确的 `confirmation` 才记录用户选择。复制保留原决定，删除清理，旧项目无需迁移。
- `canvas_audit review` 生成 1440/768/390 完整截图与客观问题。截图与自动检查不构成审美评分；需要真实读图与项目所有者评审。
- 来源研究材料不参与构建或发行。发行资源均重新编写、使用本项目 SVG 与系统字体，不携带未核实授权的模板、图片、字体或来源品牌内容。
