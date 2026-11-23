/**
 * 设计系统资产解析：dist/design/styles/<id>/assets.json 指向共享（内容寻址）或本地文件。
 *
 * 0.9.5 及更早的产物把跨风格相同的资产各存一份；为了兼容旧产物与测试夹具，
 * assets.json 缺失时回退到风格目录下的同名文件。
 *
 * 所有解析结果必须落在 dist/design/ 内，`../` 越界或指向工作区外一律拒绝。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve, sep } from 'node:path'

export interface StyleAssets {
  components: string
  interactionsCss: string
  interactionsJs: string
  interactions: string
  templates: string
  icons: string
  tokens: string
  manifest: string
}

const DEFAULTS: StyleAssets = {
  components: 'components.css',
  interactionsCss: 'interactions.css',
  interactionsJs: 'interactions.js',
  interactions: 'interactions.json',
  templates: 'templates.json',
  icons: 'icons.json',
  tokens: 'tokens.css',
  manifest: 'tokens.manifest.json',
}

const KEYS = Object.keys(DEFAULTS) as Array<keyof StyleAssets>

/** 读取 assets.json（缺失或损坏时回退默认布局）。 */
export function styleAssets(styleDir: string): StyleAssets {
  const manifest = resolve(styleDir, 'assets.json')
  try {
    if (!existsSync(manifest)) return { ...DEFAULTS }
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
    const merged = { ...DEFAULTS }
    for (const key of KEYS) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim()) merged[key] = value
    }
    return merged
  } catch {
    return { ...DEFAULTS }
  }
}

/** 把资产引用解析成绝对路径；越出 designRoot 或绝对路径直接拒绝。 */
export function resolveStyleAsset(styleDir: string, designRoot: string, key: keyof StyleAssets): string {
  const rel = styleAssets(styleDir)[key]
  if (isAbsolute(rel)) throw new Error(`设计系统资产引用不能是绝对路径：${rel}`)
  const absolute = resolve(styleDir, rel)
  const root = resolve(designRoot)
  const normalizedRoot = root.endsWith(sep) ? root : root + sep
  if (absolute !== root && !absolute.startsWith(normalizedRoot)) {
    throw new Error(`设计系统资产引用越界：${rel}`)
  }
  return absolute
}

/** 风格目录的祖父目录（dist/design/）：styleDir = <designRoot>/styles/<id>。 */
export function designRootOf(styleDir: string): string {
  return dirname(dirname(resolve(styleDir)))
}
