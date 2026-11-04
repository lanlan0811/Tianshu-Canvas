/**
 * 构建脚本：esbuild 打包 Node 侧与 Web 侧，产物写入 dist/（提交进仓库）。
 *
 * 为什么产物要提交：天枢安装插件时只跑 `npm install --ignore-scripts --omit=dev`，
 * **永不执行构建脚本**，因此 dist/ 必须随仓库分发。
 *
 * 为什么 Node 侧是单文件：src/server.ts 是模块级单例；若拆成多文件，
 * 入口会内联自己的副本，测试 import 时会看到第二个独立单例。
 */
import { build } from 'esbuild'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const distWeb = resolve(dist, 'web')

rmSync(dist, { recursive: true, force: true })
mkdirSync(distWeb, { recursive: true })

// (a) Node 侧：src/index.ts -> dist/index.js（单文件 ESM bundle）
// puppeteer-core 保持 external：运行时从 node_modules 动态 import（它体积大且非纯 JS 依赖树）。
await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['puppeteer-core'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
})

// (b) Web 侧：web/src/main.tsx -> dist/web/canvas.js（+ 自动产出 canvas.css）
await build({
  absWorkingDir: root,
  entryPoints: ['web/src/main.tsx'],
  outfile: 'dist/web/canvas.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['es2020'],
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'css' },
  logLevel: 'info',
})

// (c) 复制 HTML 外壳
copyFileSync(resolve(root, 'web/index.html'), resolve(distWeb, 'index.html'))

// 断言关键产物存在
for (const f of ['index.js', 'web/index.html', 'web/canvas.js', 'web/canvas.css']) {
  if (!existsSync(resolve(dist, f))) {
    console.error(`build: 缺少产物 dist/${f}`)
    process.exit(1)
  }
}
console.log('build: 完成 -> dist/index.js, dist/web/{index.html,canvas.js,canvas.css}')
