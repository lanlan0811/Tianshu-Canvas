/**
 * UX 三段式评审的端到端测试（需要 Chrome/Edge，无则跳过）。
 *
 * 只验证协议与结构：A 首调出模板（且**不含**检测结论）→ 回填 → B 跑确定性检测
 * → synthesize 算分落盘。不评判审美，因为那是代理的判断。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { resolveTestBrowser } from './helpers/browser.mjs'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const browserPath = resolveTestBrowser()

const PAGE = `<!doctype html><html lang="zh-CN"><head><style>
body{margin:0;background:#fff;color:#111;font-family:system-ui;font-size:16px;line-height:1.6}
h1{font-size:32px;margin:32px 0 12px}
main{padding:24px}
</style></head><body><main>
<h1>订单列表</h1>
<p>这里列出全部订单，可以按状态筛选并导出。</p>
<button type="button">新建订单</button>
<table><thead><tr><th>编号</th><th>状态</th></tr></thead><tbody><tr><td>#1001</td><td>已完成</td></tr></tbody></table>
</main></body></html>`

async function withPlugin(fn) {
  const { api, tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-ux-e2e-'))
  try {
    return await fn({ api, tools, cwd })
  } finally {
    await api.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
}

function audit(tools, cwd, input) {
  return tools.canvas_audit.execute({ input, cwd })
}

/** 从真实量表读 id 顺序，保证 a_assessment 与量表同步。 */
const rubric = JSON.parse(readFileSync(join(root, 'design-systems', 'rubrics', 'ux-review.json'), 'utf8'))

function assessment() {
  return {
    specificity: { verdict: '这一版是通用后台骨架，换到邻近产品仍能用', evidence: ['首屏是标题 + 一个主按钮 + 表格'] },
    heuristics: rubric.heuristics.map((h, index) => ({
      id: h.id,
      score: index === 9 ? 'n/a' : 3,
      ...(index === 9 ? { reason: '内部工具没有帮助文档' } : {}),
      keyIssue: index === 0 ? '新建后没有反馈' : '无重大问题',
    })),
    cognitiveLoad: { failed: [] },
    personas: [
      { id: 'alex', redFlags: ['没有批量导出'] },
      { id: 'sam', redFlags: ['表格表头无 aria-sort'] },
    ],
    priorityIssues: [
      { severity: 'P1', what: '新建按钮没有结果反馈', why: '用户会重复点击', fix: '加行内提示' },
      { severity: 'P2', what: '表格缺排序语义', why: '读屏用户无法得知排序', fix: '补 aria-sort' },
      { severity: 'P3', what: '空列表没有引导', why: '首次使用会卡住', fix: '加创建入口' },
    ],
    strengths: ['信息层级清楚'],
  }
}

