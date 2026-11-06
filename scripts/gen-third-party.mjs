/**
 * 生成 `THIRD-PARTY-NOTICES.md`：随发行 ZIP 分发的第三方组件许可与版权声明。
 *
 * 为什么是「生成」而不是手写清单：发行包里的组件完全由 esbuild 打包决定，
 * 手写清单会随依赖升级悄悄过期。本脚本用 esbuild 的 metafile 反查**真正被内联进
 * `dist/index.mjs` 与 `dist/web/canvas.js` 的** node_modules 包，逐个抽取其
 * package.json 的许可字段与 LICENSE 全文，因此清单与产物永远一致。
 *
 * 产出必须提交进仓库（与 dist/ 同样处理），CI 用 `git diff --exit-code` 校验
 * 它与源码/锁文件一致，避免平台收到的发行包里许可声明过期。
 *
 * 用法：node scripts/gen-third-party.mjs [--check]
 *   --check  只校验产物是否最新，不写文件（供 CI 使用）
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = join(root, 'THIRD-PARTY-NOTICES.md')
const checkOnly = process.argv.includes('--check')

/** 与 scripts/build.mjs 保持一致的打包参数（唯一区别是不落盘、只取 metafile）。 */
async function bundledPackages() {
  const common = { absWorkingDir: root, bundle: true, write: false, metafile: true, logLevel: 'silent' }
  const node = await build({
    ...common,
    entryPoints: ['src/index.ts'],
    platform: 'node',
    format: 'esm',
    target: 'node24',
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  })
  const web = await build({
    ...common,
    entryPoints: ['web/src/main.tsx'],
    outfile: 'dist/web/_notices-probe.js',
    platform: 'browser',
    format: 'esm',
    target: ['es2020'],
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'css', '.png': 'dataurl' },
  })

  const collect = (metafile) => {
    const set = new Set()
    for (const input of Object.keys(metafile.inputs)) {
      const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)
      if (m) set.add(m[1])
    }
    return set
  }
  return { node: collect(node.metafile), web: collect(web.metafile) }
}

const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:\.(?:md|txt|markdown))?$/i

/**
 * 少数包（如 chromium-bidi、emoji-regex）不在 tarball 里带 LICENSE 文件，
 * 但平台要求「完整许可文本」。这里按 SPDX 标识补上该许可的规范全文，
 * 版权行沿用包内 package.json / 上游声明的归属。
 */
const SPDX_TEMPLATES = {
  MIT: (holder) =>
    `MIT License\n\n${holder}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.`,
  ISC: (holder) =>
    `ISC License\n\n${holder}\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH\nREGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY\nAND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,\nINDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM\nLOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR\nOTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR\nPERFORMANCE OF THIS SOFTWARE.`,
  'BSD-3-Clause': (holder) =>
    `BSD 3-Clause License\n\n${holder}\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice, this\n   list of conditions and the following disclaimer.\n\n2. Redistributions in binary form must reproduce the above copyright notice,\n   this list of conditions and the following disclaimer in the documentation\n   and/or other materials provided with the distribution.\n\n3. Neither the name of the copyright holder nor the names of its contributors\n   may be used to endorse or promote products derived from this software\n   without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"\nAND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE\nIMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE\nDISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE\nFOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL\nDAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR\nSERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER\nCAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,\nOR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING OUT OF OR IN CONNECTION\nWITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
}

function readPackage(meta) {
  const pkg = JSON.parse(readFileSync(join(meta, 'package.json'), 'utf8'))
  const files = existsSync(meta) ? readdirSync(meta) : []
  const licenseFile = files.find((f) => LICENSE_FILE.test(f))
  let licenseText = ''
  if (licenseFile) licenseText = readFileSync(join(meta, licenseFile), 'utf8').replace(/\r\n/g, '\n').trim()
  const spdx = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN')
  const holder = licenseHolder(pkg, licenseText)
  // 包内没有许可文件时，按 SPDX 补规范全文（版权行取自 package.json）。
  if (!licenseText && SPDX_TEMPLATES[spdx]) {
    licenseText = SPDX_TEMPLATES[spdx](holder || `Copyright (c) ${pkg.name} contributors`)
  }
  return {
    name: pkg.name,
    version: pkg.version,
    license: spdx,
    holder,
    repository: typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? ''),
    licenseText,
  }
}

/**
 * 版权归属：优先取 LICENSE 里的 Copyright 行。
 * 跳过 Apache-2.0 附录里的占位行（`Copyright [yyyy] [name of copyright owner]`），
 * 否则会把模板占位当成真实版权人。
 */
function licenseHolder(pkg, text) {
  // 只接受「以 Copyright 开头」的行，避免把 Apache 正文里的
  // `"Licensor" shall mean the copyright owner…` 这类句子当成版权人。
  const line = text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:\/\/|#|\*)\s*/, '').trim())
    .find((l) => /^copyright\s*(?:\(c\)|©)?\s*\d{4}/i.test(l) || /^copyright\s*(?:\(c\)|©)/i.test(l))
  if (line) return line
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name
  return author ? `Copyright (c) ${author}` : ''
}

function section(pkgs) {
  return pkgs
    .map((p) => {
      const lines = [`### ${p.name}@${p.version}`, '']
      lines.push(`- 许可：${p.license}`)
      if (p.holder) lines.push(`- 版权：${p.holder}`)
      if (p.repository) lines.push(`- 仓库：${p.repository.replace(/^git\+/, '').replace(/\.git$/, '')}`)
      lines.push('')
      if (p.licenseText) {
        lines.push('```')
        lines.push(p.licenseText)
        lines.push('```')
      } else {
        lines.push('> 该包未随附许可文本文件，请以包内 package.json 的许可字段与实际发布产物为准。')
      }
      lines.push('')
      return lines.join('\n')
    })
    .join('\n')
}

