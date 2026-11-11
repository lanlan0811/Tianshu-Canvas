import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { buildPrototypeLibrary, validatePrototypeResource } from '../scripts/build-prototypes.mjs'

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'design-systems', 'prototypes')
const json = p => JSON.parse(readFileSync(p, 'utf8'))
const ids = json(join(source, 'index.json')).prototypes
const required = ['product-story','editorial-casebook','product-showcase','saas-landing','pricing-reference','resource-catalog','admin-list-tabs','admin-list','admin-detail','admin-detail-tabs','admin-detail-sidebar','admin-metrics','admin-create','editorial-operations','executive-briefing','training-operations','monitoring-console','hard-edge-analytics','metrics-workspace','campaign-operations','neutral-analytics','deployment-console','developer-dashboard','business-analytics','operations-overview','ai-workspace','knowledge-workspace','mobile-content','mobile-reading','developer-workbench','workspace-settings','implementation-brief']

test('原创原型覆盖全部32个目标，类别与正文信息架构不是同一模板改名', () => {
  assert.deepEqual(ids, required)
  const bodies = ids.map(id => readFileSync(join(source,id,'body.html'),'utf8'))
  assert.equal(new Set(bodies).size, 32)
  const signatures = bodies.map(body => body.replace(/>[^<]*/g,'>').replace(/data-ts-prototype="[^"]+"/g,'').replace(/id="[^"]+"/g,'').replace(/href="[^"]+"/g,''))
  assert.equal(new Set(signatures).size,32, '不能只更换文字与id生成原型')
  const fields = ['contentRequirements','responsive','interactions','variants','designDecisions']
  for(const id of ids) {
    const meta=json(join(source,id,'meta.json'))
    for(const field of fields) assert.ok(meta[field].length,`${id}/${field}`)
    assert.ok(meta.designDecisions.length>=2,`${id}必须说明至少两个实质设计决策`)
  }
})

test('原创原型与六方向示例独立构建一次，输出确定且不改动旧模板', () => {
  const a=mkdtempSync(join(tmpdir(),'tsc-prototypes-a-'))
  const b=mkdtempSync(join(tmpdir(),'tsc-prototypes-b-'))
  try {
    assert.deepEqual(buildPrototypeLibrary(root,a),{prototypes:32,directions:3,examples:6})
    buildPrototypeLibrary(root,b)
    const walk=(dir,prefix='')=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name),prefix+e.name+'/'):[prefix+e.name])
    for(const file of walk(join(a,'design'))) assert.equal(readFileSync(join(a,'design',file),'utf8'),readFileSync(join(b,'design',file),'utf8'),file)
    for(const id of ids) {
      const compiled=json(join(a,'design','prototypes',id+'.json'))
      assert.match(compiled.css,new RegExp('data-ts-prototype="'+id+'"'))
      assert.doesNotMatch(compiled.css,/:scope/)
      assert.doesNotMatch(compiled.html,/<script\b|<style\b|<html\b|https?:\/\//i)
    }
    const directions=json(join(a,'design','directions','index.json')).directions
    assert.deepEqual(directions.map(d=>d.id),['editorial-narrative','product-evidence','brand-poster'])
    for(const d of directions) {
      const doc=json(join(a,'design','directions',d.id+'.json'))
      assert.equal(doc.examples.length,2)
      assert.deepEqual(doc.examples.map(e=>e.language).sort(),['en','zh-CN'])
      for(const key of ['suitableFor','composition','typography','rhythm','mobile','assets','misuses']) assert.ok(doc[key].length,d.id+'/'+key)
    }
  } finally { rmSync(a,{recursive:true,force:true});rmSync(b,{recursive:true,force:true}) }
})

test('新原型契约拒绝脚本、外链、越界样式、未知图标变量与交互', () => {
  const meta=json(join(source,'product-story','meta.json'))
  const contract={vars:new Set(['--ts-color-text-primary']),classes:new Set(),icons:new Set(['search']),attrs:new Set()}
  const body='<main data-ts-prototype="product-story" class="tp-original">演示</main>'
  assert.doesNotThrow(()=>validatePrototypeResource(meta,body,':scope{color:var(--ts-color-text-primary)}',contract))
  for(const bad of ['<script>alert(1)</script>','<img src="file:///private.png">','<img onerror="alert(1)">','<a href="javascript:alert(1)">x</a>','<a href="file:///private">x</a>','<form action="/submit"></form>','<svg><foreignObject><iframe></iframe></foreignObject></svg>','<input type="file">','<svg data-icon="unregistered"></svg>','<div data-ts-unregistered></div>','<div class="ts-unregistered"></div>']) assert.throws(()=>validatePrototypeResource(meta,body+bad,':scope{}',contract),bad)
  for(const css of ['body{color:inherit}',':scope + body{color:inherit}',':scope[data-x] + body{color:inherit}',':scope{background:url(file:///secret)}',':scope{color:var(--missing)}','@import "./external.css";']) assert.throws(()=>validatePrototypeResource(meta,body,css,contract),css)
  for (const bad of [
    '<img srcset="//outside.test/image.png 2x">',
    '<picture><source srcset="/relative.png 1x"></picture>',
    '<video poster="//outside.test/poster.png"></video>',
    '<a href="#local" ping="//outside.test/track">tracked</a>',
    '<meta http-equiv="refresh" content="0;url=//outside.test">',
  ]) assert.throws(() => validatePrototypeResource(meta, body + bad, ':scope{}', contract), bad)
})

test('原创结构能力：商品陈列与对比、详情语义和移动原生操作齐全', () => {
  const body=id=>readFileSync(join(source,id,'body.html'),'utf8')
  const showcase=body('product-showcase')
  assert.match(showcase,/id="lineup"/)
  assert.match(showcase,/id="specifications"/)
  assert.ok((showcase.match(/<th scope="row">/g)??[]).length>=4)
  for(const id of ['admin-detail','admin-detail-tabs','admin-detail-sidebar']) {
    assert.match(body(id),/<nav aria-label="面包屑"/)
    assert.match(body(id),/<dl\b/)
    assert.match(body(id),/<dt>/)
    assert.match(body(id),/<dd>/)
  }
  assert.match(body('mobile-content'),/<details id="story-note"/)
  assert.match(body('mobile-content'),/id="mobile-save"[^>]*role="switch"/)
  const create=body('admin-create')
  for(const marker of ['data-ts-config-demo','data-ts-config-region','data-ts-config-zone','data-ts-config-range','data-ts-config-min','data-ts-config-max','data-ts-config-start','data-ts-config-end']) assert.ok(create.includes(marker),marker)
  assert.match(create,/<select id="config-features"[^>]*multiple/)
  assert.match(create,/<input id="config-time"[^>]*type="time"/)
})
