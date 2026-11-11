/** Source responsibilities are tested as actual behavior, not filename counts. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
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

async function harness(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-capabilities-'))
  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--disable-gpu'] })
  t.after(async () => { await browser.close(); rmSync(cwd, { recursive: true, force: true }) })
  const page = await browser.newPage()
  const errors = [], external = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (/^https?:/.test(request.url())) { external.push(request.url()); void request.abort() }
    else void request.continue()
  })
  const open = async (id, width = 1440) => {
    const result = await tools.canvas_style.execute({ cwd, input: { action: 'prototype', prototype_id: id } })
    assert.ok(!result.isError, result.content)
    const doc = JSON.parse(result.content)
    await page.setViewport({ width, height: 1100 })
    await page.goto('about:blank')
    const escaped = doc.html.replace(/[&"<>]/g, char => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char])
    await page.setContent('<style>body{margin:0}iframe{display:block;border:0;width:100vw;height:1100px}</style><iframe sandbox="allow-scripts" srcdoc="' + escaped + '"></iframe>', { waitUntil: 'load' })
    const frame = await (await page.$('iframe')).contentFrame()
    await frame.waitForSelector('[data-ts-prototype]')
    // Native details/tables need no runtime; do not invent a script dependency.
    if (doc.html.includes('__tianshu_interactions__')) await frame.waitForFunction(() => !!window.__tianshu_interactions__)
    await frame.evaluate(async () => { await document.fonts.ready })
    assert.equal(await frame.evaluate(() => origin), 'null')
    return frame
  }
  const finish = () => { assert.deepEqual(errors, []); assert.deepEqual(external, [], '原创资源不得请求外网') }
  return { page, open, finish }
}

const browserTest = { skip: !browserPath && '未找到浏览器', timeout: 180000 }

test('原生控件能力：级联、多选、数值区间、时间区间与纠错可实际操作', browserTest, async t => {
  const { page, open, finish } = await harness(t)
  const frame = await open('admin-create', 390)
  const form = '[data-ts-config-demo]'
  await frame.waitForSelector(form)
  const controls = await frame.$eval(form, el => {
    const region = el.querySelector('[data-ts-config-region]')
    const zones = el.querySelector('[data-ts-config-zone]')
    return {
      regions: [...region.options].map(o => o.value).filter(Boolean),
      zones: [...zones.options].map(o => ({ value: o.value, region: o.getAttribute('data-ts-region') })).filter(o => o.value),
      multiple: el.querySelector('#config-features').multiple,
      multiValues: [...el.querySelector('#config-features').options].map(o => o.value).filter(Boolean),
      nativeRange: el.querySelector('[data-ts-config-range]').type,
      nativeTimes: ['start', 'end'].map(key => el.querySelector('[data-ts-config-' + key + ']').type),
      nativeSingleTime: el.querySelector('#config-time').type,
    }
  })
  assert.ok(controls.regions.length >= 2, '级联父级应提供不同分组')
  const [firstRegion, nextRegion] = controls.regions
  const firstZone = controls.zones.find(zone => zone.region === firstRegion)?.value
  assert.ok(firstZone, '子级必须明确关联父级，不能是两份互不关联的select')
  await frame.select('[data-ts-config-region]', firstRegion)
  await frame.select('[data-ts-config-zone]', firstZone)
  assert.equal(await frame.$eval('[data-ts-config-zone]', el => el.value), firstZone)
  await frame.select('[data-ts-config-region]', nextRegion)
  assert.equal(await frame.$eval('[data-ts-config-zone]', el => el.value), '', '父级变更应清理不属于新分组的旧子级')
  assert.equal(await frame.$eval('[data-ts-config-zone]', (el, oldValue) => {
    const stale = [...el.options].find(option => option.value === oldValue)
    return !stale || stale.disabled || stale.hidden
  }, firstZone), true)
  assert.equal(controls.multiple, true)
  assert.ok(controls.multiValues.length >= 3)
  await frame.select('#config-features', ...controls.multiValues.slice(0, 2))
  assert.deepEqual(await frame.$eval('#config-features', el => [...el.selectedOptions].map(option => option.value)), controls.multiValues.slice(0, 2), '多选应保留两个值，不能等同单选')

  assert.equal(controls.nativeRange, 'range')
  await frame.focus('[data-ts-config-range]')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  const range = await frame.$eval(form, el => ({ value: el.querySelector('[data-ts-config-range]').value, output: el.querySelector('[data-ts-config-range-value]').textContent }))
  assert.ok(range.output.includes(range.value), '键盘调节range应同步文字数值，不是只绘制进度条')
  assert.deepEqual(controls.nativeTimes, ['time', 'time'], '时间选择必须是真正time输入，不能以日期控件代替')
  assert.equal(controls.nativeSingleTime, 'time')

  const change = async (selector, value) => frame.$eval(selector, (el, next) => {
    el.value = next
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await frame.type('#workspace-name', '能力验证团队')
  await frame.type('#workspace-email', 'owner@example.test')
  await change('#config-time', '10:45')
  assert.equal(await frame.$eval('#config-time', el => el.value), '10:45')
  const nextZone = await frame.$eval('[data-ts-config-zone]', el => [...el.options].find(option => option.value && !option.disabled && !option.hidden)?.value)
  assert.ok(nextZone)
  await frame.select('[data-ts-config-zone]', nextZone)
  await change('[data-ts-config-min]', '80')
  await change('[data-ts-config-max]', '20')
  const invalidRange = await frame.$eval(form, el => ({ min: el.querySelector('[data-ts-config-min]').validity.valid, max: el.querySelector('[data-ts-config-max]').validity.valid, feedback: el.querySelector('[data-ts-config-feedback]').textContent }))
  assert.ok(!invalidRange.min || !invalidRange.max, '倒置数值区间必须使输入无效')
  await frame.click(form + ' button[type=submit]')
  assert.doesNotMatch(await frame.$eval('[data-ts-demo-feedback]', el => el.textContent), /校验通过|已通过校验/)
  assert.match(invalidRange.feedback, /区间|范围|最小|最大|下限|上限/)
  await change('[data-ts-config-max]', '90')
  await change('[data-ts-config-start]', '18:00')
  await change('[data-ts-config-end]', '09:00')
  const invalidTime = await frame.$eval(form, el => ['start', 'end'].some(key => !el.querySelector('[data-ts-config-' + key + ']').validity.valid))
  assert.equal(invalidTime, true, '同日时间范围必须拒绝结束早于开始')
  assert.match(await frame.$eval('[data-ts-config-feedback]', el => el.textContent), /时间|开始|结束/)
  await change('[data-ts-config-start]', '09:00')
  await change('[data-ts-config-end]', '18:00')
  assert.equal(await frame.$eval(form, el => el.checkValidity()), true, '改正后必须解除旧customValidity，不能永远卡在错误态')
  await frame.click(form + ' button[type=submit]')
  assert.match(await frame.$eval('[data-ts-demo-feedback]', el => el.textContent), /未向服务器提交|仅.*本地/)
  assert.equal(await frame.$eval('html', el => el.scrollWidth > innerWidth), false)
  finish()
})

test('原创信息能力：规格对比、产品阵列、详情键值与层级导航有语义且可读', browserTest, async t => {
  const { open, finish } = await harness(t)
  let frame = await open('product-showcase', 390)
  const products = await frame.evaluate(() => {
    const table = document.querySelector('table')
    return {
      columns: table?.querySelectorAll('thead th').length ?? 0,
      rows: table?.querySelectorAll('tbody tr').length ?? 0,
      rowLabels: table?.querySelectorAll('tbody th[scope=row]').length ?? 0,
      productCards: document.querySelectorAll('#lineup article').length,
      honest: /虚构|概念|示例|演示/.test(document.body.textContent),
      localOverflow: document.documentElement.scrollWidth > innerWidth,
    }
  })
  assert.ok(products.columns >= 3 && products.rows >= 2 && products.rowLabels === products.rows, '规格横向对比需要真正列头与行头，不能仅用div或运营行表代替')
  assert.ok(products.productCards >= 3, '产品阵列应呈现可比较的原创型号')
  assert.equal(products.honest, true)
  assert.equal(products.localOverflow, false)
  for (const id of ['admin-detail', 'admin-detail-tabs', 'admin-detail-sidebar']) {
    frame = await open(id, 390)
    const detail = await frame.evaluate(() => {
      const dl = document.querySelector('dl')
      const breadcrumb = document.querySelector('nav[aria-label="面包屑"]')
      return { terms: dl?.querySelectorAll('dt').length ?? 0, definitions: dl?.querySelectorAll('dd').length ?? 0, current: breadcrumb?.querySelector('[aria-current=page]')?.textContent, linksResolve: [...(breadcrumb?.querySelectorAll('a[href^="#"]') ?? [])].every(link => document.getElementById(link.hash.slice(1))), overflow: document.documentElement.scrollWidth > innerWidth }
    })
    assert.ok(detail.terms >= 2 && detail.terms === detail.definitions, id + '必须用dl/dt/dd表达实际属性，不以虚构字段满足计数')
    assert.ok(detail.current && detail.linksResolve, id + '面包屑应给出当前层级和有效返回目标')
    assert.equal(detail.overflow, false)
  }
  finish()
})

test('IDE与移动内容能力：树与tab一致、模式定位、原生作品说明与收藏状态', browserTest, async t => {
  const { page, open, finish } = await harness(t)
  let frame = await open('developer-workbench', 390)
  const tree = '.tp-file-tree'
  assert.ok(await frame.$(tree + ' details details'), '文件树需要可展开层级')
  await frame.$eval(tree + ' details details', el => { el.open = false })
  await frame.focus(tree + ' details details summary')
  await page.keyboard.press('Enter')
  assert.equal(await frame.$eval(tree + ' details details', el => el.open), true)
  await frame.type('[data-ts-panel=page] textarea', ' local-capability-note')
  for (const id of ['style', 'readme', 'page']) {
    await frame.click('[data-ts-tab-target=' + id + ']')
    await frame.waitForFunction(value => document.querySelector('[data-ts-panel=' + value + ']').hidden === false, {}, id)
    assert.equal(await frame.$eval('[data-ts-tab=' + id + ']', el => el.getAttribute('aria-selected')), 'true', '文件导航与文档tab不能互相脱节')
  }
  assert.match(await frame.$eval('[data-ts-panel=page] textarea', el => el.value), /local-capability-note/)
  await frame.click('[data-ts-rail-target=assistant]')
  assert.equal(await frame.$eval('[data-ts-rail-target=assistant]', el => el.getAttribute('aria-current')), 'true')
  assert.equal(await frame.evaluate(() => document.activeElement.id), 'assistant', '模式栏应定位并聚焦实际工作区')
  assert.match(await frame.$eval('.tp-ide-status', el => el.textContent), /演示|无真实文件|当前DOM/)

  frame = await open('mobile-content', 390)
  assert.equal(await frame.$eval('#story-note', el => el.open), false)
  await frame.focus('#story-note summary')
  await page.keyboard.press('Enter')
  assert.equal(await frame.$eval('#story-note', el => el.open), true, '作品说明不能只是装饰文字')
  assert.match(await frame.$eval('#story-note', el => el.textContent), /原创|示意|演示|视频/)
  const before = await frame.$eval('#mobile-save', el => el.getAttribute('aria-checked'))
  await frame.focus('#mobile-save')
  await page.keyboard.press('Space')
  assert.notEqual(await frame.$eval('#mobile-save', el => el.getAttribute('aria-checked')), before)
  for (const id of ['discover', 'inbox', 'profile', 'feed']) {
    await frame.click('[data-ts-tab=' + id + ']')
    assert.equal(await frame.$eval('[data-ts-panel=' + id + ']', el => el.hidden), false)
  }
  assert.notEqual(await frame.$eval('#mobile-save', el => el.getAttribute('aria-checked')), before, '切换内容页应保留收藏状态')
  assert.equal(await frame.$eval('html', el => el.scrollWidth > innerWidth), false)

  frame = await open('ai-workspace', 768)
  const catalog = await frame.evaluate(() => {
    const cards = [...document.querySelectorAll('.tp-grid article')]
    return { count: cards.length, purposeful: cards.every(card => card.querySelector('h3') && card.querySelector('p') && card.querySelector('a[href="#chat"]')), boundary: document.body.textContent }
  })
  assert.ok(catalog.count >= 3 && catalog.purposeful, '能力目录应解释任务并链接真实本地输入，而非伪造可执行第三方服务')
  assert.match(catalog.boundary, /不连接AI|不是一个真实模型服务|无AI请求/)
  const payload = '<img src=x onerror=alert(1)>'
  await frame.type('[data-ts-chat-form] input', payload)
  await frame.click('[data-ts-chat-form] button')
  assert.match(await frame.$eval('[data-ts-chat-messages]', el => el.textContent), /<img src=x/)
  assert.equal(await frame.$$eval('[data-ts-chat-messages] img', els => els.length), 0, '输入应作为文本，不能当消息HTML执行')
  assert.match(await frame.$eval('[data-ts-chat-messages]', el => el.textContent), /未连接 AI|未连接AI|不会调用真实AI/)
  assert.equal(await frame.$eval('[data-ts-chat-form] input', el => el.value), '', '本地发送完成后清空编辑器')
  finish()
})

test('数据证据能力：映射图表有实际图形、可读摘要和演示边界', browserTest, async t => {
  const { open, finish } = await harness(t)
  // Eight archived chart previews merge into these real analysis tasks. Source
  // donut/funnel/paused decorations are intentionally not claimed as delivered.
  const chartTargets = ['metrics-workspace', 'monitoring-console', 'admin-metrics', 'business-analytics']
  for (const id of chartTargets) {
    const frame = await open(id, 768)
    const state = await frame.evaluate(() => {
      const charts = [...document.querySelectorAll('svg.tp-chart, [data-ts-chart], figure[aria-label]')]
      return { count: charts.length, represented: charts.every(chart => chart.querySelector('path,rect,circle,polyline,[data-ts-chart-value]')), named: charts.every(chart => (chart.getAttribute('aria-label') || chart.querySelector('title,figcaption')?.textContent || '').trim().length > 5), labels: charts.map(chart => chart.getAttribute('aria-label') || chart.textContent).join(' '), text: document.body.textContent, overflow: document.documentElement.scrollWidth > innerWidth }
    })
    assert.ok(state.count >= 1 && state.represented && state.named, id + '图表映射必须交付图形与可访问说明，不能把card/progress视作完整图表')
    assert.match(state.labels, /\d/, id + '图形应提供可核对的示例读数或标签')
    assert.match(state.text, /示例|演示|虚构/)
    assert.match(state.text, /单位|口径|样本|条|项|次|分钟|周|日|状态/)
    assert.equal(state.overflow, false)
  }
  finish()
})
