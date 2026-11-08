/**
 * 回归（技术反馈 03）：截图与视觉回归必须保留 Chromium 进程沙箱。
 *
 * 旧实现把 `--no-sandbox` 硬编码在启动参数里，而这两条路径会渲染可能含脚本的原型，
 * 关掉沙箱等于让这些脚本拥有当前用户的全部权限。
 *
 * 断言两层：
 *   1. 静态：启动参数清单里没有 `--no-sandbox`（除非显式设了放开环境变量）；
 *   2. 动态：真正启动浏览器并读取其命令行，确认沙箱参数未被注入。
 * 无可用浏览器时跳过第 2 层（不阻塞 CI），第 1 层始终执行。
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { installFakeSdk, loadPlugin, rawFetch } from './helpers/host.mjs'

const root = resolve(import.meta.dirname, '..')

test('启动参数默认不含 --no-sandbox（静态）', () => {
  const source = readFileSync(join(root, 'src', 'export.ts'), 'utf8')
  const launchArgsBlock = source.slice(source.indexOf('const LAUNCH_ARGS'), source.indexOf(']', source.indexOf('const LAUNCH_ARGS')))
  assert.ok(!/--no-sandbox/.test(launchArgsBlock), 'LAUNCH_ARGS 不得包含 --no-sandbox')
  // 只允许在显式放开的分支里出现。
  assert.match(source, /TIANSHU_CANVAS_ALLOW_NO_SANDBOX/, '应提供显式放开开关')
})

test('沙箱不可用时明确报错而非静默降级（源码契约）', () => {
  const source = readFileSync(join(root, 'src', 'export.ts'), 'utf8')
  assert.match(source, /SandboxUnavailableError/, '应有专门的沙箱失败错误类型')
  assert.match(source, /已停止截图与视觉回归/, '错误信息应说明已停止截图/视觉回归')
})

test('原包截图与视觉审计启动的 Chromium 保留沙箱', { skip: process.platform !== 'win32' && '仅在 Windows 上抓取命令行', timeout: 180000 }, async (t) => {
  installFakeSdk()
  const mod = await import(pathToFileURL(join(root, 'dist', 'index.mjs')).href + '?sandbox=' + Date.now())
  const exe = mod.resolveBrowser()
  if (!exe) {
    if (process.env.TIANSHU_CANVAS_REQUIRE_BROWSER === '1') assert.fail('正式验收必须提供可用浏览器')
    return t.skip('未找到浏览器：动态沙箱检查未完成')
  }
  assert.notEqual(process.env.TIANSHU_CANVAS_ALLOW_NO_SANDBOX, '1', '验收必须保留沙箱')
  const cwd = mkdtempSync(join(tmpdir(), 'tsc-sandbox-test-'))
  const { api, tools } = await loadPlugin(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  // 只观察当前 Node 进程直接启动、使用插件临时 profile 的浏览器。
  async function observe(operation) {
    const script = `$deadline=(Get-Date).AddSeconds(80); do { $p=Get-CimInstance Win32_Process -Filter 'ParentProcessId=${process.pid}' | Where-Object { $_.CommandLine -match '--user-data-dir=.*tsc-png-' } | Select-Object -First 1; if ($p) { Write-Output $p.CommandLine; exit 0 }; Start-Sleep -Milliseconds 200 } while ((Get-Date) -lt $deadline); exit 2`
    let child
    const observed = new Promise((resolve, reject) => {
      child = execFile('powershell', ['-NoProfile', '-Command', script], { timeout: 90000 }, (err, stdout) => err ? reject(err) : resolve(stdout))
    })
    // 附加拒绝处理，避免操作失败时观察进程的异常变成未处理拒绝。
    observed.catch(() => {})
    try {
      const result = await operation()
      const cmdline = await observed
      assert.match(cmdline, /--user-data-dir=.*tsc-png-/)
      assert.doesNotMatch(cmdline, /--no-sandbox/i)
      return result
    } finally {
      if (child && child.exitCode === null) child.kill()
    }
  }
  try {
    const added = await tools.canvas_upsert_page.execute({ cwd, input: { id: 'sandbox', title: 'sandbox', html: '<h1>synthetic</h1>' } })
    assert.equal(added.isError, undefined)
    const opened = await tools.canvas_open.execute({ cwd, input: { port: 0 } })
    const url = new URL(opened.content.match(/http:\/\/127\.0\.0\.1:\d+\/w\/[0-9a-f]{32}\/\?ws=[0-9a-f]{32}#[0-9a-f]{64}/)[0])
    const png = await observe(async () => {
      const res = await rawFetch(`${url.origin}/api/export`, { method: 'POST', headers: { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json', 'X-Tianshu-Canvas': '1' }, body: JSON.stringify({ ws: url.searchParams.get('ws'), kind: 'png' }) })
      assert.equal(res.status, 200)
      const result = await res.json()
      assert.ok(result.files?.some((f) => f.name.endsWith('.png')), result.pngError)
      return result
    })
    assert.ok(png.files.length)
    const visual = await observe(() => tools.canvas_audit.execute({ cwd, input: { action: 'baseline' } }))
    assert.equal(visual.isError, undefined, visual.content)
  } finally {
    await api.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
})
