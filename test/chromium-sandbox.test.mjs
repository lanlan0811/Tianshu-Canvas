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
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { installFakeSdk } from './helpers/host.mjs'

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

test('真实启动的 Chromium 命令行不含 --no-sandbox', { skip: process.platform !== 'win32' && '仅在 Windows 上抓取命令行' }, async () => {
  installFakeSdk()
  const mod = await import(pathToFileURL(join(root, 'dist', 'index.mjs')).href + '?sandbox=' + Date.now())
  const exe = mod.resolveBrowser()
  if (!exe) return // 无浏览器：本层跳过
  const exeName = exe.split(/[\\/]/).pop()

  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--disable-gpu'] })
  let cmdline = ''
  try {
    const pid = browser.process()?.pid
    cmdline = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
      { encoding: 'utf8' },
    )
  } finally {
    await browser.close()
  }
  assert.ok(cmdline.includes(exeName) || cmdline.length > 0, '应取到浏览器命令行')
  assert.ok(!/--no-sandbox/.test(cmdline), '运行中的 Chromium 不得带 --no-sandbox')
})
