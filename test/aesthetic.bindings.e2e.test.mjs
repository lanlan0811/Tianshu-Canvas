import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadPlugin } from './helpers/host.mjs'
import { resolveTestBrowser } from './helpers/browser.mjs'

const root = resolve(import.meta.dirname, '..')
const { tools } = await loadPlugin(pathToFileURL(join(root, 'dist/index.mjs')).href)
const browserPath = resolveTestBrowser()

test('自由模式：页面实际主题参与默认自检，伪造注释或脚本不能保留主题', async () => {
  const cwd=mkdtempSync(join(tmpdir(),'tsc-theme-review-'))
  try {
    const resource=JSON.parse((await tools.canvas_style.execute({input:{action:'prototype',prototype_id:'product-story'},cwd})).content)
    const broken=resource.html.replace('</main>','<p class="tp-unregistered" style="color:var(--ts-color-does-not-exist)">坏契约</p></main>')
    const up=await tools.canvas_upsert_page.execute({input:{id:'theme-review',title:'Theme',html:broken},cwd})
    assert.ok(!up.isError,up.content)
    for(const input of [{page_id:'theme-review'},{html:broken},{}]){
      const result=await tools.canvas_check_style.execute({input,cwd})
      assert.match(result.content,/tp-unregistered/)
      assert.match(result.content,/--ts-color-does-not-exist/)
    }
    // The compiled CSS contains the same attribute selector before the actual
    // body root. Replace the element, otherwise this fixture is still a genuine
    // registered prototype and correctly retains its theme.
    const plain=resource.html.replace('<main data-ts-prototype="product-story">','<main data-example="plain">')
    assert.match(plain, /<main data-example="plain">/)
    assert.doesNotMatch(plain, /<main data-ts-prototype="product-story">/)
    for(const marker of ['<!-- data-ts-prototype="product-story" -->',`<script>var label='data-ts-prototype="product-story"'</script>`,'<main data-ts-prototype="unregistered"></main>']){
      const result=await tools.canvas_upsert_page.execute({input:{id:'plain-theme',html:plain.replace('<body>','<body>'+marker),title:'Plain'},cwd})
      assert.ok(!result.isError,result.content)
      const saved=readFileSync(join(cwd,'.tianshu-canvas/pages/plain-theme.html'),'utf8')
      assert.doesNotMatch(saved,/tianshu-ds:start/)
    }
  } finally {rmSync(cwd,{recursive:true,force:true})}
})

test('原创原型：自由项目保持自包含，项目锁优先；普通自由页仍剥离旧主题', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-composition-'))
  try {
    const resource = JSON.parse((await tools.canvas_style.execute({input:{action:'prototype',prototype_id:'resource-catalog'},cwd})).content)
    assert.ok(resource.html.includes('tianshu-tokens'))
    const result = await tools.canvas_upsert_page.execute({input:{title:'原型',html:resource.html},cwd})
    assert.ok(!result.isError, result.content)
    const id = result.content.match(/id=([\w-]+)/)[1]
    let saved = readFileSync(join(cwd,'.tianshu-canvas/pages',id+'.html'),'utf8')
    assert.match(saved,/tianshu-tokens/)
    assert.match(saved,/tianshu-interactions/)
    assert.equal(JSON.parse(readFileSync(join(cwd,'.tianshu-canvas/project.json'),'utf8')).design,undefined)
    await tools.canvas_upsert_page.execute({input:{id,html:saved},cwd})
    saved = readFileSync(join(cwd,'.tianshu-canvas/pages',id+'.html'),'utf8')
    assert.equal(saved.split('tianshu-ds:start').length-1,1)
    await tools.canvas_style.execute({input:{action:'set',style_id:'tianshu-inkstone'},cwd})
    saved = readFileSync(join(cwd,'.tianshu-canvas/pages',id+'.html'),'utf8')
    assert.match(saved,/style=tianshu-inkstone/)
    const lint = await tools.canvas_check_style.execute({input:{html:'<div class="tp-unregistered ts-no-such-component">test</div>',style_id:'tianshu-original'},cwd})
    assert.match(lint.content,/tp-unregistered/)
    assert.match(lint.content,/ts-no-such-component/)
  } finally { rmSync(cwd,{recursive:true,force:true}) }
})

