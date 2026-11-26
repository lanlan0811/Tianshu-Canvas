/**
 * DESIGN.md 投影：把设计系统导出成 Google design.md 规范的文件。
 *
 * 结构（判据来自 impeccable skill/reference/document.md）：
 *  - YAML frontmatter 是机器层，正文是语境层，**token 优先于散文**；
 *  - frontmatter 只允许五组：colors / typography / rounded / spacing / components；
 *  - 组件子 token 只允许 8 个属性；引用写成 {path.to.token}；
 *  - 键名用项目语义名，不改 Material 默认名；
 *  - 八节固定英文标题，缺数据的整节省略，**不编造规则填满**。
 *
 * 零依赖：YAML 由本文件的序列化函数手写，只覆盖本投影需要的标量与嵌套映射。
 */
import { join } from 'node:path'
import type { ComponentContractEntry } from './design/components.js'

/** 组件子 token 允许的 8 个属性（Stitch schema 的硬约束）。 */
const COMPONENT_PROPS = ['backgroundColor', 'textColor', 'typography', 'rounded', 'padding', 'size', 'height', 'width'] as const
export type ComponentProp = typeof COMPONENT_PROPS[number]

/** 八节固定顺序与英文标题（一个词都不能改，工具按标题解析）。 */
const SECTIONS = ['Overview', 'Colors', 'Typography', 'Layout', 'Elevation & Depth', 'Shapes', 'Components', "Do's and Don'ts"] as const

export interface DesignDocInput {
  id: string
  name: string
  /** 自定义风格的 tokens.json 原文。 */
  tokens: Record<string, unknown>
  /** meta.json（name/tagline/description）。 */
  meta: Record<string, unknown>
  /** 组件契约（来自 dist/design/components/contract.json）。 */
  components: ComponentContractEntry[]
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

const kebab = (value: string): string => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase()
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** 把嵌套对象拍平成点路径 → 值（只处理对象与标量）。 */
function flatten(value: unknown, prefix = ''): Array<[string, string | number]> {
  if (!isRecord(value)) return []
  const out: Array<[string, string | number]> = []
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isRecord(item)) out.push(...flatten(item, path))
    else if (typeof item === 'string' || typeof item === 'number') out.push([path, item])
  }
  return out
}

