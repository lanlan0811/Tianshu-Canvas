/**
 * Derived navigation cache. Never persisted in the version-1 project model.
 * Metadata/fingerprint checks may remain O(pages); unchanged unrelated bodies are
 * neither read nor parsed on a warm mutation. A failed transaction publishes no cache.
 */
import { lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertInsideWorkspace } from './paths.js'
import { pagesDir, readPageHtml, type ProjectTransaction } from './project.js'
import { MAX_HTML_BYTES } from './limits.js'
import {
  createNavIndex, navReferenceKeys, parseNavDocument, resolveNavRef, rewriteParsedNavLinks, titleSlug,
  type NavIndex, type ParsedNavAnchor, type ParsedNavDocument,
} from './nav.js'

interface PageCache {
  fingerprint: string | null
  anchors: readonly ParsedNavAnchor[]
  pending: ReadonlySet<string>
  targets: ReadonlySet<string>
}
interface WorkspaceCache {
  titles: Map<string, string>
  pages: Map<string, PageCache>
  reverse: Map<string, ReadonlySet<string>>
  targets: Map<string, ReadonlySet<string>>
}
const workspaces = new Map<string, WorkspaceCache>()

function workspaceKey(cwd: string): string {
  const path = resolve(cwd)
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/** Clear on the last plugin instance's disposal; also supports explicit test/restart isolation. */
export function clearNavigationCache(cwd?: string): void {
  if (cwd === undefined) workspaces.clear()
  else workspaces.delete(workspaceKey(cwd))
}

function pageFingerprint(cwd: string, id: string): string | null {
  const path = join(pagesDir(cwd), `${id}.html`)
  assertInsideWorkspace(cwd, path, '页面文件')
  try {
    const stat = lstatSync(path, { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('页面文件不是普通文件')
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function pendingKeys(document: ParsedNavDocument, index: NavIndex, deferred = false): Set<string> {
  const keys = new Set<string>()
  for (const anchor of document.anchors) {
    const resolution = resolveNavRef(anchor.ref, index)
    if (!deferred && resolution.target) continue
    for (const key of navReferenceKeys(anchor.ref)) keys.add(key)
  }
  return keys
}

function resolvedTargets(document: ParsedNavDocument, index: NavIndex): Set<string> {
  const targets = new Set<string>()
  for (const anchor of document.anchors) {
    const target = resolveNavRef(anchor.ref, index).target
    if (target) targets.add(target)
  }
  return targets
}

export interface NavigationBackfillResult {
  /** Page titles with changed final HTML, matching the tool's existing message. */
  changed: string[]
  warnings: string[]
  stats: { bodyReads: number; parsed: number; rewritten: number }
}

/**
 * Invoke synchronously at the end of a page mutation, inside its existing lock.
 * Reads pending staged HTML and stages every dependent rewrite before one commit.
 * It intentionally edits only real anchor tags in final HTML: design blocks,
 * scripts, styles and comments remain byte-identical, without strip/reinjection.
 */
export function backfillNavigation(cwd: string, tx: ProjectTransaction): NavigationBackfillResult {
  const key = workspaceKey(cwd)
  const previous = workspaces.get(key)
  const next: WorkspaceCache = {
    titles: new Map(tx.project.nodes.map((node) => [node.id, node.title])),
    pages: new Map(previous?.pages),
    reverse: new Map(previous?.reverse),
    targets: new Map(previous?.targets),
  }
  const result: NavigationBackfillResult = { changed: [], warnings: [], stats: { bodyReads: 0, parsed: 0, rewritten: 0 } }
  const index = createNavIndex(tx.project.nodes)
  const candidates = new Set<string>()
  const changedKeys = new Set<string>()
  const documents = new Map<string, ParsedNavDocument>()
  const staged = new Set(tx.stagedPageIds)
  const nodes = new Map(tx.project.nodes.map((node) => [node.id, node]))

  const setEntry = (id: string, entry?: PageCache): void => {
    const old = next.pages.get(id)
    for (const reference of old?.pending ?? []) {
      const sources = new Set(next.reverse.get(reference))
      sources.delete(id)
      if (sources.size) next.reverse.set(reference, sources)
      else next.reverse.delete(reference)
    }
    for (const target of old?.targets ?? []) {
      const sources = new Set(next.targets.get(target))
      sources.delete(id)
      if (sources.size) next.targets.set(target, sources)
      else next.targets.delete(target)
    }
    if (!entry) { next.pages.delete(id); return }
    next.pages.set(id, entry)
    for (const reference of entry.pending) {
      const sources = new Set(next.reverse.get(reference))
      sources.add(id)
      next.reverse.set(reference, sources)
    }
    for (const target of entry.targets) {
      const sources = new Set(next.targets.get(target))
      sources.add(id)
      next.targets.set(target, sources)
    }
  }
  const titleKeys = (id: string, title: string | undefined): void => {
    changedKeys.add(`id:${id}`)
    if (title !== undefined) {
      const slug = titleSlug(title)
      if (slug) changedKeys.add(`slug:${slug}`)
    }
  }
  const load = (id: string, known?: PageCache): ParsedNavDocument | null => {
    if (documents.has(id)) return documents.get(id)!
    const before = known && !staged.has(id) ? pageFingerprint(cwd, id) : null
    if (!staged.has(id)) result.stats.bodyReads++
    const html = readPageHtml(cwd, id, tx)
    if (html === null) return null
    const reuse = known && before === known.fingerprint && pageFingerprint(cwd, id) === before
    const document = reuse ? { html, anchors: known.anchors } : parseNavDocument(html)
    if (!reuse) result.stats.parsed++
    documents.set(id, document)
    return document
  }

  for (const [id, title] of previous?.titles ?? []) {
    if (!next.titles.has(id) || next.titles.get(id) !== title) titleKeys(id, title)
    if (!next.titles.has(id)) {
      // A deleted exact ID may now resolve through the existing slug fallback.
      // Keep this dependency separate: a rename never rereads normalized links.
      for (const source of previous?.targets.get(id) ?? []) if (nodes.has(source)) candidates.add(source)
      setEntry(id)
    }
  }
  for (const node of tx.project.nodes) {
    if (!previous?.titles.has(node.id) || previous.titles.get(node.id) !== node.title) titleKeys(node.id, node.title)
    try {
      const fingerprint = pageFingerprint(cwd, node.id)
      const cached = next.pages.get(node.id)
      if (!staged.has(node.id) && cached && cached.fingerprint === fingerprint) continue
      const document = load(node.id)
      if (document === null) { setEntry(node.id, { fingerprint, anchors: [], pending: new Set(), targets: new Set() }); continue }
      setEntry(node.id, { fingerprint, anchors: document.anchors, pending: pendingKeys(document, index), targets: resolvedTargets(document, index) })
      candidates.add(node.id)
    } catch {
      // Do not cache failed/unsafe reads: a later repaired file must be retried.
      setEntry(node.id)
      result.warnings.push(`页面「${node.title}」无法安全读取，导航自动补齐已跳过；请检查页面文件后重试。`)
    }
  }
  for (const reference of changedKeys) {
    for (const id of previous?.reverse.get(reference) ?? []) if (nodes.has(id)) candidates.add(id)
    for (const id of next.reverse.get(reference) ?? []) if (nodes.has(id)) candidates.add(id)
  }

  for (const id of candidates) {
    const node = nodes.get(id)
    const cached = next.pages.get(id)
    if (!node || !cached) continue
    try {
      const document = load(id, cached)
      if (!document) continue
      const rewrite = rewriteParsedNavLinks(document, index, '')
      // Preserve the whole source page when any reference is ambiguous.
      const deferred = rewrite.ambiguous.length > 0 || (rewrite.html !== document.html && Buffer.byteLength(rewrite.html, 'utf8') > MAX_HTML_BYTES)
      if (deferred) {
        setEntry(id, { ...cached, pending: pendingKeys(document, index, true), targets: resolvedTargets(document, index) })
        if (rewrite.ambiguous.length) {
          result.warnings.push(`页面「${node.title}」存在歧义跳转，已保留整页原文；请使用页面 id 或 data-nav。`)
        } else {
          result.warnings.push(`页面「${node.title}」自动补齐后将超过 8 MiB，已保留原文；请缩减页面内容后重试。`)
        }
        continue
      }
      if (rewrite.html === document.html) {
        setEntry(id, { ...cached, pending: pendingKeys(document, index), targets: resolvedTargets(document, index) })
        continue
      }
      const normalized = parseNavDocument(rewrite.html)
      tx.stagePageHtml(id, rewrite.html)
      staged.add(id)
      const now = Date.now()
      node.htmlRev = Math.max(now, (node.htmlRev ?? 0) + 1)
      node.updatedAt = Math.max(now, node.updatedAt)
      tx.markProjectChanged()
      result.stats.parsed++
      setEntry(id, { ...cached, anchors: normalized.anchors, pending: pendingKeys(normalized, index), targets: resolvedTargets(normalized, index) })
      result.changed.push(node.title)
      result.stats.rewritten++
    } catch {
      setEntry(id)
      result.warnings.push(`页面「${node.title}」导航自动补齐失败，已保留原文；请检查页面文件后重试。`)
    }
  }

  tx.afterCommit(() => {
    // Only successful final bytes become the baseline for the next transaction.
    for (const id of staged) {
      const entry = next.pages.get(id)
      if (!entry) continue
      try { next.pages.set(id, { ...entry, fingerprint: pageFingerprint(cwd, id) }) }
      catch { setEntry(id) }
    }
    workspaces.set(key, next)
  })
  return result
}
