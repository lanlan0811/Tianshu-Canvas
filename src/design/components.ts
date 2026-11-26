/**
 * 组件契约的运行时读取（裁剪版，来自 dist/design/components/contract.json）。
 *
 * 为什么不读 design-systems/components/components.json：源目录不进发行包，
 * 运行时（drift 等）只能依赖 dist 产物。裁剪版只保留 id/base/classes/states/stateAttrs。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { designDir } from '../design.js'

export interface ComponentContractEntry {
  id: string
  base: string
  classes: string[]
  states: string[]
  stateAttrs: string[]
  /** 组件子 token 的点路径（如 color.action.primary / radius.md）。 */
  tokens: string[]
}

export interface ComponentContract {
  schemaVersion: 1
  components: ComponentContractEntry[]
}

/** 读组件契约；缺失时报可读错误（构建产物未生成）。 */
export function loadComponentContract(): ComponentContract {
  const file = join(designDir(), 'components', 'contract.json')
  if (!existsSync(file)) {
    throw new Error('组件契约产物缺失（dist/design/components/contract.json），请先运行 npm run build。')
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as ComponentContract
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.components)) {
    throw new Error('组件契约产物格式无效（schemaVersion 必须为 1 且含 components 数组）。')
  }
  return parsed
}