/** YAML 标量：字符串一律双引号转义，数字原样。 */
function yamlScalar(value: string | number): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** 生成两空格缩进的 YAML 映射（只支持一层嵌套，够本投影用）。 */
function yamlBlock(entries: Array<[string, string | number]>): string {
  const lines: string[] = []
  let currentGroup = ''
  for (const [path, value] of entries) {
    const [head, ...rest] = path.split('.')
    if (!head) continue
    if (rest.length === 0) {
      lines.push(`  ${head}: ${yamlScalar(value)}`)
      continue
    }
    if (head !== currentGroup) {
      lines.push(`  ${head}:`)
      currentGroup = head
    }
    let indent = '    '
    for (let i = 1; i < rest.length - 1; i++) {
      lines.push(`${indent}${rest[i]}:`)
      indent += '  '
    }
    lines.push(`${indent}${rest[rest.length - 1] ?? head}: ${yamlScalar(value)}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// frontmatter
// ---------------------------------------------------------------------------

interface Frontmatter {
  colors: Record<string, string>
  typography: Record<string, Record<string, string | number>>
  rounded: Record<string, number>
  spacing: Record<string, number>
  components: Record<string, Partial<Record<ComponentProp, string>>>
}

/** 语义色引用：`{colors.bg-canvas}`。原语不参与引用（原语不可互相引用）。 */
const colorRef = (path: string): string => `{colors.${kebab(path.replace(/^color\.semantic\./, '').split('.').join('-'))}}`

/**
 * 组件子 token → 8 属性。
 * 引用必须指向 frontmatter 里真实存在的路径（colors/typography/rounded/spacing），
 * 否则 Stitch 的解析器会把这些引用当成坏路径。无法映射的（shadow / motion / border）直接丢弃：
 * 宁可少写，也不要写进 schema 不接受的键。
 */
export function mapComponentTokens(tokens: string[], rawTokens: Record<string, unknown> = {}): Partial<Record<ComponentProp, string>> {
  const out: Partial<Record<ComponentProp, string>> = {}
  const sizeAt = (path: string): number | null => {
    const parts = path.split('.')
    let node: unknown = rawTokens
    for (const part of parts) {
      if (!isRecord(node)) return null
      node = node[part]
    }
    return typeof node === 'number' ? node : null
  }
  for (const token of tokens) {
    if (token.startsWith('color.')) {
      const isText = /text|foreground|label/i.test(token)
      const prop: ComponentProp = isText ? 'textColor' : 'backgroundColor'
      /* color.action.primary → {colors.action-primary}：与 frontmatter 的语义键同名。 */
      const name = kebab(token.replace(/^color\.semantic\./, '').replace(/^color\./, '').split('.').join('-'))
      if (!out[prop]) out[prop] = `{colors.${name}}`
    } else if (token.startsWith('font.families.')) {
      if (!out.typography) out.typography = `{typography.${kebab(token.slice('font.families.'.length))}.fontFamily}`
    } else if (token.startsWith('radius.')) {
      if (!out.rounded) out.rounded = `{rounded.${kebab(token.slice('radius.'.length))}}`
    } else if (token.startsWith('space.')) {
      if (!out.padding) out.padding = `{spacing.s${token.slice('space.'.length)}}`
    } else if (token.startsWith('size.')) {
      /* size 不在 frontmatter 的五组里：解析成实际的 px 字面量，而不是编造引用。 */
      const px = sizeAt(token)
      if (px !== null) {
        if (!out.size) out.size = `${px}px`
        if (!out.height) out.height = `${px}px`
      }
    }
  }
  return out
}

function buildFrontmatter(input: DesignDocInput): Frontmatter {
  const tokens = input.tokens
  const semantic = isRecord(tokens.color) && isRecord((tokens.color as Record<string, unknown>).semantic)
    ? ((tokens.color as Record<string, unknown>).semantic as Record<string, unknown>)
    : {}

  const colors: Record<string, string> = {}
  for (const [group, entry] of Object.entries(semantic)) {
    if (isRecord(entry)) {
      for (const name of Object.keys(entry)) colors[`${kebab(group)}-${kebab(name)}`] = colorRef(`${group}.${name}`)
    } else if (typeof entry === 'string') {
      colors[kebab(group)] = colorRef(group)
    }
  }

  const typography: Record<string, Record<string, string | number>> = {}
  if (isRecord(tokens.font)) {
    const font = tokens.font as Record<string, unknown>
    if (isRecord(font.families)) {
      for (const [name, value] of Object.entries(font.families)) {
        if (typeof value !== 'string') continue
        /* 写真实字族值：如果这里也写成 {typography.x.fontFamily}，引用会指向自己。 */
        typography[kebab(name)] = { fontFamily: value }
      }
    }
    /* 字阶单独放在 overview 的正文里；frontmatter 的 typography 只承载字族，
       避免把 9 档字号塞进 Stitch 的 typography 组（那份 schema 期望的是样式条目）。 */
  }

  const rounded: Record<string, number> = {}
  if (isRecord(tokens.radius)) {
    for (const [name, value] of Object.entries(tokens.radius)) if (typeof value === 'number') rounded[kebab(name)] = value
  }

  const spacing: Record<string, number> = {}
  if (isRecord(tokens.space)) {
    for (const [name, value] of Object.entries(tokens.space)) if (typeof value === 'number') spacing[`s${name}`] = value
  }

  const components: Frontmatter['components'] = {}
  for (const component of input.components) {
    const mapped = mapComponentTokens(component.tokens ?? [], input.tokens)
    if (Object.keys(mapped).length) components[kebab(component.id)] = mapped
  }

  return { colors, typography, rounded, spacing, components }
}

function renderFrontmatter(fm: Frontmatter, input: DesignDocInput): string {
  const lines = ['---', `name: ${yamlScalar(input.name)}`, `description: ${yamlScalar(String(input.meta.description ?? input.meta.tagline ?? input.name))}`]
  const group = (key: string, entries: Array<[string, string | number]>): void => {
    if (!entries.length) return
    lines.push(`${key}:`)
    lines.push(yamlBlock(entries))
  }
  group('colors', Object.entries(fm.colors))
  group('typography', Object.entries(fm.typography).map(([name, props]) => [name, props.fontFamily ?? ''] as [string, string]))
  group('rounded', Object.entries(fm.rounded))
  group('spacing', Object.entries(fm.spacing))
  const componentEntries = Object.entries(fm.components) as Array<[string, Partial<Record<ComponentProp, string>>]>
  if (componentEntries.length) {
    lines.push('components:')
    for (const [name, props] of componentEntries) {
      lines.push(`  ${name}:`)
      for (const key of COMPONENT_PROPS) {
        if (props[key]) lines.push(`    ${key}: ${yamlScalar(props[key]!)}`)
      }
    }
  }
  lines.push('---')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 正文八节
// ---------------------------------------------------------------------------

/** 命名规则：`**The [Name] Rule.** 一句教义`。每节最多 3 条。 */
function namedRules(rules: Array<[string, string]>): string[] {
  return rules.slice(0, 3).map(([name, doctrine]) => `**The ${name} Rule.** ${doctrine}`)
}

function colorsSection(input: DesignDocInput, fm: Frontmatter): string[] {
  const semantic = isRecord(input.tokens.color) && isRecord((input.tokens.color as Record<string, unknown>).semantic)
    ? ((input.tokens.color as Record<string, unknown>).semantic as Record<string, unknown>)
    : {}
  const primitives = isRecord(input.tokens.color) && isRecord((input.tokens.color as Record<string, unknown>).primitives)
    ? ((input.tokens.color as Record<string, unknown>).primitives as Record<string, unknown>)
    : {}
  const primitiveRows = flatten(primitives).slice(0, 24)
  if (!Object.keys(fm.colors).length && !primitiveRows.length) return []
  const lines = ['## Colors', '', '语义色是规范层，原色只作为它们的来源。页面只引用语义色。', '']
  lines.push('| 语义名 | 引用 |', '|---|---|')
  for (const [name, ref] of Object.entries(fm.colors)) lines.push(`| \`${name}\` | \`${ref}\` |`)
  if (primitiveRows.length) {
    lines.push('', '原色阶（仅用于生成语义色，页面不要直接引用）：', '', '| 原色 | 值 |', '|---|---|')
    for (const [path, value] of primitiveRows) lines.push(`| \`${kebab(path.replace(/\./g, '-'))}\` | \`${value}\` |`)
  }
  lines.push('', ...namedRules([
    ['One Accent', '强调色只出现在主行动与当前项上；它的稀缺性就是它的作用。'],
    ['No Raw Hex', '页面只引用语义色；直接写十六进制会把调色板的修改挡在门外。'],
  ]))
  return lines
}

function typographySection(input: DesignDocInput): string[] {
  if (!isRecord(input.tokens.font)) return []
  const font = input.tokens.font as Record<string, unknown>
  const sizes = isRecord(font.sizes) ? Object.entries(font.sizes).filter(([, v]) => typeof v === 'number') : []
  const families = isRecord(font.families) ? Object.entries(font.families).filter(([, v]) => typeof v === 'string') : []
  if (!sizes.length && !families.length) return []
  const lines = ['## Typography', '']
  if (families.length) {
    lines.push('字体声部：', '')
    for (const [name, value] of families) lines.push(`- \`${kebab(name)}\`：${String(value).split(',')[0]!.replace(/['"]/g, '')}`)
    lines.push('')
  }
  if (sizes.length) {
    lines.push('字号阶梯（px）：', '', '| 档 | 字号 |', '|---|---|')
    for (const [name, value] of sizes) lines.push(`| \`${kebab(name)}\` | ${value} |`)
    lines.push('')
  }
  lines.push(...namedRules([
    ['Reading First', '正文优先可读：字号、行高与行宽先定，展示字最后加。'],
    ['Two Voices', '最多两个声部（正文 + 展示）；第三个字族只有在它承担独立语义时才出现。'],
  ]))
  return lines
}

function layoutSection(input: DesignDocInput): string[] {
  const space = isRecord(input.tokens.space) ? Object.entries(input.tokens.space).filter(([, v]) => typeof v === 'number') : []
  const sizes = isRecord(input.tokens.size) ? flatten(input.tokens.size).slice(0, 12) : []
  if (!space.length && !sizes.length) return []
  const lines = ['## Layout', '']
  if (space.length) {
    lines.push('间距刻度（px）：', '', '| 档 | 值 |', '|---|---|')
    for (const [name, value] of space) lines.push(`| \`s${name}\` | ${value} |`)
    lines.push('')
  }
  if (sizes.length) {
    lines.push('尺寸刻度：', '')
    for (const [path, value] of sizes) lines.push(`- \`${kebab(path.replace(/\./g, '-'))}\`：${value}px`)
    lines.push('')
  }
  lines.push(...namedRules([
    ['Group by Space', '相关元素靠近、区块之间拉开；间距是分组手段，不是平均分配。'],
  ]))
  return lines
}

function elevationSection(input: DesignDocInput): string[] {
  const shadow = isRecord(input.tokens.shadow) ? Object.entries(input.tokens.shadow).filter(([, v]) => typeof v === 'string') : []
  if (!shadow.length) return []
  const lines = ['## Elevation & Depth', '', '| 档 | 值 |', '|---|---|']
  for (const [name, value] of shadow) lines.push(`| \`${kebab(name)}\` | \`${String(value)}\` |`)
  lines.push('', ...namedRules([
    ['Flat by Default', '静止表面是平的；阴影只在状态变化（悬停、浮层、聚焦）时出现。'],
  ]))
  return lines
}

function shapesSection(input: DesignDocInput, fm: Frontmatter): string[] {
  const borders = isRecord(input.tokens.borderWidth) ? Object.entries(input.tokens.borderWidth).filter(([, v]) => typeof v === 'number') : []
  if (!Object.keys(fm.rounded).length && !borders.length) return []
  const lines = ['## Shapes', '']
  if (Object.keys(fm.rounded).length) {
    lines.push('圆角刻度（px）：', '', '| 档 | 值 |', '|---|---|')
    for (const [name, value] of Object.entries(fm.rounded)) lines.push(`| \`${name}\` | ${value} |`)
    lines.push('')
  }
  if (borders.length) {
    lines.push('描边宽度（px）：', '')
    for (const [name, value] of borders) lines.push(`- \`${kebab(name)}\`：${value}px`)
    lines.push('')
  }
  lines.push(...namedRules([
    ['One Curve Family', '同一产品只用一套圆角语义；不要在一个界面里混用方角与胶囊。'],
  ]))
  return lines
}

function componentsSection(fm: Frontmatter, input: DesignDocInput): string[] {
  if (!Object.keys(fm.components).length) return []
  const byId = new Map(input.components.map((component) => [kebab(component.id), component]))
  const lines = ['## Components', '', '每个组件只声明允许的八个属性；阴影、动效、焦点环不进入组件 token。', '']
  for (const [name, props] of Object.entries(fm.components) as Array<[string, Partial<Record<ComponentProp, string>>]>) {
    const component = byId.get(name)
    lines.push(`### ${name}`, '')
    if (component) lines.push(`类名：\`${component.base}\`${component.states.length ? ` · 状态：${component.states.join(' / ')}` : ''}`, '')
    for (const key of COMPONENT_PROPS) if (props[key]) lines.push(`- \`${key}\`：\`${props[key]}\``)
    lines.push('')
  }
  lines.push(...namedRules([
    ['Eight Props Only', '组件 token 只写这八项；其它视觉决策由状态与构图承担。'],
  ]))
  return lines
}

function dosSection(): string[] {
  return [
    "## Do's and Don'ts",
    '',
    "**Do** 引用语义 token；**Don't** 在页面里写裸色值或裸像素。",
    '',
    '**Do** 用状态属性表达交互态（`:hover` / `[aria-busy]` / `[aria-invalid]`）；**Don\'t** 新增状态类。',
    '',
    '**Do** 缺数据时省略对应小节；**Don\'t** 编造规则把文档填满。',
  ]
}

/** 组装完整 DESIGN.md（纯函数，同输入字节一致）。 */
export function buildDesignDoc(input: DesignDocInput): string {
  const fm = buildFrontmatter(input)
  const title = `# ${input.name}`
  const overview = [
    '## Overview',
    '',
    String(input.meta.description ?? input.meta.tagline ?? `${input.name} 的设计系统。`),
    '',
    '机器层是上方 frontmatter 的 token；本页正文只解释它们如何使用。两者冲突时以 token 为准。',
  ]
  const blocks: string[] = [renderFrontmatter(fm, input), '', title, '', ...overview]
  const sections: Record<(typeof SECTIONS)[number], string[]> = {
    Overview: [],
    Colors: colorsSection(input, fm),
    Typography: typographySection(input),
    Layout: layoutSection(input),
    'Elevation & Depth': elevationSection(input),
    Shapes: shapesSection(input, fm),
    Components: componentsSection(fm, input),
    "Do's and Don'ts": dosSection(),
  }
  for (const name of [...SECTIONS, 'Overview' as const].filter((section, index, all) => all.indexOf(section) === index)) {
    if (name === 'Overview') continue
    const body = sections[name]
    if (body.length) blocks.push('', ...body)
  }
  return blocks.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** DESIGN.md 的输出路径（与品牌包同目录）。 */
export function designDocFile(outDir: string, id: string): string {
  return join(outDir, 'DESIGN.md')
}
