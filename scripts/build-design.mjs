/**
 * 把 design-systems/ 源数据编译到 dist/design/。
 *
 * 产物是确定性的：固定键序、LF 换行、不写时间戳，保证 CI 的
 * `git diff --exit-code -- dist` 在任意平台上结果一致。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildManifest, tokensToCss } from './design/design-tokens.mjs'
import {
  auditForbidden,
  validateComponents,
  validateConsistency,
  validateIcons,
  validateTemplateHtml,
  validateTemplates,
  validateTokens,
} from './design/design-validate.mjs'

const CORE_NAMES = [
  'search', 'home', 'menu', 'x', 'plus', 'check', 'user', 'settings', 'bell', 'mail',
  'calendar', 'clock', 'trash', 'edit', 'copy', 'download', 'upload', 'link', 'lock',
  'eye', 'file', 'folder', 'image', 'chart-bar', 'chart-line', 'table', 'grid', 'list',
  'layers', 'filter', 'refresh', 'play', 'pause', 'star', 'heart', 'bookmark', 'tag',
  'globe', 'info', 'alert-triangle', 'alert-circle', 'check-circle', 'code', 'terminal',
  'database', 'server', 'credit-card', 'shopping-cart',
]

function readJson(file, label) {
  if (!existsSync(file)) throw new Error(`缺少文件：${label}（${file}）`)
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`${label} 不是合法 JSON：${err.message}`)
  }
}

function writeJson(file, value) {
  mkdirSync(resolve(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2).replace(/\r\n/g, '\n') + '\n', 'utf8')
}

function writeText(file, text) {
  mkdirSync(resolve(file, '..'), { recursive: true })
  writeFileSync(file, text.replace(/\r\n/g, '\n'), 'utf8')
}

/** 校验 index.json 与各 meta.json 的一致性。 */
function checkIndex(index, metas, errors) {
  const byId = new Map(metas.map((m) => [m.id, m]))
  for (const entry of index.styles ?? []) {
    const meta = byId.get(entry.id)
    if (!meta) {
      errors.push(`index.json 里的 ${entry.id} 没有对应的 styles/<id>/meta.json`)
      continue
    }
    for (const key of ['name', 'tagline', 'description']) {
      if (entry[key] !== meta[key]) errors.push(`index.json 与 ${entry.id}/meta.json 的 ${key} 不一致`)
    }
    if (JSON.stringify(entry.tags) !== JSON.stringify(meta.tags)) errors.push(`index.json 与 ${entry.id}/meta.json 的 tags 不一致`)
    if (JSON.stringify(entry.swatches) !== JSON.stringify(meta.swatches)) {
      errors.push(`index.json 与 ${entry.id}/meta.json 的 swatches 不一致`)
    }
  }
  for (const meta of metas) {
    if (!(index.styles ?? []).some((s) => s.id === meta.id)) errors.push(`styles/${meta.id} 未在 index.json 中登记`)
  }
}