async function generate() {
  const { node, web } = await bundledPackages()
  const load = (names) =>
    [...names]
      .map((n) => readPackage(join(root, 'node_modules', ...n.split('/'))))
      .filter((p) => existsSync(join(root, 'node_modules', ...p.name.split('/'))))
      .sort((a, b) => a.name.localeCompare(b.name))

  const nodePkgs = load(node)
  const webPkgs = load(web)
  const all = [...new Map([...nodePkgs, ...webPkgs].map((p) => [p.name, p])).values()].sort((a, b) => a.name.localeCompare(b.name))

  const header = [
    '# 第三方组件许可与版权声明',
    '',
    '本文件由 `scripts/gen-third-party.mjs` 依据实际打包产物生成，随发行 ZIP 一并分发。',
    '插件自身的代码以仓库根目录的 Apache-2.0（见 `LICENSE`）授权；下列第三方组件仍适用其各自许可。',
    '',
    `- 内联进 \`dist/index.mjs\`（Node 侧）的组件：${nodePkgs.length} 个`,
    `- 内联进 \`dist/web/canvas.js\`（画布前端，含 React Flow）的组件：${webPkgs.length} 个`,
    `- 去重后共 ${all.length} 个组件。`,
    '',
    '## 组件清单',
    '',
    '| 组件 | 版本 | 许可 |',
    '| --- | --- | --- |',
    ...all.map((p) => `| ${p.name} | ${p.version} | ${p.license} |`),
    '',
    '## 各组件许可全文',
    '',
  ].join('\n')

  const body = [
    '<!-- Node 侧（dist/index.mjs） -->',
    '',
    '## Node 侧内联组件（`dist/index.mjs`）',
    '',
    section(nodePkgs),
    '<!-- 画布前端（dist/web/canvas.js） -->',
    '',
    '## 画布前端内联组件（`dist/web/canvas.js`）',
    '',
    section(webPkgs),
  ].join('\n')

  const text = header + body
  return { text, count: all.length }
}

const { text, count } = await generate()
if (checkOnly) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : ''
  if (current !== text) {
    console.error('THIRD-PARTY-NOTICES.md 与当前依赖不一致。请运行 `npm run notices` 并提交产物。')
    process.exit(1)
  }
  console.log(`OK 第三方许可声明已是最新（${count} 个组件）`)
} else {
  writeFileSync(OUTPUT, text)
  const digest = createHash('sha256').update(text).digest('hex')
  console.log(`THIRD-PARTY-NOTICES.md 已生成：${count} 个组件，sha256=${digest.slice(0, 16)}…`)
}
