import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTestBrowser } from './helpers/browser.mjs'

test('浏览器显式路径优先，不受默认安装位置影响', () => {
  const checked = []
  const customPath = 'D:/Browsers/Edge/msedge.exe'
  const actual = resolveTestBrowser({
    env: { TIANSHU_CANVAS_BROWSER: customPath, CI: 'true' },
    exists: (path) => { checked.push(path); return true },
  })
  assert.equal(actual, customPath)
  assert.deepEqual(checked, [customPath])
})

test('显式浏览器路径错误时不静默回退到其他浏览器', () => {
  const configured = 'D:/missing-browser.exe'
  assert.throws(() => resolveTestBrowser({
    env: { TIANSHU_CANVAS_BROWSER: configured },
    exists: (path) => path !== configured,
  }), /TIANSHU_CANVAS_BROWSER.*无效/)
  for (const value of ['', '   ']) {
    assert.throws(() => resolveTestBrowser({
      env: { TIANSHU_CANVAS_BROWSER: value }, exists: () => true,
    }), /TIANSHU_CANVAS_BROWSER.*无效/)
  }
})

test('兼容 Windows Edge 与 Linux Chromium 默认安装位置', () => {
  for (const installed of [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium',
  ]) {
    assert.equal(resolveTestBrowser({
      env: { CI: 'true' }, exists: (path) => path === installed,
    }), installed)
  }
})

test('CI 与正式验收模式缺少浏览器必须失败', () => {
  for (const env of [{ CI: 'true' }, { TIANSHU_CANVAS_REQUIRE_BROWSER: '1' }]) {
    assert.throws(() => resolveTestBrowser({ env, exists: () => false }), /浏览器 E2E 不允许跳过/)
  }
})

test('普通本机无浏览器时返回 undefined，由调用方明确跳过', () => {
  for (const env of [{}, { CI: 'false', TIANSHU_CANVAS_REQUIRE_BROWSER: '0' }]) {
    assert.equal(resolveTestBrowser({ env, exists: () => false }), undefined)
  }
})
