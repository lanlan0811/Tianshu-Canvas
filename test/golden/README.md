# golden 逐字节基线

`test/golden/check-style/` 是 `canvas_check_style` **报告文本**的回归基线。报告改了文案、排序、汇总行或截断提示，
这里会失败——这是有意的回归信号，不是噪音。

## 目录约定

```
<case>.html        输入（内联 HTML；首行注释记录输入指纹）
<case>.golden.txt  期望报告文本（LF，末尾按工具输出原样保存）
```

每个 `.html` 的第一行必须是：

```html
<!-- input-sha256: <去掉本行后的 sha256> -->
```

测试先校验指纹再比对报告：**输入被改动却没重录基线时直接失败**，避免「换了个页面让旧基线看起来还对」。

## 录制流程

1. 改完规则或报告格式，先跑 `canvas_check_style`（内联 HTML 分支）拿到新报告；
2. **逐行人工复核**这份报告——确认每一处变化都是你要的，而不是顺手带出来的；
3. 再写入 `.golden.txt`；
4. 提交时在 commit 里说明为什么报告变了（改了哪条规则 / 哪个格式）。

## 禁止事项

**禁止为了让测试通过而重录 golden。** 基线的作用是冻结行为契约：如果报告变了你却直接重录，
等于把当前实现（可能包含 bug）当成了正确结果。先判断变化对不对，再决定是改代码还是改基线。

## 报告为什么是确定性的

- 排序：`lint.ts` 按 `line` 升序，同行按 `rule` 字典序；
- 截断：最多 40 条 finding，`counts` 与「发现 N 处」仍是全量，末尾追加「另有 N 处未显示」；
- 汇总行顺序：9 条风格规则固定序 + 注册表书写序——**注册表增删或重排会让 golden 失败**；
- `unused-ignore` 计入计数但不在汇总行，只出现在末尾「未生效的忽略」；
- 输入不含页面 id / 标题 / 模式（这些是报告里唯一的非确定性来源），因此走内联 HTML 分支并显式传 `style_id`。

## 渲染级 golden（`test/golden/render/`）

`a11y` 与 `states` 的报告需要真实浏览器，因此单独放在 `render/` 下：

- 本地无浏览器时**会 skip**——这是已知的假绿风险；CI 的「Require a browser for E2E」步骤
  保证 CI 一定真跑（`.github/workflows/ci.yml`）。
- 归一化：页面 id 与标题在录制与运行时都替换成 `<page-id>` / `<page-title>`，
  这是报告里唯一的非确定性来源。
- 两个用例：`clean-page`（合规页面，0 error / 0 warning）与 `issues-page`（对比度、图片 alt、
  空列表、无防重复提交各自命中）。
- `quality` / `review` 未做 golden：quality 依赖字体加载与几何测量（不同机器会有 1px 级差异），
  review 产出的是截图 + 多视口拼接，逐字节比对成本高于收益。

## 未覆盖

- `quality` / `review` 无 golden（理由见上）。
- 渲染级 golden 只在 Chromium 上跑过；Safari / Firefox 的排版差异未测。