export function buildDesignSystems({ root, dist }) {
  const sourceDir = resolve(root, 'design-systems')
  if (sourceDir.split(/[\\/]/).includes('.claude')) throw new Error('设计系统源不得位于 .claude/ 下')

  const errors = []
  const warnings = []

  const index = readJson(join(sourceDir, 'index.json'), 'design-systems/index.json')
  if (index.schemaVersion !== 1) errors.push('index.schemaVersion 必须是 1')
  if (!index.notice) errors.push('index.notice 缺失')

  const stylesRoot = join(sourceDir, 'styles')
  const styleIds = (index.styles ?? []).map((s) => s.id)
  if (styleIds.length === 0) errors.push('index.json 没有登记任何风格')
  for (const id of styleIds) {
    if (!existsSync(join(stylesRoot, id))) errors.push(`styles/${id} 目录不存在`)
  }
  const onDisk = existsSync(stylesRoot)
    ? readdirSync(stylesRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : []
  for (const dir of onDisk) {
    if (!styleIds.includes(dir)) errors.push(`styles/${dir} 未在 index.json 中登记（会被忽略）`)
  }

  const componentsDoc = readJson(join(sourceDir, 'components', 'components.json'), 'components.json')
  const componentsCss = readFileSync(join(sourceDir, 'components', 'components.css'), 'utf8').replace(/\r\n/g, '\n')
  const iconsDoc = readJson(join(sourceDir, 'icons', 'core.json'), 'icons/core.json')
  const templatesDoc = readJson(join(sourceDir, 'templates', 'templates.json'), 'templates.json')
  const templateBodies = new Map()
  for (const template of templatesDoc.templates ?? []) {
    const file = join(sourceDir, template.file)
    if (!existsSync(file)) {
      errors.push(`模板文件不存在：${template.file}`)
      continue
    }
    templateBodies.set(template.id, readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
  }

  const metas = []
  const output = []

  // 组件与图标只校验一次：它们不随风格变化，类名集合是全局契约。
  // 变量集合用第一套风格做代表——跨风格一致性在后面统一校验。
  const iconNames = validateIcons(iconsDoc, CORE_NAMES, errors, warnings)
  const componentCatalog = new Set((componentsDoc.components ?? []).map((c) => c.id))
  const firstId = styleIds[0]
  let representativeManifest = { vars: [] }
  if (firstId && existsSync(join(stylesRoot, firstId, 'tokens.json'))) {
    try {
      const sample = readJson(join(stylesRoot, firstId, 'tokens.json'), `${firstId}/tokens.json`)
      representativeManifest = buildManifest(sample, { icons: iconNames, componentClasses: [] })
    } catch (err) {
      errors.push(`代表风格 manifest 生成失败：${err.message}`)
    }
  }
  const classSet = validateComponents(componentsDoc, componentsCss, representativeManifest, errors, warnings)
  const componentClasses = [...classSet]

  for (const id of styleIds) {
    const dir = join(stylesRoot, id)
    const meta = readJson(join(dir, 'meta.json'), `${id}/meta.json`)
    const tokens = readJson(join(dir, 'tokens.json'), `${id}/tokens.json`)
    metas.push(meta)

    const styleErrors = []
    validateTokens(tokens, id, styleErrors, warnings)
    if (meta.id !== id) styleErrors.push(`meta.id（${meta.id}）与目录名不一致`)
    auditForbidden(`${id}/meta.json`, JSON.stringify(meta), styleErrors)
    if (!meta.iconStyle || typeof meta.iconStyle.strokeWidth !== 'number') styleErrors.push(`${id}/meta.iconStyle.strokeWidth 缺失`)

    let manifest = null
    if (styleErrors.length === 0) {
      try {
        manifest = buildManifest(tokens, { icons: iconNames, componentClasses })
      } catch (err) {
        styleErrors.push(`manifest 生成失败：${err.message}`)
      }
    }

    const { templates } = validateTemplates(
      templatesDoc,
      join(sourceDir, 'templates'),
      classSet,
      iconNames,
      manifest,
      componentCatalog,
      styleErrors,
    )
    const templateIds = templates.map((t) => t.id)
    for (const template of templates) {
      const body = templateBodies.get(template.id)
      if (body === undefined) continue
      validateTemplateHtml(
        `${id}/${template.file}`,
        body,
        template,
        classSet,
        new Set(iconNames),
        manifest ?? { vars: [] },
        componentCatalog,
        styleErrors,
      )
    }

    errors.push(...styleErrors)
    if (styleErrors.length) continue

    output.push({
      id,
      meta,
      tokens,
      tokensCss: tokensToCss(tokens),
      manifest,
      iconsDoc,
      templates,
      templateBodies,
      componentClasses,
      templateIds,
    })
  }

  checkIndex(index, metas, errors)
  if (errors.length === 0) validateConsistency(output, errors)

  if (errors.length > 0) {
    const message = ['设计系统校验失败：', ...errors.map((e) => `  - ${e}`)].join('\n')
    throw new Error(message)
  }
  if (warnings.length) for (const w of warnings) console.warn(`[design] 警告：${w}`)

  const outRoot = join(dist, 'design')
  const catalogStyles = []
  for (const style of output) {
    const outDir = join(outRoot, 'styles', style.id)
    writeJson(join(outDir, 'meta.json'), style.meta)
    writeText(join(outDir, 'tokens.css'), style.tokensCss)
    writeJson(join(outDir, 'tokens.manifest.json'), style.manifest)
    writeText(join(outDir, 'components.css'), componentsCss)
    writeJson(join(outDir, 'icons.json'), {
      viewBox: style.iconsDoc.viewBox,
      stroke: style.meta.iconStyle,
      icons: style.iconsDoc.icons,
    })
    const templates = {}
    for (const template of style.templates) {
      const body = style.templateBodies.get(template.id)
      if (body === undefined) continue
      templates[template.id] = {
        name: template.name,
        description: template.description,
        device: template.device,
        components: template.components,
        icons: template.icons,
        html: body,
      }
    }
    writeJson(join(outDir, 'templates.json'), templates)

    catalogStyles.push({
      id: style.meta.id,
      name: style.meta.name,
      tagline: style.meta.tagline,
      description: style.meta.description,
      tags: style.meta.tags,
      swatches: style.meta.swatches,
      fonts: style.tokens.font.families,
      iconStyle: style.meta.iconStyle,
      counts: {
        icons: style.manifest.iconNames.length,
        components: (componentsDoc.components ?? []).length,
        templates: Object.keys(templates).length,
      },
      templates: style.templates.map((t) => ({ id: t.id, name: t.name, device: t.device })),
    })
  }

  writeJson(join(outRoot, 'index.json'), {
    schemaVersion: 1,
    notice: index.notice,
    styles: catalogStyles,
  })

  return { styles: catalogStyles.length }
}
