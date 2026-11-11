/** Shared original page compositions and content-led visual directions. No workspace writes. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { designDir, injectDesign, resolveDesignStyle } from './design.js'
import { InvalidInputError } from './ids.js'

export interface PrototypeSummary {
  id: string
  name: string
  category: string
  description: string
  language: string
  variants: string[]
}
export interface Prototype extends PrototypeSummary {
  html: string
  css: string
  classes: string[]
  contentRequirements: string[]
  responsive: string[]
  interactions: string[]
  designDecisions: string[]
}
export interface DirectionSummary {
  id: string
  name: string
  description: string
  suitableFor: string[]
  composition: string[]
  typography: string[]
  rhythm: string[]
  mobile: string[]
  assets: string[]
  misuses: string[]
  exampleCount?: number
}
export interface Direction extends DirectionSummary {
  examples: { id: string; name: string; language: string; prototypeId?: string; resourceId: string; html: string }[]
}
const read = <T>(category: 'prototypes' | 'directions', id: string): T => {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new InvalidInputError('无效的设计资源 ID')
  return JSON.parse(readFileSync(join(designDir(), category, `${id}.json`), 'utf8')) as T
}
export function listPrototypes(): PrototypeSummary[] {
  return read<{ prototypes: PrototypeSummary[] }>('prototypes', 'index').prototypes
}
function compose(resource: Prototype, styleId: string, cwd?: string): string {
  if (!resolveDesignStyle(cwd, styleId)) throw new InvalidInputError(`未知的设计风格：${styleId}`)
  const escapedTitle = resource.name.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!))
  const css = resource.css.replace(/<\/style/gi, '<\\/style')
  return injectDesign(`<!doctype html><html lang="${resource.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle}</title><style data-tianshu-prototype="${resource.id}">${css}</style></head><body style="margin:0">${resource.html}</body></html>`, styleId, cwd).html
}
export function getPrototype(id: string, styleId = 'tianshu-original', cwd?: string): Prototype | null {
  if (!listPrototypes().some(p => p.id === id)) return null
  const resource = read<Prototype>('prototypes', id)
  return { ...resource, html: compose(resource, styleId, cwd) }
}
export function listDirections(): DirectionSummary[] {
  return read<{ directions: DirectionSummary[] }>('directions', 'index').directions
}
export function getDirection(id: string, styleId = 'tianshu-original', cwd?: string): Direction | null {
  if (!listDirections().some(d => d.id === id)) return null
  const direction = read<Direction>('directions', id)
  return { ...direction, examples: direction.examples.map(example => {
    const resource = read<Prototype>(example.prototypeId ? 'prototypes' : 'directions', example.resourceId)
    return { ...example, html: compose(resource, styleId, cwd) }
  }) }
}
/** Registered composition classes are explicit, not a wildcard exemption for tp-* names. */
export function prototypeClasses(): string[] {
  return [...new Set(listPrototypes().flatMap(p => read<Prototype>('prototypes', p.id).classes).concat(listDirections().flatMap(d => read<Direction>('directions', d.id).examples.filter(e => !e.prototypeId).flatMap(e => read<Prototype>('directions', e.resourceId).classes))).filter(cls => cls.startsWith('tp-')))]
}