test('声明式绑定：过滤/计数/空态/分页、作用域隔离、聊天纯文本和表单校验', {skip:!browserPath, timeout:90000}, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-bindings-'))
  let browser
  try {
    const controls = '<section data-ts-filter data-ts-table-pages data-ts-page-size="2"><label>Search<input data-ts-filter-input></label><span data-ts-filter-count></span><p data-ts-filter-empty hidden>Empty</p><table><tbody><tr data-ts-filter-item="Alpha"><td>Alpha</td></tr><tr data-ts-filter-item="Beta"><td>Beta</td></tr><tr data-ts-filter-item="Gamma"><td>Gamma</td></tr></tbody></table><nav data-ts-pagination data-ts-total="2"><button data-ts-page-prev>Prev</button><button class="ts-i-pagination__item">1</button><button class="ts-i-pagination__item">2</button><button data-ts-page-next>Next</button></nav></section>'
    const html = '<html><body><main data-ts-prototype="test-bindings"><div id="first">'+controls+'</div><div id="second">'+controls+'</div><div data-ts-chat-messages></div><form data-ts-chat-form><label>Message<input name="message" required></label><button>Send</button></form><form data-ts-demo-save><label>Name<input name="name" required></label><button>Save</button><p data-ts-demo-feedback hidden></p></form></main></body></html>'
    await tools.canvas_style.execute({input:{action:'set',style_id:'tianshu-original'},cwd})
    const add=await tools.canvas_upsert_page.execute({input:{title:'Bindings',html},cwd})
    assert.ok(!add.isError,add.content)
    const id=add.content.match(/id=([\w-]+)/)[1]
    const open=await tools.canvas_open.execute({input:{port:0},cwd})
    const url=open.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)[0]
    const puppeteer=(await import('puppeteer-core')).default
    browser=await puppeteer.launch({executablePath:browserPath,headless:true,args:process.platform==='linux'?['--no-sandbox']:[]})
    const page=await browser.newPage()
    await page.goto(url,{waitUntil:'domcontentloaded'})
    await page.waitForSelector('.page-node__iframe')
    await page.waitForFunction(() => !location.hash)
    // Use the same authenticated preview route at 1:1 scale for trusted clicks.
    // React Flow's transformed canvas is covered by its separate geometry suite.
    const previewUrl=new URL(url)
    previewUrl.pathname += 'page/'+id
    previewUrl.hash=''
    await page.evaluate(src=>{const f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');f.src=src;f.style.cssText='width:100%;height:1600px;border:0';document.body.replaceChildren(f)},previewUrl.toString())
    const frame=await page.waitForFrame(f=>f.url().includes('/page/'+id))
    await frame.waitForFunction(() => !!window.__tianshu_interactions__)
    const state=()=>frame.evaluate(()=>Array.from(document.querySelectorAll('#first tr')).filter(x=>!x.hidden).map(x=>x.textContent))
    assert.deepEqual(await state(),['Alpha','Beta'])
    await frame.click('#first [data-ts-page-next]')
    assert.deepEqual(await state(),['Gamma'])
    await frame.type('#first [data-ts-filter-input]','Beta')
    assert.deepEqual(await state(),['Beta'])
    assert.equal(await frame.$eval('#first [data-ts-filter-count]',x=>x.textContent),'1')
    assert.equal(await frame.$eval('#first [data-ts-page-next]',x=>x.disabled),true)
    assert.equal(await frame.$$eval('#second tr',xs=>xs.filter(x=>!x.hidden).length),2)
    await frame.type('#first [data-ts-filter-input]','zzz')
    assert.equal(await frame.$eval('#first [data-ts-filter-empty]',x=>x.hidden),false)
    await frame.$eval('#first [data-ts-filter-input]',el=>{el.value='';el.dispatchEvent(new Event('input',{bubbles:true}))})
    await frame.click('#first [data-ts-page-next]')
    assert.deepEqual(await state(),['Gamma'])
    const payload='<img src=x onerror=alert(1)>'
    await frame.type('[data-ts-chat-form] input',payload)
    assert.equal(await frame.$eval('[data-ts-chat-form] input',x=>x.value),payload)
    await frame.click('[data-ts-chat-form] button')
    assert.equal(await frame.$eval('[data-ts-chat-messages] p',x=>x.textContent),payload)
    assert.equal(await frame.$$eval('[data-ts-chat-messages] img',xs=>xs.length),0)
    assert.match(await frame.$eval('[data-ts-chat-messages]',x=>x.textContent),/未连接 AI/)
    await frame.click('[data-ts-demo-save] button')
    assert.equal(await frame.$eval('[data-ts-demo-feedback]',x=>x.hidden),true)
    await frame.type('[data-ts-demo-save] input','Example')
    await frame.click('[data-ts-demo-save] button')
    assert.equal(await frame.$eval('[data-ts-demo-feedback]',x=>x.hidden),false)
    assert.match(await frame.$eval('[data-ts-demo-feedback]',x=>x.textContent),/未向服务器/)
  } finally { await browser?.close();rmSync(cwd,{recursive:true,force:true}) }
})

