# i18n 韧性：能自动检测的与必须知道的

判据来源：impeccable（Apache-2.0，Paul Bakaus）`skill/reference/harden.md` 的 Internationalization 段与 `skill/reference/audit.md` 的 RTL signals。中文文案与阈值表述为本项目重写。

## 一、能自动检测的四件事（`canvas_check_style`）

| 规则 | 触发条件 | 怎么改 |
|---|---|---|
| `rtl-physical-direction` | **只在 `<html>` 或 `<body>` 写了 `dir="rtl"` 的页面**：出现 `margin-left/right`、`padding-left/right`、`border-left/right`、`border-top-left-radius` 等物理属性，或 `text-align: left/right`、`float: left/right`、`left:/right:` 定位 | 换逻辑属性：`margin-inline-start/end`、`padding-inline-start/end`、`border-inline-start/end`、`text-align: start/end`、`float: inline-start/inline-end`、`inset-inline-start/end`。`left: 50%` + `translateX(-50%)` 是方向无关的居中写法，可保留 |
| `fixed-text-width` | 按钮、链接、标签、`h1–h6`、`.ts-btn`、`.ts-tab`、`.ts-nav__link`、`.ts-badge`、`.ts-input`、`.ts-select` 上写死 `width: <长度>`，且同块内没有 `min-width`/`max-width` 兜底 | 改成 `padding` + 内容自适应；确需上限用 `max-width`，并为翻译预留 30–40% 空间 |
| `plural-concat` | 页面内联脚本里出现 `` `${n} item${n !== 1 ? 's' : ''}` `` 或 `n + " item" + (n !== 1 ? "s" : "")` 式拼接 | 用 ICU 复数规则或 `Intl.PluralRules`；数量词交给翻译资源 |
| `western-digits-rtl` | 页面 `lang` 为 `ar`、`fa`、`ur`、`ps`、`ckb`、`he`、`yi`、`ug`、`sd`、`dv` 之一，且**正文**（不含脚本/样式）里出现 ASCII 数字 | 用 `Intl.NumberFormat` 传入正确 locale；日期用 `Intl.DateTimeFormat` |

注意：`lang` 只表示语言，**不表示方向**。浏览器只按 `dir` 决定文本书写方向；RTL 检测因此以 `dir="rtl"` 为准。

## 二、不可自动检测，但必须知道

### 长度膨胀

德语常比英语长 **30%**，部分语言更多。给按钮、标签、导航项预留 **30–40%** 空间预算；用德语（或目标语言里最长的那个）实测一次，不要只看英文。

### ZWNJ（U+200C）必须保留

波斯语与库尔德语用零宽非连接符（ZWNJ）断开复合词中的连写，同时保持词是一个整体。**任何清洗、去重、规范化流程都不能把它删掉**——删了会改变词义。

本项目的文本安全扫描（`src/textSafety.ts`）把 ZWNJ 列为「仅警告」而非硬拒绝，正是这个原因：emoji ZWJ 序列与合法波斯语文本都需要它。看到警告时先确认是不是有意的语言字符，不要一律删除。

### 波斯语与阿拉伯语的同形字母

| 语言 | 字符 | 码位 |
|---|---|---|
| 波斯语 | ی | U+06CC |
| 阿拉伯语 | ي | U+064A |
| 波斯语 | ک | U+06A9 |
| 阿拉伯语 | ك | U+0643 |

规则：**存储保留用户输入的原始形态**；只在搜索、比对、校验时把对应字母视为等价。拒绝其中一种，会让另一种键盘布局的用户无法使用。

### 数字系统与历法

- 波斯语（`fa-IR`）正文数字通常是 `۰۱۲۳۴۵۶۷۸۹`；阿拉伯语（`ar-SA`）通常是 `٠١٢٣٤٥٦٧٨٩`。手写 ASCII 数字在正文里会显得突兀。
- 波斯用户默认使用太阳历（Jalali / Solar Hijri）；许多阿拉伯语用户使用伊斯兰历（Hijri）。日期显示与"今天/本周"这类判断都要按 locale 走，例如 `Intl.DateTimeFormat('fa-IR')`、`'ar-SA-u-ca-islamic'`。
- 编码统一 UTF-8；CJK 与 emoji 占 2–4 字节，做长度限制时按字符而不是字节。

### 物理方向与逻辑属性

除上面的检测项外，还要注意：`[dir="rtl"] .arrow { margin-right: 1rem }` 这类补丁只有**同时清掉冲突的基础属性**（例如 `margin-left: 0`）才成立，否则两个方向的 margin 会叠加。方向性图标（箭头、进度指示）应在 RTL 下用 `transform: scaleX(-1)` 镜像——但要以**渲染后**的观感为准，不能只看有没有写这条规则。

## 三、自查清单

1. 把最长的一条真实文案（德语或目标语言）放进按钮、标签、导航，页面是否仍不横向滚动？
2. 给 `<html>` 加 `dir="rtl"`，布局是否镜像后仍然正确（不是元素跑到屏幕外）？
3. 数字与日期是否都走了 `Intl`，没有手写格式？
4. 清洗流程是否保留了 ZWNJ 与用户原始的波斯/阿拉伯字母形态？
