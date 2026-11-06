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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDesignSystems } from './build-design.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const distWeb = resolve(dist, 'web')

rmSync(dist, { recursive: true, force: true })
mkdirSync(distWeb, { recursive: true })

// (0) 设计系统：design-systems/ -> dist/design/（运行时不读源目录）
await buildDesignSystems({ root, dist })

// (a) Node 侧：src/index.ts -> dist/index.mjs（单文件 ESM bundle）
// 为什么是 .mjs：插件 ZIP 内没有 package.json（官方禁止依赖目录/清单），Node 只能按扩展名
// 判定模块格式；官方手册也推荐 .mjs 明确 ESM。
// 为什么不留 external：官方发行包禁止依赖目录与运行时安装，puppeteer-core 必须内联。
// banner 提供 require：puppeteer-core 的 CJS 依赖（ws 等）在 ESM bundle 里需要它。
await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
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
  // .png 内联为 data: URI：画布 CSP 只允许 img-src 'self' data: blob:，
  // 内联同时省掉静态资源路由（服务端只白名单 canvas.js/css/map）。
  loader: { '.css': 'css', '.png': 'dataurl' },
  logLevel: 'info',
})

// (c) HTML 外壳：把 __FAVICON__ 占位换成内联的图标 data: URI
// 必须归一化换行：Windows checkout（core.autocrlf=true）下源文件是 CRLF，直接写出会让
// dist/ 与 Linux CI 重建的结果逐字节不同，触发「dist 与源码不一致」门禁。
const favicon = readFileSync(resolve(root, 'web/favicon.png')).toString('base64')
const shell = readFileSync(resolve(root, 'web/index.html'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace('__FAVICON__', `data:image/png;base64,${favicon}`)
writeFileSync(resolve(distWeb, 'index.html'), shell)

// 断言关键产物存在
for (const f of ['index.mjs', 'web/index.html', 'web/canvas.js', 'web/canvas.css', 'design/index.json']) {
  if (!existsSync(resolve(dist, f))) {
    console.error(`build: 缺少产物 dist/${f}`)
    process.exit(1)
  }
}
console.log('build: 完成 -> dist/index.mjs, dist/web/{index.html,canvas.js,canvas.css}, dist/design/**')
