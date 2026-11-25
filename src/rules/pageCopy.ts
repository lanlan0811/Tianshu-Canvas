/**
 * 文案类规则：破折号过密、营销黑话、格言腔。
 *
 * 中文文本的「——」是合法标点，破折号规则只在拉丁主导致页面生效。
 */
import { cjkRatio, decodeEntities, sentenceEndings } from './textMath.js'
import type { RuleContext, RuleFinding } from './types.js'

/** 破折号过密：≥8 处 em-dash，且约每 500 字符 1 处；只看拉丁主导页面。 */
export function checkEmDashOveruse(ctx: RuleContext): RuleFinding[] {
  const runs = sentenceEndings(ctx.masked)
  const text = runs.map((r) => r.text).join(' ')
  if (text.length < 500) return []
  // 中文正文里「——」是合法标点，直接不判。
  if (cjkRatio(text) >= 0.5) return []
  const matches = [...text.matchAll(/—|(?<!-)—(?!-)|(?<![-\w])--(?![-\w])/g)]
  if (matches.length < 8) return []
  if (text.length / matches.length > 500) return []
  // 定位到第一处 em-dash 在原文中的大致位置
  const first = runs.find((r) => /—/.test(r.text))
  return [
    {
      rule: 'em-dash-overuse',
      offset: first?.offset ?? 0,
      message: `正文里 ${matches.length} 处破折号（约每 ${Math.round(text.length / matches.length)} 字符一个），是 AI 的句式习惯；改用逗号、冒号、句号或括号`,
      severity: 'advisory',
    },
  ]
}

/** 英文词表（ASCII 词边界）与中文词表（字面子串）。 */
const EN_BUZZWORDS = [
  'streamline',
  'empower',
  'empowering',
  'supercharge',
  'world-class',
  'world class',
  'enterprise-grade',
  'enterprise grade',
  'next-generation',
  'next generation',
  'cutting-edge',
  'cutting edge',
  'game-changer',
  'game changer',
  'revolutionize',
  'revolutionary',
  'seamless',
  'seamlessly',
  'effortless',
  'effortlessly',
  'unlock the power',
  'take it to the next level',
  'best-in-class',
  'state-of-the-art',
]

const ZH_BUZZWORDS = [
  '赋能',
  '一站式',
  '无缝',
  '极致',
  '引领',
  '重新定义',
  '闭环',
  '抓手',
  '护城河',
  '降本增效',
  '全方位',
  '深层次',
  '颠覆式',
  '颠覆性',
  '底层逻辑',
  '组合拳',
]

export function checkMarketingBuzzword(ctx: RuleContext): RuleFinding[] {
  const out: RuleFinding[] = []
  for (const run of sentenceEndings(ctx.masked)) {
    const text = decodeEntities(run.text)
    if (!text.trim()) continue
    const lower = text.toLowerCase()
    const hits: string[] = []
    for (const word of EN_BUZZWORDS) {
      const re = new RegExp(`(?<![A-Za-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i')
      const match = re.exec(text)
      if (!match) continue
      // 首字母大写的孤立词视为专名（"Streamline is the name of the tool"），不判。
      const hit = match[0]
      if (/^[A-Z][a-z]/.test(hit) && !lower.slice(0, match.index).match(/[a-z]/i)) continue
      hits.push(word)
    }
    for (const word of ZH_BUZZWORDS) {
      if (text.includes(word)) hits.push(word)
    }
    if (hits.length === 0) continue
    out.push({
      rule: 'marketing-buzzword',
      offset: run.offset,
      message: `营销黑话：${[...new Set(hits)].slice(0, 4).join('、')}；用具体的动词和名词说清产品实际做了什么`,
      severity: 'warning',
    })
  }
  return out
}

/** 格言腔：≥3 个区块以「X。不是 Y。」/「Not a feature. A platform.」收尾。 */
const ZH_APHORISM = /[。！？]\s*(?:不是|而是|仅仅|只是)[^。！？]{1,40}[。！？]\s*$/
// 「X. No Y.」/「X. Not a Y.」/「X. Just Y.」：末句以否定或限定词开头，且整句很短。
const EN_APHORISM = /(?:^|[.!?]\s*)(?:no|not|just|merely)\s+[^.!?]{1,60}\.\s*$/i

export function checkAphoristicCadence(ctx: RuleContext): RuleFinding[] {
  const hits: Array<{ text: string; offset: number }> = []
  for (const run of sentenceEndings(ctx.masked)) {
    const text = decodeEntities(run.text).trim()
    if (text.length < 6) continue
    if (ZH_APHORISM.test(text) || EN_APHORISM.test(text)) hits.push({ text, offset: run.offset })
  }
  if (hits.length < 3) return []
  return [
    {
      rule: 'aphoristic-cadence',
      offset: hits[0]!.offset,
      message: `${hits.length} 个区块都以「X。不是 Y。」式对仗短句收尾，读起来是 AI 腔；把这个句式留给真正需要强调的一处`,
      severity: 'advisory',
    },
  ]
}