test('交互边界回归：sandbox真实键鼠提交、禁用/组合输入与嵌套容器互不串扰', {skip:!browserPath, timeout:90000}, async () => {
  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({executablePath:browserPath,headless:true})
  try {
    const page = await browser.newPage()
    const errors = [], external = []
    page.on('pageerror',error=>errors.push(error.message))
    await page.setRequestInterception(true)
    page.on('request',request=>{
      if (/^https?:/.test(request.url())) {external.push(request.url());void request.abort()}
      else void request.continue()
    })
    const chat = id => '<section id="'+id+'"><div data-ts-chat-messages aria-live="polite"></div><form data-ts-chat-form><label>Message<input required name="message"></label><button type="submit"><span>Send</span></button><button type="button">Keep editing</button></form></section>'
    const fixture = '<main data-ts-prototype="outer">'+chat('chat-a')+chat('chat-b')+'<div id="outer-filter" data-ts-filter><label>Outer<input data-ts-filter-input value="Beta"></label><span data-ts-filter-count></span><p data-ts-filter-item>Alpha</p><p data-ts-filter-item>Beta</p><div id="inner-filter" data-ts-filter><label>Inner<input data-ts-filter-input></label><span data-ts-filter-count></span><p data-ts-filter-item>Inner Alpha</p><p data-ts-filter-item>Inner Beta</p><p data-ts-filter-empty hidden>Empty</p></div></div><form id="save" data-ts-form data-ts-demo-save><label>Name<input required name="name"></label><button type="submit"><span>Save</span></button><p data-ts-demo-feedback hidden></p></form></main>'
    const runtime = readFileSync(join(root,'design-systems/interactions/interactions.js'),'utf8')
    const pagination = '<section id="page-reset" data-ts-filter data-ts-table-pages data-ts-page-size="2"><label>Filter<input data-ts-filter-input></label><table><tbody>'+['Alpha','Beta','Gamma','Delta','Epsilon','Zeta'].map(value=>'<tr data-ts-filter-item><td>'+value+'</td></tr>').join('')+'</tbody></table><nav data-ts-pagination data-ts-total="3"><button data-ts-page-prev>Previous</button><button class="ts-i-pagination__item">1</button><button class="ts-i-pagination__item">2</button><button class="ts-i-pagination__item">3</button><button data-ts-page-next>Next</button></nav></section>'
    const html = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;;script-src &apos;unsafe-inline&apos;"><body>'+fixture+pagination+'<script>'+runtime+'</script></body>'
    await page.setContent('<iframe sandbox="allow-scripts" style="width:100%;height:2000px;border:0"></iframe>')
    await page.$eval('iframe',(iframe,doc)=>{iframe.srcdoc=doc},html)
    const frame = await (await page.$('iframe')).contentFrame()
    await frame.waitForSelector('#chat-a button')
    await frame.waitForFunction(()=>!!window.__tianshu_interactions__)
    assert.equal(await frame.evaluate(()=>origin),'null','必须保留无同源权限的真实沙箱')
    assert.equal(await page.$eval('iframe',el=>el.getAttribute('sandbox')),'allow-scripts','不允许通过放开allow-forms修复演示提交')
    assert.deepEqual(await frame.$$eval('#outer-filter > [data-ts-filter-item]',els=>els.filter(el=>!el.hidden).map(el=>el.textContent)),['Beta'],'初始化即应用已有查询')
    assert.equal(await frame.$eval('#inner-filter [data-ts-filter-count]',el=>el.textContent),'2')
    await frame.type('#outer-filter > label input','missing')
    assert.equal(await frame.$$eval('#inner-filter [data-ts-filter-item]',els=>els.filter(el=>!el.hidden).length),2,'父过滤器不能隐藏子过滤器条目')
    await frame.type('#inner-filter input','no-match')
    assert.equal(await frame.$eval('#inner-filter [data-ts-filter-count]',el=>el.textContent),'0')
    assert.equal(await frame.$eval('#inner-filter [data-ts-filter-empty]',el=>el.hidden),false)
    const visibleRows = () => frame.$$eval('#page-reset tr',rows=>rows.filter(row=>!row.hidden).map(row=>row.textContent))
    await frame.click('#page-reset [data-ts-page-next]')
    await frame.click('#page-reset [data-ts-page-next]')
    assert.deepEqual(await visibleRows(),['Epsilon','Zeta'])
    await frame.type('#page-reset input','Alpha')
    assert.deepEqual(await visibleRows(),['Alpha'])
    await frame.focus('#page-reset input')
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.keyboard.press('Backspace')
    assert.deepEqual(await visibleRows(),['Alpha','Beta'])
    await frame.click('#page-reset [data-ts-page-next]')
    assert.deepEqual(await visibleRows(),['Gamma','Delta'],'过滤复位后下一页必须从当前第一页前进，不能复用旧第三页状态')

    const messageCount = id => frame.$$eval('#'+id+' [data-ts-chat-messages] p:not([role])',els=>els.length)
    await frame.type('#chat-b input','<img src="https://invalid.example/x" onerror="alert(1)">')
    await frame.click('#chat-b button[type=button]')
    assert.equal(await messageCount('chat-b'),0,'非提交按钮不能发送消息')
    await frame.click('#chat-b button[type=submit] span')
    assert.equal(await messageCount('chat-a'),0,'多个聊天容器不得串消息')
    assert.equal(await messageCount('chat-b'),1,'点按钮内部元素仅发送一次')
    assert.equal(await frame.$$eval('#chat-b [data-ts-chat-messages] img',els=>els.length),0,'恶意输入只能创建纯文本')
    await frame.type('#chat-b input','Keyboard')
    await page.keyboard.press('Enter')
    assert.equal(await messageCount('chat-b'),2,'单行输入真实Enter应发送一次')
    await frame.type('#chat-b input','Space')
    await frame.focus('#chat-b button[type=submit]')
    await page.keyboard.press('Space')
    assert.equal(await messageCount('chat-b'),3,'提交按钮真实空格应发送一次')
    await frame.type('#chat-b input','Pending')
    await page.keyboard.down('Control')
    await page.keyboard.press('Enter')
    await page.keyboard.up('Control')
    assert.equal(await messageCount('chat-b'),3,'组合按键不能误发消息')
    await frame.$eval('#chat-b input',input=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})))
    assert.equal(await messageCount('chat-b'),3,'输入法候选确认不能误发消息')
    await frame.$eval('#chat-b button[type=submit]',button=>{button.disabled=true})
    await frame.focus('#chat-b input')
    await page.keyboard.press('Enter')
    assert.equal(await messageCount('chat-b'),3,'禁用提交按钮后Enter也不能发送')
    await frame.$eval('#chat-b button[type=submit]',button=>{button.disabled=false})
    await page.keyboard.press('Enter')
    assert.equal(await messageCount('chat-b'),4)
    assert.equal(await frame.$eval('#chat-b input',input=>input.value),'')
    assert.equal(await frame.$eval('#chat-b input',input=>document.activeElement===input),true,'发送后保留输入焦点')

    await frame.$eval('#save',form=>{window.validEvents=0;form.addEventListener('ts:form-valid',()=>{window.validEvents++})})
    await frame.click('#save button span')
    assert.equal(await frame.$eval('#save [data-ts-demo-feedback]',el=>el.hidden),true,'必填校验失败不能显示成功')
    await frame.type('#save input','Example')
    await page.keyboard.press('Enter')
    assert.equal(await frame.evaluate(()=>window.validEvents),1,'同时注册通用校验和演示反馈也只能提交一次')
    assert.equal(await frame.$eval('#save [data-ts-demo-feedback]',el=>el.hidden),false)
    assert.equal(await frame.$eval('#save [data-ts-demo-feedback]',el=>el.getAttribute('role')),'status')
    assert.deepEqual(errors,[])
    assert.deepEqual(external,[],'交互演示不得外发消息或资源请求')
  } finally {await browser.close()}
})