test('ux 三段式：A 出模板且不含检测结论 → 回填 → B → synthesize', { skip: !browserPath && '未找到浏览器', timeout: 180000 }, async () => {
  await withPlugin(async ({ tools, cwd }) => {
    await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const added = await tools.canvas_upsert_page.execute({ input: { html: PAGE, title: '订单页', surface_mode: 'operate' }, cwd })
    assert.ok(!added.isError, added.content)
    const pageId = /id=([A-Za-z0-9_-]+)/.exec(added.content)?.[1]
    assert.ok(pageId, added.content)

    // A 首调
    const start = await audit(tools, cwd, { action: 'ux', phase: 'a', page_id: pageId })
    assert.ok(!start.isError, start.content)
    assert.match(start.content, /UX 评审 A 阶段/)
    assert.match(start.content, /三段式隔离/)
    assert.match(start.content, /设计特异性/)
    // 截图路径存在
    const shotPath = /- \d+×\d+：(.+)/.exec(start.content)?.[1]?.trim()
    assert.ok(shotPath && existsSync(shotPath), `截图未生成：${shotPath}`)
    // 模板里不能出现检测器发现
    for (const leaked of ['horizontal-overflow', 'broken-image', '低对比', 'tiny-text', '符合度']) {
      assert.ok(!start.content.includes(leaked), `A 阶段模板泄漏了检测结论：${leaked}`)
    }
    const reviewId = /评审 ID：(\S+)/.exec(start.content)?.[1]
    assert.ok(reviewId, start.content)

    // B 之前必须先回填 A：未回填时 phase=b 必须报错
    const early = await audit(tools, cwd, { action: 'ux', phase: 'b', review_id: reviewId })
    assert.equal(early.isError, true)
    assert.match(early.content, /必须先完成 A/)

    // 回填 A
    const recorded = await audit(tools, cwd, { action: 'ux', phase: 'a', review_id: reviewId, a_assessment: assessment() })
    assert.ok(!recorded.isError, recorded.content)
    assert.match(recorded.content, /A 阶段结论已记录/)
    assert.match(recorded.content, /n\/a 1 项/)

    // B
    const b = await audit(tools, cwd, { action: 'ux', phase: 'b', review_id: reviewId })
    assert.ok(!b.isError, b.content)
    assert.match(b.content, /B 阶段完成/)
    assert.match(b.content, /设计契约：符合度/)

    // synthesize
    const syn = await audit(tools, cwd, { action: 'ux', phase: 'synthesize', review_id: reviewId })
    assert.ok(!syn.isError, syn.content)
    assert.match(syn.content, /方法：三段式隔离/)
    assert.match(syn.content, /合计.*27\/36/)
    assert.match(syn.content, /良好/)
    assert.ok(!syn.content.includes('/40'), '有 n/a 时不得写 /40')
    const file = /已落盘：(.+)/.exec(syn.content)?.[1]?.trim()
    assert.ok(file && existsSync(file), `ux.json 未落盘：${file}`)
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(payload.schema, 1)
    assert.equal(payload.pageId, pageId)
    assert.equal(payload.score.max, 36)
    assert.ok(payload.limitations.some((l) => l.includes('不能替代项目所有者')))
  })
})

test('ux：A 结论不合规时拒绝落盘并指出具体问题', { skip: !browserPath && '未找到浏览器', timeout: 120000 }, async () => {
  await withPlugin(async ({ tools, cwd }) => {
    await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const added = await tools.canvas_upsert_page.execute({ input: { html: PAGE, title: '订单页' }, cwd })
    const pageId = /id=([A-Za-z0-9_-]+)/.exec(added.content)?.[1]
    const start = await audit(tools, cwd, { action: 'ux', phase: 'a', page_id: pageId })
    const reviewId = /评审 ID：(\S+)/.exec(start.content)?.[1]
    const bad = assessment()
    bad.heuristics = bad.heuristics.slice(0, 8)
    bad.priorityIssues = bad.priorityIssues.slice(0, 1)
    const res = await audit(tools, cwd, { action: 'ux', phase: 'a', review_id: reviewId, a_assessment: bad })
    assert.equal(res.isError, true)
    assert.match(res.content, /缺少启发式评分/)
    assert.match(res.content, /priorityIssues 必须 3–5 条/)
  })
})

test('ux：phase=a 缺 page_id 与 review_id 时给出可执行提示', { timeout: 60000 }, async () => {
  await withPlugin(async ({ tools, cwd }) => {
    await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const res = await audit(tools, cwd, { action: 'ux', phase: 'a' })
    assert.equal(res.isError, true)
    assert.match(res.content, /需要 page_id/)
  })
})

test('ux：非法 phase 被拒绝', { timeout: 60000 }, async () => {
  await withPlugin(async ({ tools, cwd }) => {
    await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const res = await audit(tools, cwd, { action: 'ux', phase: 'z' })
    assert.equal(res.isError, true)
    assert.match(res.content, /可选 a \/ b \/ synthesize/)
  })
})
