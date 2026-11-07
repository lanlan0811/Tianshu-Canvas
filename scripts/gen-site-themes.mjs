/**
 * 从插件内置的 design-systems/styles/<id>/tokens.json 生成官网换肤数据与样式：
 *   - official-website/src/data/siteThemes.ts   主题数组（供组件使用）
 *   - official-website/src/styles/site-themes.css  <html data-site-theme> 下的变量覆盖
 *
 * 为什么生成而不是手写：官网的 11 套主题必须与画布内的设计系统逐值一致，
 * token 一改就该同步；手抄必然会漂。
 *
 * 用法：node scripts/gen-site-themes.mjs [--check]
 *   --check 只校验产物是否与当前 token 一致（CI 用），不写盘。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stylesDir = join(root, 'design-systems', 'styles')
const siteDir = join(root, 'official-website', 'src')

/** 顺序与 design-systems/index.json 一致。 */
const IDS = [
  'apple',
  'google',
  'claude',
  'tianshu-original',
  'barbie',
  'nerv',
  'minimalist',
  'tianshu-inkstone',
  'tianshu-vapor',
  'tianshu-saffron',
  'tianshu-aurora'
]

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

/** 把 "组.步" 解析成 hex；已是字面量则原样返回。 */
function resolver(tokens) {
  const P = tokens.color.primitives
  return (v) => {
    if (/^#/.test(v)) return v
    const [g, s] = v.split('.')
    const out = P[g]?.[s]
    if (!out) throw new Error(`无法解析颜色：${v}`)
    return out
  }
}

function collect() {
  return IDS.map((id) => {
    const t = readJson(join(stylesDir, id, 'tokens.json'))
    const meta = readJson(join(stylesDir, id, 'meta.json'))
    const rv = resolver(t)
    const S = t.color.semantic
    const N = t.color.primitives.neutral
    const B = t.color.primitives.brand
    return {
      id,
      label: meta.name,
      bg: rv(S.bg.canvas),
      surface: rv(S.bg.surface),
      sunken: rv(S.bg.sunken),
      inverse: rv(S.bg.inverse),
      fg: rv(S.text.primary),
      fg2: rv(S.text.secondary),
      muted: rv(S.text.muted),
      inv: rv(S.text.inverse),
      bd: rv(S.border.default),
      bdStrong: rv(S.border.strong),
      primary: rv(S.action.primary),
      primaryHover: rv(S.action.primaryHover),
      primaryFg: rv(S.action.primaryText),
      /* 反馈色：Design CI 那类「问题 / 通过」状态要跟着主题走，
         不能写死红黄绿，否则换到深色主题会刺眼或看不清。 */
      danger: rv(S.status.danger),
      dangerBg: rv(S.status.dangerBg),
      warning: rv(S.status.warning),
      warningBg: rv(S.status.warningBg),
      success: rv(S.status.success),
      successBg: rv(S.status.successBg),
      info: rv(S.status.info),
      infoBg: rv(S.status.infoBg),
      n: [N[0], N[50], N[100], N[200], N[300], N[500], N[700], N[900]],
      b: [B[100], B[300], B[500], B[600], B[700]],
      radius: t.radius.md,
      radiusSm: t.radius.sm,
      radiusLg: t.radius.lg,
      shadowSm: t.shadow.sm,
      shadowMd: t.shadow.md,
      sans: t.font.families.sans,
      display: t.font.families.display,
      mono: t.font.families.mono
    }
  })
}

const q = (s) => JSON.stringify(s)
const arr = (a) => '[' + a.map(q).join(', ') + ']'

function renderTs(themes) {
  const ids = themes.map((t) => '  | ' + q(t.id)).join('\n')
  const items = themes
    .map(
      (t) => `  {
    id: ${q(t.id)},
    label: ${q(t.label)},
    bg: ${q(t.bg)},
    surface: ${q(t.surface)},
    sunken: ${q(t.sunken)},
    fg: ${q(t.fg)},
    fg2: ${q(t.fg2)},
    muted: ${q(t.muted)},
    inverse: ${q(t.inv)},
    border: ${q(t.bd)},
    borderStrong: ${q(t.bdStrong)},
    primary: ${q(t.primary)},
    primaryHover: ${q(t.primaryHover)},
    primaryFg: ${q(t.primaryFg)},
    danger: ${q(t.danger)},
    dangerBg: ${q(t.dangerBg)},
    warning: ${q(t.warning)},
    warningBg: ${q(t.warningBg)},
    success: ${q(t.success)},
    successBg: ${q(t.successBg)},
    info: ${q(t.info)},
    infoBg: ${q(t.infoBg)},
    n: ${arr(t.n)},
    b: ${arr(t.b)},
    radius: ${t.radius},
    radiusSm: ${t.radiusSm},
    radiusLg: ${t.radiusLg},
    shadowSm: ${q(t.shadowSm)},
    shadowMd: ${q(t.shadowMd)},
    sans: ${q(t.sans)},
    display: ${q(t.display)},
    mono: ${q(t.mono)}
  }`
    )
    .join(',\n')

  return `/**
 * 站点可选设计风格。
 *
 * 本文件由 scripts/gen-site-themes.mjs 从 design-systems/styles/<id>/tokens.json
 * 生成，**请勿手改**：改 token 后重新运行该脚本。
 */

export type SiteThemeId =
${ids}

export type SiteTheme = {
  id: SiteThemeId
  label: string
  /** 语义色 */
  bg: string
  surface: string
  sunken: string
  fg: string
  fg2: string
  muted: string
  inverse: string
  border: string
  borderStrong: string
  primary: string
  primaryHover: string
  primaryFg: string
  /** 反馈色（Design CI 等状态用） */
  danger: string
  dangerBg: string
  warning: string
  warningBg: string
  success: string
  successBg: string
  info: string
  infoBg: string
  /** 原色阶 neutral 0/50/100/200/300/500/700/900 */
  n: [string, string, string, string, string, string, string, string]
  /** 原色阶 brand 100/300/500/600/700 */
  b: [string, string, string, string, string]
  /** 圆角 / 阴影 / 字体 */
  radius: number
  radiusSm: number
  radiusLg: number
  shadowSm: string
  shadowMd: string
  sans: string
  display: string
  mono: string
}

export const siteThemes: SiteTheme[] = [
${items}
]

/** 默认主题（写在 index.html 的 data-site-theme 上，避免 JS 接管前闪配色）。 */
export const defaultSiteThemeId: SiteThemeId = 'minimalist'
`
}

function renderCss(themes) {
  const blocks = themes
    .map((t) => {
      const n = t.n
      const b = t.b
      return `/* ${t.label}（${t.id}） */
html[data-site-theme='${t.id}'] {
  /* 语义色 */
  --background: ${t.bg};
  --card: ${t.surface};
  --popover: ${t.surface};
  --muted: ${t.sunken};
  --foreground: ${t.fg};
  --card-foreground: ${t.fg};
  --popover-foreground: ${t.fg};
  --muted-foreground: ${t.muted};
  --accent-foreground: ${t.fg};
  --secondary-foreground: ${t.fg};
  --primary: ${t.primary};
  --primary-foreground: ${t.primaryFg};
  --secondary: ${t.sunken};
  --accent: ${t.sunken};
  --input: ${t.bd};
  --ring: ${t.primary};
  --border: ${t.bd};
  --border-strong: ${t.bdStrong};
  --success: ${t.success};
  --success-subtle: ${t.successBg};
  --success-text: ${t.success};
  --destructive: ${t.danger};
  --destructive-subtle: ${t.dangerBg};
  --destructive-text: ${t.danger};
  --warning: ${t.warning};
  --warning-subtle: ${t.warningBg};
  --warning-text: ${t.warning};
  --info: ${t.info};
  --info-subtle: ${t.infoBg};
  --info-text: ${t.info};
  --brand-subtle: ${b[0]};
  --brand-border: ${b[1]};

  /* 原色阶：站点直接引用处（按钮 hover / 色板 / FAQ hover / 图标） */
  --brand-50: ${n[1]};
  --brand-100: ${b[0]};
  --brand-200: ${n[3]};
  --brand-300: ${b[1]};
  --brand-400: ${t.muted};
  --brand-500: ${b[2]};
  --brand-600: ${b[3]};
  --brand-700: ${t.fg2};
  --brand-800: ${t.primaryHover};
  --brand-900: ${t.fg};
  --icon-400: ${t.muted};
  --icon-500: ${t.muted};
  --icon-600: ${t.fg2};

  /* 圆角 / 阴影 / 字体 */
  --radius: ${t.radius}px;
  --radius-sm: ${t.radiusSm}px;
  --radius-lg: ${t.radiusLg}px;
  --shadow-2xs: ${t.shadowSm};
  --shadow-xs: ${t.shadowSm};
  --shadow-sm: ${t.shadowSm};
  --shadow-md: ${t.shadowMd};
  --font-sans: ${t.sans};
  --font-serif: ${t.display};
  --font-mono: ${t.mono};
}`
    })
    .join('\n\n')

  return `/* ═══════════════════════════════════════════════════════════════
   站点换肤：11 套内置设计风格

   由 scripts/gen-site-themes.mjs 从 design-systems/styles/<id>/tokens.json 生成，
   与画布内切换风格所见一致。**请勿手改**：改 token 后重新运行脚本。

   切换方式：<html data-site-theme="<id>">。仅覆盖颜色 / 圆角 / 阴影 / 字体，
   不动版式（间距、字号、栅格）。
   ═══════════════════════════════════════════════════════════════ */

${blocks}
`
}

const check = process.argv.includes('--check')

// official-website/ 被 .gitignore 排除，新克隆的仓库里没有它。
// 此时给出明确说明，而不是让读取产物时报一个费解的 ENOENT。
if (!existsSync(join(root, 'official-website'))) {
  console.error('未找到 official-website/（该目录被 .gitignore 排除，不随仓库分发）。')
  console.error('本脚本只用于本地生成官网的换肤产物，无需在 CI 中运行。')
  process.exit(check ? 0 : 1)
}

const themes = collect()
const outputs = [
  [join(siteDir, 'data', 'siteThemes.ts'), renderTs(themes)],
  [join(siteDir, 'styles', 'site-themes.css'), renderCss(themes)]
]

let stale = 0
for (const [path, content] of outputs) {
  if (check) {
    let current = ''
    try {
      current = readFileSync(path, 'utf8')
    } catch {
      current = ''
    }
    if (current !== content) {
      console.error(`✗ 产物不是最新的：${path}`)
      stale++
    } else {
      console.log(`✓ ${path}`)
    }
  } else {
    writeFileSync(path, content)
    console.log(`写入 ${path}`)
  }
}

if (check && stale > 0) {
  console.error('请运行 node scripts/gen-site-themes.mjs 重新生成。')
  process.exit(1)
}
