import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'
import { resolveTestBrowser } from './helpers/browser.mjs'

const root=resolve(import.meta.dirname,'..')
const browserPath=resolveTestBrowser()
const { tools, api }=await loadPlugin(pathToFileURL(join(root,'dist','index.mjs')).href)

test('原创原型：真实任务搜索分页、输入保留、表单校验、聊天与移动多视图', {skip:!browserPath&&'未找到浏览器',timeout:180000},async()=>{
  const puppeteer=(await import('puppeteer-core')).default
  const cwd=mkdtempSync(join(tmpdir(),'tsc-prototype-e2e-'))
  const browser=await puppeteer.launch({executablePath:browserPath,headless:true,args:['--disable-gpu']})
  const page=await browser.newPage()
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  let external=0
  await page.setRequestInterception(true)
  page.on('request',req=>{if(/^https?:/.test(req.url())){external++;req.abort()}else req.continue()})
  let frame
  async function open(id,width=1440){
    const result=await tools.canvas_style.execute({cwd,input:{action:'prototype',prototype_id:id}})
    assert.ok(!result.isError,result.content)
    const doc=JSON.parse(result.content)
    await page.setViewport({width,height:1000})
    await page.goto('about:blank')
    const escaped=doc.html.replace(/[&"<>]/g,c=>({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]))
    await page.setContent('<iframe sandbox="allow-scripts" style="border:0;width:100%;height:1000px" srcdoc="'+escaped+'"></iframe>',{waitUntil:'load'})
    frame=await (await page.$('iframe')).contentFrame()
    await frame.waitForSelector('[data-ts-prototype]')
    await frame.evaluate(async()=>{await document.fonts.ready})
    assert.equal(await frame.evaluate(()=>globalThis.origin),'null','原型必须在opaque origin中测试')
    return doc
  }
  try{
    await open('admin-list-tabs')
    const visible=()=>frame.$$eval('tbody tr',rows=>rows.filter(r=>!r.hidden).map(r=>r.textContent))
    const first=await visible()
    assert.equal(first.length,4)
    await frame.click('[data-ts-page-next]')
    const second=await visible()
    assert.equal(second.length,4)
    assert.ok(!second.some(row=>first.includes(row)),'分页必须切换行而非仅页码')
    await frame.type('[data-ts-filter-input]','林青')
    assert.equal((await visible()).length,2)
    assert.equal(await frame.$eval('[data-ts-pagination]',el=>el.getAttribute('data-ts-page')),'1')
    await frame.focus('[data-ts-filter-input]')
    await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control')
    await page.keyboard.press('Backspace')
    await frame.type('[data-ts-filter-input]','不存在的记录')
    assert.equal((await visible()).length,0)
    assert.equal(await frame.$eval('[data-ts-filter-empty]',el=>el.hidden),false)
    await frame.focus('[data-ts-filter-input]')
    await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control')
    await page.keyboard.press('Backspace')
    assert.equal((await visible()).length,4)

    await open('admin-detail-tabs')
    await frame.type('textarea','未提交的核对备注')
    await frame.click('[data-ts-tab=secondary]')
    await frame.click('[data-ts-tab=primary]')
    assert.equal(await frame.$eval('textarea',el=>el.value),'未提交的核对备注')
    await frame.focus('[data-ts-tab=primary]')
    await page.keyboard.press('ArrowRight')
    assert.equal(await frame.$eval('[data-ts-tab=secondary]',el=>el.getAttribute('aria-selected')),'true')

    await open('admin-create',390)
    await frame.click('button[type=submit]')
    assert.doesNotMatch(await frame.$eval('[data-ts-demo-feedback]',el=>el.textContent),/校验通过/)
    await frame.type('#workspace-name','示例团队')
    await frame.type('#workspace-email','owner@example.test')
    await frame.click('button[type=submit]')
    assert.match(await frame.$eval('[data-ts-demo-feedback]',el=>el.textContent),/未向服务器提交/)

    await open('ai-workspace',768)
    const payload='<img src=x onerror=alert(1)>'
    await frame.type('[data-ts-chat-form] input',payload)
    await frame.click('[data-ts-chat-form] button')
    assert.match(await frame.$eval('[data-ts-chat-messages]',el=>el.textContent),/<img src=x/)
    assert.equal(await frame.$$eval('[data-ts-chat-messages] img',els=>els.length),0,'输入必须作为纯文本加入')
    assert.match(await frame.$eval('[data-ts-chat-messages]',el=>el.textContent),/未连接 AI 或服务器/)

    await open('mobile-reading',390)
    for(const id of ['recommend','threads','preferences','read']){
      await frame.click('[data-ts-tab='+id+']')
      assert.equal(await frame.$eval('[data-ts-panel='+id+']',el=>el.hidden),false)
    }
    await frame.click('[data-ts-tab=threads]')
    await frame.type('textarea','留下一个问题')
    await frame.click('[data-ts-tab=preferences]')
    const before=await frame.$eval('[data-ts-switch]',el=>el.getAttribute('aria-checked'))
    await frame.click('[data-ts-switch]')
    assert.notEqual(await frame.$eval('[data-ts-switch]',el=>el.getAttribute('aria-checked')),before)
    await frame.click('[data-ts-tab=threads]')
    assert.equal(await frame.$eval('textarea',el=>el.value),'留下一个问题')

    await open('developer-workbench',390)
    await frame.click('[data-ts-tab=style]')
    assert.equal(await frame.$eval('[data-ts-panel=style]',el=>el.hidden),false)
    await frame.click('[data-ts-tab=page]')
    await frame.type('[data-ts-panel=page] textarea','\n<!-- local note -->')
    await frame.click('[data-ts-tab=readme]')
    await frame.click('[data-ts-tab=page]')
    assert.match(await frame.$eval('[data-ts-panel=page] textarea',el=>el.value),/local note/)
    assert.equal(external,0,'原型不应请求任何外部网络')
    assert.deepEqual(errors,[])
  }finally{await browser.close();await api.deactivate?.();rmSync(cwd,{recursive:true,force:true})}
})
