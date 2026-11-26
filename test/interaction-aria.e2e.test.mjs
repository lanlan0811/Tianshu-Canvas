/**
 * 交互库 ARIA 端到端：按 interactions.json 的 a11y 契约，逐个构造默认态与打开态，
 * 读真实 DOM 断言角色/属性/键位真的生效。
 *
 * 证据边界：断言的是运行时把语义写进 DOM；读屏软件实际播报、浏览器原生手势仲裁
 * 与真机差异仍未覆盖。tilt-card 的取消手势由 gesture-interrupt.e2e 覆盖。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { resolveTestBrowser } from './helpers/browser.mjs'
import { loadPlugin } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')
const browserPath = resolveTestBrowser()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const DESKTOP_PAGE = `<!doctype html><html lang="zh-CN"><head><style>
body{margin:0;padding:24px;font-family:system-ui;background:#fff}
</style></head><body>
<div id="sibling">背景内容</div>

<div class="ts-i-tabs" id="tabs" data-ts-tabs>
  <div class="ts-tabs" role="tablist">
    <button class="ts-tab ts-tab--active" role="tab" id="tab-a" data-ts-tab="overview" aria-selected="true">概览</button>
    <button class="ts-tab" role="tab" id="tab-b" data-ts-tab="detail" aria-selected="false">明细</button>
  </div>
  <div class="ts-i-tabs__panel" role="tabpanel" data-ts-panel="overview">概览内容</div>
  <div class="ts-i-tabs__panel" role="tabpanel" data-ts-panel="detail" hidden>明细内容</div>
</div>

<button class="ts-btn ts-btn--primary" id="modal-open" data-ts-open="#dlg">打开弹窗</button>
<div class="ts-i-modal" id="dlg" data-ts-modal hidden>
  <div class="ts-i-modal__scrim" data-ts-close></div>
  <div class="ts-dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
    <h3 id="dlg-title">确认</h3>
    <div class="ts-dialog__footer">
      <button class="ts-btn" id="dlg-cancel" data-ts-close>取消</button>
      <button class="ts-btn ts-btn--primary" id="dlg-ok" data-ts-close>确定</button>
    </div>
  </div>
</div>

<button class="ts-btn ts-btn--secondary" id="drawer-open" data-ts-open="#drw">打开抽屉</button>
<div class="ts-i-drawer" id="drw" data-ts-drawer data-ts-side="right" hidden>
  <div class="ts-i-drawer__scrim" data-ts-close></div>
  <aside class="ts-i-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="drw-title">
    <h3 id="drw-title">筛选</h3>
    <button class="ts-icon-btn" id="drw-close" data-ts-close aria-label="关闭">×</button>
    <div class="ts-i-drawer__body">抽屉内容</div>
  </aside>
</div>

<div class="ts-i-dropdown" id="dd" data-ts-dropdown>
  <button class="ts-btn ts-btn--secondary ts-i-dropdown__trigger" id="dd-trigger" aria-haspopup="menu" aria-expanded="false">操作</button>
  <div class="ts-i-dropdown__menu" role="menu" hidden>
    <button class="ts-i-dropdown__item" role="menuitem">编辑</button>
    <button class="ts-i-dropdown__item" role="menuitem">复制</button>
    <button class="ts-i-dropdown__item ts-i-dropdown__item--danger" role="menuitem">删除</button>
  </div>
</div>

<span class="ts-i-tooltip" id="tip" data-ts-tooltip="保存草稿" data-ts-tooltip-side="top"><svg data-icon="info" class="ts-icon"></svg></span>

<div class="ts-stack" data-ts-skeleton aria-busy="true"><div class="ts-i-skeleton ts-i-skeleton--text" style="width:60%"></div></div>

<div class="ts-progress" id="prog" data-ts-progress role="progressbar" aria-valuenow="64" aria-valuemin="0" aria-valuemax="100"><span class="ts-progress__bar" style="width:64%"></span></div>

<form class="ts-i-form ts-stack" id="form" data-ts-form novalidate>
  <div class="ts-i-form__field ts-field">
    <label class="ts-field__label" for="f-email">邮箱</label>
    <input class="ts-input" id="f-email" name="email" type="email" required data-ts-error="请输入有效邮箱" />
    <p class="ts-i-form__error" id="f-email-error" aria-live="polite"></p>
  </div>
  <button class="ts-btn ts-btn--primary" type="submit" id="form-submit">提交</button>
</form>

<div class="ts-i-segmented" id="seg" data-ts-segmented role="radiogroup" aria-label="视图">
  <button class="ts-i-segmented__item ts-i-segmented__item--active" role="radio" aria-checked="true" data-ts-value="day">日</button>
  <button class="ts-i-segmented__item" role="radio" aria-checked="false" data-ts-value="week">周</button>
</div>

<button class="ts-switch ts-switch--on" id="sw" data-ts-switch role="switch" aria-checked="true" aria-label="启用通知"></button>

<div class="ts-i-stepper" id="steps" data-ts-stepper data-ts-current="2">
  <div class="ts-i-stepper__step" data-ts-step="1"><span class="ts-i-stepper__marker">1</span><span class="ts-i-stepper__label">填写</span></div>
  <div class="ts-i-stepper__step" data-ts-step="2"><span class="ts-i-stepper__marker">2</span><span class="ts-i-stepper__label">确认</span></div>
</div>

<nav class="ts-i-pagination" id="pager" data-ts-pagination data-ts-total="3" data-ts-page="1" aria-label="分页">
  <button class="ts-i-pagination__item ts-i-pagination__item--active" aria-current="page">1</button>
  <button class="ts-i-pagination__item">2</button>
  <button class="ts-i-pagination__item">3</button>
</nav>

<table class="ts-table ts-i-table--sortable" id="tbl" data-ts-table>
  <thead><tr>
    <th class="ts-i-table__th--sortable" id="th-name" data-ts-sort="text" aria-sort="none" scope="col">名称<span class="ts-i-table__sort"></span></th>
  </tr></thead>
  <tbody>
    <tr><td>乙</td></tr>
    <tr><td>甲</td></tr>
  </tbody>
</table>

<div class="ts-i-datepicker" id="dp" data-ts-datepicker>
  <input class="ts-input ts-i-datepicker__input" id="dp-input" readonly data-ts-value="2026-11-07" aria-label="选择日期" />
  <div class="ts-i-datepicker__popup" hidden></div>
</div>

<div class="ts-i-scroll-progress" id="sp" data-ts-scroll-progress data-ts-threshold="100" role="button" tabindex="0" aria-label="返回顶部">
  <span class="ts-i-scroll-progress__label" id="sp-label">0%</span>
</div>

<div class="ts-i-accordion" data-ts-accordion>
  <details class="ts-i-accordion__item" open><summary class="ts-i-accordion__trigger">问题一</summary><div class="ts-i-accordion__panel">答案一。</div></details>
</div>

<div class="ts-i-copy" id="cp" data-ts-copy>
  <pre class="ts-i-copy__code">npm run build</pre>
  <button class="ts-i-copy__btn" id="cp-btn" data-ts-copy-btn data-ts-copied-label="已复制" aria-label="复制代码">复制</button>
</div>

<div class="ts-i-toast-region" id="toasts" data-ts-toast-region data-ts-position="top-right" aria-live="polite">
  <div class="ts-toast ts-toast--success" id="toast-ok" data-ts-toast-duration="0">已保存<button class="ts-i-toast-close" data-ts-toast-dismiss aria-label="关闭">×</button></div>
  <div class="ts-toast ts-toast--danger" id="toast-err" data-ts-toast-duration="0">保存失败<button class="ts-i-toast-close" data-ts-toast-dismiss aria-label="关闭">×</button></div>
</div>
</body></html>`

const MOBILE_PAGE = `<!doctype html><html lang="zh-CN"><head><style>
body{margin:0;padding:16px;font-family:system-ui;background:#fff}
</style></head><body>
<div id="sibling">背景内容</div>
<nav class="ts-i-mobile-nav" id="mn" data-ts-mobile-nav>
  <button class="ts-i-mobile-nav__toggle" id="mn-toggle" type="button" aria-expanded="false" aria-controls="mn-menu" aria-label="打开导航菜单">
    <span class="ts-i-mobile-nav__bar"></span><span class="ts-i-mobile-nav__bar"></span><span class="ts-i-mobile-nav__bar"></span>
  </button>
  <div class="ts-i-mobile-nav__backdrop"></div>
  <div class="ts-nav__links" id="mn-menu">
    <a class="ts-nav__link" id="mn-link" href="#sec-1">首页</a>
  </div>
</nav>
<aside class="ts-i-toc" id="toc" data-ts-toc>
  <button class="ts-i-toc__toggle" id="toc-toggle" type="button" aria-expanded="false" aria-controls="toc-panel" aria-label="打开目录">目录</button>
  <div class="ts-i-toc__backdrop"></div>
  <nav class="ts-i-toc__panel" id="toc-panel" aria-label="目录">
    <p class="ts-i-toc__title">目录</p>
    <div class="ts-i-toc__list">
      <a class="ts-i-toc__link ts-i-toc__link--active" id="toc-a" href="#sec-1">第一节</a>
      <a class="ts-i-toc__link" id="toc-b" href="#sec-2">第二节</a>
    </div>
  </nav>
</aside>
<div id="sec-1" style="height:600px">第一节</div>
<div id="sec-2" style="height:600px">第二节</div>
</body></html>`

/** 打开画布并返回指定页面 iframe。 */
async function withFrame(html, fn, { device = 'desktop', width = 1440, height = 900 } = {}) {
  const { api, tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-aria-'))
  const puppeteer = (await import('puppeteer-core')).default
  let browser
  try {
    const open = await tools.canvas_open.execute({ input: { port: 0 }, cwd })
    const url = open.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)?.[0]
    assert.ok(url, open.content)
    await tools.canvas_style.execute({ input: { action: 'set', style_id: 'apple' }, cwd })
    const added = await tools.canvas_upsert_page.execute({ input: { html, title: 'ARIA 页', device_type: device }, cwd })
    const pageId = /id=([\w-]+)/.exec(added.content)?.[1]
    assert.ok(pageId, added.content)

    browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
    const page = await browser.newPage()
    await page.setViewport({ width, height })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForSelector('.page-node__iframe', { timeout: 15000 })
    await sleep(800)
    const frame = page.frames().find((f) => f.url().includes(pageId))
    assert.ok(frame, '应找到页面 iframe')
    return await fn({ frame })
  } finally {
    if (browser) await browser.close().catch(() => {})
    await api.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
}

test('交互 ARIA（桌面）：默认态 + 打开态逐个读真实 DOM', { skip: !browserPath && '未找到浏览器', timeout: 240000 }, async () => {
  await withFrame(DESKTOP_PAGE, async ({ frame }) => {
    const state = await frame.evaluate(() => {
      const q = (sel) => document.querySelector(sel)
      const all = (sel) => Array.from(document.querySelectorAll(sel))
      const descId = (el) => (el?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      return {
        tabs: {
          tablist: !!q('[role=tablist]'),
          tab: !!q('[role=tab][aria-selected]'),
          panel: !!q('[role=tabpanel]'),
          controls: q('#tab-a').getAttribute('aria-controls'),
          labelledby: (q('[data-ts-panel=overview]') || {}).getAttribute?.('aria-labelledby'),
        },
        tooltip: {
          bubble: !!q('[role=tooltip]'),
          text: q('[role=tooltip]')?.textContent,
          described: descId(q('#tip')),
          bubbleId: q('[role=tooltip]')?.id,
          rootTabindex: q('#tip').getAttribute('tabindex'),
        },
        skeleton: q('[data-ts-skeleton]').getAttribute('aria-busy'),
        progress: {
          role: q('#prog').getAttribute('role'),
          min: q('#prog').getAttribute('aria-valuemin'),
          max: q('#prog').getAttribute('aria-valuemax'),
          now: q('#prog').getAttribute('aria-valuenow'),
        },
        dropdown: {
          expanded: q('#dd-trigger').getAttribute('aria-expanded'),
          controls: q('#dd-trigger').getAttribute('aria-controls'),
          menu: !!q('[role=menu]'),
          items: all('[role=menuitem]').length,
        },
        segmented: {
          group: q('#seg').getAttribute('role'),
          radios: all('#seg [role=radio]').length,
          checked: all('#seg [role=radio]').filter((el) => el.getAttribute('aria-checked') === 'true').length,
        },
        stepper: {
          current: all('#steps [aria-current]').map((el) => el.getAttribute('aria-current')),
        },
        pagination: {
          current: q('#pager [aria-current]')?.getAttribute('aria-current'),
          label: q('#pager').getAttribute('aria-label'),
        },
        sortable: {
          role: q('#th-name').getAttribute('role'),
          tabindex: q('#th-name').getAttribute('tabindex'),
          sort: q('#th-name').getAttribute('aria-sort'),
        },
        datepicker: {
          controls: q('#dp-input').getAttribute('aria-controls'),
          haspopup: q('#dp-input').getAttribute('aria-haspopup'),
          popupRole: q('#dp .ts-i-datepicker__popup').getAttribute('role'),
        },
        scrollProgress: {
          hidden: q('#sp').getAttribute('aria-hidden'),
          tabindex: q('#sp').getAttribute('tabindex'),
        },
        copy: q('#cp-btn').getAttribute('aria-label'),
        toast: {
          region: q('#toasts').getAttribute('role'),
          okRole: q('#toast-ok').getAttribute('role'),
          errRole: q('#toast-err').getAttribute('role'),
          errLive: q('#toast-err').getAttribute('aria-live'),
          errLiveParent: q('#toast-err').parentElement.getAttribute('aria-live'),
        },
        modal: { hidden: q('#dlg').hidden, ariaHidden: q('#dlg').getAttribute('aria-hidden') },
        drawer: { hidden: q('#drw').hidden, ariaHidden: q('#drw').getAttribute('aria-hidden') },
      }
    })

    // tabs
    assert.ok(state.tabs.tablist && state.tabs.tab && state.tabs.panel, JSON.stringify(state.tabs))
    assert.ok(state.tabs.controls, 'tab 必须有 aria-controls')
    assert.ok(state.tabs.labelledby, 'panel 必须有 aria-labelledby')
    // tooltip：真实气泡 + describedby 指向它
    assert.ok(state.tooltip.bubble, '运行时必须生成 role=tooltip 气泡')
    assert.equal(state.tooltip.text, '保存草稿')
    assert.ok(state.tooltip.described.includes(state.tooltip.bubbleId), `触发元素应描述气泡：${JSON.stringify(state.tooltip)}`)
    assert.equal(state.tooltip.rootTabindex, '0', '纯图标触发器应可聚焦')
    // 其它默认态
    assert.equal(state.skeleton, 'true')
    assert.deepEqual(state.progress, { role: 'progressbar', min: '0', max: '100', now: '64' })
    assert.equal(state.dropdown.expanded, 'false')
    assert.ok(state.dropdown.controls && state.dropdown.menu && state.dropdown.items === 3, JSON.stringify(state.dropdown))
    assert.equal(state.segmented.group, 'radiogroup')
    assert.equal(state.segmented.radios, 2)
    assert.equal(state.segmented.checked, 1)
    assert.deepEqual(state.stepper.current, ['step'], '只有当前步带 aria-current=step')
    assert.equal(state.pagination.current, 'page')
    assert.equal(state.pagination.label, '分页')
    assert.equal(state.sortable.role, 'columnheader')
    assert.equal(state.sortable.tabindex, '0')
    assert.equal(state.sortable.sort, 'none')
    assert.ok(state.datepicker.controls && state.datepicker.haspopup === 'dialog' && state.datepicker.popupRole === 'dialog', JSON.stringify(state.datepicker))
    assert.equal(state.scrollProgress.hidden, 'true', '未滚动时进度环隐藏')
    assert.equal(state.scrollProgress.tabindex, '-1', '隐藏时必须移出 Tab 序（真实违规修复）')
    assert.equal(state.copy, '复制代码')
    assert.equal(state.toast.region, 'status')
    assert.equal(state.toast.errRole, 'alert', '错误 toast 必须 role=alert')
    assert.equal(state.toast.errLive, 'assertive')
    assert.equal(state.toast.okRole, null, '成功 toast 不重复声明角色')
    assert.equal(state.modal.ariaHidden, 'true')
    assert.equal(state.drawer.ariaHidden, 'true')

    // --- modal 打开态：焦点进入 + 背景 inert + Esc 关闭并归还焦点 ---
    const modalState = await frame.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const opener = document.getElementById('modal-open')
      opener.focus()
      opener.click()
      await sleep(80)
      const open = {
        ariaHidden: document.getElementById('dlg').getAttribute('aria-hidden'),
        ariaModal: document.querySelector('#dlg [role=dialog]').getAttribute('aria-modal'),
        focusInside: document.getElementById('dlg').contains(document.activeElement),
        backgroundInert: document.getElementById('sibling').hasAttribute('inert'),
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await sleep(80)
      return {
        ...open,
        afterHidden: document.getElementById('dlg').hidden,
        afterAriaHidden: document.getElementById('dlg').getAttribute('aria-hidden'),
        focusReturned: document.activeElement === opener,
        backgroundRestored: !document.getElementById('sibling').hasAttribute('inert'),
      }
    })
    assert.equal(modalState.ariaHidden, 'false')
    assert.equal(modalState.ariaModal, 'true')
    assert.ok(modalState.focusInside, '打开后焦点应进入弹窗')
    assert.ok(modalState.backgroundInert, '打开后背景应 inert')
    assert.ok(modalState.afterHidden, 'Esc 应关闭弹窗')
    assert.equal(modalState.afterAriaHidden, 'true')
    assert.ok(modalState.focusReturned, '关闭后焦点应归还触发按钮')
    assert.ok(modalState.backgroundRestored, '关闭后背景 inert 应撤销')

    // --- drawer 打开态 ---
    const drawerState = await frame.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const opener = document.getElementById('drawer-open')
      opener.focus()
      opener.click()
      await sleep(80)
      const open = {
        hidden: document.getElementById('drw').hidden,
        ariaModal: document.querySelector('#drw [role=dialog]').getAttribute('aria-modal'),
        focusInside: document.getElementById('drw').contains(document.activeElement),
      }
      document.getElementById('drw-close').click()
      await sleep(80)
      return { ...open, closed: document.getElementById('drw').hidden, focusReturned: document.activeElement === opener }
    })
    assert.equal(drawerState.hidden, false)
    assert.equal(drawerState.ariaModal, 'true')
    assert.ok(drawerState.focusInside)
    assert.ok(drawerState.closed && drawerState.focusReturned, JSON.stringify(drawerState))

    // --- dropdown：展开 → 方向键 → Esc 归还焦点 ---
    const ddState = await frame.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const trigger = document.getElementById('dd-trigger')
      trigger.focus()
      trigger.click()
      await sleep(50)
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await sleep(50)
      const open = {
        expanded: trigger.getAttribute('aria-expanded'),
        active: trigger.getAttribute('aria-activedescendant'),
        menuHidden: trigger.parentElement.querySelector('[role=menu]').hidden,
      }
      document.querySelector('#dd [role=menuitem]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await sleep(50)
      return { ...open, afterExpanded: trigger.getAttribute('aria-expanded'), focusReturned: document.activeElement === trigger }
    })
    assert.equal(ddState.expanded, 'true')
    assert.ok(ddState.active, '应设置 aria-activedescendant')
    assert.equal(ddState.menuHidden, false)
    assert.equal(ddState.afterExpanded, 'false')
    assert.ok(ddState.focusReturned, 'Esc 后焦点应回到触发按钮')

    // --- tooltip 聚焦可见 ---
    const tipVisible = await frame.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      document.getElementById('tip').focus()
      await sleep(50)
      const bubble = document.querySelector('#tip [role=tooltip]')
      return getComputedStyle(bubble).visibility
    })
    assert.equal(tipVisible, 'visible', '键盘聚焦时气泡必须可见')

    // --- form-validation：无效字段写标准 ARIA ---
    const formState = await frame.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      document.getElementById('form-submit').click()
      await sleep(80)
      const input = document.getElementById('f-email')
      const error = document.getElementById('f-email-error')
      return {
        invalid: input.getAttribute('aria-invalid'),
        described: input.getAttribute('aria-describedby'),
        errorId: error.id,
        errorRole: error.getAttribute('role'),
        shown: error.textContent,
      }
    })
    assert.equal(formState.invalid, 'true')
    assert.equal(formState.described, formState.errorId)
    assert.equal(formState.errorRole, 'alert')
    assert.match(formState.shown, /邮箱/)

    // --- sortable：Enter 排序 + 播报 ---
    const sortState = await frame.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const th = document.getElementById('th-name')
      th.focus()
      const rows = () => Array.from(th.closest('table').tBodies[0].rows).map((r) => r.cells[0].textContent)
      const before = rows()
      th.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await sleep(100)
      const firstSort = th.getAttribute('aria-sort')
      th.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await sleep(120)
      return {
        before,
        firstSort,
        sort: th.getAttribute('aria-sort'),
        after: rows(),
        announced: document.getElementById('ts-i-announcer')?.textContent,
      }
    })
    assert.equal(sortState.firstSort, 'ascending')
    assert.equal(sortState.sort, 'descending', '再按一次应切到降序')
    assert.notDeepEqual(sortState.after, sortState.before, '重排后行顺序必须变化')
    assert.equal(sortState.after[0], '甲', '降序后第一行应是「甲」')
    assert.match(sortState.announced ?? '', /降序/, '重排后必须播报')

    // --- date-picker：roving tabindex + 方向键 + Esc ---
    const dpState = await frame.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const input = document.getElementById('dp-input')
      input.focus()
      input.click()
      await sleep(80)
      const popup = document.querySelector('#dp .ts-i-datepicker__popup')
      const opened = !popup.hidden
      const roving = popup.querySelectorAll('[data-ts-date][tabindex="0"]')
      const focusedDay = document.activeElement
      focusedDay.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await sleep(60)
      const afterMove = document.activeElement
      const rovingAfter = popup.querySelectorAll('[data-ts-date][tabindex="0"]').length
      afterMove.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await sleep(60)
      return {
        open: opened,
        roving: roving.length,
        rovingAfter,
        moved: afterMove !== focusedDay,
        currentDate: !!popup.querySelector('[data-ts-date][aria-current="date"]'),
        afterClosed: popup.hidden,
        focusReturned: document.activeElement === input,
      }
    })
    assert.equal(dpState.open, true, JSON.stringify(dpState))
    assert.equal(dpState.roving, 1, '网格里只能有一个 Tab 停靠点（Tab 只在网格外）')
    assert.equal(dpState.rovingAfter, 1, '方向键移动后停靠点仍只有一个')
    assert.ok(dpState.moved, '方向键应移动焦点')
    assert.ok(dpState.currentDate, '今天应带 aria-current=date')
    assert.ok(dpState.afterClosed && dpState.focusReturned, JSON.stringify(dpState))

    // --- segmented / switch / pagination / copy ---
    const misc = await frame.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const first = document.querySelector('#seg [role=radio]')
      first.focus()
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await sleep(50)
      const checked = Array.from(document.querySelectorAll('#seg [role=radio]')).find((el) => el.getAttribute('aria-checked') === 'true')
      const sw = document.getElementById('sw')
      sw.click()
      await sleep(50)
      document.querySelectorAll('#pager .ts-i-pagination__item')[1].click()
      await sleep(50)
      document.getElementById('cp-btn').click()
      /* 复制可能走 Clipboard API 的异步路径，失败才回退 execCommand；
         不同环境落地时间不同，这里等播报区真的出现文案，而不是死等固定毫秒。 */
      const announcer = () => document.getElementById('ts-i-announcer')?.textContent ?? ''
      for (let i = 0; i < 40 && !announcer().includes('已复制'); i++) await sleep(50)
      return {
        checkedText: checked?.getAttribute('data-ts-value'),
        switchChecked: sw.getAttribute('aria-checked'),
        pageCurrent: document.querySelector('#pager [aria-current="page"]')?.textContent,
        announced: announcer(),
      }
    })
    assert.equal(misc.checkedText, 'week')
    assert.equal(misc.switchChecked, 'false')
    assert.equal(misc.pageCurrent, '2')
    assert.match(misc.announced ?? '', /已复制/, '复制成功应写入共享播报区')

    // --- toast Esc 关闭 ---
    const toastClosed = await frame.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const err = document.getElementById('toast-err')
      err.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await sleep(300)
      return document.getElementById('toast-err') === null
    })
    assert.ok(toastClosed, 'Esc 应关闭 toast')
  })
})

