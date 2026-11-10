/** 发布门禁：稳定版本、main 上的标签和同一提交成功的 main push CI。 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REPOSITORY = 'lanlan0811/Tianshu-Canvas'
const root = resolve(import.meta.dirname, '..')

export function releaseContext(env) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF_TYPE !== 'tag') {
    throw new Error('发布只接受本仓库的 tag push 事件')
  }
  const tag = env.GITHUB_REF_NAME
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? '') || env.GITHUB_REF !== `refs/tags/${tag}`) {
    throw new Error('发布标签必须为 v<稳定版本>，且与事件引用一致')
  }
  const sha = env.GITHUB_SHA
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('发布提交 SHA 无效')
  return { tag, sha }
}

export function validateReleaseFiles(directory, tag) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? '')) throw new Error('发布标签版本无效')
  const version = tag.slice(1)
  const readJson = (name) => JSON.parse(readFileSync(join(directory, name), 'utf8'))
  const pkg = readJson('package.json')
  const manifest = readJson('tianshu.plugin.json')
  const lock = readJson('package-lock.json')
  for (const [name, value] of [
    ['package.json', pkg.version], ['tianshu.plugin.json', manifest.version],
    ['package-lock.json', lock.version], ['package-lock.json packages[""]', lock.packages?.['']?.version],
  ]) {
    if (value !== version) throw new Error(`${name} 版本必须与 ${tag} 一致`)
  }
  const notes = join(directory, 'release', `release-${version}.md`)
  let contents
  try { contents = readFileSync(notes, 'utf8') } catch { throw new Error(`缺少发布说明 release/release-${version}.md`) }
  if (!contents.trim()) throw new Error(`发布说明 release/release-${version}.md 不得为空`)
  return { version, notes }
}

export function verifyReleaseRevision(directory, { tag, sha }, git = (args) => execFileSync('git', args, {
  cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
})) {
  const head = git(['rev-parse', 'HEAD']).trim()
  const tagCommit = git(['rev-parse', `refs/tags/${tag}^{commit}`]).trim()
  if (head !== sha || tagCommit !== sha) throw new Error('checkout、标签和事件 SHA 必须指向同一个提交')
  try { git(['merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main']) } catch {
    throw new Error('发布标签必须指向 origin/main 上的提交')
  }
  let remote
  try { remote = git(['ls-remote', '--exit-code', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]) } catch {
    throw new Error('无法确认远端发布标签，标签可能已删除或远端不可达')
  }
  const refs = new Map()
  for (const line of remote.trim().split(/\r?\n/)) {
    const match = /^([0-9a-f]{40})\t(.+)$/.exec(line)
    if (!match || ![`refs/tags/${tag}`, `refs/tags/${tag}^{}`].includes(match[2]) || refs.has(match[2])) {
      throw new Error('远端发布标签响应异常')
    }
    refs.set(match[2], match[1])
  }
  if (!refs.has(`refs/tags/${tag}`)) throw new Error('远端发布标签不存在')
  const remoteCommit = refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`)
  if (remoteCommit !== sha) throw new Error('远端发布标签已移动，不再指向事件 SHA')
}

function ciTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error('GitHub CI 日期字段无效')
  }
  const time = Date.parse(value)
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z')
  if (!Number.isFinite(time) || new Date(time).toISOString() !== normalized) throw new Error('GitHub CI 日期字段无效')
  return time
}

export function successfulMainCi(runs, sha) {
  if (!Array.isArray(runs)) throw new Error('GitHub CI 响应缺少 workflow_runs')
  const matches = runs.filter((run) => run?.head_sha === sha && run.head_branch === 'main' && run.event === 'push')
  if (!matches.length) throw new Error('未找到相同 SHA 的 main push CI')
  if (matches.some((run) => !Number.isSafeInteger(run.id) || run.id <= 0 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0)) {
    throw new Error('GitHub CI 运行标识无效')
  }
  const timed = matches.map((run) => {
    const created = ciTimestamp(run.created_at)
    const started = ciTimestamp(run.run_started_at)
    const updated = ciTimestamp(run.updated_at)
    if (started < created || updated < created) throw new Error('GitHub CI 日期顺序无效')
    // run id 是首次创建顺序；旧 run 的新 attempt 必须按最近活动而非 id 排序。
    return { run, activity: Math.max(started, updated) }
  })
  timed.sort((a, b) => b.activity - a.activity || b.run.id - a.run.id || b.run.run_attempt - a.run.run_attempt)
  const latest = timed[0]
  // REST 时间戳可能只精确到秒；同秒活动无法确定先后时，任何非成功状态都拒绝。
  if (timed.some(({ run, activity }) => activity === latest.activity && (run.status !== 'completed' || run.conclusion !== 'success'))) {
    throw new Error('相同 SHA 最新的 main push CI 尚未成功')
  }
  return latest.run
}

export async function requireSuccessfulMainCi(sha, token, fetchImpl = fetch) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('发布提交 SHA 无效')
  if (typeof token !== 'string' || !token.trim()) throw new Error('检查发布 CI 需要 GITHUB_TOKEN（actions: read）')
  const url = new URL(`https://api.github.com/repos/${REPOSITORY}/actions/workflows/ci.yml/runs`)
  url.search = new URLSearchParams({ branch: 'main', event: 'push', head_sha: sha, per_page: '100' }).toString()
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`无法确认 main CI：GitHub API HTTP ${response.status}`)
  const result = await response.json()
  return successfulMainCi(result.workflow_runs, sha)
}

async function main() {
  const context = releaseContext(process.env)
  const { version } = validateReleaseFiles(root, context.tag)
  verifyReleaseRevision(root, context)
  const run = await requireSuccessfulMainCi(context.sha, process.env.GITHUB_TOKEN)
  console.log(`发布门禁通过：v${version} · ${context.sha} · main CI run ${run.id} / attempt ${run.run_attempt}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
