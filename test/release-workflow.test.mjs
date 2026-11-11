import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { releaseContext, validateReleaseFiles, verifyReleaseRevision, successfulMainCi, requireSuccessfulMainCi } from '../scripts/check-release-ci.mjs'
import { PACKAGE_ENTRIES } from '../scripts/check-plugin.mjs'

const sha = 'a'.repeat(40)
const otherSha = 'b'.repeat(40)
const context = { GITHUB_REPOSITORY: 'lanlan0811/Tianshu-Canvas', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag', GITHUB_REF: 'refs/tags/v1.2.3', GITHUB_REF_NAME: 'v1.2.3', GITHUB_SHA: sha }
const passingRun = (overrides = {}) => ({ id: 100, run_attempt: 1, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', created_at: '2026-11-10T12:00:00Z', run_started_at: '2026-11-10T12:01:00Z', updated_at: '2026-11-10T12:02:00Z', ...overrides })

test('发布事件仅接受固定仓库稳定 tag push，引用和 SHA 必须有效', () => {
  assert.deepEqual(releaseContext(context), { tag: 'v1.2.3', sha })
  for (const change of [
    { GITHUB_REPOSITORY: 'other/Tianshu-Canvas' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_REF_TYPE: 'branch' }, { GITHUB_REF: 'refs/heads/main' },
    { GITHUB_REF_NAME: 'v1.2.3;echo unsafe' }, { GITHUB_REF_NAME: 'v1.2.3-beta.1' },
    { GITHUB_REF_NAME: 'v01.2.3' }, { GITHUB_SHA: '--help' },
  ]) assert.throws(() => releaseContext({ ...context, ...change }))
})

function withReleaseFixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'tsc-release-gate-'))
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    writeFileSync(join(directory, 'tianshu.plugin.json'), JSON.stringify({ version: '1.2.3' }))
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }))
    mkdirSync(join(directory, 'release'))
    writeFileSync(join(directory, 'release/release-1.2.3.md'), '# v1.2.3\n修复与验收详情。\n')
    return run(directory)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

test('发布版本必须与 package、manifest 和 lock 两处一致', () => {
  withReleaseFixture((directory) => assert.deepEqual(validateReleaseFiles(directory, 'v1.2.3'), { version: '1.2.3', notes: join(directory, 'release/release-1.2.3.md') }))
  for (const filename of ['package.json', 'tianshu.plugin.json', 'package-lock.json']) {
    withReleaseFixture((directory) => {
      const file = join(directory, filename)
      const data = JSON.parse(readFileSync(file, 'utf8'))
      data.version = '1.2.2'
      writeFileSync(file, JSON.stringify(data))
      assert.throws(() => validateReleaseFiles(directory, 'v1.2.3'), /版本必须/)
    })
  }
  withReleaseFixture((directory) => {
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.2' } } }))
    assert.throws(() => validateReleaseFiles(directory, 'v1.2.3'), /packages.*版本必须/)
  })
})

test('缺失或空白发布说明必须失败，CHANGELOG 不能回退替代', () => {
  withReleaseFixture((directory) => {
    rmSync(join(directory, 'release/release-1.2.3.md'))
    writeFileSync(join(directory, 'CHANGELOG.md'), '# v1.2.3\n旧回退说明')
    assert.throws(() => validateReleaseFiles(directory, 'v1.2.3'), /缺少发布说明/)
    writeFileSync(join(directory, 'release/release-1.2.3.md'), '  \n\t')
    assert.throws(() => validateReleaseFiles(directory, 'v1.2.3'), /不得为空/)
  })
})

test('标签和 checkout 必须同 SHA，且必须是 origin/main 的祖先', () => {
  const calls = []
  verifyReleaseRevision('/unused', { tag: 'v1.2.3', sha }, (args) => {
    calls.push(args)
    return args[0] === 'ls-remote' ? `${sha}\trefs/tags/v1.2.3\n` : sha + '\n'
  })
  assert.deepEqual(calls, [['rev-parse', 'HEAD'], ['rev-parse', 'refs/tags/v1.2.3^{commit}'], ['merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main'], ['ls-remote', '--exit-code', 'origin', 'refs/tags/v1.2.3', 'refs/tags/v1.2.3^{}']])
  for (const mismatch of ['HEAD', 'refs/tags/v1.2.3^{commit}']) {
    assert.throws(() => verifyReleaseRevision('/unused', { tag: 'v1.2.3', sha }, (args) => args[1] === mismatch ? otherSha : sha), /同一个提交/)
  }
  assert.throws(() => verifyReleaseRevision('/unused', { tag: 'v1.2.3', sha }, (args) => {
    if (args[0] === 'merge-base') throw new Error('not an ancestor')
    return sha
  }), /origin.main/)
})