test('交互 ARIA（窄屏）：移动菜单与目录的焦点陷阱、inert、Esc 归还', { skip: !browserPath && '未找到浏览器', timeout: 180000 }, async () => {
  await withFrame(MOBILE_PAGE, async ({ frame }) => {
    const mnState = await frame.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const toggle = document.getElementById('mn-toggle')
      toggle.focus()
      toggle.click()
      await sleep(80)
      const open = {
        expanded: toggle.getAttribute('aria-expanded'),
        backgroundInert: document.getElementById('sibling').hasAttribute('inert'),
        trapBound: document.getElementById('mn').hasAttribute('data-ts-trap-bound'),
      }
      /* Tab 从最后一个可聚焦元素继续走，应回到第一个（焦点陷阱生效）。 */
      const link = document.getElementById('mn-link')
      link.focus()
      link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
      await sleep(50)
      const trapped = document.activeElement === toggle
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await sleep(80)
      return {
        ...open,
        trapped,
        afterExpanded: toggle.getAttribute('aria-expanded'),
        focusReturned: document.activeElement === toggle,
        backgroundRestored: !document.getElementById('sibling').hasAttribute('inert'),
      }
    })
    assert.equal(mnState.expanded, 'true')
    assert.ok(mnState.backgroundInert, '菜单打开时背景应 inert')
    assert.ok(mnState.trapBound, '应绑定焦点陷阱')
    assert.ok(mnState.trapped, 'Tab 应被限制在菜单内')
    assert.equal(mnState.afterExpanded, 'false')
    assert.ok(mnState.focusReturned, 'Esc 后焦点应回到汉堡按钮')
    assert.ok(mnState.backgroundRestored, '关闭后背景 inert 应撤销')

    const tocState = await frame.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const toggle = document.getElementById('toc-toggle')
      toggle.focus()
      toggle.click()
      await sleep(80)
      const open = {
        opened: document.getElementById('toc').classList.contains('ts-i-toc--open'),
        expanded: toggle.getAttribute('aria-expanded'),
        backgroundInert: document.getElementById('sibling').hasAttribute('inert'),
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await sleep(80)
      return {
        ...open,
        closed: !document.getElementById('toc').classList.contains('ts-i-toc--open'),
        focusReturned: document.activeElement === toggle,
        backgroundRestored: !document.getElementById('sibling').hasAttribute('inert'),
      }
    })
    assert.ok(tocState.opened)
    assert.equal(tocState.expanded, 'true')
    assert.ok(tocState.backgroundInert)
    assert.ok(tocState.closed && tocState.focusReturned && tocState.backgroundRestored, JSON.stringify(tocState))
  }, { device: 'mobile', width: 700, height: 900 })
})
