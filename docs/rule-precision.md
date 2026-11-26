# 规则命中实测（自建语料）

日期：2026-11-26 · 语料指纹 `8a498025b9134d9d` · 干净语料 44 份（32 原型 + 12 方向示例）

复现：`node scripts/rule-precision.mjs`（需先 `npm run build`）。

## 这份数字能说明什么、不能说明什么

impeccable 的 `tests/oracle/DELTAS.md` 是靠**真实站点语料 + 人工判读**得出 `clipped-overflow-container` 命中精度 0.08、伤害率 0.04 这类结论的。本项目没有外部语料，只能做三件可复核的事：

1. **在干净语料（我们自己的 44 份页面）上跑一遍**——命中即误报候选；
2. **在构造缺陷语料（每条规则 4 份 flag fixture）上测召回**——命中即真阳；
3. **在阴性语料（每条规则 5 份 pass fixture）上测误报**——命中即假阳。

**不能说明的**：这三份语料都由本项目自己维护，风格一致、且刻意避开了这些套路，所以「干净语料零命中」主要证明规则不会在合规页面上乱报，**不能外推成真实世界的精度**。真实世界的误报需要外部站点语料，本轮不具备。

## 结果

| 指标 | 结果 |
|---|---|
| 干净语料命中文件数 | 0 / 44 |
| 构造缺陷召回 | 88 / 88 |
| 阴性语料误报 | 0 / 110 |

### 干净语料（命中 = 误报候选）

| 规则 | 命中文件 | 命中条数 |
|---|---|---|
| `overused-font` | 0 | 0 |
| `gradient-text` | 0 | 0 |
| `side-tab` | 0 | 0 |
| `border-accent-on-rounded` | 0 | 0 |
| `ai-color-palette` | 0 | 0 |
| `cream-palette` | 0 | 0 |
| `gray-on-color` | 0 | 0 |
| `hard-offset-shadow` | 0 | 0 |
| `bounce-easing` | 0 | 0 |
| `repeating-stripes-gradient` | 0 | 0 |
| `codex-grid-background` | 0 | 0 |
| `marquee` | 0 | 0 |
| `monotonous-spacing` | 0 | 0 |
| `em-dash-overuse` | 0 | 0 |
| `marketing-buzzword` | 0 | 0 |
| `aphoristic-cadence` | 0 | 0 |
| `radial-halo` | 0 | 0 |
| `emoji-icon` | 0 | 0 |
| `rtl-physical-direction` | 0 | 0 |
| `fixed-text-width` | 0 | 0 |
| `plural-concat` | 0 | 0 |
| `western-digits-rtl` | 0 | 0 |

### 召回与误报（逐条）

| 规则 | flag 命中 | pass 误报 |
|---|---|---|
| `overused-font` | 4/4 | 0/5 |
| `gradient-text` | 4/4 | 0/5 |
| `side-tab` | 4/4 | 0/5 |
| `border-accent-on-rounded` | 4/4 | 0/5 |
| `ai-color-palette` | 4/4 | 0/5 |
| `cream-palette` | 4/4 | 0/5 |
| `gray-on-color` | 4/4 | 0/5 |
| `hard-offset-shadow` | 4/4 | 0/5 |
| `bounce-easing` | 4/4 | 0/5 |
| `repeating-stripes-gradient` | 4/4 | 0/5 |
| `codex-grid-background` | 4/4 | 0/5 |
| `marquee` | 4/4 | 0/5 |
| `monotonous-spacing` | 4/4 | 0/5 |
| `em-dash-overuse` | 4/4 | 0/5 |
| `marketing-buzzword` | 4/4 | 0/5 |
| `aphoristic-cadence` | 4/4 | 0/5 |
| `radial-halo` | 4/4 | 0/5 |
| `emoji-icon` | 4/4 | 0/5 |
| `rtl-physical-direction` | 4/4 | 0/5 |
| `fixed-text-width` | 4/4 | 0/5 |
| `plural-concat` | 4/4 | 0/5 |
| `western-digits-rtl` | 4/4 | 0/5 |

## 判读

**A. 干净语料零命中是「选择偏倚」的直接结果，不是精度证据。** 44 份原型与方向示例全部由本项目按 SKILL.md 的规范写就，本来就不用渐变文字、侧色条、紫蓝配色。要测真实精度必须有外部语料，本轮不做。

**B. 召回 88/88 只证明 fixture 与实现一致。** flag fixture 与规则是同一批人按同一份判据写的，100% 召回是预期结果；它能防「改了规则把 fixture 忘了」，不能防「判据本身错了」。

**C. 阴性语料零误报证明豁免逻辑没坏。** pass fixture 覆盖的是已知误报形态（品牌字体、`left:50%` 居中、CSS 里的复数、脚本里的数字等），零误报说明这些豁免仍生效。**其中 `overused-font` 的「品牌字体豁免」样本依赖 fixture 的 `meta.json` 指定风格**（`tianshu-vapor`）——脚本最初硬编码 `tianshu-original`，把它误判成 1 条误报；已改为逐规则读取 `meta.json`。这是本轮实测发现的**真实缺陷**（测试口径与 fixture 不一致会制造假信号）。

**D. immediate / deferred 的分级没有实测支撑。** 6.1.1 的档位是按 impeccable 的四桶判据人工划的；本轮实测也无法验证「哪一档更容易误伤」——那需要真实站点语料。结论：分级暂按判据保留，**等有外部语料再评估**。

## 未覆盖

- 真实站点语料（无外部数据源）。
- 渲染级规则（quality / states / a11y）的精度：需要真实浏览器且判据不同，不在本脚本范围。
- 「伤害率」：需要判断命中是否造成实际损害（用户是否因此改错），只能人工评审，本脚本不产出。