test('CI 必须是完全相同 SHA 的 main push，拒绝失败、取消和进行中运行', () => {
  assert.equal(successfulMainCi([passingRun()], sha).id, 100)
  for (const changes of [
    { head_sha: otherSha }, { head_branch: 'feature' }, { event: 'pull_request' },
    { status: 'in_progress', conclusion: null }, { status: 'queued', conclusion: null },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'skipped' },
  ]) assert.throws(() => successfulMainCi([passingRun(changes)], sha))
  assert.throws(() => successfulMainCi([], sha), /未找到/)
  assert.throws(() => successfulMainCi(undefined, sha), /workflow_runs/)
})

test('真实 Git bare 远端验证 main 祖先、轻量/附注标签，拒绝远端移动或删除', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tsc-release-history-'))
  const git = (args, input) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  try {
    git(['init', '--initial-branch=main'])
    git(['init', '--bare', '--initial-branch=main', join(directory, 'remote.git')])
    git(['remote', 'add', 'origin', join(directory, 'remote.git')])
    git(['config', 'user.name', 'Release Gate Test'])
    git(['config', 'user.email', 'release-gate@example.invalid'])
    git(['commit', '--allow-empty', '-m', 'synthetic main base'])
    const base = git(['rev-parse', 'HEAD'])
    git(['tag', '-a', 'v1.2.3', '-m', 'synthetic annotated release'])
    git(['tag', 'v1.2.2'])
    git(['commit', '--allow-empty', '-m', 'synthetic main next'])
    const mainHead = git(['rev-parse', 'HEAD'])
    git(['push', 'origin', 'main', 'refs/tags/v1.2.3', 'refs/tags/v1.2.2'])
    git(['checkout', '--detach', base])
    verifyReleaseRevision(directory, { tag: 'v1.2.3', sha: base })
    verifyReleaseRevision(directory, { tag: 'v1.2.2', sha: base })
    git(['push', '--force', 'origin', `${mainHead}:refs/tags/v1.2.3`])
    assert.equal(git(['rev-parse', 'refs/tags/v1.2.3^{commit}']), base, '本地标签仍旧，必须直接查远端发现移动')
    assert.throws(() => verifyReleaseRevision(directory, { tag: 'v1.2.3', sha: base }), /远端发布标签已移动/)
    git(['push', 'origin', ':refs/tags/v1.2.2'])
    assert.equal(git(['rev-parse', 'refs/tags/v1.2.2^{commit}']), base)
    assert.throws(() => verifyReleaseRevision(directory, { tag: 'v1.2.2', sha: base }), /无法确认远端发布标签/)
    const tree = git(['write-tree'])
    const unrelated = git(['commit-tree', tree], 'synthetic unrelated release\n')
    git(['tag', 'v1.2.4', unrelated])
    git(['checkout', '--detach', unrelated])
    assert.throws(() => verifyReleaseRevision(directory, { tag: 'v1.2.4', sha: unrelated }), /origin.main/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('旧 CI 成功不能覆盖最新失败或尚未完成的重跑，包括旧 id 的新 attempt', () => {
  for (const changes of [{ status: 'in_progress', conclusion: null }, { conclusion: 'failure' }]) {
    assert.throws(() => successfulMainCi([passingRun(), passingRun({ id: 101, updated_at: '2026-11-10T12:03:00Z', ...changes })], sha), /最新/)
    assert.throws(() => successfulMainCi([passingRun(), passingRun({ run_attempt: 2, run_started_at: '2026-11-10T12:03:00Z', updated_at: '2026-11-10T12:03:01Z', ...changes })], sha), /最新/)
    assert.throws(() => successfulMainCi([passingRun({ id: 101 }), passingRun({ id: 100, run_attempt: 2, run_started_at: '2026-11-10T12:04:00Z', updated_at: '2026-11-10T12:04:01Z', ...changes })], sha), /最新/)
  }
  assert.equal(successfulMainCi([passingRun({ id: 101, updated_at: '2026-11-10T12:03:00Z' }), passingRun({ conclusion: 'failure' })], sha).id, 101)
  assert.equal(successfulMainCi([passingRun({ id: 101 }), passingRun({ id: 100, run_attempt: 2, run_started_at: '2026-11-10T12:04:00Z', updated_at: '2026-11-10T12:05:00Z' })], sha).id, 100)
  assert.throws(() => successfulMainCi([passingRun(), passingRun({ id: 101, conclusion: 'failure' })], sha), /最新/, '同秒无法确定活动先后时必须拒绝')
})

test('CI 活动日期必须为真实 GitHub ISO 时间，拒绝缺失、畸形和不可能的日期', () => {
  for (const field of ['created_at', 'run_started_at', 'updated_at']) {
    for (const value of [undefined, null, 'not-a-date', '2026-02-30T12:00:00Z', '2026-11-10 12:00:00Z']) {
      assert.throws(() => successfulMainCi([passingRun({ [field]: value })], sha), /日期/)
    }
  }
  assert.throws(() => successfulMainCi([passingRun({ run_started_at: '2026-11-09T12:00:00Z' })], sha), /日期顺序/)
})

test('远端标签查询失败或响应不完整异常时拒绝，不能沿用本地标签', () => {
  for (const remote of ['', `${sha}\trefs/tags/v9.9.9\n`, `${sha}\trefs/tags/v1.2.3^{}\n`, `${sha}\trefs/tags/v1.2.3\n${sha}\trefs/tags/v1.2.3\n`, 'unexpected response']) {
    assert.throws(() => verifyReleaseRevision('/unused', { tag: 'v1.2.3', sha }, (args) => args[0] === 'ls-remote' ? remote : sha), /远端发布标签/)
  }
  assert.throws(() => verifyReleaseRevision('/unused', { tag: 'v1.2.3', sha }, (args) => {
    if (args[0] === 'ls-remote') throw new Error('network unavailable')
    return sha
  }), /无法确认远端发布标签/)
})

test('CI REST 查询固定官方 endpoint 并严格复核返回事件，不信任 API 筛选结果', async () => {
  let request
  const run = await requireSuccessfulMainCi(sha, 'synthetic-token', async (url, options) => {
    request = { url, options }
    return { ok: true, json: async () => ({ workflow_runs: [passingRun()] }) }
  })
  assert.equal(run.id, 100)
  assert.equal(request.url.origin, 'https://api.github.com')
  assert.equal(request.url.pathname, '/repos/lanlan0811/Tianshu-Canvas/actions/workflows/ci.yml/runs')
  assert.equal(request.url.searchParams.get('head_sha'), sha)
  assert.equal(request.url.searchParams.get('branch'), 'main')
  assert.equal(request.url.searchParams.get('event'), 'push')
  assert.equal(request.options.headers.Authorization, 'Bearer synthetic-token')
  assert.equal(request.options.redirect, 'error')
  assert.ok(request.options.signal instanceof AbortSignal)
  await assert.rejects(requireSuccessfulMainCi(sha, 'synthetic-token', async () => ({ ok: true, json: async () => ({ workflow_runs: [passingRun({ head_sha: otherSha })] }) })), /未找到/)
})

test('CI 状态无法确认时发布拒绝，不将 API 错误或空响应视为成功', async () => {
  await assert.rejects(requireSuccessfulMainCi(sha, ''), /GITHUB_TOKEN/)
  await assert.rejects(requireSuccessfulMainCi('--help', 'synthetic-token'), /SHA/)
  await assert.rejects(requireSuccessfulMainCi(sha, 'synthetic-token', async () => ({ ok: false, status: 403 })), /HTTP 403/)
  await assert.rejects(requireSuccessfulMainCi(sha, 'synthetic-token', async () => ({ ok: true, json: async () => ({}) })), /workflow_runs/)
  await assert.rejects(requireSuccessfulMainCi(sha, 'synthetic-token', async () => { throw new Error('network unavailable') }), /network unavailable/)
})

test('Release 工作流在创建 Release 前复核 main CI 并执行完整门禁', () => {
  const workflow = readFileSync(join(resolve(import.meta.dirname, '..'), '.github/workflows/release.yml'), 'utf8')
  assert.match(workflow, /actions: read/)
  const required = [
    'node scripts/check-release-ci.mjs', 'npm ci', 'npm run typecheck', 'npm run build',
    'git diff --exit-code -- dist', 'npm run notices', 'git diff --exit-code -- THIRD-PARTY-NOTICES.md',
    'TIANSHU_CANVAS_REQUIRE_BROWSER=1', 'npm test', 'npm run verify:codegen', 'npm run check:plugin', 'npm run verify:prototypes',
    'test -s', 'gh release create',
  ]
  let previous = -1
  for (const command of required) {
    const position = workflow.indexOf(command)
    assert.ok(position > previous, `发布门禁缺失或顺序错误：${command}`)
    previous = position
  }
  assert.doesNotMatch(workflow, /extract-release-notes/)
  assert.ok(workflow.includes('actions/upload-artifact@v4'))
  assert.ok(workflow.includes('path: .tmp/release-prototypes'))
  assert.ok(workflow.includes('include-hidden-files: true'))
  assert.ok(workflow.includes('--verify-tag --repo'))
  assert.equal(workflow.match(/node scripts.check-release-ci.mjs/g)?.length, 2, '发布创建前必须再次复核 CI，不能只检查验收开始时的状态')
  assert.equal(workflow.match(/git fetch --no-tags origin refs.heads.main:refs.remotes.origin.main/g)?.length, 2, '创建 Release 前必须重新确认当前 main 历史')
})

test('main CI requires full original-composition evidence before release eligibility', () => {
  const workflow = readFileSync(join(resolve(import.meta.dirname, '..'), '.github/workflows/ci.yml'), 'utf8')
  assert.ok(workflow.includes('npm run verify:prototypes -- --out .tmp/ci-prototypes'))
  assert.ok(workflow.includes('actions/upload-artifact@v4'))
  assert.match(workflow, /if-no-files-found: error/)
  assert.ok(workflow.includes('path: .tmp/ci-prototypes'))
  assert.ok(workflow.includes('include-hidden-files: true'))
})

test('release package ships only the current acceptance document', () => {
  const documents = PACKAGE_ENTRIES.filter(entry => entry.startsWith('docs/'))
  assert.deepEqual(documents, ['docs/aesthetic-upgrade-acceptance.md'])
})
