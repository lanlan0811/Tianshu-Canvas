/**
 * Production-tool workflow integration, using original fixed-copy specimens.
 * This proves selection / persistence / rendering, not aesthetic superiority.
 * The explicit confirmation below represents a recorded test-user decision; a
 * canvas click alone must never create it. No archived source HTML is used.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import { loadPlugin } from './helpers/host.mjs'
import { resolveTestBrowser } from './helpers/browser.mjs'

const root = resolve(import.meta.dirname, '..')
const browserPath = resolveTestBrowser()
const { tools, api } = await loadPlugin(pathToFileURL(join(root, 'dist/index.mjs')).href)
after(async () => { await api.dispose?.() })

const content = Object.freeze({
  brand: 'Fieldnotes 修复工作室',
  title: '让每一次修复，都留下可追溯的记录',
  description: '把故障、判断与交付串成一条清楚的工作线索。',
  evidence: '工作流示意：接收 → 诊断 → 交付。演示内容，不代表真实业务成果。',
  action: '查看工作流示意',
})
const sharedBrief = Object.freeze({
  audience: '独立维修工作室的服务负责人',
  purpose: '解释服务工作流，引导查看示意',
  proposition: content.title,
  evidence: [content.evidence],
  primaryAction: content.action,
  assets: ['原创内联 SVG 工作流线图；不使用外链或第三方图片'],
  brandConstraints: ['保持 Fieldnotes 名称；既有项目品牌锁优先；不捏造客户或业绩'],
})
const directions = ['editorial-narrative', 'product-evidence']
const ids = ['workflow-editorial', 'workflow-product']
const prototypeIds = ['editorial-casebook', 'product-story']
const readProject = cwd => JSON.parse(readFileSync(join(cwd, '.tianshu-canvas/project.json'), 'utf8'))
const readHtml = (cwd, id) => readFileSync(join(cwd, '.tianshu-canvas/pages', `${id}.html`), 'utf8')

async function call(cwd, name, input = {}) {
  const result = await tools[name].execute({ cwd, input })
  assert.ok(!result.isError, `${name}: ${result.content}`)
  return result.content
}

async function eventually(check, message, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(message)
}

function specimen(direction, complete = false) {
  const editorial = direction === 'editorial-narrative'
  const heading = `<h1 data-copy="title">${content.title}</h1>`
  const description = `<p data-copy="description">${content.description}</p>`
  const action = `<a data-copy="action" class="primary-action" href="#workflow-details">${content.action}</a>`
  const proof = `<aside class="evidence" aria-label="工作流证据"><svg viewBox="0 0 240 90" role="img" aria-label="接收、诊断、交付的原创线图"><path d="M24 44H216" fill="none" stroke="currentColor" stroke-width="2"/><g fill="currentColor"><circle cx="24" cy="44" r="6"/><circle cx="120" cy="44" r="6"/><circle cx="216" cy="44" r="6"/></g></svg><p data-copy="evidence">${content.evidence}</p></aside>`
  const hero = editorial
    ? `${heading}<div class="hero-intro">${description}${action}</div>${proof}`
    : `<div class="hero-copy">${heading}${description}${action}</div>${proof}`
  const details = complete
    ? '<section id="workflow-details" class="workflow-details"><h2>把判断写进交付</h2><div class="detail-grid"><article><h3>接收</h3><p>记录问题与约束，保留客户提供的描述。</p></article><article><h3>诊断</h3><p>逐项说明检查过程、判断和未确定事项。</p></article><article><h3>交付</h3><p>提供结果、维护建议与可追溯的过程记录。</p></article></div><details><summary>这些内容是否为真实经营数据？</summary><p>这是为流程验证编写的原创示意，没有客户或业绩背书。</p></details></section><footer>Fieldnotes · 工作流示意</footer>'
    : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${content.brand}</title><style>
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--ts-color-bg-canvas,#f5f2ea);color:var(--ts-color-text-primary,#192b25);font:18px/1.65 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1280px;margin:auto;padding:40px 56px}header{border-bottom:1px solid currentColor;padding-bottom:20px;font-size:16px;letter-spacing:.04em}.hero{min-height:620px;padding:46px 0;display:grid;gap:28px 32px}h1{margin:0;font-weight:600;line-height:1.15;letter-spacing:-.04em;overflow-wrap:anywhere}p{margin:0 0 24px}.primary-action{display:inline-block;color:inherit;padding:12px 0;border-bottom:2px solid currentColor;font-weight:600;text-decoration:none}.evidence{align-self:center}.evidence svg{width:100%;height:110px}.evidence p{font-size:17px}.editorial .hero{grid-template-columns:1fr 240px}.editorial h1{grid-column:1/-1;font:600 68px/1.15 Georgia,"Noto Serif CJK SC",serif;letter-spacing:-.04em}.editorial .hero-intro{max-width:420px}.product .hero{grid-template-columns:1.15fr 1fr;align-items:center}.product h1{font-size:46px;margin-bottom:28px}.product .evidence{border-left:1px solid currentColor;padding-left:28px}.workflow-details{padding:64px 0;border-top:1px solid currentColor}.workflow-details h2{font-size:36px;line-height:1.3}.detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}details{padding:24px 0;border-top:1px solid currentColor}summary{cursor:pointer}footer{padding:32px 0;border-top:1px solid currentColor;font-size:15px}
    @media(max-width:600px){main{padding:24px}.hero{min-height:0;padding:36px 0}.editorial .hero,.product .hero{display:grid;grid-template-columns:minmax(0,1fr)}.editorial h1,.product h1{font-size:40px;line-height:1.2;grid-column:auto}.product .evidence{border-left:0;border-top:1px solid currentColor;padding:20px 0 0}.editorial .hero-intro{max-width:none}.evidence svg{height:80px}.detail-grid{grid-template-columns:minmax(0,1fr)}.workflow-details{padding:36px 0}.workflow-details h2{font-size:30px}}
  </style></head><body class="${editorial ? 'editorial' : 'product'}" data-workflow-direction="${direction}"><main><header data-copy="brand">${content.brand}</header><section class="hero" aria-label="首屏方案">${hero}</section>${details}</main></body></html>`
}

async function pageFrame(page, id, preview = false) {
  return await eventually(() => {
    const frame = page.frames().find(frame => frame.url().includes(`/page/${id}?`) && frame.url().includes('preview=1') === preview)
    return frame ?? null
  }, `页面 ${id} 的 ${preview ? '预览' : '画布'} iframe 未加载`)
}

test('审美工作流保留九工具，公开入口明确双首屏与显式确认', async () => {
  assert.deepEqual(Object.keys(tools).sort(), ['canvas_open', 'canvas_upsert_page', 'canvas_get_state', 'canvas_arrange', 'canvas_style', 'canvas_check_style', 'canvas_design_system', 'canvas_audit', 'canvas_comments'].sort())
  const actions = tools.canvas_style.definition.input_schema.properties.action.enum
  for (const action of ['direction', 'prototype', 'brief']) assert.ok(actions.includes(action))
  const schema = tools.canvas_style.definition.input_schema.properties.brief.properties.confirmation
  assert.deepEqual(schema.properties.confirmed.enum, [true])
  assert.match(schema.description, /明确选择/)
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-workflow-contract-'))
  try {
    const opened = await call(cwd, 'canvas_open', { port: 0 })
    assert.match(opened, /同一内容.*两个.*首屏/)
    assert.match(opened, /明确选择.*brief.*原位深化/)
    assert.doesNotMatch(opened, /风格名作为选项|先确认设计风格/)
    const state = await call(cwd, 'canvas_get_state')
    assert.match(state, /自由发挥/)
    assert.match(state, /两个不同首屏/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

for (const locked of [false, true]) {
  test(`双首屏真实浏览器：${locked ? '既有品牌锁与旧页' : '自由发挥'} → 点击非确认 → 显式确认 → 原位整页与手机`, { skip: !browserPath && '未找到浏览器', timeout: 180000 }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'tsc-workflow-e2e-'))
    const puppeteer = (await import('puppeteer-core')).default
    let browser
    try {
      const opened = await call(cwd, 'canvas_open', { port: 0 })
      const url = opened.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)?.[0]
      assert.ok(url, '生产工具应返回带工作区与授权凭证的画布 URL')
      if (locked) {
        await call(cwd, 'canvas_style', { action: 'set', style_id: 'tianshu-inkstone' })
        await call(cwd, 'canvas_upsert_page', { id: 'brand-existing', title: '已有品牌页', html: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><h1 id="legacy-mark">已有品牌页面</h1><p>本页不参与此次选稿。</p></body></html>', x: 2080, y: 0, width: 600, height: 820 })
      }
      // canvas_open intentionally does not create project.json for an empty canvas.
      const oldProject = locked ? readProject(cwd) : { nodes: [] }
      const oldDesign = structuredClone(oldProject.design)
      const oldHtml = locked ? readHtml(cwd, 'brand-existing') : null
      const docs = []
      for (let i = 0; i < directions.length; i++) {
        const doc = JSON.parse(await call(cwd, 'canvas_style', { action: 'direction', direction_id: directions[i] }))
        assert.equal(doc.id, directions[i])
        assert.ok(doc.composition.length && doc.typography.length && doc.mobile.length)
        assert.equal(doc.examples.length, 2)
        assert.ok(doc.examples.every(example => /<html[\s>]/i.test(example.html)))
        docs.push(doc)
        await call(cwd, 'canvas_upsert_page', { id: ids[i], title: i === 0 ? '方案 A · 编辑叙事' : '方案 B · 产品证据', html: specimen(directions[i]), x: i * 1040, y: 0, width: 900, height: 820, device_type: 'desktop' })
        await call(cwd, 'canvas_style', { action: 'brief', page_id: ids[i], brief: { ...sharedBrief, directionId: directions[i], prototypeId: prototypeIds[i] } })
      }
      assert.notDeepEqual(docs[0].composition, docs[1].composition, '方向必须提供不同构图指导')
      const drafts = readProject(cwd)
      assert.equal(drafts.nodes.length, locked ? 3 : 2)
      assert.deepEqual(drafts.design, oldDesign, '读取方向、出方案与保存简报不得修改项目品牌锁')
      for (let i = 0; i < ids.length; i++) {
        const brief = drafts.pageBriefs[ids[i]]
        for (const [key, value] of Object.entries(sharedBrief)) assert.deepEqual(brief[key], value, `两个方向必须使用相同 ${key}`)
        assert.equal(brief.directionId, directions[i])
        assert.equal(brief.confirmedDirection, undefined, '生成方案只能保存草稿')
        const node = drafts.nodes.find(node => node.id === ids[i])
        assert.equal(node.type, 'page', '首屏候选必须是普通画布节点')
      }
      if (locked) assert.equal(readHtml(cwd, 'brand-existing'), oldHtml)
      const draftState = await call(cwd, 'canvas_get_state')
      assert.match(draftState, /选中节点不等于确认/)
      for (const direction of directions) assert.ok(draftState.includes(`未确认草稿 ${direction}`))
      for (const prototypeId of prototypeIds) assert.ok(draftState.includes(prototypeId))
      const otherHtml = readHtml(cwd, ids[1])
      const otherNode = structuredClone(drafts.nodes.find(node => node.id === ids[1]))
      const otherBrief = structuredClone(drafts.pageBriefs[ids[1]])

      browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--disable-gpu'] })
      const page = await browser.newPage()
      await page.setViewport({ width: 3000, height: 1280 })
      const externalRequests = []
      await page.setRequestInterception(true)
      page.on('request', request => {
        const requestUrl = request.url()
        if (requestUrl.startsWith('http:') || requestUrl.startsWith('https:')) {
          if (new URL(requestUrl).origin !== new URL(url).origin) { externalRequests.push(requestUrl); void request.abort(); return }
        }
        void request.continue()
      })
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      await page.waitForSelector(`.react-flow__node[data-id="${ids[1]}"] .page-node__iframe`, { timeout: 15000 })
      const frames = []
      for (const id of ids) {
        const frame = await pageFrame(page, id)
        await frame.waitForSelector('[data-copy="title"]', { timeout: 15000 })
        frames.push(frame)
      }
      await page.waitForFunction(([a, b]) => {
        const box = id => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect()
        const left = box(a), right = box(b)
        return left && right && left.width > 100 && right.width > 100 && Math.abs(left.top - right.top) < 2 && left.right <= right.left && left.left >= 0 && right.right <= innerWidth
      }, { timeout: 15000 }, ids)
      const layout = []
      for (let i = 0; i < frames.length; i++) {
        const snapshot = await frames[i].evaluate(() => {
          const title = document.querySelector('[data-copy="title"]')
          const evidence = document.querySelector('.evidence')
          const h = title.getBoundingClientRect(), e = evidence.getBoundingClientRect()
          return { copy: [...document.querySelectorAll('[data-copy]')].map(el => [el.getAttribute('data-copy'), el.textContent]).sort(([a], [b]) => a.localeCompare(b)), font: getComputedStyle(title).fontFamily, titleWidth: h.width, titleBottom: h.bottom, evidenceTop: e.top, evidenceLeft: e.left, titleRight: h.right, direction: document.body.dataset.workflowDirection }
        })
        assert.equal(snapshot.direction, directions[i])
        assert.deepEqual(Object.fromEntries(snapshot.copy), { ...content })
        layout.push(snapshot)
      }
      assert.ok(layout[0].titleWidth > layout[1].titleWidth * 1.3, '真实首屏应改变构图：通栏论点与分列产品证据')
      assert.notEqual(layout[0].font, layout[1].font, '真实首屏还应改变排版层级，不能只换颜色')
      assert.ok(layout[0].evidenceTop >= layout[0].titleBottom, '编辑方案证据按阅读次序排在标题之后')
      assert.ok(layout[1].evidenceLeft > layout[1].titleRight, '产品方案把证据放在标题右侧')
      for (const id of ids) {
        assert.equal(await page.$eval(`.react-flow__node[data-id="${id}"] .page-node__iframe`, frame => frame.getAttribute('sandbox')), 'allow-scripts')
        await page.click(`.react-flow__node[data-id="${id}"] .page-node__header`)
        await eventually(() => { try { return JSON.parse(readFileSync(join(cwd, '.tianshu-canvas/selection.json'), 'utf8')).pageId === id } catch { return false } }, '点击候选应保存实际选中项')
        assert.equal(readProject(cwd).pageBriefs[id].confirmedDirection, undefined, '用户浏览或选中候选不能自动确认方向')
      }
      const reason = '测试用户明确选择方案 A：通栏论点与章节阅读更适合当前服务说明。'
      await call(cwd, 'canvas_style', { action: 'brief', page_id: ids[0], brief: { confirmation: { confirmed: true, directionId: directions[0], reason } } })
      const confirmed = readProject(cwd).pageBriefs[ids[0]].confirmedDirection
      assert.equal(confirmed.directionId, directions[0])
      assert.equal(confirmed.reason, reason)
      assert.ok(Number.isSafeInteger(confirmed.confirmedAt) && confirmed.confirmedAt > 0)
      await call(cwd, 'canvas_upsert_page', { id: ids[0], html: specimen(directions[0], true), height: 1420 })
      const completed = readProject(cwd)
      assert.equal(completed.nodes.length, drafts.nodes.length, '深化更新原节点，不能另建页面或替换另一方案')
      const originalNode = drafts.nodes.find(node => node.id === ids[0])
      const completedNode = completed.nodes.find(node => node.id === ids[0])
      for (const key of ['id', 'createdAt', 'x', 'y', 'width', 'deviceType', 'htmlPath']) assert.equal(completedNode[key], originalNode[key], `原位深化保留 ${key}`)
      assert.deepEqual(completed.pageBriefs[ids[0]].confirmedDirection, confirmed, '深化不能刷新或伪造确认时间')
      assert.deepEqual(completed.nodes.find(node => node.id === ids[1]), otherNode, '未选节点元数据必须保留')
      assert.deepEqual(completed.pageBriefs[ids[1]], otherBrief, '未选方向仍为其自己的未确认草稿')
      assert.equal(readHtml(cwd, ids[1]), otherHtml, '未选方案 HTML 必须逐字保留')
      assert.deepEqual(completed.design, oldDesign)
      if (locked) {
        assert.equal(readHtml(cwd, 'brand-existing'), oldHtml, '品牌旧页不得被新方案或整页深化改写')
        assert.deepEqual(completed.nodes.find(node => node.id === 'brand-existing'), oldProject.nodes.find(node => node.id === 'brand-existing'))
        assert.equal(completed.pageBriefs['brand-existing'], undefined)
      } else {
        assert.equal(completed.design, undefined, '自由生成不得自动全局上锁')
      }
      await eventually(async () => {
        const frame = await pageFrame(page, ids[0])
        try { return Boolean(await frame.$('.workflow-details')) } catch { return false }
      }, '原节点 iframe 应通过生产 SSE 刷新到整页')
      const unchangedFrame = await pageFrame(page, ids[1])
      assert.equal(await unchangedFrame.$('.workflow-details'), null)
      const state = await call(cwd, 'canvas_get_state')
      assert.ok(state.includes(`用户已确认 ${directions[0]}`) && state.includes(reason) && state.includes(String(confirmed.confirmedAt)))
      assert.ok(state.includes(`未确认草稿 ${directions[1]}`))

      // Real preview UI exercises the completed page at the production 375px preset.
      await page.click(`.react-flow__node[data-id="${ids[0]}"] .page-node__header`, { button: 'right' })
      await page.waitForSelector('.context-menu', { timeout: 5000 })
      const menuItems = await page.$$('.context-menu > .context-menu__item')
      let openedPreview = false
      for (const item of menuItems) {
        if ((await item.evaluate(el => el.textContent.trim())) === '预览') { await item.click(); openedPreview = true; break }
      }
      assert.ok(openedPreview, '普通候选节点应能使用现有全屏预览')
      await page.waitForSelector('.preview-overlay', { timeout: 5000 })
      await page.click('.preview-device-seg__btn[data-device="mobile"]')
      const mobile = await pageFrame(page, ids[0], true)
      await mobile.waitForFunction(() => innerWidth === 375 && document.querySelector('.workflow-details'), { timeout: 15000 })
      const mobileResult = await mobile.evaluate(() => {
        const action = document.querySelector('.primary-action').getBoundingClientRect()
        return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, actionVisible: action.left >= 0 && action.right <= innerWidth, grid: getComputedStyle(document.querySelector('.detail-grid')).gridTemplateColumns, details: document.querySelectorAll('.detail-grid article').length, title: document.querySelector('h1').textContent }
      })
      assert.equal(mobileResult.width, 375)
      assert.equal(mobileResult.overflow, false, '深化后的整页在手机预览不得横向溢出')
      assert.equal(mobileResult.actionVisible, true)
      assert.equal(mobileResult.grid.trim().split(/\s+/).length, 1, '手机详情按阅读顺序重排为一列')
      assert.equal(mobileResult.details, 3)
      assert.equal(mobileResult.title, content.title)
      await page.keyboard.press('Escape')
      await page.waitForSelector('.preview-overlay', { hidden: true, timeout: 5000 })
      assert.deepEqual(readProject(cwd).pageBriefs[ids[0]].confirmedDirection, confirmed, '预览设备切换不应改变用户确认')
      assert.deepEqual(readProject(cwd).pageBriefs[ids[1]], otherBrief)
      assert.equal(readHtml(cwd, ids[1]), otherHtml)
      assert.deepEqual(externalRequests, [], '流程及原创双首屏应在本地离线渲染，不依赖网络素材')
    } finally {
      await browser?.close()
      rmSync(cwd, { recursive: true, force: true })
    }
  })
}