test('两类列表批量归档：零选择禁用、跨页筛选保留、只改选中行和重复操作', {skip:!browserPath, timeout:90000}, async () => {
  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({executablePath:browserPath,headless:true})
  try {
    const page = await browser.newPage()
    const errors = [], external = []
    page.on('pageerror',error=>errors.push(error.message))
    await page.setRequestInterception(true)
    page.on('request',request=>{
      if (/^https?:/.test(request.url())) {external.push(request.url());void request.abort()}
      else void request.continue()
    })
    const runtime = readFileSync(join(root,'design-systems/interactions/interactions.js'),'utf8')
    for (const id of ['admin-list','admin-list-tabs']) {
      const body = readFileSync(join(root,'design-systems/prototypes',id,'body.html'),'utf8')
      const html = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;;script-src &apos;unsafe-inline&apos;"><body>'+body+'<script>'+runtime+'</script></body>'
      await page.setContent('<iframe sandbox="allow-scripts" style="width:100%;height:2200px;border:0"></iframe>')
      await page.$eval('iframe',(iframe,doc)=>{iframe.srcdoc=doc},html)
      const frame = await (await page.$('iframe')).contentFrame()
      await frame.waitForSelector('[data-ts-bulk-demo]')
      await frame.waitForFunction(()=>!!window.__tianshu_interactions__)
      const rows = () => frame.$$eval('tbody tr',els=>els.map(row=>({name:row.querySelector('a').textContent,status:row.querySelector('[data-ts-bulk-status]').textContent,checked:row.querySelector('[data-ts-bulk-select]').checked,hidden:row.hidden})))
      const clear = async () => {
        await frame.focus('[data-ts-filter-input]')
        await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace')
      }
      const original = await rows()
      assert.equal(await frame.$eval('[data-ts-bulk-archive]',el=>el.disabled),true,id+'零选择必须禁用')
      assert.equal(await frame.$eval('[data-ts-bulk-count]',el=>el.textContent),'0')
      await frame.focus('tbody tr:nth-child(1) [data-ts-bulk-select]')
      await page.keyboard.press('Space')
      assert.equal(await frame.$eval('[data-ts-bulk-count]',el=>el.textContent),'1','键盘选择应更新计数')
      await frame.click('[data-ts-page-next]')
      await frame.click('tbody tr:nth-child(5) [data-ts-bulk-select]')
      assert.equal(await frame.$eval('[data-ts-bulk-count]',el=>el.textContent),'2','跨页保留勾选')
      await frame.type('[data-ts-filter-input]','山间')
      assert.equal(await frame.$eval('[data-ts-bulk-count]',el=>el.textContent),'2','筛选隐藏已选行也保留选择')
      await frame.focus('[data-ts-bulk-archive]')
      await page.keyboard.press('Enter')
      const archived = await rows()
      for(let index=0;index<archived.length;index++) assert.equal(archived[index].status,[0,4].includes(index)?'已归档（本地演示）':original[index].status,id+'只修改选中行'+index)
      assert.ok(archived.every(row=>!row.checked),'动作完成清空选择')
      assert.equal(await frame.$eval('[data-ts-bulk-archive]',el=>el.disabled),true)
      assert.equal(await frame.$eval('[data-ts-bulk-count]',el=>el.textContent),'0')
      assert.match(await frame.$eval('[data-ts-bulk-feedback]',el=>el.textContent),/归档 2 条.*未保存到服务器/)
      assert.equal(await frame.$eval('[data-ts-bulk-feedback]',el=>el.getAttribute('role')),'status')
      await frame.click('[data-ts-bulk-archive]')
      assert.deepEqual(await rows(),archived,'重复点击禁用动作不得再次更改')
      await clear()
      assert.equal(await frame.$eval('[data-ts-pagination]',el=>el.getAttribute('data-ts-page')),'1')
      await frame.type('[data-ts-filter-input]','待确认')
      assert.equal(await frame.$eval('[data-ts-filter-count]',el=>el.textContent),'1')
      await frame.click('tbody tr:nth-child(2) [data-ts-bulk-select]')
      await frame.click('[data-ts-bulk-archive]')
      assert.equal(await frame.$eval('[data-ts-filter-count]',el=>el.textContent),'0','状态变更后必须重新应用当前过滤器')
      assert.equal(await frame.$eval('[data-ts-filter-empty]',el=>el.hidden),false)
      assert.equal(await frame.$eval('[data-ts-page-next]',el=>el.disabled),true)
      await clear()
      await frame.click('[data-ts-page-next]')
      assert.deepEqual((await rows()).filter(row=>!row.hidden).map(row=>row.name),original.slice(4).map(row=>row.name),'批量操作后跨页显示保持正确')
      await frame.click('[data-ts-page-prev]')
      await frame.click('tbody tr:nth-child(1) [data-ts-bulk-select]')
      await frame.click('[data-ts-bulk-archive]')
      assert.equal((await rows())[0].status,'已归档（本地演示）','重新选择已归档记录具有幂等状态')
      assert.equal(await frame.$eval('[data-ts-bulk-count]',el=>el.textContent),'0')
      assert.equal(await frame.evaluate(()=>origin),'null')
    }
    assert.deepEqual(errors,[])
    assert.deepEqual(external,[],'本地批量动作不发送网络请求')
  } finally {await browser.close()}
})
