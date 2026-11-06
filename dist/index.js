// src/tpi.ts
function defineTianshuPlugin(spec) {
  const sdk = globalThis.__tianshuTPI;
  if (!sdk) throw new Error("not running inside Tianshu: TPI plugins load only through the Tianshu host");
  return sdk.defineTianshuPlugin(spec);
}

// src/tools.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync7, mkdirSync as mkdirSync4, readFileSync as readFileSync7, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname, join as join6 } from "node:path";

// src/device.ts
var DEVICE_PRESETS = {
  desktop: { label: "\u684C\u9762", width: 1440, height: 900 },
  tablet: { label: "\u5E73\u677F", width: 768, height: 1024 },
  mobile: { label: "\u624B\u673A", width: 375, height: 812 }
};
var DEFAULT_DEVICE = "desktop";
function isDeviceType(value) {
  return value === "desktop" || value === "tablet" || value === "mobile" || value === "free";
}
function resolveSize(device, width, height) {
  const preset = device === "free" ? DEVICE_PRESETS.desktop : DEVICE_PRESETS[device];
  const w = positiveOr(width, preset.width);
  const h = positiveOr(height, preset.height);
  return { width: w, height: h };
}
function positiveOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

// src/design.ts
import { readFileSync as readFileSync3, existsSync as existsSync3 } from "node:fs";
import { join as join3 } from "node:path";
import { fileURLToPath } from "node:url";

// src/html.ts
function afterDoctype(html) {
  const match = /^(?:\s|<!--[\s\S]*?-->)*<!doctype\b[^>]*>/i.exec(html);
  return match ? match[0].length : 0;
}

// src/designCustom.ts
import { createHash } from "node:crypto";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, readdirSync, renameSync as renameSync2, rmSync as rmSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/ids.ts
import { randomUUID } from "node:crypto";
var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
var InvalidInputError = class extends Error {
};
function isSafeId(id) {
  return typeof id === "string" && ID_RE.test(id);
}
function assertSafeId(id) {
  if (!isSafeId(id)) throw new InvalidInputError(`invalid page id: ${String(id)}`);
}
function newPageId() {
  return "page-" + randomUUID().replace(/-/g, "").slice(0, 8);
}
function newCommentId() {
  return "cmt-" + randomUUID().replace(/-/g, "").slice(0, 8);
}

// src/project.ts
import { EventEmitter } from "node:events";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var PROJECT_DIR_NAME = ".tianshu-canvas";
var projectEvents = new EventEmitter();
projectEvents.setMaxListeners(0);
function projectDir(cwd) {
  return join(cwd, PROJECT_DIR_NAME);
}
function projectFile(cwd) {
  return join(projectDir(cwd), "project.json");
}
function pagesDir(cwd) {
  return join(projectDir(cwd), "pages");
}
function emptyProject() {
  return { version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] };
}
function inspectProject(cwd) {
  const file = projectFile(cwd);
  if (!existsSync(file)) return { project: emptyProject(), dropped: 0 };
  const raw = readFileSync(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { project: emptyProject(), problem: err.message, dropped: 0 };
  }
  const obj = parsed;
  if (!obj || !Array.isArray(obj.nodes)) {
    return { project: emptyProject(), problem: "\u7F3A\u5C11 nodes \u6570\u7EC4", dropped: 0 };
  }
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];
  const nodes = obj.nodes.filter(isPageNode);
  const edges = rawEdges.filter(isEdge);
  const project = { version: 1, viewport: normalizeViewport(obj.viewport), nodes, edges };
  const design = normalizeDesign(obj.design);
  if (design) project.design = design;
  const rawComments = Array.isArray(obj.comments) ? obj.comments : [];
  const comments = rawComments.map(normalizeComment).filter((c) => c !== null);
  if (comments.length > 0) project.comments = comments;
  return {
    project,
    // 无效批注静默过滤（与 design 一致），不计入 dropped。
    dropped: obj.nodes.length - nodes.length + rawEdges.length - edges.length
  };
}
function readProject(cwd) {
  return inspectProject(cwd).project;
}
function projectIssue(cwd) {
  const { problem, dropped } = inspectProject(cwd);
  if (problem) {
    return `project.json \u5DF2\u635F\u574F\uFF08${problem}\uFF09\u3002\u753B\u5E03\u6682\u6309\u7A7A\u9879\u76EE\u663E\u793A\uFF0C\u539F\u6587\u4EF6\u672A\u6539\u52A8\uFF0C\u4FEE\u590D\u540E\u4F1A\u81EA\u52A8\u6062\u590D\uFF1B\u7EE7\u7EED\u5199\u5165\u524D\u4F1A\u5148\u5907\u4EFD\u4E3A project.json.corrupt-*\u3002`;
  }
  if (dropped > 0) {
    return `project.json \u4E2D\u6709 ${dropped} \u6761\u65E0\u6548\u7684\u8282\u70B9\u6216\u8FDE\u7EBF\uFF0C\u8BFB\u53D6\u65F6\u5DF2\u5FFD\u7565\u3002\u539F\u6587\u4EF6\u672A\u6539\u52A8\uFF0C\u4E0B\u6B21\u5199\u5165\u524D\u4F1A\u5148\u5907\u4EFD\u4E3A project.json.corrupt-*\u3002`;
  }
  return null;
}
var pendingBackups = /* @__PURE__ */ new Map();
function takeProjectBackup(cwd) {
  const path = pendingBackups.get(cwd) ?? null;
  pendingBackups.delete(cwd);
  return path;
}
function backupDamagedProject(cwd) {
  const { problem, dropped } = inspectProject(cwd);
  if (!problem && dropped === 0) return;
  const file = projectFile(cwd);
  const stamp2 = Date.now();
  for (let n = 0; n < 1e3; n++) {
    const dest = n === 0 ? `${file}.corrupt-${stamp2}` : `${file}.corrupt-${stamp2}-${n}`;
    try {
      copyFileSync(file, dest, constants.COPYFILE_EXCL);
    } catch (err) {
      if (err.code === "EEXIST") continue;
      throw err;
    }
    pendingBackups.set(cwd, dest);
    console.error(`[tianshu-canvas] project.json \u5DF2\u635F\u574F\u6216\u542B\u65E0\u6548\u6761\u76EE\uFF0C\u8986\u76D6\u524D\u5DF2\u5907\u4EFD\u5230 ${dest}`);
    return;
  }
  throw new Error(`\u65E0\u6CD5\u5907\u4EFD\u635F\u574F\u7684\u9879\u76EE\u6587\u4EF6\uFF1A${file}`);
}
function normalizeViewport(v) {
  if (v && typeof v === "object") {
    const o = v;
    const x = typeof o.x === "number" && Number.isFinite(o.x) ? o.x : 0;
    const y = typeof o.y === "number" && Number.isFinite(o.y) ? o.y : 0;
    const zoom = typeof o.zoom === "number" && Number.isFinite(o.zoom) && o.zoom > 0 ? o.zoom : 1;
    return { x, y, zoom };
  }
  return { x: 0, y: 0, zoom: 1 };
}
function normalizeDesign(v) {
  if (!v || typeof v !== "object") return null;
  const o = v;
  if (typeof o.styleId !== "string" || o.styleId.trim() === "") return null;
  const updatedAt = typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt) ? o.updatedAt : 0;
  return { styleId: o.styleId.trim(), updatedAt };
}
function normalizeComment(v) {
  if (!v || typeof v !== "object") return null;
  const o = v;
  if (typeof o.id !== "string" || o.id.trim() === "") return null;
  if (!isSafeId(o.pageId)) return null;
  if (typeof o.xpath !== "string" || o.xpath.trim() === "") return null;
  if (typeof o.note !== "string" || o.note.trim() === "") return null;
  const createdAt = typeof o.createdAt === "number" && Number.isFinite(o.createdAt) ? o.createdAt : 0;
  const resolved = o.resolved === true;
  const comment = {
    id: o.id.trim(),
    pageId: o.pageId,
    xpath: o.xpath,
    tagName: typeof o.tagName === "string" ? o.tagName : "",
    note: o.note.trim(),
    createdAt,
    resolved
  };
  if (typeof o.textContent === "string") comment.textContent = o.textContent;
  if (resolved && typeof o.resolvedAt === "number" && Number.isFinite(o.resolvedAt)) comment.resolvedAt = o.resolvedAt;
  return comment;
}
function isPageNode(n) {
  if (!n || typeof n !== "object") return false;
  const o = n;
  return typeof o.id === "string" && isSafeId(o.id) && o.type === "page";
}
function isEdge(e) {
  if (!e || typeof e !== "object") return false;
  const o = e;
  return typeof o.id === "string" && typeof o.source === "string" && typeof o.target === "string";
}
function writeProjectAtomic(cwd, project, notify = true) {
  mkdirSync(pagesDir(cwd), { recursive: true });
  backupDamagedProject(cwd);
  const file = projectFile(cwd);
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(project, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
  if (notify) projectEvents.emit("change", { cwd });
}
function writeProject(cwd, project) {
  writeProjectAtomic(cwd, project);
}
function writePageHtml(cwd, id, html) {
  assertSafeId(id);
  mkdirSync(pagesDir(cwd), { recursive: true });
  const rel = join(PROJECT_DIR_NAME, "pages", `${id}.html`);
  const abs = join(cwd, rel);
  const tmp = abs + ".tmp";
  writeFileSync(tmp, html, "utf8");
  renameSync(tmp, abs);
  return rel;
}
function readPageHtml(cwd, id) {
  if (!isSafeId(id)) return null;
  const abs = join(pagesDir(cwd), `${id}.html`);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
}
function upsertNode(cwd, node) {
  const project = readProject(cwd);
  const idx = project.nodes.findIndex((n) => n.id === node.id);
  if (idx >= 0) {
    const prev = project.nodes[idx];
    project.nodes[idx] = { ...prev, ...node, createdAt: prev.createdAt, updatedAt: Date.now() };
  } else {
    project.nodes.push(node);
  }
  writeProjectAtomic(cwd, project);
  return project;
}
function autoLayoutPosition(cwd, index, size) {
  const gapX = 120;
  const gapY = 140;
  const cols = 3;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: col * (size.width + gapX),
    y: row * (size.height + gapY)
  };
}
function setViewport(cwd, viewport) {
  const { project, problem, dropped } = inspectProject(cwd);
  if (problem || dropped > 0) return project;
  project.viewport = normalizeViewport(viewport);
  writeProjectAtomic(cwd, project, false);
  return project;
}
function nextLayoutIndex(cwd) {
  return readProject(cwd).nodes.length;
}
function removeNode(cwd, id) {
  assertSafeId(id);
  const project = readProject(cwd);
  project.nodes = project.nodes.filter((n) => n.id !== id);
  project.edges = project.edges.filter((e) => e.source !== id && e.target !== id);
  if (project.comments) {
    const keep = project.comments.filter((c) => c.pageId !== id);
    if (keep.length > 0) project.comments = keep;
    else delete project.comments;
  }
  writeProjectAtomic(cwd, project);
  try {
    rmSync(join(pagesDir(cwd), `${id}.html`), { force: true });
  } catch {
  }
  return project;
}
function renameNode(cwd, id, title) {
  assertSafeId(id);
  const project = readProject(cwd);
  const node = project.nodes.find((n) => n.id === id);
  if (!node) throw new InvalidInputError(`\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${id}`);
  node.title = title;
  node.updatedAt = Date.now();
  writeProjectAtomic(cwd, project);
  return project;
}
function moveNode(cwd, id, x, y) {
  assertSafeId(id);
  const project = readProject(cwd);
  const node = project.nodes.find((n) => n.id === id);
  if (!node) throw new InvalidInputError(`\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${id}`);
  node.x = x;
  node.y = y;
  node.updatedAt = Date.now();
  writeProjectAtomic(cwd, project);
  return project;
}
function duplicateNode(cwd, id, title) {
  assertSafeId(id);
  const project = readProject(cwd);
  const src = project.nodes.find((n) => n.id === id);
  if (!src) throw new InvalidInputError(`\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${id}`);
  const newId = newPageId();
  const html = readPageHtml(cwd, id) ?? "";
  const rel = writePageHtml(cwd, newId, html);
  const now = Date.now();
  const node = {
    ...src,
    id: newId,
    title: title ?? `${src.title} \u526F\u672C`,
    x: src.x + 40,
    y: src.y + 40,
    htmlPath: rel,
    createdAt: now,
    updatedAt: now
  };
  project.nodes.push(node);
  writeProjectAtomic(cwd, project);
  return node;
}
function assertEdgeEnds(source, target) {
  assertSafeId(source);
  assertSafeId(target);
  if (source === target) throw new InvalidInputError(`\u4E0D\u80FD\u5C06\u8282\u70B9\u8FDE\u63A5\u5230\u81EA\u8EAB\uFF1A${source}`);
}
function assertEdgeNodes(project, source, target) {
  if (!project.nodes.some((n) => n.id === source)) throw new InvalidInputError(`\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${source}`);
  if (!project.nodes.some((n) => n.id === target)) throw new InvalidInputError(`\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${target}`);
}
function addEdge(cwd, source, target, label) {
  assertEdgeEnds(source, target);
  const project = readProject(cwd);
  assertEdgeNodes(project, source, target);
  const exists = project.edges.find((e) => e.source === source && e.target === target);
  if (exists) {
    if (label !== void 0 && exists.label !== label) {
      exists.label = label;
      writeProjectAtomic(cwd, project);
    }
    return exists;
  }
  const edge = { id: `edge-${source}-${target}`, source, target, ...label ? { label } : {} };
  project.edges.push(edge);
  writeProjectAtomic(cwd, project);
  return edge;
}
function removeEdge(cwd, source, target) {
  const project = readProject(cwd);
  const edges = project.edges.filter((e) => !(e.source === source && e.target === target));
  if (edges.length === project.edges.length) return project;
  project.edges = edges;
  writeProjectAtomic(cwd, project);
  return project;
}
function selectionFile(cwd) {
  return join(projectDir(cwd), "selection.json");
}
function readSelection(cwd) {
  const file = selectionFile(cwd);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed.pageId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
function writeSelection(cwd, selection) {
  mkdirSync(projectDir(cwd), { recursive: true });
  const file = selectionFile(cwd);
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(selection, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
  projectEvents.emit("selection", { cwd });
}
function readComments(cwd) {
  return readProject(cwd).comments ?? [];
}
function addComment(cwd, input) {
  assertSafeId(input.pageId);
  if (!input.xpath || input.xpath.trim() === "") throw new InvalidInputError("\u6279\u6CE8\u7F3A\u5C11 xpath");
  if (!input.note || input.note.trim() === "") throw new InvalidInputError("\u6279\u6CE8\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
  const project = readProject(cwd);
  if (!project.nodes.some((n) => n.id === input.pageId)) {
    throw new InvalidInputError(`\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${input.pageId}`);
  }
  const comment = {
    id: newCommentId(),
    pageId: input.pageId,
    xpath: input.xpath,
    tagName: input.tagName ?? "",
    note: input.note.trim(),
    createdAt: Date.now(),
    resolved: false
  };
  if (input.textContent !== void 0) comment.textContent = input.textContent;
  project.comments = [...project.comments ?? [], comment];
  writeProjectAtomic(cwd, project);
  return comment;
}
function setCommentsResolved(cwd, ids, resolved) {
  const project = readProject(cwd);
  const comments = project.comments ?? [];
  if (comments.length === 0) return 0;
  const wanted = new Set(ids);
  let changed = 0;
  for (const c of comments) {
    if (!wanted.has(c.id) || c.resolved === resolved) continue;
    c.resolved = resolved;
    if (resolved) c.resolvedAt = Date.now();
    else delete c.resolvedAt;
    changed++;
  }
  if (changed > 0) writeProjectAtomic(cwd, project);
  return changed;
}
function removeComments(cwd, ids) {
  const project = readProject(cwd);
  const comments = project.comments ?? [];
  if (comments.length === 0) return 0;
  const keep = ids ? comments.filter((c) => !ids.includes(c.id)) : [];
  const removed = comments.length - keep.length;
  if (removed === 0) return 0;
  if (keep.length > 0) project.comments = keep;
  else delete project.comments;
  writeProjectAtomic(cwd, project);
  return removed;
}

// scripts/design/design-tokens.mjs
var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function isHex(value) {
  return typeof value === "string" && HEX.test(value.trim());
}
function kebab(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").toLowerCase();
}
function isPrimitiveRef(value) {
  return typeof value === "string" && /^[a-z][a-z0-9]*\.[A-Za-z0-9]+$/.test(value);
}
function resolveColor(tokens, value, trail = []) {
  if (isPrimitiveRef(value)) {
    const [group, step] = value.split(".");
    const prim = tokens?.color?.primitives?.[group]?.[step];
    if (prim === void 0) {
      throw new Error(`\u8BED\u4E49\u8272\u5F15\u7528\u65E0\u6CD5\u89E3\u6790\uFF1A${value}\uFF08\u5728 ${trail.join(".")}\uFF09`);
    }
    return { value: prim, primitive: value };
  }
  if (isHex(value) || /^rgba?\(|^hsla?\(|^transparent$/.test(value)) {
    return { value };
  }
  throw new Error(`\u65E0\u6CD5\u8BC6\u522B\u7684\u989C\u8272\u503C\uFF1A${JSON.stringify(value)}\uFF08\u5728 ${trail.join(".")}\uFF09`);
}
function flattenTokens(tokens) {
  const vars = [];
  const resolvedSemantic = {};
  const push = (name, value) => {
    if (!name.startsWith("--ts-")) throw new Error(`\u53D8\u91CF\u5FC5\u987B\u4EE5 --ts- \u5F00\u5934\uFF1A${name}`);
    vars.push({ name, value });
  };
  const primitives = tokens.color.primitives;
  for (const group of Object.keys(primitives)) {
    for (const step of Object.keys(primitives[group])) {
      const value = primitives[group][step];
      if (!isHex(value)) throw new Error(`\u539F\u8272\u5FC5\u987B\u662F hex\uFF1Acolor.primitives.${group}.${step} = ${value}`);
      push(`--ts-color-${kebab(group)}-${kebab(step)}`, value);
    }
  }
  const semantic = tokens.color.semantic;
  for (const group of Object.keys(semantic)) {
    for (const name of Object.keys(semantic[group])) {
      const raw = semantic[group][name];
      const { value, primitive } = resolveColor(tokens, raw, ["color", "semantic", group, name]);
      const varName = `--ts-color-${kebab(group)}-${kebab(name)}`;
      push(varName, value);
      resolvedSemantic[`color.${group}.${name}`] = { value, primitive: primitive ?? null };
    }
  }
  for (const name of Object.keys(tokens.font.families)) {
    push(`--ts-font-${kebab(name)}`, tokens.font.families[name]);
  }
  for (const name of Object.keys(tokens.font.sizes)) {
    push(`--ts-fs-${kebab(name)}`, `${tokens.font.sizes[name]}px`);
  }
  for (const name of Object.keys(tokens.font.weights)) {
    push(`--ts-weight-${kebab(name)}`, String(tokens.font.weights[name]));
  }
  for (const name of Object.keys(tokens.font.lineHeights)) {
    push(`--ts-lh-${kebab(name)}`, String(tokens.font.lineHeights[name]));
  }
  for (const name of Object.keys(tokens.font.letterSpacing)) {
    push(`--ts-tracking-${kebab(name)}`, String(tokens.font.letterSpacing[name]));
  }
  const pxGroups = [
    ["space", "--ts-space-"],
    ["radius", "--ts-radius-"],
    ["borderWidth", "--ts-border-"],
    ["size", "--ts-size-"]
  ];
  for (const [group, prefix] of pxGroups) {
    for (const name of Object.keys(tokens[group])) {
      const n = tokens[group][name];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
        throw new Error(`${group}.${name} \u5FC5\u987B\u662F\u975E\u8D1F\u6570\u5B57`);
      }
      push(`${prefix}${kebab(name)}`, `${n}px`);
    }
  }
  for (const name of Object.keys(tokens.shadow)) {
    push(`--ts-shadow-${kebab(name)}`, String(tokens.shadow[name]));
  }
  for (const name of Object.keys(tokens.motion)) {
    push(`--ts-motion-${kebab(name)}`, String(tokens.motion[name]));
  }
  return { vars, resolvedSemantic };
}
function hasDarkMode(tokens) {
  return tokens?.modes?.dark === true && tokens?.color?.semanticDark != null;
}
function flattenDarkSemantic(tokens) {
  const vars = [];
  const semantic = tokens?.color?.semanticDark;
  if (semantic == null) return vars;
  for (const group of Object.keys(semantic)) {
    for (const name of Object.keys(semantic[group])) {
      const raw = semantic[group][name];
      const { value } = resolveColor(tokens, raw, ["color", "semanticDark", group, name]);
      vars.push({ name: `--ts-color-${kebab(group)}-${kebab(name)}`, value });
    }
  }
  return vars;
}
function tokensToCss(tokens) {
  const { vars } = flattenTokens(tokens);
  const lines = vars.map((v) => `  ${v.name}: ${v.value};`);
  let css = `/* \u7531 tokens.json \u751F\u6210\uFF0C\u8BF7\u52FF\u624B\u6539\u3002 */
:root {
${lines.join("\n")}
}
`;
  if (hasDarkMode(tokens)) {
    const darkLines = flattenDarkSemantic(tokens).map((v) => `  ${v.name}: ${v.value};`);
    css += `
/* \u6DF1\u8272\u6A21\u5F0F\uFF1A\u7ED9\u6839\u5143\u7D20\u52A0 class="dark" \u5373\u5207\u6362\u3002 */
.dark {
${darkLines.join("\n")}
}
`;
  }
  return css;
}
function buildManifest(tokens, { icons, componentClasses }) {
  const { vars, resolvedSemantic } = flattenTokens(tokens);
  return {
    schema: "tianshu-design-manifest/1",
    id: tokens.id,
    version: tokens.version,
    vars: vars.map((v) => v.name),
    spacing: Object.values(tokens.space),
    radius: Object.values(tokens.radius),
    fontFamilies: Object.values(tokens.font.families),
    iconNames: [...icons],
    componentClasses: [...componentClasses],
    resolvedSemantic
  };
}
function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`\u65E0\u6CD5\u89E3\u6790\u989C\u8272\uFF1A${hex}`);
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function parseHex(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// scripts/design/design-validate.mjs
var FORBIDDEN = [
  "library-consumption",
  "soloDesignConsumption",
  "uikit-plan",
  "preview-contract",
  "readOrder",
  ".trae-cn",
  "dl_builtin",
  "fill-html-head",
  "solo-design",
  "--trae-",
  "--doubao-",
  "--claude-",
  "--apple-",
  "--google-"
];
var REQUIRED_SEMANTIC = {
  bg: ["canvas", "surface", "raised", "sunken", "inverse"],
  text: ["primary", "secondary", "muted", "inverse", "link"],
  border: ["default", "strong", "subtle", "focus"],
  action: [
    "primary",
    "primaryHover",
    "primaryText",
    "secondary",
    "secondaryHover",
    "secondaryText",
    "ghostHover",
    "danger",
    "dangerText"
  ],
  status: ["success", "successBg", "warning", "warningBg", "danger", "dangerBg", "info", "infoBg"],
  chart: ["1", "2", "3", "4", "5"],
  overlay: ["scrim"]
};
function auditForbidden(label, text, errors) {
  for (const token of FORBIDDEN) {
    if (text.includes(token)) errors.push(`${label}\uFF1A\u51FA\u73B0\u88AB\u7981\u7528\u7684\u6807\u8BC6 ${token}`);
  }
  if (/https?:\/\//.test(text)) errors.push(`${label}\uFF1A\u51FA\u73B0\u5916\u94FE URL`);
}
function checkMonotonic(label, record, errors) {
  const keys = Object.keys(record);
  const nums = keys.map((k) => Number(k));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) {
    errors.push(`${label}\uFF1A\u952E\u5FC5\u987B\u662F\u975E\u8D1F\u6570\u5B57\uFF08\u53EF\u6392\u5E8F\uFF09`);
    return;
  }
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] <= nums[i - 1]) errors.push(`${label}\uFF1A\u952E\u5FC5\u987B\u4E25\u683C\u9012\u589E\uFF08${keys[i - 1]} -> ${keys[i]}\uFF09`);
  }
  for (let i = 1; i < keys.length; i++) {
    const prev = record[keys[i - 1]];
    const cur = record[keys[i]];
    if (typeof prev !== "number" || typeof cur !== "number") continue;
    if (cur <= prev) errors.push(`${label}\uFF1A\u503C\u5FC5\u987B\u4E25\u683C\u9012\u589E\uFF08${keys[i - 1]}=${prev} -> ${keys[i]}=${cur}\uFF09`);
  }
}
function checkRadius(record, errors) {
  const entries = Object.entries(record);
  let prev = -Infinity;
  for (const [key, value] of entries) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      errors.push(`tokens.radius.${key} \u5FC5\u987B\u662F\u975E\u8D1F\u6570\u5B57`);
      continue;
    }
    if (key === "full") continue;
    if (value <= prev) errors.push(`tokens.radius.${key} \u5FC5\u987B\u5927\u4E8E\u524D\u4E00\u6863\uFF08${prev}\uFF09`);
    prev = value;
  }
}
function validateTokens(tokens, expectedId, errors, warnings) {
  if (tokens?.schema !== "tianshu-design-tokens/1") errors.push("tokens.schema \u5FC5\u987B\u662F tianshu-design-tokens/1");
  if (tokens?.id !== expectedId) errors.push(`tokens.id\uFF08${tokens?.id}\uFF09\u4E0E\u76EE\u5F55\uFF08${expectedId}\uFF09\u4E0D\u4E00\u81F4`);
  if (typeof tokens?.version !== "number") errors.push("tokens.version \u5FC5\u987B\u662F\u6570\u5B57");
  for (const group of ["font", "space", "radius", "borderWidth", "shadow", "size", "motion", "color"]) {
    if (!tokens?.[group] || typeof tokens[group] !== "object") errors.push(`tokens.${group} \u7F3A\u5931`);
  }
  if (!tokens?.color?.primitives || !tokens?.color?.semantic) {
    errors.push("tokens.color \u9700\u8981 primitives \u4E0E semantic");
    return null;
  }
  for (const [group, steps] of Object.entries(tokens.color.primitives)) {
    for (const [step, value] of Object.entries(steps)) {
      if (!isHex(value)) errors.push(`\u539F\u8272\u5FC5\u987B\u662F hex\uFF1Acolor.primitives.${group}.${step} = ${value}`);
    }
  }
  for (const [group, required] of Object.entries(REQUIRED_SEMANTIC)) {
    const actual = tokens.color.semantic[group];
    if (!actual) {
      errors.push(`\u7F3A\u5C11\u8BED\u4E49\u8272\u7EC4 color.semantic.${group}`);
      continue;
    }
    for (const name of required) {
      if (actual[name] === void 0) errors.push(`\u7F3A\u5C11\u8BED\u4E49\u8272 color.semantic.${group}.${name}`);
    }
  }
  for (const [group, entries] of Object.entries(tokens.color.semantic)) {
    for (const [name, value] of Object.entries(entries)) {
      if (isPrimitiveRef(value)) {
        const [g, s] = value.split(".");
        if (tokens.color.primitives[g]?.[s] === void 0) {
          errors.push(`\u8BED\u4E49\u8272\u5F15\u7528\u4E0D\u53EF\u89E3\u6790\uFF1Acolor.semantic.${group}.${name} = ${value}`);
        }
      } else if (!isHex(value) && !/^(?:rgba?|hsla?)\(|^transparent$/.test(value)) {
        errors.push(`\u65E0\u6CD5\u8BC6\u522B\u7684\u989C\u8272\u503C\uFF1Acolor.semantic.${group}.${name} = ${value}`);
      }
    }
  }
  const font = tokens.font ?? {};
  for (const key of ["families", "sizes", "weights", "lineHeights", "letterSpacing"]) {
    if (!font[key] || Object.keys(font[key]).length === 0) errors.push(`tokens.font.${key} \u4E0D\u80FD\u4E3A\u7A7A`);
  }
  for (const [name, px] of Object.entries(font.sizes ?? {})) {
    if (typeof px !== "number" || px <= 0) errors.push(`font.sizes.${name} \u5FC5\u987B\u662F\u6B63\u6570`);
  }
  checkMonotonic("tokens.space", tokens.space ?? {}, errors);
  checkRadius(tokens.radius ?? {}, errors);
  for (const [k, v] of Object.entries(tokens.size ?? {})) {
    if (typeof v !== "number" || v <= 0) errors.push(`size.${k} \u5FC5\u987B\u662F\u6B63\u6570`);
  }
  for (const [k, v] of Object.entries(tokens.shadow ?? {})) {
    if (typeof v !== "string" || /url\(|@import|https?:\/\//i.test(v)) errors.push(`shadow.${k} \u542B\u7981\u7528\u5185\u5BB9`);
  }
  validateColorSemantics(tokens, tokens.color.semantic, "", errors, warnings);
  const dark = tokens.color.semanticDark;
  if (dark != null) {
    if (typeof dark !== "object") {
      errors.push("color.semanticDark \u5FC5\u987B\u662F\u5BF9\u8C61");
    } else {
      for (const [group, required] of Object.entries(REQUIRED_SEMANTIC)) {
        const actual = dark[group];
        if (!actual) {
          errors.push(`\u7F3A\u5C11\u6DF1\u8272\u8BED\u4E49\u8272\u7EC4 color.semanticDark.${group}`);
          continue;
        }
        for (const name of required) {
          if (actual[name] === void 0) errors.push(`\u7F3A\u5C11\u6DF1\u8272\u8BED\u4E49\u8272 color.semanticDark.${group}.${name}`);
        }
      }
      for (const [group, entries] of Object.entries(dark)) {
        for (const [name, value] of Object.entries(entries)) {
          if (isPrimitiveRef(value)) {
            const [g, s] = value.split(".");
            if (tokens.color.primitives[g]?.[s] === void 0) {
              errors.push(`\u6DF1\u8272\u8BED\u4E49\u8272\u5F15\u7528\u4E0D\u53EF\u89E3\u6790\uFF1Acolor.semanticDark.${group}.${name} = ${value}`);
            }
          } else if (!isHex(value) && !/^(?:rgba?|hsla?)\(|^transparent$/.test(value)) {
            errors.push(`\u65E0\u6CD5\u8BC6\u522B\u7684\u6DF1\u8272\u8BED\u4E49\u8272\u503C\uFF1Acolor.semanticDark.${group}.${name} = ${value}`);
          }
        }
      }
      validateColorSemantics(tokens, dark, "[dark] ", errors, warnings);
    }
  }
  try {
    flattenTokens(tokens);
    if (dark != null) flattenDarkSemantic(tokens);
  } catch (err) {
    errors.push(`token \u5C55\u5E73\u5931\u8D25\uFF1A${err.message}`);
    return null;
  }
  return true;
}
function resolveValue(tokens, path, semantic) {
  const [group, name] = path.split(".");
  const raw = semantic?.[group]?.[name];
  if (raw === void 0) return null;
  if (isPrimitiveRef(raw)) {
    const [g, s] = raw.split(".");
    return tokens.color.primitives[g]?.[s] ?? null;
  }
  return raw;
}
var CONTRAST_PAIRS = [
  ["text.primary", "bg.canvas", 4.5],
  ["text.primary", "bg.surface", 4.5],
  ["text.secondary", "bg.canvas", 4.5],
  ["text.muted", "bg.canvas", 3],
  ["action.primaryText", "action.primary", 4.5]
];
function validateColorSemantics(tokens, semantic, prefix, errors, warnings) {
  if (!semantic || typeof semantic !== "object") return;
  for (const [fg, bg, min] of CONTRAST_PAIRS) {
    const fgValue = resolveValue(tokens, fg, semantic);
    const bgValue = resolveValue(tokens, bg, semantic);
    if (!fgValue || !bgValue) continue;
    if (!parseHex(fgValue) || !parseHex(bgValue)) continue;
    const ratio = contrast(fgValue, bgValue);
    const label = `${prefix}${fg} \u5BF9\u6BD4 ${bg} = ${ratio.toFixed(2)}`;
    if (ratio < min) {
      if (min >= 4.5) errors.push(`\u5BF9\u6BD4\u5EA6\u4E0D\u8DB3\uFF1A${label}\uFF08\u8981\u6C42 \u2265 ${min}\uFF09`);
      else warnings.push(`\u5BF9\u6BD4\u5EA6\u504F\u4F4E\uFF1A${label}\uFF08\u5EFA\u8BAE \u2265 ${min}\uFF09`);
    }
  }
}

// src/designCustom.ts
var LIBRARY_DIR_NAME = "library";
function libraryDir(cwd) {
  return join2(projectDir(cwd), LIBRARY_DIR_NAME);
}
function customStyleDir(cwd, id) {
  assertSafeId(id);
  return join2(libraryDir(cwd), id);
}
function collectVars(text) {
  const out = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(/var\(\s*(--ts-[A-Za-z0-9-]+)/g)) out.add(match[1]);
  return out;
}
function stampLibrary(cwd) {
  const dir = libraryDir(cwd);
  if (!existsSync2(dir)) return "";
  const hash = createHash("sha1");
  const ids = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const id of ids) {
    if (!isSafeId(id)) continue;
    hash.update(id);
    for (const file of ["tokens.json", "meta.json"]) {
      const abs = join2(dir, id, file);
      hash.update(existsSync2(abs) ? readFileSync2(abs, "utf8") : "\0");
    }
  }
  return hash.digest("hex");
}
function readJson(file, label) {
  try {
    return JSON.parse(readFileSync2(file, "utf8"));
  } catch (err) {
    throw new InvalidInputError(`${label} \u4E0D\u662F\u5408\u6CD5 JSON\uFF1A${err.message}`);
  }
}
function sharedAssets(builtinDir, builtinId, iconStyle) {
  const dir = join2(builtinDir, "styles", builtinId);
  const componentsCss = readFileSync2(join2(dir, "components.css"), "utf8");
  const templates = readJson(join2(dir, "templates.json"), "templates.json");
  const raw = readJson(join2(dir, "icons.json"), "icons.json");
  return { componentsCss, templates, icons: { viewBox: raw.viewBox, stroke: iconStyle, icons: raw.icons } };
}
function assertCoversSharedVars(manifest, componentsCss, templates, errors) {
  const known = new Set(manifest.vars);
  const needed = collectVars(componentsCss);
  for (const tpl of Object.values(templates)) for (const v of collectVars(tpl.html)) needed.add(v);
  const missing = [...needed].filter((v) => !known.has(v));
  if (missing.length) {
    errors.push(`tokens \u7F3A\u5C11\u5171\u4EAB\u7EC4\u4EF6/\u6A21\u677F\u6240\u9700\u7684\u53D8\u91CF\uFF08\u4F1A\u6837\u5F0F\u60AC\u7A7A\uFF09\uFF1A${missing.slice(0, 8).join("\u3001")}${missing.length > 8 ? ` \u7B49 ${missing.length} \u4E2A` : ""}`);
  }
}
function loadCustomSummaries(cwd, builtinDir) {
  const dir = libraryDir(cwd);
  if (!existsSync2(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
    try {
      out.push(compileCustomStyle(cwd, entry.name, builtinDir).summary);
    } catch {
    }
  }
  return out;
}
function customStyleExists(cwd, id) {
  return isSafeId(id) && existsSync2(join2(libraryDir(cwd), id, "tokens.json"));
}
function compileCustomStyle(cwd, id, builtinDir) {
  const dir = customStyleDir(cwd, id);
  const tokensFile = join2(dir, "tokens.json");
  const metaFile = join2(dir, "meta.json");
  if (!existsSync2(tokensFile) || !existsSync2(metaFile)) {
    throw new InvalidInputError(`\u81EA\u5B9A\u4E49\u8BBE\u8BA1\u7CFB\u7EDF\u4E0D\u5B58\u5728\uFF1A${id}`);
  }
  const tokens = readJson(tokensFile, `${id}/tokens.json`);
  const meta = readJson(metaFile, `${id}/meta.json`);
  const iconStyle = meta.iconStyle;
  const contract = sharedContract(builtinDir);
  const shared = sharedAssets(builtinDir, contract.builtinId, iconStyle);
  const manifest = buildManifest(tokens, {
    icons: contract.iconNames,
    componentClasses: contract.componentClasses
  });
  const templates = shared.templates;
  const summary = {
    id,
    name: String(meta.name ?? id),
    tagline: String(meta.tagline ?? ""),
    description: String(meta.description ?? ""),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    swatches: Array.isArray(meta.swatches) ? meta.swatches.map(String) : [],
    fonts: tokens.font?.families ?? {},
    iconStyle,
    counts: { icons: manifest.iconNames.length, components: contract.componentCount, templates: Object.keys(templates).length },
    templates: Object.entries(templates).map(([tid, t]) => ({ id: tid, name: t.name, device: t.device }))
  };
  return {
    summary,
    tokensCss: tokensToCss(tokens),
    componentsCss: shared.componentsCss,
    manifest,
    icons: shared.icons,
    templates
  };
}
var sharedContractCache = /* @__PURE__ */ new Map();
function sharedContract(builtinDir) {
  const cached = sharedContractCache.get(builtinDir);
  if (cached) return cached;
  const index = readJson(join2(builtinDir, "index.json"), "design/index.json");
  const builtinId = index.styles[0]?.id;
  if (!builtinId) throw new Error("\u8BBE\u8BA1\u7CFB\u7EDF\u6784\u5EFA\u4EA7\u7269\u7F3A\u5931\uFF1Adist/design/index.json \u6CA1\u6709\u98CE\u683C");
  const dir = join2(builtinDir, "styles", builtinId);
  const manifest = readJson(join2(dir, "tokens.manifest.json"), "tokens.manifest.json");
  const icons = readJson(join2(dir, "icons.json"), "icons.json");
  const value = {
    builtinId,
    componentClasses: manifest.componentClasses,
    iconNames: Object.keys(icons.icons),
    componentCount: index.styles[0]?.counts?.components ?? 0
  };
  sharedContractCache.set(builtinDir, value);
  return value;
}
function writeJsonAtomic(file, value) {
  mkdirSync2(join2(file, ".."), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync2(tmp, JSON.stringify(value, null, 2).replace(/\r\n/g, "\n") + "\n", "utf8");
  renameSync2(tmp, file);
}
function createCustomStyle(cwd, id, tokensIn, metaIn, builtinDir, options) {
  if (!isSafeId(id)) {
    throw new InvalidInputError(`\u975E\u6CD5 id\uFF1A${String(id)}\uFF08\u4EC5\u5141\u8BB8\u5B57\u6BCD\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u3001\u8FDE\u5B57\u7B26\uFF0C1\u201364 \u4F4D\uFF09`);
  }
  if (options.builtinIds.includes(id)) {
    throw new InvalidInputError(`id\u300C${id}\u300D\u4E0E\u5185\u7F6E\u98CE\u683C\u51B2\u7A81\uFF0C\u8BF7\u6362\u4E00\u4E2A\u540D\u5B57\u3002`);
  }
  const exists = customStyleExists(cwd, id);
  if (exists && options.overwrite !== true) {
    throw new InvalidInputError(`\u81EA\u5B9A\u4E49\u8BBE\u8BA1\u7CFB\u7EDF\u300C${id}\u300D\u5DF2\u5B58\u5728\u3002\u82E5\u8981\u8986\u76D6\uFF0C\u8BF7\u4F20 overwrite=true\u3002`);
  }
  if (!tokensIn || typeof tokensIn !== "object" || Array.isArray(tokensIn)) {
    throw new InvalidInputError("\u7F3A\u5C11 tokens\uFF1A\u8BF7\u4F20\u5165\u5B8C\u6574 tokens \u5BF9\u8C61\uFF08\u89C1\u5DE5\u5177\u8BF4\u660E\uFF09\u3002");
  }
  const metaInObj = metaIn && typeof metaIn === "object" && !Array.isArray(metaIn) ? metaIn : {};
  const tokens = { ...tokensIn, schema: "tianshu-design-tokens/1", id };
  if (typeof tokens.version !== "number") tokens.version = 1;
  if (!tokens.modes || typeof tokens.modes !== "object") {
    tokens.modes = { light: true, dark: tokens.color?.semanticDark != null };
  }
  const iconStyle = metaInObj.iconStyle;
  if (!iconStyle || typeof iconStyle !== "object" || typeof iconStyle.strokeWidth !== "number") {
    throw new InvalidInputError("\u7F3A\u5C11 meta.iconStyle.strokeWidth\uFF08\u6570\u5B57\uFF0C\u5982 1.5 / 1.75\uFF09\u3002");
  }
  const meta = {
    id,
    name: String(metaInObj.name ?? id),
    tagline: String(metaInObj.tagline ?? ""),
    description: String(metaInObj.description ?? ""),
    tags: Array.isArray(metaInObj.tags) ? metaInObj.tags.map(String) : [],
    swatches: Array.isArray(metaInObj.swatches) ? metaInObj.swatches.map(String) : [],
    version: tokens.version,
    iconStyle,
    license: String(metaInObj.license ?? "\u672C\u9879\u76EE\u539F\u521B\u914D\u8272\uFF1B\u56FE\u6807\u4E3A\u5171\u4EAB\u7684\u901A\u7528\u7EBF\u6027\u51E0\u4F55\u56FE\u5F62\u3002"),
    notice: String(metaInObj.notice ?? "\u81EA\u5B9A\u4E49\u98CE\u683C\uFF1B\u4E0E\u5404\u54C1\u724C\u65E0\u96B6\u5C5E\u5173\u7CFB\u3002")
  };
  const errors = [];
  const warnings = [];
  validateTokens(tokens, id, errors, warnings);
  auditForbidden("meta.json", JSON.stringify(meta), errors);
  const contract = sharedContract(builtinDir);
  const manifest = errors.length === 0 ? buildManifest(tokens, { icons: contract.iconNames, componentClasses: contract.componentClasses }) : null;
  if (manifest) {
    const { componentsCss, templates } = sharedAssets(builtinDir, contract.builtinId, iconStyle);
    assertCoversSharedVars(manifest, componentsCss, templates, errors);
    const builtinManifest = readJson(
      join2(builtinDir, "styles", contract.builtinId, "tokens.manifest.json"),
      "tokens.manifest.json"
    );
    const known = new Set(manifest.vars);
    const missing = builtinManifest.vars.filter((v) => !known.has(v));
    if (missing.length) {
      errors.push(`tokens \u7F3A\u5C11\u5185\u7F6E\u98CE\u683C\u7684\u53D8\u91CF\uFF1A${missing.slice(0, 8).join("\u3001")}${missing.length > 8 ? ` \u7B49 ${missing.length} \u4E2A` : ""}`);
    }
  }
  if (errors.length) {
    throw new InvalidInputError(`\u8BBE\u8BA1\u7CFB\u7EDF\u6821\u9A8C\u5931\u8D25\uFF1A
${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
  const dir = customStyleDir(cwd, id);
  writeJsonAtomic(join2(dir, "tokens.json"), tokens);
  writeJsonAtomic(join2(dir, "meta.json"), meta);
  const summary = compileCustomStyle(cwd, id, builtinDir).summary;
  return { id, summary, warnings };
}
function removeCustomStyle(cwd, id) {
  if (!isSafeId(id)) throw new InvalidInputError(`\u975E\u6CD5 id\uFF1A${String(id)}`);
  const dir = join2(libraryDir(cwd), id);
  if (!existsSync2(dir)) throw new InvalidInputError(`\u81EA\u5B9A\u4E49\u8BBE\u8BA1\u7CFB\u7EDF\u4E0D\u5B58\u5728\uFF1A${id}`);
  rmSync2(dir, { recursive: true, force: true });
}

// src/design.ts
var DESIGN_DIR = fileURLToPath(new URL("./design/", import.meta.url));
var BLOCK_START = "<!--tianshu-ds:start";
var BLOCK_END = "<!--tianshu-ds:end-->";
var START_RE = /\n?<!--tianshu-ds:start[^>]*-->[\s\S]*?<!--tianshu-ds:end-->\n?/g;
var builtinCatalogCache = null;
var customCatalogCache = /* @__PURE__ */ new Map();
var styleCache = /* @__PURE__ */ new Map();
function readJson2(file) {
  return JSON.parse(readFileSync3(file, "utf8"));
}
function designDir() {
  return DESIGN_DIR;
}
function loadBuiltinCatalog() {
  if (builtinCatalogCache) return builtinCatalogCache;
  const file = join3(DESIGN_DIR, "index.json");
  if (!existsSync3(file)) {
    throw new Error("\u8BBE\u8BA1\u7CFB\u7EDF\u6784\u5EFA\u4EA7\u7269\u7F3A\u5931\uFF08dist/design/index.json\uFF09\uFF0C\u8BF7\u5148\u8FD0\u884C npm run build\u3002");
  }
  builtinCatalogCache = readJson2(file);
  return builtinCatalogCache;
}
function customStylesFor(cwd) {
  if (!cwd) return [];
  const stamp2 = stampLibrary(cwd);
  const cached = customCatalogCache.get(cwd);
  if (cached && cached.stamp === stamp2) return cached.styles;
  let styles = [];
  try {
    styles = loadCustomSummaries(cwd, DESIGN_DIR);
  } catch {
    styles = [];
  }
  customCatalogCache.set(cwd, { stamp: stamp2, styles });
  return styles;
}
function invalidateDesignCache(cwd) {
  customCatalogCache.delete(cwd);
  const prefix = `${cwd}\0`;
  for (const key of [...styleCache.keys()]) if (key.startsWith(prefix)) styleCache.delete(key);
}
function loadDesignCatalog(cwd) {
  const builtin = loadBuiltinCatalog();
  const custom = customStylesFor(cwd);
  if (custom.length === 0) return builtin;
  return { schemaVersion: builtin.schemaVersion, notice: builtin.notice, styles: [...builtin.styles, ...custom] };
}
function designStyleIds(cwd) {
  try {
    return loadDesignCatalog(cwd).styles.map((s) => s.id);
  } catch {
    return [];
  }
}
function designStyleExists(cwd, id) {
  return typeof id === "string" && designStyleIds(cwd).includes(id);
}
function designStyleSummary(cwd, id) {
  try {
    return loadDesignCatalog(cwd).styles.find((s) => s.id === id) ?? null;
  } catch {
    return null;
  }
}
function isBuiltinStyle(id) {
  return typeof id === "string" && designStyleIds().includes(id);
}
function resolveDesignStyle(cwd, id) {
  if (!designStyleExists(cwd, id)) return null;
  const key = `${cwd ?? "\0builtin"}\0${id}`;
  const cached = styleCache.get(key);
  if (cached) return cached;
  const summary = designStyleSummary(cwd, id);
  if (!summary) return null;
  let resolved;
  if (cwd && customStyleExists(cwd, id)) {
    resolved = compileCustomStyle(cwd, id, DESIGN_DIR);
  } else {
    const dir = join3(DESIGN_DIR, "styles", id);
    try {
      resolved = {
        summary,
        tokensCss: readFileSync3(join3(dir, "tokens.css"), "utf8"),
        componentsCss: readFileSync3(join3(dir, "components.css"), "utf8"),
        manifest: readJson2(join3(dir, "tokens.manifest.json")),
        icons: readJson2(join3(dir, "icons.json")),
        templates: readJson2(join3(dir, "templates.json"))
      };
    } catch (err) {
      throw new Error(`\u8BBE\u8BA1\u98CE\u683C\u300C${id}\u300D\u7684\u6784\u5EFA\u4EA7\u7269\u4E0D\u5B8C\u6574\uFF1A${err.message}`);
    }
  }
  styleCache.set(key, resolved);
  return resolved;
}
function stripDesign(html) {
  return html.replace(START_RE, "");
}
function maskSegments(html) {
  const mask2 = (text) => text.replace(/[^\n]/g, " ");
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, mask2).replace(/<!--[\s\S]*?-->/g, mask2);
}
function findInsertOffset(html) {
  const masked = maskSegments(html);
  const head = /<head\b[^>]*>/i.exec(masked);
  if (head) return head.index + head[0].length;
  const htmlTag = /<html\b[^>]*>/i.exec(masked);
  if (htmlTag) return htmlTag.index + htmlTag[0].length;
  return afterDoctype(html);
}
function escapeStyleText(css) {
  return css.replace(/<\/style/gi, "<\\/style");
}
var STYLE_OWNED_ICON_ATTRS = /\s(?:fill|stroke|stroke-width|stroke-linecap|stroke-linejoin)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
function buildIconSvg(attrs, body, set, viewBox) {
  const kept = attrs.replace(STYLE_OWNED_ICON_ATTRS, "").replace(/\s*\/\s*$/g, "").replace(/\s+/g, " ").trim();
  const hasViewBox = /\bviewBox\s*=/.test(kept);
  const stroke = `fill="none" stroke="currentColor" stroke-width="${set.stroke.strokeWidth}"` + (set.stroke.linecap ? ` stroke-linecap="${set.stroke.linecap}"` : "") + (set.stroke.linejoin ? ` stroke-linejoin="${set.stroke.linejoin}"` : "");
  const parts = [kept, hasViewBox ? "" : `viewBox="${viewBox}"`, stroke].filter(Boolean);
  return `<svg ${parts.join(" ")}>${body}</svg>`;
}
var ICON_SCAN = /<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->|<svg\b([^>]*?)(?:\/>|>[\s\S]*?<\/svg\s*>)/gi;
var ICON_ATTR = /\bdata-icon\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
var SCRIPT_ICON = /\bdata-icon\s*=\s*\\?["']([^"'\\]*)/gi;
function expandIcons(html, set) {
  const used = /* @__PURE__ */ new Set();
  const missing = /* @__PURE__ */ new Set();
  const inScripts = /* @__PURE__ */ new Set();
  const viewBox = set.viewBox || "0 0 24 24";
  const expanded = html.replace(ICON_SCAN, (whole, attrs) => {
    if (attrs === void 0) {
      if (/^<script/i.test(whole)) {
        for (const match of whole.matchAll(SCRIPT_ICON)) if (match[1]) inScripts.add(match[1]);
      }
      return whole;
    }
    const iconMatch = ICON_ATTR.exec(attrs);
    if (!iconMatch) return whole;
    const name = (iconMatch[1] ?? iconMatch[2] ?? "").trim();
    const body = set.icons[name];
    if (!body) {
      missing.add(name);
      return whole;
    }
    used.add(name);
    return buildIconSvg(attrs, body, set, viewBox);
  });
  return { html: expanded, usedIcons: [...used], missingIcons: [...missing], scriptIcons: [...inScripts] };
}
function injectDesign(html, styleId, cwd) {
  const stripped = stripDesign(html);
  if (styleId === null) {
    return { html: stripped, styleId: null, injected: false, usedIcons: [], missingIcons: [], scriptIcons: [] };
  }
  const style = resolveDesignStyle(cwd, styleId);
  if (!style) {
    return { html: stripped, styleId: null, injected: false, usedIcons: [], missingIcons: [], scriptIcons: [] };
  }
  const icons = expandIcons(stripped, style.icons);
  const block = `${BLOCK_START} style=${style.summary.id} version=${style.manifest.version}-->
<style id="tianshu-tokens" data-tianshu-ds="tokens" data-style="${style.summary.id}" data-version="${style.manifest.version}">${escapeStyleText(style.tokensCss)}</style>
<style id="tianshu-components" data-tianshu-ds="components">${escapeStyleText(style.componentsCss)}</style>
${BLOCK_END}
`;
  const offset = findInsertOffset(icons.html);
  const result = icons.html.slice(0, offset) + "\n" + block + icons.html.slice(offset);
  return {
    html: result,
    styleId: style.summary.id,
    injected: true,
    usedIcons: icons.usedIcons,
    missingIcons: icons.missingIcons,
    scriptIcons: icons.scriptIcons
  };
}

// src/designOps.ts
function currentStyleId(cwd) {
  return readProject(cwd).design?.styleId ?? null;
}
function applyProjectStyle(cwd, styleId) {
  if (styleId !== null && !designStyleExists(cwd, styleId)) {
    throw new InvalidInputError(`\u672A\u77E5\u7684\u8BBE\u8BA1\u98CE\u683C\uFF1A${styleId}\u3002\u53EF\u7528 canvas_style\uFF08action=list\uFF09\u67E5\u770B\u53EF\u9009\u98CE\u683C\u3002`);
  }
  if (projectIssue(cwd)) {
    throw new InvalidInputError("project.json \u5DF2\u635F\u574F\u6216\u542B\u65E0\u6548\u6761\u76EE\uFF0C\u8BF7\u5148\u4FEE\u590D\u540E\u518D\u5207\u6362\u8BBE\u8BA1\u98CE\u683C\u3002");
  }
  const project = readProject(cwd);
  if (styleId === null) {
    delete project.design;
  } else {
    const design = { styleId, updatedAt: Date.now() };
    project.design = design;
  }
  const missing = /* @__PURE__ */ new Set();
  const scriptIcons = /* @__PURE__ */ new Set();
  let pagesUpdated = 0;
  const now = Date.now();
  if (styleId !== null) {
    for (const node of project.nodes) {
      const html = readPageHtml(cwd, node.id);
      if (html === null || html.trim() === "") continue;
      const injected = injectDesign(html, styleId, cwd);
      for (const name of injected.missingIcons) missing.add(name);
      for (const name of injected.scriptIcons) scriptIcons.add(name);
      if (injected.html === html) continue;
      writePageHtml(cwd, node.id, injected.html);
      node.htmlRev = now;
      pagesUpdated++;
    }
  }
  writeProject(cwd, project);
  return {
    styleId,
    name: styleId === null ? null : designStyleSummary(cwd, styleId)?.name ?? styleId,
    pagesUpdated,
    missingIcons: [...missing],
    scriptIcons: [...scriptIcons]
  };
}
function templateDocument(cwd, styleId, templateId) {
  const style = resolveDesignStyle(cwd, styleId);
  if (!style) return null;
  const template = style.templates[templateId];
  if (!template) return null;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${template.name}</title>
</head>
<body>
${template.html.trim()}
</body>
</html>
`;
  return { html, device: template.device, name: template.name };
}

// src/extract.ts
import { existsSync as existsSync4, readFileSync as readFileSync4 } from "node:fs";

// src/cssParse.ts
var HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;
var FUNC_COLOR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/gi;
var COLOR_PROP = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline))*(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|text-decoration(?:-color)?|caret-color|accent-color|column-rule(?:-color)?)$/;
var NAMED_COLORS = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" ")
);
var CSS_WORD = /(?<![\w-])[a-z]+(?![\w-])/gi;
var VAR_REF = /var\(\s*(--ts-[A-Za-z0-9-]+)\s*\)/g;
var CLASS_ATTR_RE = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
var DATA_ICON = /data-icon\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
var EMPTY_SVG = /<svg\b([^>]*)>\s*<\/svg>/gi;
var SPACING_PROPS = /^(?:padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$/;
var RADIUS_PROP = /^border(?:-[a-z]+)*-radius$/;
var FONT_PROP = /^font-family$/;
function mask(text) {
  return text.replace(/[^\n]/g, " ");
}
function maskBalanced(text, pattern) {
  const out = text.split("");
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    for (let i = start; i < start + match[0].length; i++) if (out[i] !== "\n") out[i] = " ";
  }
  return out.join("");
}
function maskUrls(segment) {
  let out = maskBalanced(segment, /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi);
  out = maskBalanced(out, /\bdata:[^"')\s]+/gi);
  return out;
}
function styleSegments(maskedHtml) {
  const segments = [];
  for (const match of maskedHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const inner = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].indexOf(inner);
    segments.push({ start, text: inner.replace(/\/\*[\s\S]*?\*\//g, mask) });
  }
  for (const match of maskedHtml.matchAll(/(?<![\w-])style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const inner = match[1] ?? match[2] ?? "";
    const start = (match.index ?? 0) + match[0].indexOf(inner);
    segments.push({ start, text: inner });
  }
  return segments;
}
function declarations(text) {
  const out = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  const flush = (end) => {
    const body = text.slice(start, end);
    const colon = body.indexOf(":");
    if (colon > 0) {
      const prop = body.slice(0, colon).trim().toLowerCase();
      const raw = body.slice(colon + 1);
      const value = raw.replace(/\}+\s*$/, "").trim();
      if (prop && value) out.push({ prop, value, raw, offset: start + colon + 1 });
    }
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === ";" || ch === "}")) {
      flush(i);
      start = i + 1;
    } else if (depth === 0 && ch === "{") {
      start = i + 1;
    }
  }
  if (start < text.length) flush(text.length);
  return out;
}
function lineIndex(html) {
  const index = [0];
  for (let i = 0; i < html.length; i++) if (html[i] === "\n") index.push(i + 1);
  return index;
}
function lineOf(index, offset) {
  let lo = 0;
  let hi = index.length - 1;
  while (lo < hi) {
    const mid = lo + hi + 1 >> 1;
    if (index[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
function snippetAt(html, offset, length = 80) {
  const start = Math.max(0, offset);
  const lineEnd = html.indexOf("\n", start);
  const end = lineEnd === -1 ? Math.min(html.length, start + length) : Math.min(lineEnd, start + length);
  return html.slice(start, end).trim();
}
function pxValues(value) {
  if (/calc\(/i.test(value)) return [];
  const literal = value.replace(/var\([^)]*\)/gi, " ");
  const found = /* @__PURE__ */ new Set();
  for (const match of literal.matchAll(/(?<![\w.-])-?(\d+(?:\.\d+)?)px\b/g)) found.add(Number(match[1]));
  return [...found];
}

// src/resources.ts
var TAG_RESOURCE = /<(?:script|img|link|iframe|video|audio|source|embed|object)\b[^>]*?\b(?:src|href|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
var CSS_RESOURCE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi;
var INLINE = /^(?:data:|blob:|about:|#)/i;
function findBlockedResources(html) {
  const found = /* @__PURE__ */ new Set();
  for (const pattern of [TAG_RESOURCE, CSS_RESOURCE]) {
    for (const match of html.matchAll(pattern)) {
      const value = match.slice(1).find((group) => group !== void 0)?.trim();
      if (value && !INLINE.test(value)) found.add(value);
    }
  }
  return [...found];
}

// src/netFetch.ts
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
var FetchError = class extends Error {
};
var DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
var DEFAULT_DEADLINE_MS = 1e4;
var DEFAULT_MAX_REDIRECTS = 3;
var BLOCKED_V4 = [
  { base: 0, bits: 8 },
  // 0.0.0.0/8
  { base: 167772160, bits: 8 },
  // 10/8
  { base: 1681915904, bits: 10 },
  // 100.64/10 (CGNAT)
  { base: 2130706432, bits: 8 },
  // 127/8 (loopback)
  { base: 2851995648, bits: 16 },
  // 169.254/16 (link-local)
  { base: 2886729728, bits: 12 },
  // 172.16/12
  { base: 3221225472, bits: 24 },
  // 192.0.0/24
  { base: 3232235520, bits: 16 },
  // 192.168/16
  { base: 3323068416, bits: 15 },
  // 198.18/15 (benchmark)
  { base: 3758096384, bits: 4 },
  // 224/4 (multicast)
  { base: 4026531840, bits: 4 }
  // 240/4 (reserved)
];
function v4ToInt(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return NaN;
  return (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
}
function ipv4Blocked(ip) {
  const value = v4ToInt(ip);
  if (!Number.isFinite(value)) return true;
  for (const { base, bits } of BLOCKED_V4) {
    const mask2 = bits === 0 ? 0 : 4294967295 << 32 - bits >>> 0;
    if ((value & mask2) === (base & mask2)) return true;
  }
  return false;
}
function normalizeIp(raw) {
  const value = raw.trim().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped) return { family: 4, ip: mapped[1] };
  const family = isIP(value);
  if (family === 4) return { family: 4, ip: value };
  if (family === 6) return { family: 6, ip: value.toLowerCase() };
  return null;
}
function ipv6Blocked(ip) {
  const value = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (value === "::1" || value === "::") return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (/^f[cd]/.test(value)) return true;
  if (value.startsWith("2001:db8")) return true;
  return false;
}
function isBlockedIp(raw) {
  const parsed = normalizeIp(raw);
  if (!parsed) return true;
  return parsed.family === 4 ? ipv4Blocked(parsed.ip) : ipv6Blocked(parsed.ip);
}
async function assertUrlAllowed(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchError(`\u4E0D\u662F\u5408\u6CD5 URL\uFF1A${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError(`\u4EC5\u5141\u8BB8 http/https\uFF1A${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new FetchError("\u4E0D\u5141\u8BB8 URL \u5185\u5D4C\u51ED\u636E\uFF08user:pass@\uFF09\u3002");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new FetchError(`\u7981\u6B62\u8BBF\u95EE\u5185\u7F51/\u4FDD\u7559\u5730\u5740\uFF1A${host}`);
    return { url, address: host, family: isIP(host) };
  }
  const addresses = await resolveAll(host);
  if (addresses.length === 0) throw new FetchError(`\u65E0\u6CD5\u89E3\u6790\u4E3B\u673A\uFF1A${host}`);
  for (const addr of addresses) {
    if (isBlockedIp(addr.address)) throw new FetchError(`\u4E3B\u673A ${host} \u89E3\u6790\u5230\u5185\u7F51/\u4FDD\u7559\u5730\u5740\uFF1A${addr.address}`);
  }
  return { url, address: addresses[0].address, family: addresses[0].family };
}
function resolveAll(host) {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { all: true }, (err, addresses) => {
      if (err) reject(new FetchError(`DNS \u89E3\u6790\u5931\u8D25\uFF1A${host}\uFF08${err.message}\uFF09`));
      else resolve(addresses);
    });
  });
}
function requestOnce(target, options, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    const isHttps = target.url.protocol === "https:";
    const mod = isHttps ? https : http;
    const pinnedLookup = (_hostname, _opts, callback) => {
      callback(null, target.address, target.family);
    };
    const req = mod.request(
      {
        protocol: target.url.protocol,
        hostname: target.url.hostname.replace(/^\[|\]$/g, ""),
        port: target.url.port || (isHttps ? 443 : 80),
        path: target.url.pathname + target.url.search,
        method: "GET",
        // identity：不解压，避免 gzip 炸弹。
        headers: { "Accept-Encoding": "identity", "User-Agent": "tianshu-canvas", ...options.headers },
        lookup: pinnedLookup,
        ...isHttps ? { servername: target.url.hostname.replace(/^\[|\]$/g, "") } : {},
        signal
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(new FetchError(`\u54CD\u5E94\u8D85\u8FC7\u4F53\u79EF\u4E0A\u9650\uFF08${maxBytes} \u5B57\u8282\uFF09`));
            return;
          }
          chunks.push(chunk);
        });
        res.on(
          "end",
          () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })
        );
        res.on("error", reject);
      }
    );
    req.on("error", (err) => {
      if (signal.aborted) reject(new FetchError("\u6293\u53D6\u8D85\u65F6\u6216\u5DF2\u53D6\u6D88"));
      else reject(new FetchError(`\u8BF7\u6C42\u5931\u8D25\uFF1A${err.message}`));
    });
    req.end();
  });
}
async function fetchUrl(rawUrl, options = {}) {
  if (options.fetchImpl) return options.fetchImpl(rawUrl, options);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const deadline = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadline);
  timer.unref?.();
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const target = await assertUrlAllowed(current);
      const res = await requestOnce(target, options, maxBytes, controller.signal);
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        if (hop === maxRedirects) throw new FetchError(`\u91CD\u5B9A\u5411\u6B21\u6570\u8D85\u8FC7 ${maxRedirects} \u6B21`);
        current = new URL(String(res.headers.location), target.url).toString();
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        throw new FetchError(`HTTP ${res.status}\uFF1A${target.url.toString()}`);
      }
      const contentType = typeof res.headers["content-type"] === "string" ? res.headers["content-type"] : null;
      return { body: res.body, url: target.url.toString(), contentType };
    }
    throw new FetchError("\u91CD\u5B9A\u5411\u5904\u7406\u5F02\u5E38");
  } finally {
    clearTimeout(timer);
  }
}
async function fetchText(rawUrl, options = {}) {
  const result = await fetchUrl(rawUrl, options);
  return { text: result.body.toString("utf8"), url: result.url, contentType: result.contentType };
}

// src/extract.ts
var NEUTRAL_KEYS = ["0", "50", "100", "200", "300", "500", "700", "900"];
var BRAND_KEYS = ["100", "300", "500", "600", "700"];
var STATUS_KEYS = ["50", "500"];
var STATUS_GROUPS = ["success", "warning", "danger", "info"];
var SPACE_KEYS = ["0", "1", "2", "3", "4", "5", "6", "8", "10", "12", "16"];
var RADIUS_KEYS = ["none", "sm", "md", "lg", "xl", "full"];
var SIZE_KEYS = ["controlSm", "controlMd", "controlLg", "iconSm", "iconMd", "iconLg", "containerSm", "containerMd", "containerLg", "sidebar"];
var FALLBACK = {
  neutral: ["#ffffff", "#fafafa", "#f4f4f5", "#e4e4e7", "#d4d4d8", "#71717a", "#3f3f46", "#18181b"],
  brand500: "#2563eb",
  status: { success: "#15803d", warning: "#b45309", danger: "#dc2626", info: "#1d4ed8" },
  fontSizes: [11, 12, 14, 17, 21, 26, 34, 48],
  space: [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64],
  radius: [0, 6, 10, 14, 20, 9999],
  shadow: {
    sm: "0 1px 2px rgba(0,0,0,0.04)",
    md: "0 4px 16px rgba(0,0,0,0.08)",
    lg: "0 12px 40px rgba(0,0,0,0.12)"
  },
  families: {
    sans: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    display: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
  }
};
function toHex({ r, g, b }) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
function parseColor(value) {
  const text = value.trim();
  const hex = parseHex(text);
  if (hex) return { r: hex[0], g: hex[1], b: hex[2] };
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(text);
  if (hsl) {
    const [h, s, l] = [Number(hsl[1]) / 360, Number(hsl[2]) / 100, Number(hsl[3]) / 100];
    return hslToRgb(h, s, l);
  }
  return null;
}
function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255 };
}
function rgbToHsl({ r, g, b }) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return { h, s, l };
}
function luminanceOf(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ensureContrast(fgHex, bgHex, min) {
  const bgLum = luminanceOf(bgHex);
  const darken2 = bgLum > 0.5;
  let current = parseColor(fgHex);
  if (!current) return fgHex;
  for (let i = 0; i < 200; i++) {
    if (contrast(toHex(current), bgHex) >= min) break;
    const step = darken2 ? -6 : 6;
    current = { r: current.r + step, g: current.g + step, b: current.b + step };
    if (current.r <= 0 && current.g <= 0 && current.b <= 0) break;
    if (current.r >= 255 && current.g >= 255 && current.b >= 255) break;
  }
  return toHex(current);
}
function mix(aHex, bHex, t) {
  const a = parseColor(aHex);
  const b = parseColor(bHex);
  return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}
function darken(hex, amount) {
  return mix(hex, "#000000", amount);
}
var COLOR_HINT = /\b(?:color|background|border|fill|stroke|shadow|outline|accent|caret)\b/i;
var COLOR_FN = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/gi;
var COLOR_FN_TEST = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/i;
var READABLE_SELECTOR = /(?:^|[\s,{])(?:body|html|:root|\.btn|\.button|button|\.primary|\.link|a)\b/i;
function collectFromCss(css, into, weightBoost = 1) {
  const segments = styleSegments(css);
  const sources = segments.length ? segments : [{ start: 0, text: css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")) }];
  for (const segment of sources) {
    const boost = READABLE_SELECTOR.test(segment.text) ? weightBoost * 3 : weightBoost;
    for (const decl of declarations(segment.text)) {
      const prop = decl.prop;
      if (COLOR_HINT.test(prop) || COLOR_FN_TEST.test(decl.raw)) {
        for (const match of decl.raw.matchAll(COLOR_FN)) {
          const rgb = parseColor(match[0]);
          if (rgb) into.colors.push({ hex: toHex(rgb), weight: boost });
        }
      }
      if (prop === "font-size") {
        const px = firstPx(decl.value);
        if (px !== null) into.fontSizes.push(px);
      } else if (RADIUS_PROP.test(prop)) {
        for (const px of pxList(decl.value)) into.radii.push(px);
      } else if (SPACING_PROPS.test(prop)) {
        for (const px of pxList(decl.value)) if (px > 0) into.spaces.push(px);
      } else if (prop === "font-family") {
        const first = decl.value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
        if (first) into.families.push(decl.value.trim());
      } else if (prop === "box-shadow" && !/url\(|@import|https?:/i.test(decl.value)) {
        into.shadows.push(decl.value);
      } else if (prop === "font-weight") {
        const w = Number(decl.value);
        if (Number.isFinite(w) && w >= 100 && w <= 900) into.weights.push(w);
      }
      const stroke = /^stroke-width$/.test(prop) ? /([\d.]+)/.exec(decl.value) : null;
      if (stroke) into.iconStroke = Number(stroke[1]);
    }
  }
}
function firstPx(value) {
  const list = pxList(value);
  return list.length ? list[0] : null;
}
function pxList(value) {
  if (/calc\(/i.test(value)) return [];
  const found = [];
  for (const match of value.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px\b/g)) found.push(Number(match[1]));
  return found;
}
function collectFromHtml(html) {
  const links = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    if (/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(match[0])) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
      const ref = (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
      if (ref) links.push(ref);
    }
  }
  return { css: html, links };
}
async function gather(input, warnings) {
  let htmlText = null;
  let cssText = "";
  if (typeof input.source === "string" && input.source.trim()) {
    if (/<[a-z!/]/i.test(input.source)) htmlText = input.source;
    else cssText = input.source;
  } else if (input.file) {
    if (!existsSync4(input.file)) throw new Error(`\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${input.file}`);
    const text = readFileSync4(input.file, "utf8");
    if (/\.css$/i.test(input.file) || !/<[a-z!/]/i.test(text)) cssText = text;
    else htmlText = text;
  } else if (input.url) {
    const result = await fetchText(input.url, { fetchImpl: input.fetchImpl });
    htmlText = result.text;
  } else {
    throw new Error("\u7F3A\u5C11\u8F93\u5165\uFF1A\u8BF7\u63D0\u4F9B source\uFF08\u5185\u8054 HTML/CSS\uFF09\u3001file\uFF08\u6587\u4EF6\u8DEF\u5F84\uFF09\u6216 url\u3002");
  }
  const parts = [];
  if (cssText) parts.push(cssText);
  if (htmlText) {
    const { css, links } = collectFromHtml(htmlText);
    parts.push(css);
    const base = input.url;
    for (const href of links.slice(0, 3)) {
      try {
        const abs = base ? new URL(href, base).toString() : href;
        if (!/^https?:/i.test(abs)) continue;
        const res = await fetchText(abs, { fetchImpl: input.fetchImpl });
        parts.push(res.text);
      } catch (err) {
        warnings.push(`\u5916\u90E8\u6837\u5F0F\u8868\u6293\u53D6\u5931\u8D25\uFF1A${href}\uFF08${err.message}\uFF09`);
      }
    }
  }
  return { cssText: parts.join("\n"), htmlText };
}
function neutralRamp(colors) {
  const observed = /* @__PURE__ */ new Map();
  for (const c of colors) {
    const hsl = rgbToHsl(parseColor(c.hex));
    if (hsl.s < 0.12) observed.set(c.hex, (observed.get(c.hex) ?? 0) + c.weight);
  }
  const unique = [...observed.keys()].sort((a, b) => luminanceOf(b) - luminanceOf(a));
  if (unique.length >= 8) {
    const picked = NEUTRAL_KEYS.map((_, i) => unique[Math.round(i * (unique.length - 1) / (NEUTRAL_KEYS.length - 1))]);
    return picked.map((hex) => ({ hex, observed: true }));
  }
  if (unique.length >= 2) {
    const light = unique[0];
    const dark = unique[unique.length - 1];
    return NEUTRAL_KEYS.map((_, i) => {
      if (i === 0) return { hex: light, observed: true };
      if (i === NEUTRAL_KEYS.length - 1) return { hex: dark, observed: true };
      const t = i / (NEUTRAL_KEYS.length - 1);
      return { hex: mix(light, dark, t), observed: false };
    });
  }
  return FALLBACK.neutral.map((hex) => ({ hex, observed: false }));
}
function pickStatus(colors) {
  const bands = {
    success: [80, 170],
    warning: [30, 70],
    danger: [330, 360],
    info: [180, 260]
  };
  const out = {};
  for (const group of STATUS_GROUPS) {
    const [lo, hi] = bands[group];
    const inBand = colors.filter((c) => {
      const hsl = rgbToHsl(parseColor(c.hex));
      if (hsl.s < 0.2 || hsl.l > 0.8 || hsl.l < 0.15) return false;
      const deg = hsl.h * 360;
      return group === "danger" ? deg >= lo || deg <= 20 : deg >= lo && deg <= hi;
    });
    if (inBand.length) {
      const best = inBand.sort((a, b) => b.weight - a.weight || a.hex.localeCompare(b.hex))[0];
      out[group] = { hex: best.hex, observed: true };
    } else {
      out[group] = { hex: FALLBACK.status[group], observed: false };
    }
  }
  return out;
}
function pickBrand(colors) {
  const colored = colors.filter((c) => {
    const hsl = rgbToHsl(parseColor(c.hex));
    return hsl.s >= 0.2 && hsl.l > 0.15 && hsl.l < 0.8;
  });
  if (!colored.length) return { hex: FALLBACK.brand500, observed: false };
  const best = colored.sort((a, b) => b.weight - a.weight || a.hex.localeCompare(b.hex))[0];
  return { hex: best.hex, observed: true };
}
async function extractTokens(input) {
  const warnings = [];
  const { cssText, htmlText } = await gather(input, warnings);
  if (!cssText.trim()) warnings.push("\u672A\u4ECE\u8F93\u5165\u4E2D\u89E3\u6790\u5230\u4EFB\u4F55 CSS\uFF1B\u5C06\u751F\u6210\u4E00\u5957\u4E2D\u6027\u9ED8\u8BA4\u8BBE\u8BA1\u7CFB\u7EDF\u3002");
  const analysis = { colors: [], fontSizes: [], radii: [], spaces: [], families: [], shadows: [], weights: [], iconStroke: null };
  collectFromCss(cssText, analysis);
  if (analysis.colors.length === 0 && analysis.fontSizes.length === 0) {
    warnings.push("\u672A\u89E3\u6790\u5230\u4EFB\u4F55\u989C\u8272\u6216\u5B57\u53F7\u58F0\u660E\uFF1B\u5C06\u751F\u6210\u4E00\u5957\u4E2D\u6027\u9ED8\u8BA4\u8BBE\u8BA1\u7CFB\u7EDF\uFF08\u53EF\u5728\u8FD4\u56DE\u7684 tokens \u57FA\u7840\u4E0A\u518D\u8C03\uFF09\u3002");
  }
  let observed = 0;
  let synthesized = 0;
  const report = [];
  const mark = (isObserved) => {
    if (isObserved) {
      observed++;
      return "observed";
    }
    synthesized++;
    return "synthesized";
  };
  const neutral = neutralRamp(analysis.colors);
  const neutralHex = neutral.map((n) => n.hex);
  for (const n of neutral) mark(n.observed);
  report.push(`neutral  ${NEUTRAL_KEYS.map((k, i) => `${k}=${neutralHex[i]}`).join(" ")}`);
  const brand = pickBrand(analysis.colors);
  mark(brand.observed);
  const brandScale = {
    "100": mix(brand.hex, "#ffffff", 0.85),
    "300": mix(brand.hex, "#ffffff", 0.45),
    "500": brand.hex,
    "600": darken(brand.hex, 0.08),
    "700": darken(brand.hex, 0.18)
  };
  report.push(`brand    500=${brandScale["500"]}\uFF08${brand.observed ? "observed" : "synthesized"}\uFF09`);
  const status = pickStatus(analysis.colors);
  const statusScale = {};
  for (const group of STATUS_GROUPS) {
    const base = status[group];
    mark(base.observed);
    statusScale[group] = { "50": mix(base.hex, "#ffffff", 0.9), "500": base.hex };
  }
  report.push(`status   ${STATUS_GROUPS.map((g) => `${g}=${statusScale[g]["500"]}`).join(" ")}`);
  const isDark = luminanceOf(neutralHex[NEUTRAL_KEYS.length - 1]) > 0.4 && luminanceOf(neutralHex[0]) < 0.25;
  const lightEnd = isDark ? neutralHex[0] : neutralHex[0];
  const darkEnd = isDark ? neutralHex[NEUTRAL_KEYS.length - 1] : neutralHex[NEUTRAL_KEYS.length - 1];
  const bgCanvas = isDark ? darkEnd : lightEnd;
  const bgSurface = isDark ? mix(darkEnd, "#000000", 0.15) : "#ffffff";
  const textPrimaryRaw = isDark ? mix(lightEnd, "#ffffff", 0.6) : mix(darkEnd, "#000000", 0.1);
  const textPrimary = ensureContrast(textPrimaryRaw, bgCanvas, 4.5);
  const textPrimaryFixed = ensureContrast(textPrimary, bgSurface, 4.5);
  const textSecondary = ensureContrast(mix(textPrimaryFixed, bgCanvas, 0.25), bgCanvas, 4.5);
  const textMuted = ensureContrast(mix(textPrimaryFixed, bgCanvas, 0.5), bgCanvas, 3);
  const actionPrimary = ensureContrast(brandScale["500"], isDark ? "#111111" : "#ffffff", 4.5);
  const primitive = (group, step) => `${group}.${step}`;
  neutralHex[NEUTRAL_KEYS.indexOf(isDark ? "900" : "0")] = isDark ? bgSurface : "#ffffff";
  neutralHex[NEUTRAL_KEYS.indexOf(isDark ? "0" : "900")] = isDark ? textPrimaryFixed : textPrimaryFixed;
  neutralHex[NEUTRAL_KEYS.indexOf("700")] = textSecondary;
  neutralHex[NEUTRAL_KEYS.indexOf("500")] = textMuted;
  brandScale["500"] = actionPrimary;
  brandScale["600"] = darken(actionPrimary, 0.08);
  const sizeRamp = analysis.fontSizes.filter((n) => n > 0).sort((a, b) => a - b);
  const uniqSizes = [...new Set(sizeRamp)];
  let sizes;
  if (uniqSizes.length >= 4) {
    const picked = FALLBACK.fontSizes.map((d, i) => uniqSizes[Math.round(i * (uniqSizes.length - 1) / (FALLBACK.fontSizes.length - 1))] ?? d);
    sizes = monotonic(picked, FALLBACK.fontSizes);
    mark(true);
  } else {
    sizes = FALLBACK.fontSizes;
    mark(false);
  }
  report.push(`fontSize ${sizes.join(" ")}`);
  const radiiRaw = [...new Set(analysis.radii.filter((n) => n >= 0))].sort((a, b) => a - b);
  const radius = monotonic(
    radiiRaw.length >= 3 ? RADIUS_KEYS.map((_, i) => radiiRaw[Math.min(radiiRaw.length - 1, Math.round((i + 1) / RADIUS_KEYS.length * radiiRaw.length))] ?? FALLBACK.radius[i]) : FALLBACK.radius,
    FALLBACK.radius
  );
  radius[RADIUS_KEYS.length - 1] = 9999;
  report.push(`radius   ${RADIUS_KEYS.map((k, i) => `${k}=${radius[i]}`).join(" ")}`);
  const spaceUnit = analysis.spaces.length ? Math.min(Math.max(Math.min(...analysis.spaces), 2), 8) : 4;
  const space = FALLBACK.space.map((v, i) => i === 0 ? 0 : Math.round(v * spaceUnit / 4));
  report.push(`space    ${SPACE_KEYS.map((k, i) => `${k}=${space[i]}`).join(" ")}`);
  const families = pickFamilies(analysis.families);
  const weightSet = pickWeights(analysis.weights);
  const shadow = analysis.shadows.length >= 1 ? buildShadows(analysis.shadows) : FALLBACK.shadow;
  const iconStroke = analysis.iconStroke !== null ? Math.max(1, Math.min(2, analysis.iconStroke)) : 1.5;
  const tokens = {
    primitiveColors: {
      neutral: zip(NEUTRAL_KEYS, neutralHex),
      brand: zip(BRAND_KEYS, BRAND_KEYS.map((k) => brandScale[k])),
      ...Object.fromEntries(STATUS_GROUPS.map((g) => [g, zip(STATUS_KEYS, STATUS_KEYS.map((k) => statusScale[g][k]))]))
    },
    semantic: buildSemantic({
      isDark,
      neutral: neutralHex,
      brand: brandScale,
      status: statusScale,
      primitive
    }),
    font: {
      families,
      sizes: zip(FALLBACK.fontSizes.map((_, i) => ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"][i]), sizes),
      weights: weightSet,
      lineHeights: { tight: 1.15, snug: 1.3, normal: 1.45, relaxed: 1.65 },
      letterSpacing: { tight: "-0.02em", normal: "0", wide: "0.06em" }
    },
    space: zip(SPACE_KEYS, space),
    radius: zip(RADIUS_KEYS, radius),
    borderWidth: { hairline: 1, thin: 1.5, thick: 2 },
    shadow,
    size: zip(SIZE_KEYS, [28, 36, 44, 14, 18, 22, 640, 960, 1200, 248]),
    motion: { fast: "120ms", base: "200ms", easing: "cubic-bezier(.2,.7,.3,1)" }
  };
  const out = {
    color: { primitives: tokens.primitiveColors, semantic: tokens.semantic },
    font: tokens.font,
    space: tokens.space,
    radius: tokens.radius,
    borderWidth: tokens.borderWidth,
    shadow: tokens.shadow,
    size: tokens.size,
    motion: tokens.motion
  };
  report.push(`\u5BF9\u6BD4\u5EA6\uFF1Atext.primary/bg.canvas=${contrast(textPrimaryFixed, bgCanvas).toFixed(2)}\uFF0Caction.primaryText/action.primary=${contrast("#ffffff", actionPrimary).toFixed(2)}`);
  if (htmlText) {
    const blocked = findBlockedResources(htmlText);
    if (blocked.length) warnings.push(`\u6E90\u9875\u9762\u6709 ${blocked.length} \u5904\u5916\u94FE\u8D44\u6E90\uFF08\u4E0D\u5F71\u54CD\u98CE\u683C\u62BD\u53D6\uFF0C\u4F46\u7528\u4E8E\u539F\u578B\u65F6\u9700\u5185\u8054\uFF09\u3002`);
  }
  return {
    tokens: out,
    iconStyle: { strokeWidth: iconStroke, linecap: "round", linejoin: "round" },
    report,
    warnings,
    observed,
    synthesized
  };
}
function monotonic(values, fallback) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const candidate = Number.isFinite(values[i]) && values[i] > 0 ? Math.round(values[i]) : Math.round(fallback[i] ?? i + 1);
    const prev = out[out.length - 1];
    out.push(prev === void 0 || candidate > prev ? candidate : prev + Math.max(1, Math.round(candidate * 0.1)));
  }
  return out;
}
function zip(keys, values) {
  const out = {};
  keys.forEach((k, i) => {
    out[k] = values[i];
  });
  return out;
}
function pickFamilies(observed) {
  const sans = observed[0] ?? FALLBACK.families.sans;
  const monoObserved = observed.find((f) => /mono|consol|menlo|courier/i.test(f));
  return { sans, display: sans, mono: monoObserved ?? FALLBACK.families.mono };
}
function pickWeights(observed) {
  const has = (w) => observed.some((o) => Math.abs(o - w) <= 50);
  return {
    regular: has(400) ? 400 : 400,
    medium: observed.find((o) => o >= 450 && o <= 550) ?? 500,
    semibold: observed.find((o) => o >= 560 && o <= 640) ?? 600,
    bold: observed.find((o) => o >= 650) ?? 700
  };
}
function buildShadows(observed) {
  const clean = observed.filter((s) => !/url\(|@import|https?:/i.test(s));
  const pick = (i) => clean[Math.min(i, clean.length - 1)] ?? FALLBACK.shadow[["sm", "md", "lg"][i]];
  return { sm: pick(0), md: pick(1), lg: pick(2) };
}
function buildSemantic(ctx) {
  const n = (step) => ctx.primitive("neutral", step);
  const b = (step) => ctx.primitive("brand", step);
  const s = (group, step) => ctx.primitive(group, step);
  const N = ctx.neutral;
  const light = (i) => n(NEUTRAL_KEYS[i]);
  const D = ctx.isDark;
  return {
    bg: {
      canvas: D ? light(NEUTRAL_KEYS.length - 1) : light(0),
      surface: D ? light(NEUTRAL_KEYS.length - 2) : light(0),
      raised: D ? light(NEUTRAL_KEYS.length - 2) : light(0),
      sunken: D ? light(0) : light(2),
      inverse: D ? light(0) : light(NEUTRAL_KEYS.length - 1)
    },
    text: {
      primary: D ? light(0) : light(NEUTRAL_KEYS.length - 1),
      secondary: n("700"),
      muted: n("500"),
      inverse: D ? light(NEUTRAL_KEYS.length - 1) : light(0),
      link: b("500")
    },
    border: {
      default: D ? light(3) : light(3),
      strong: D ? light(2) : light(4),
      subtle: D ? light(4) : light(2),
      focus: b("500")
    },
    action: {
      primary: b("500"),
      primaryHover: b("600"),
      primaryText: D ? n("900") : n("0"),
      secondary: D ? light(2) : light(2),
      secondaryHover: D ? light(3) : light(3),
      secondaryText: D ? light(0) : light(NEUTRAL_KEYS.length - 1),
      ghostHover: b("100"),
      danger: s("danger", "500"),
      dangerText: D ? n("900") : n("0")
    },
    status: {
      success: s("success", "500"),
      successBg: s("success", "50"),
      warning: s("warning", "500"),
      warningBg: s("warning", "50"),
      danger: s("danger", "500"),
      dangerBg: s("danger", "50"),
      info: s("info", "500"),
      infoBg: s("info", "50")
    },
    chart: {
      "1": b("500"),
      "2": s("success", "500"),
      "3": s("warning", "500"),
      "4": s("info", "500"),
      "5": s("danger", "500")
    },
    overlay: { scrim: "rgba(0,0,0,0.4)" }
  };
}

// src/inlineAssets.ts
var DEFAULT_MAX_PER = 2 * 1024 * 1024;
var DEFAULT_MAX_TOTAL = 8 * 1024 * 1024;
var TEXT_TYPES = /* @__PURE__ */ new Set(["text/css", "text/javascript", "application/javascript", "image/svg+xml"]);
var EXT_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json"
};
function mimeFor(ref, contentType) {
  const fromHeader = contentType?.split(";")[0]?.trim().toLowerCase();
  const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(ref)?.[1]?.toLowerCase();
  return (fromHeader && fromHeader !== "application/octet-stream" ? fromHeader : void 0) ?? (ext && EXT_MIME[ext]) ?? "application/octet-stream";
}
function toDataUri(body, mime) {
  if (TEXT_TYPES.has(mime)) {
    return `data:${mime};charset=utf-8,${encodeURIComponent(body.toString("utf8"))}`;
  }
  return `data:${mime};base64,${body.toString("base64")}`;
}
function escapeScript(text) {
  return text.replace(/<\/script/gi, "<\\/script");
}
function escapeStyle(text) {
  return text.replace(/<\/style/gi, "<\\/style");
}
async function inlineCssUrls(css, ctx) {
  const refs = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi)];
  let out = css;
  for (const match of refs) {
    const ref = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!ref || /^(?:data:|blob:|about:|#)/i.test(ref)) continue;
    const uri = await inlineOne(ref, ctx);
    if (uri) out = out.replaceAll(match[0], `url("${uri}")`);
  }
  return out;
}
function resolveRef(ref, ctx) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
    return /^https?:/i.test(ref) ? ref : null;
  }
  if (!ctx.origin) return null;
  try {
    return new URL(ref, ctx.origin).toString();
  } catch {
    return null;
  }
}
async function inlineOne(ref, ctx) {
  const abs = resolveRef(ref, ctx);
  if (!abs) {
    ctx.skipped.push({ ref, reason: ctx.origin ? "\u4E0D\u652F\u6301\u7684\u8D44\u6E90\u7C7B\u578B" : "\u76F8\u5BF9\u8DEF\u5F84\u4F46\u672A\u63D0\u4F9B origin" });
    return null;
  }
  const remaining = ctx.maxTotalBytes - ctx.used.total;
  if (remaining <= 0) {
    ctx.skipped.push({ ref, reason: "\u5DF2\u8FBE\u7D2F\u8BA1\u4F53\u79EF\u4E0A\u9650" });
    return null;
  }
  try {
    const result = await fetchUrl(abs, {
      maxBytes: Math.min(ctx.maxBytesPer, remaining),
      fetchImpl: ctx.fetchImpl
    });
    ctx.used.total += result.body.length;
    ctx.inlined++;
    return toDataUri(result.body, mimeFor(abs, result.contentType));
  } catch (err) {
    ctx.skipped.push({ ref, reason: err.message });
    return null;
  }
}
async function inlineAssets(html, options = {}) {
  const ctx = {
    origin: options.origin,
    maxBytesPer: options.maxBytesPer ?? DEFAULT_MAX_PER,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL,
    used: { total: 0 },
    fetchImpl: options.fetchImpl,
    inlined: 0,
    skipped: []
  };
  const blockedAtStart = findBlockedResources(html);
  let out = html;
  for (const match of [...out.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]) {
    const ref = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!ref || /^(?:data:|blob:|about:|#)/i.test(ref)) continue;
    const uri = await inlineOne(ref, ctx);
    if (uri) out = out.replace(match[0], match[0].replace(ref, uri));
  }
  for (const match of [...out.matchAll(/<link\b[^>]*>/gi)]) {
    const tag = match[0];
    if (!/\brel\s*=\s*(?:"[^"]*stylesheet[^"]*"|'[^']*stylesheet[^']*'|stylesheet)/i.test(tag)) continue;
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const ref = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim();
    if (!ref || /^(?:data:|blob:|about:|#)/i.test(ref)) continue;
    const abs = resolveRef(ref, ctx);
    if (!abs) {
      ctx.skipped.push({ ref, reason: ctx.origin ? "\u4E0D\u652F\u6301\u7684\u8D44\u6E90\u7C7B\u578B" : "\u76F8\u5BF9\u8DEF\u5F84\u4F46\u672A\u63D0\u4F9B origin" });
      continue;
    }
    try {
      const result = await fetchUrl(abs, { maxBytes: ctx.maxBytesPer, fetchImpl: ctx.fetchImpl });
      ctx.used.total += result.body.length;
      const css = await inlineCssUrls(result.body.toString("utf8"), ctx);
      out = out.replace(tag, `<style>${escapeStyle(css)}</style>`);
      ctx.inlined++;
    } catch (err) {
      ctx.skipped.push({ ref, reason: err.message });
    }
  }
  for (const match of [...out.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>\s*<\/script>/gi)]) {
    const ref = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!ref || /^(?:data:|blob:|about:|#)/i.test(ref)) continue;
    const abs = resolveRef(ref, ctx);
    if (!abs) {
      ctx.skipped.push({ ref, reason: ctx.origin ? "\u4E0D\u652F\u6301\u7684\u8D44\u6E90\u7C7B\u578B" : "\u76F8\u5BF9\u8DEF\u5F84\u4F46\u672A\u63D0\u4F9B origin" });
      continue;
    }
    try {
      const result = await fetchUrl(abs, { maxBytes: ctx.maxBytesPer, fetchImpl: ctx.fetchImpl });
      ctx.used.total += result.body.length;
      out = out.replace(match[0], `<script>${escapeScript(result.body.toString("utf8"))}</script>`);
      ctx.inlined++;
    } catch (err) {
      ctx.skipped.push({ ref, reason: err.message });
    }
  }
  out = await replaceStyleBlocks(out, ctx);
  const handledRefs = /* @__PURE__ */ new Set([...ctx.skipped.map((s) => s.ref)]);
  for (const ref of blockedAtStart) {
    if (handledRefs.has(ref)) continue;
    if (out.includes(ref)) {
      ctx.skipped.push({ ref, reason: "\u4E0D\u652F\u6301\u7684\u8D44\u6E90\u7C7B\u578B\uFF08\u672A\u5185\u8054\uFF09" });
    }
  }
  return { html: out, inlined: ctx.inlined, skipped: ctx.skipped };
}
async function replaceStyleBlocks(html, ctx) {
  let out = html;
  const styleBlocks = [...out.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
  for (const match of styleBlocks) {
    const inner = match[1] ?? "";
    const replaced = await inlineCssUrls(inner, ctx);
    if (replaced !== inner) {
      out = out.replace(match[0], match[0].replace(inner, escapeStyle(replaced)));
    }
  }
  const styleAttrs = [...out.matchAll(/(?<![\w-])style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)];
  for (const match of styleAttrs) {
    const inner = match[1] ?? match[2] ?? "";
    const replaced = await inlineCssUrls(inner, ctx);
    if (replaced !== inner) out = out.replace(match[0], match[0].replace(inner, replaced));
  }
  return out;
}

// src/lint.ts
var MAX_FINDINGS = 40;
var RULES = ["color", "font", "spacing", "radius", "icon", "component", "token", "resource"];
function nearest(values, target) {
  const sorted = [...values].sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
  return sorted.slice(0, 2);
}
function nearestTokenHint(kind, value, manifest) {
  const pool = kind === "space" ? manifest.spacing : manifest.radius;
  const close = nearest(pool, value);
  return close.map((v) => `--ts-${kind === "space" ? "space" : "radius"}-${keyFor(pool, v, kind)}`).join(" / ");
}
function keyFor(pool, value, kind) {
  const names = kind === "radius" ? { 0: "none", 4: "sm", 6: "sm", 8: "md", 10: "md", 12: "lg", 14: "lg", 16: "xl", 18: "xl", 20: "xl", 9999: "full" } : {};
  return names[value] ?? String(value);
}
function lintHtml(html, styleId, cwd) {
  const counts = Object.fromEntries(RULES.map((r) => [r, 0]));
  const findings = [];
  const index = lineIndex(html);
  const add = (rule, offset, message) => {
    counts[rule]++;
    if (findings.length < MAX_FINDINGS) {
      findings.push({ rule, line: lineOf(index, offset), message, snippet: snippetAt(html, offset) });
    }
  };
  const blocked = findBlockedResources(html);
  if (blocked.length) {
    const first = blocked[0];
    const at = Math.max(0, html.indexOf(first));
    add("resource", at, `\u5C06\u88AB\u753B\u5E03 CSP \u62E6\u622A\uFF1A${blocked.slice(0, 3).join("\u3001")}${blocked.length > 3 ? ` \u7B49 ${blocked.length} \u5904` : ""}`);
  }
  const style = styleId ? resolveDesignStyle(cwd, styleId) : null;
  if (!style) {
    return { styleId: null, findings, counts, truncated: counts.resource > MAX_FINDINGS, total: counts.resource };
  }
  const manifest = style.manifest;
  const varSet = new Set(manifest.vars);
  const iconSet = new Set(manifest.iconNames);
  const classSet = new Set(manifest.componentClasses);
  const familySet = new Set(manifest.fontFamilies.map((f) => f.split(",")[0].trim().replace(/^['"]|['"]$/g, "").toLowerCase()));
  const spacing = new Set(manifest.spacing);
  const radius = new Set(manifest.radius);
  let masked = html.replace(/<!--tianshu-ds:start[^>]*-->[\s\S]*?<!--tianshu-ds:end-->/g, mask).replace(/<script\b[\s\S]*?<\/script>/gi, mask).replace(/<!--[\s\S]*?-->/g, mask);
  masked = maskUrls(masked);
  for (const match of masked.matchAll(VAR_REF)) {
    const name = match[1];
    if (!varSet.has(name)) add("token", match.index ?? 0, `\u672A\u77E5 token\uFF1A${name}`);
  }
  for (const segment of styleSegments(masked)) {
    for (const decl of declarations(segment.text)) {
      const offset = segment.start + decl.offset;
      if (FONT_PROP.test(decl.prop)) {
        const first = decl.value.split(",")[0].trim().replace(/^['"]|['"]$/g, "").toLowerCase();
        if (first && !first.startsWith("var(") && first !== "inherit" && !familySet.has(first)) {
          add("font", offset, `\u5B57\u4F53 ${first} \u4E0D\u5728\u5F53\u524D\u98CE\u683C\u5B57\u4F53\u6808\u5185\uFF0C\u6539\u7528 var(--ts-font-sans)`);
        }
        continue;
      }
      if (RADIUS_PROP.test(decl.prop)) {
        for (const px of pxValues(decl.value)) {
          if (px !== 0 && !radius.has(px)) {
            add("radius", offset, `\u5706\u89D2 ${px}px \u4E0D\u5728\u5C3A\u5EA6\u4E0A\uFF0C\u6700\u8FD1\uFF1A${nearestTokenHint("radius", px, manifest)}`);
          }
        }
        continue;
      }
      if (SPACING_PROPS.test(decl.prop)) {
        for (const px of pxValues(decl.value)) {
          if (px !== 0 && px !== 1 && !spacing.has(px)) {
            add("spacing", offset, `\u95F4\u8DDD ${px}px \u4E0D\u5728\u5C3A\u5EA6\u4E0A\uFF0C\u6700\u8FD1\uFF1A${nearestTokenHint("space", px, manifest)}`);
          }
        }
      }
    }
  }
  for (const segment of styleSegments(masked)) {
    for (const decl of declarations(segment.text)) {
      const offset = segment.start + decl.offset;
      const reportColor = (index2, color) => add("color", offset + index2, `\u88F8\u8272\u503C ${color}\uFF0C\u6539\u7528 var(--ts-color-*)`);
      for (const match of decl.raw.matchAll(HEX_COLOR)) reportColor(match.index ?? 0, match[0]);
      for (const match of decl.raw.matchAll(FUNC_COLOR)) {
        if (!match[0].includes("var(")) reportColor(match.index ?? 0, match[0]);
      }
      if (COLOR_PROP.test(decl.prop)) {
        const words = decl.raw.replace(/var\([^)]*\)/gi, mask);
        for (const match of words.matchAll(CSS_WORD)) {
          if (NAMED_COLORS.has(match[0].toLowerCase())) reportColor(match.index ?? 0, match[0]);
        }
      }
    }
  }
  for (const match of masked.matchAll(DATA_ICON)) {
    const name = (match[1] ?? match[2] ?? "").trim();
    if (name && !iconSet.has(name)) add("icon", match.index ?? 0, `\u56FE\u6807\u76EE\u5F55\u65E0\u6B64\u540D\uFF1A${name}`);
  }
  for (const match of masked.matchAll(EMPTY_SVG)) {
    if (!/data-icon/.test(match[1] ?? "")) add("icon", match.index ?? 0, "\u7A7A <svg> \u7F3A\u5C11 data-icon \u540D\u79F0");
  }
  for (const match of masked.matchAll(CLASS_ATTR_RE)) {
    const value = match[1] ?? match[2] ?? "";
    for (const cls of value.split(/\s+/).filter(Boolean)) {
      if (cls.startsWith("ts-") && !classSet.has(cls)) {
        add("component", match.index ?? 0, `\u7EC4\u4EF6\u76EE\u5F55\u65E0\u6B64\u7C7B\uFF1A${cls}`);
      }
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  findings.sort((a, b) => a.line - b.line);
  return { styleId, styleName: style.summary.name, findings, counts, truncated: total > MAX_FINDINGS, total };
}
function formatLintReport(report, label) {
  const styleName = report.styleId ? report.styleName ?? report.styleId : null;
  const head = styleName ? `\u98CE\u683C\u68C0\u67E5\uFF1A${styleName}\uFF08${report.styleId}\uFF09\xB7 ${label}` : `\u98CE\u683C\u68C0\u67E5\uFF1A\u672A\u9501\u5B9A\u98CE\u683C \xB7 ${label}\uFF08\u4EC5\u68C0\u67E5\u8D44\u6E90\u5F15\u7528\uFF09`;
  if (report.total === 0) {
    return `${head}
\u672A\u53D1\u73B0\u4E0D\u7B26\u5408\u9879\uFF080 \u5904\uFF09\u3002`;
  }
  const lines = report.findings.map((f, i) => `${i + 1}. [${f.rule}] \u7B2C ${f.line} \u884C ${f.message}
   ${f.snippet}`);
  const summary = RULES.filter((r) => report.counts[r] > 0).map((r) => `${r} ${report.counts[r]}`).join("\u3001");
  const tail = report.truncated ? `
\u2026\u53E6\u6709 ${report.total - report.findings.length} \u5904\u672A\u663E\u793A\u3002` : "";
  return `${head}
\u53D1\u73B0 ${report.total} \u5904\uFF08\u4EC5\u62A5\u544A\uFF0C\u672A\u4FEE\u6539\u6587\u4EF6\uFF09\uFF1A
${lines.join("\n")}
\u6C47\u603B\uFF1A${summary}${tail}`;
}

// src/codegen.ts
var ATTR_MAP = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  colspan: "colSpan",
  rowspan: "rowSpan",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  autofocus: "autoFocus",
  autocomplete: "autoComplete",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  contenteditable: "contentEditable",
  crossorigin: "crossOrigin",
  datetime: "dateTime",
  enctype: "encType",
  formaction: "formAction",
  frameborder: "frameBorder",
  srcset: "srcSet",
  usemap: "useMap",
  novalidate: "noValidate",
  spellcheck: "spellCheck"
};
var BOOLEAN_ATTRS = /* @__PURE__ */ new Set([
  "disabled",
  "checked",
  "readonly",
  "required",
  "multiple",
  "selected",
  "autofocus",
  "hidden",
  "open",
  "default",
  "async",
  "defer"
]);
var VOID_TAGS = /* @__PURE__ */ new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
var SVG_ATTRS = {
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  "clip-path": "clipPath",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "text-anchor": "textAnchor",
  "font-size": "fontSize",
  "font-family": "fontFamily",
  "font-weight": "fontWeight",
  "xlink:href": "xlinkHref",
  "xml:space": "xmlSpace",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "preserveaspectratio": "preserveAspectRatio"
};
function camelCase(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
function styleToObject(value) {
  const entries = value.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const idx = part.indexOf(":");
    if (idx < 0) return null;
    const prop = camelCase(part.slice(0, idx).trim());
    const val = part.slice(idx + 1).trim().replace(/'/g, "\\'");
    return `${prop}: '${val}'`;
  }).filter((e) => e !== null);
  return `{{ ${entries.join(", ")} }}`;
}
function attrsToJsx(rawAttrs) {
  const parts = [];
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of rawAttrs.matchAll(attrRe)) {
    const rawName = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    const lower = rawName.toLowerCase();
    if (lower.startsWith("on") && value !== void 0) continue;
    const name = ATTR_MAP[lower] ?? SVG_ATTRS[lower] ?? (rawName.includes("-") || rawName.includes(":") ? rawName : camelCase(rawName));
    if (value === void 0) {
      if (BOOLEAN_ATTRS.has(lower)) parts.push(name);
      else parts.push(`${name}={true}`);
      continue;
    }
    if (lower === "style") {
      parts.push(`style=${styleToObject(value)}`);
      continue;
    }
    if (lower === "class") {
      parts.push(`${name}="${value}"`);
      continue;
    }
    if (/[{}]/.test(value)) parts.push(`${name}={${value}}`);
    else parts.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}
function htmlToJsx(html) {
  let body = html;
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch) body = bodyMatch[1];
  else body = html.replace(/<!doctype[^>]*>/gi, "").replace(/<\/?(?:html|head)\b[^>]*>/gi, "");
  let out = "";
  let i = 0;
  const tokens = /<!--[\s\S]*?-->|<\/([a-zA-Z][-a-zA-Z0-9]*)\s*>|<([a-zA-Z][-a-zA-Z0-9]*)((?:\s+[^>]*?)?)\/?>/g;
  let match;
  while ((match = tokens.exec(body)) !== null) {
    const text = body.slice(i, match.index);
    if (text) out += text.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
    i = match.index + match[0].length;
    if (match[0].startsWith("<!--")) {
      out += `{/* ${match[0].slice(4, -3).trim()} */}`;
      continue;
    }
    if (match[1]) {
      out += `</${match[1]}>`;
      continue;
    }
    const tag = match[2];
    const attrs = match[3] ?? "";
    const lower = tag.toLowerCase();
    const selfClosed = /\/>$/.test(match[0]) || VOID_TAGS.has(lower);
    out += `<${tag}${attrsToJsx(attrs)}${selfClosed ? " />" : ">"}`;
  }
  const rest = body.slice(i);
  if (rest) out += rest.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
function toReactComponent(pageHtml, componentName = "CanvasPage") {
  const jsx = htmlToJsx(pageHtml);
  const component = `/**
 * \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u3002\u6837\u5F0F\u4F9D\u8D56\u540C\u76EE\u5F55\u7684 components.css \u4E0E tokens.css\uFF08--ts-* \u53D8\u91CF\uFF09\u3002
 * \u6CE8\u610F\uFF1A\u539F\u578B\u7684 <style> / \u5185\u8054\u6837\u5F0F\u65E0\u6CD5 1:1 \u6620\u5C04\u5230 JSX\uFF0C\u5FC5\u8981\u5904\u8BF7\u4EBA\u5DE5\u6821\u5BF9\u3002
 */
import './tokens.css'
import './components.css'

export default function ${componentName}() {
  return (
    ${jsx}
  )
}
`;
  return [{ name: `${componentName}.tsx`, content: component, language: "tsx" }];
}
function toFrameworklessHtml(pageHtml, bundle) {
  const linked = pageHtml.replace(
    /<\/head\s*>/i,
    `  <link rel="stylesheet" href="./tokens.css">
  <link rel="stylesheet" href="./components.css">
</head>`
  );
  const html = /<\/head\s*>/i.test(pageHtml) ? linked : `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="./tokens.css">
  <link rel="stylesheet" href="./components.css">
</head>
<body>
${pageHtml}
</body>
</html>
`;
  return [
    { name: "index.html", content: html, language: "html" },
    { name: "tokens.css", content: bundle.tokensCss, language: "css" },
    { name: "components.css", content: bundle.componentsCss, language: "css" }
  ];
}
function toTailwindConfig(input) {
  const colors = Object.entries(input.colors).map(([k, v]) => `        '${k}': '${v}',`).join("\n");
  const families = Object.entries(input.fontFamilies).map(([k, v]) => `        ${k}: [${v.split(",").map((f) => `'${f.trim().replace(/^['"]|['"]$/g, "")}'`).join(", ")}],`).join("\n");
  const fontSizes = Object.entries(input.fontSizes).map(([k, v]) => `        '${k}': '${v}px',`).join("\n");
  const spacing = input.spacing.map((v) => `        '${v}': '${v}px',`).join("\n");
  const radius = input.radius.filter((v) => v < 9999).map((v) => `        'ts-${v}': '${v}px',`).join("\n");
  const shadows = Object.entries(input.shadows).map(([k, v]) => `        '${k}': '${v}',`).join("\n");
  return `/** \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\uFF1ATailwind \u4E3B\u9898\u6620\u5C04\uFF08\u503C\u6765\u81EA\u5F53\u524D\u8BBE\u8BA1\u7CFB\u7EDF tokens\uFF09\u3002 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
${colors}
      },
      fontFamily: {
${families}
      },
      fontSize: {
${fontSizes}
      },
      spacing: {
${spacing}
      },
      borderRadius: {
${radius}
      },
      boxShadow: {
${shadows}
      },
    },
  },
  plugins: [],
}
`;
}

// src/codegen/tailwind-map.ts
var TAILWIND_MAP = [
  { id: "app", base: "ts-app", utilities: "flex min-h-[var(--ts-size-containerLg)] bg-[var(--ts-color-bg-canvas)] text-[var(--ts-color-text-primary)]" },
  { id: "sidebar", base: "ts-sidebar", utilities: "w-[var(--ts-size-sidebar)] shrink-0 border-r border-[var(--ts-color-border-default)] bg-[var(--ts-color-bg-surface)]" },
  { id: "main", base: "ts-main", utilities: "flex-1 min-w-0 bg-[var(--ts-color-bg-canvas)]" },
  { id: "container", base: "ts-container", utilities: "mx-auto w-full max-w-[var(--ts-size-containerLg)] px-[var(--ts-space-6)]" },
  { id: "stack", base: "ts-stack", utilities: "flex flex-col gap-[var(--ts-space-4)]" },
  { id: "row", base: "ts-row", utilities: "flex flex-row items-center gap-[var(--ts-space-3)]" },
  { id: "grid", base: "ts-grid", utilities: "grid gap-[var(--ts-space-4)]" },
  { id: "section", base: "ts-section", utilities: "py-[var(--ts-space-6)]" },
  { id: "button", base: "ts-btn", utilities: "inline-flex items-center justify-center gap-[var(--ts-space-2)] h-[var(--ts-size-controlMd)] px-[var(--ts-space-4)] rounded-[var(--ts-radius-md)] bg-[var(--ts-color-action-primary)] text-[var(--ts-color-action-primary-text)] font-[var(--ts-weight-medium)]" },
  { id: "icon-button", base: "ts-icon-btn", utilities: "inline-flex items-center justify-center size-[var(--ts-size-controlMd)] rounded-[var(--ts-radius-md)] hover:bg-[var(--ts-color-action-ghost-hover)]" },
  { id: "input", base: "ts-input", utilities: "h-[var(--ts-size-controlMd)] w-full px-[var(--ts-space-3)] rounded-[var(--ts-radius-md)] border border-[var(--ts-color-border-default)] bg-[var(--ts-color-bg-surface)] text-[var(--ts-color-text-primary)]" },
  { id: "field", base: "ts-field", utilities: "flex flex-col gap-[var(--ts-space-2)]" },
  { id: "select", base: "ts-select", utilities: "h-[var(--ts-size-controlMd)] px-[var(--ts-space-3)] rounded-[var(--ts-radius-md)] border border-[var(--ts-color-border-default)] bg-[var(--ts-color-bg-surface)]" },
  { id: "switch", base: "ts-switch", utilities: "inline-flex h-[var(--ts-size-controlSm)] w-[calc(var(--ts-size-controlSm)*1.8)] items-center rounded-full bg-[var(--ts-color-border-strong)]" },
  { id: "checkbox", base: "ts-check", utilities: "inline-flex size-[var(--ts-size-iconMd)] items-center justify-center rounded-[var(--ts-radius-sm)] border border-[var(--ts-color-border-default)]" },
  { id: "card", base: "ts-card", utilities: "rounded-[var(--ts-radius-lg)] border border-[var(--ts-color-border-default)] bg-[var(--ts-color-bg-surface)] p-[var(--ts-space-5)] shadow-[var(--ts-shadow-sm)]" },
  { id: "stat", base: "ts-stat", utilities: "flex flex-col gap-[var(--ts-space-1)]" },
  { id: "badge", base: "ts-badge", utilities: "inline-flex items-center px-[var(--ts-space-2)] py-[var(--ts-space-1)] rounded-[var(--ts-radius-full)] text-[var(--ts-fs-xs)] font-[var(--ts-weight-medium)]" },
  { id: "table", base: "ts-table", utilities: "w-full border-collapse text-[var(--ts-fs-md)]" },
  { id: "nav", base: "ts-nav", utilities: "flex flex-col gap-[var(--ts-space-1)]" },
  { id: "tabs", base: "ts-tabs", utilities: "flex flex-row gap-[var(--ts-space-2)] border-b border-[var(--ts-color-border-subtle)]" },
  { id: "dialog", base: "ts-dialog", utilities: "rounded-[var(--ts-radius-lg)] bg-[var(--ts-color-bg-raised)] p-[var(--ts-space-6)] shadow-[var(--ts-shadow-lg)]" },
  { id: "toast", base: "ts-toast", utilities: "rounded-[var(--ts-radius-md)] bg-[var(--ts-color-bg-inverse)] px-[var(--ts-space-4)] py-[var(--ts-space-3)] text-[var(--ts-color-text-inverse)] shadow-[var(--ts-shadow-md)]" },
  { id: "avatar", base: "ts-avatar", utilities: "inline-flex size-[var(--ts-size-iconLg)] items-center justify-center overflow-hidden rounded-full bg-[var(--ts-color-bg-sunken)]" },
  { id: "empty", base: "ts-empty", utilities: "flex flex-col items-center justify-center gap-[var(--ts-space-3)] py-[var(--ts-space-10)] text-[var(--ts-color-text-muted)]" },
  { id: "progress", base: "ts-progress", utilities: "h-[var(--ts-space-2)] w-full overflow-hidden rounded-full bg-[var(--ts-color-bg-sunken)]" }
];
var TAILWIND_BY_BASE = Object.fromEntries(
  TAILWIND_MAP.map((m) => [m.base, m.utilities])
);

// src/codegen/platforms.ts
function defaultComponents() {
  return TAILWIND_MAP.map((m) => ({ id: m.id, base: m.base }));
}
var STACKS = {
  ios: ["swiftui", "uikit"],
  android: ["compose", "xml"],
  miniprogram: ["weapp", "uniapp", "taro"]
};
var PLATFORM_LABEL = {
  ios: "iOS",
  android: "Android",
  miniprogram: "\u5C0F\u7A0B\u5E8F"
};
var STACK_LABEL = {
  swiftui: "SwiftUI",
  uikit: "UIKit",
  compose: "Jetpack Compose",
  xml: "XML \u5E03\u5C40",
  weapp: "\u5FAE\u4FE1\u5C0F\u7A0B\u5E8F\u539F\u751F",
  uniapp: "uni-app",
  taro: "Taro"
};
var COMPONENT_HINTS = {
  "ts-btn": { swiftui: "Button + .buttonStyle(.borderedProminent)", uikit: "UIButton(configuration: .filled())", compose: "Button", xml: "MaterialButton", weapp: '<button type="primary">', uniapp: '<button type="primary">', taro: "Button" },
  "ts-input": { swiftui: "TextField", uikit: "UITextField", compose: "OutlinedTextField", xml: "TextInputLayout+TextInputEditText", weapp: "<input>", uniapp: "<input>", taro: "Input" },
  "ts-card": { swiftui: "VStack + .background(.regularMaterial)", uikit: "UIView + layer.cornerRadius", compose: "Card", xml: "MaterialCardView", weapp: '<view class="card">', uniapp: '<view class="card">', taro: "View + Card" },
  "ts-nav": { swiftui: "NavigationStack / TabView", uikit: "UITabBarController / UINavigationController", compose: "NavigationBar", xml: "BottomNavigationView", weapp: "tabBar\uFF08app.json\uFF09", uniapp: "tabBar\uFF08pages.json\uFF09", taro: "TabBar" },
  "ts-tabs": { swiftui: "Picker(.segmented)", uikit: "UISegmentedControl", compose: "TabRow", xml: "TabLayout", weapp: "\u81EA\u5B9A\u4E49 view \u5207\u6362", uniapp: "<u-tabs>", taro: "Tabs" },
  "ts-dialog": { swiftui: ".alert / .sheet", uikit: "UIAlertController / present", compose: "AlertDialog", xml: "MaterialAlertDialogBuilder", weapp: "wx.showModal", uniapp: "uni.showModal", taro: "Modal" },
  "ts-toast": { swiftui: "overlay + animation", uikit: "\u81EA\u5B9A\u4E49 UIView", compose: "Snackbar", xml: "Snackbar", weapp: "wx.showToast", uniapp: "uni.showToast", taro: "Toast" },
  "ts-avatar": { swiftui: "AsyncImage + .clipShape(Circle())", uikit: "UIImageView + cornerRadius", compose: "AsyncImage + CircleShape", xml: "ShapeableImageView", weapp: '<image class="avatar">', uniapp: '<image class="avatar">', taro: "Image" },
  "ts-progress": { swiftui: "ProgressView(value:)", uikit: "UIProgressView", compose: "LinearProgressIndicator", xml: "LinearProgressIndicator", weapp: "<progress>", uniapp: "<progress>", taro: "Progress" },
  "ts-table": { swiftui: "List / Table", uikit: "UITableView", compose: "LazyColumn", xml: "RecyclerView", weapp: "<view> \u5217\u8868 + scroll-view", uniapp: "<scroll-view>", taro: "ScrollView" }
};
var FIDELITY_NOTE = `## \u4FDD\u771F\u5EA6\u4E0E\u4EBA\u5DE5\u6821\u5BF9\u70B9

- \u672C\u4EA7\u7269\u53EA\u4FDD\u8BC1**\u4E3B\u9898/Token \u4E0E\u89C4\u683C\u6E05\u5355**\u786E\u5B9A\u6027\u6B63\u786E\uFF1B**\u9875\u9762\u7ED3\u6784\u7531 AI \u6309\u89C4\u683C\u7F16\u5199**\uFF0C\u4E0D\u662F\u81EA\u52A8\u8F6C\u6362\u3002
- HTML\u2192\u539F\u751F**\u5FC5\u7136\u6709\u635F**\uFF1Aflex/grid \u5E03\u5C40\u3001\u4F2A\u5143\u7D20\uFF08::before/::after\uFF09\u3001\u81EA\u5B9A\u4E49\u6EDA\u52A8\u3001CSS \u52A8\u753B/\u8FC7\u6E21\u3001
  \u7EDD\u5BF9\u5B9A\u4F4D\u5C42\u7EA7\u7B49\u65E0\u6CD5 1:1 \u6620\u5C04\uFF0C\u9700\u8981\u6309\u5E73\u53F0\u60EF\u4F8B\u91CD\u5199\u3002
- \u8BF7\u52FF\u628A\u672C\u4EA7\u7269\u5F53\u4F5C\u300C\u50CF\u7D20\u7EA7\u8FD8\u539F\u300D\uFF1B\u4E0A\u7EBF\u524D\u8BF7\u5728\u771F\u673A/\u6A21\u62DF\u5668\u4E0A\u9010\u5C4F\u6821\u5BF9\u3002`;
function colorValue(raw) {
  const trimmed = raw.trim();
  const rgba = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(trimmed);
  if (rgba) {
    const hex = "#" + [rgba[1], rgba[2], rgba[3]].map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("");
    return { hex, opacity: rgba[4] !== void 0 ? Number(rgba[4]) : 1 };
  }
  return { hex: trimmed.startsWith("#") ? trimmed : "#000000", opacity: 1 };
}
function constantName(semanticKey, style = "camel") {
  const parts = semanticKey.split(".");
  const camel = parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  switch (style) {
    case "snake":
      return parts.join("_");
    case "kebab":
      return parts.join("-");
    case "upperSnake":
      return parts.join("_").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
    default:
      return camel;
  }
}
function designSpec(target, stack, input) {
  const lines = [];
  lines.push(`# \u8BBE\u8BA1\u89C4\u683C\u6E05\u5355\uFF08${PLATFORM_LABEL[target]} \xB7 ${STACK_LABEL[stack]}\uFF09`);
  lines.push("");
  lines.push("> \u7531\u5929\u67A2\u753B\u5E03\u4ECE\u5F53\u524D\u8BBE\u8BA1\u7CFB\u7EDF\u751F\u6210\u3002\u8BF7\u6309\u672C\u89C4\u683C\u7F16\u5199\u9875\u9762\u4EE3\u7801\u3002");
  lines.push("");
  lines.push("## \u8BED\u4E49\u8272");
  lines.push("");
  lines.push("| \u8BED\u4E49 | \u53D8\u91CF | \u503C | \u5EFA\u8BAE\u5E38\u91CF\u540D |");
  lines.push("| --- | --- | --- | --- |");
  for (const [key, value] of Object.entries(input.semantics)) {
    lines.push(`| ${key} | \`${input.semanticVars[key] ?? ""}\` | \`${value}\` | \`${constantName(key, "camel")}\` |`);
  }
  lines.push("");
  lines.push("## \u5B57\u9636");
  lines.push("");
  lines.push("| \u6863\u4F4D | px | pt/sp |");
  lines.push("| --- | --- | --- |");
  for (const [name, px] of Object.entries(input.fontSizes)) {
    lines.push(`| ${name} | ${px}px | ${px}pt |`);
  }
  lines.push("");
  lines.push(`\u5B57\u91CD\uFF1A${Object.entries(input.weights).map(([k, v]) => `${k}=${v}`).join("\u3001")}`);
  lines.push(`\u884C\u9AD8\uFF1A${Object.entries(input.lineHeights).map(([k, v]) => `${k}=${v}`).join("\u3001")}`);
  lines.push(`\u5B57\u4F53\u65CF\uFF1Asans=${input.fontFamilies.sans ?? ""}`);
  lines.push(`\u7B49\u5BBD\uFF1A${input.fontFamilies.mono ?? ""}`);
  lines.push("");
  lines.push("## \u95F4\u8DDD / \u5706\u89D2 / \u9634\u5F71");
  lines.push("");
  lines.push(`\u95F4\u8DDD\u6863\u4F4D\uFF1A${input.spacing.join(", ")}\uFF08px\uFF09`);
  lines.push(`\u5706\u89D2\uFF1A${Object.entries(input.radius).map(([k, v]) => `${k}=${v}`).join("\u3001")}`);
  lines.push(`\u9634\u5F71\uFF1A${Object.entries(input.shadows).map(([k, v]) => `${k}=\`${v}\``).join("\u3001")}`);
  lines.push("");
  lines.push("> \u8BF4\u660E\uFF1A1px\uFF08CSS\uFF09\u2248 1pt\uFF08iOS\uFF09\u2248 1dp\uFF08Android\uFF09\u5728 @1x \u4E0B\u7B49\u4EF7\uFF1B\u5C0F\u7A0B\u5E8F\u7528 rpx \u65F6\u6309 750 \u8BBE\u8BA1\u5BBD\u6362\u7B97\u3002");
  lines.push("");
  lines.push("## \u7EC4\u4EF6\u6620\u5C04\u5EFA\u8BAE");
  lines.push("");
  lines.push("| ts-* \u7C7B | \u672C\u5E73\u53F0\u60EF\u7528\u6784\u4EF6 |");
  lines.push("| --- | --- |");
  for (const comp of input.components) {
    const hint = COMPONENT_HINTS[comp.base]?.[stack];
    if (hint) lines.push(`| \`${comp.base}\` | ${hint} |`);
  }
  lines.push("");
  lines.push(FIDELITY_NOTE);
  return lines.join("\n");
}
function swiftUiFiles(input) {
  const colorLines = Object.entries(input.semantics).map(([key, value]) => {
    const { hex, opacity } = colorValue(value);
    const name = constantName(key, "camel");
    return opacity < 1 ? `        public static let ${name} = Color(hex: "${hex}").opacity(${opacity})` : `        public static let ${name} = Color(hex: "${hex}")`;
  }).join("\n");
  const fontLines = Object.entries(input.fontSizes).map(([name, px]) => `        public static let ${name} = CGFloat(${px})`).join("\n");
  const spacingLines = input.spacing.map((v) => `        public static let s${v} = CGFloat(${v})`).join("\n");
  const swift = `import SwiftUI

/// \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u7684\u8BBE\u8BA1 Token\u3002\u8BF7\u52FF\u624B\u6539\u3002
public enum DesignTokens {
    public enum Color_ {
${colorLines}
    }

    public enum FontSize {
${fontLines}
    }

    public enum Spacing {
${spacingLines}
    }

    public enum Radius {
${Object.entries(input.radius).filter(([, v]) => v < 9999).map(([k, v]) => `        public static let ${k} = CGFloat(${v})`).join("\n")}
    }
}

public extension Color {
    /// \u89E3\u6790 #rrggbb / #rgb\u3002
    init(hex: String) {
        let cleaned = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        let expanded = cleaned.count == 3 ? cleaned.map { "\\($0)\\($0)" }.joined() : cleaned
        let value = UInt64(expanded, radix: 16) ?? 0
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255,
            opacity: 1
        )
    }
}
`;
  return [{ name: "DesignTokens.swift", content: swift, language: "swift" }];
}
function uiKitFiles(input) {
  const header = `#import <UIKit/UIKit.h>

/// \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u7684\u8BBE\u8BA1 Token\u3002\u8BF7\u52FF\u624B\u6539\u3002
@interface TSDesignTokens : NSObject

${Object.keys(input.semantics).map((k) => `+ (UIColor *)${constantName(k, "camel")};`).join("\n")}

+ (UIFont *)fontOfSize:(CGFloat)size weight:(UIFontWeight)weight;
+ (CGFloat)spacing:(NSInteger)step;
+ (CGFloat)radius:(NSString *)name;

@end
`;
  const impl = `#import "TSDesignTokens.h"

@implementation TSDesignTokens

+ (UIColor *)colorWithHex:(NSString *)hex {
    NSString *cleaned = [hex hasPrefix:@"#"] ? [hex substringFromIndex:1] : hex;
    unsigned int value = 0;
    [[NSScanner scannerWithString:cleaned] scanHexInt:&value];
    return [UIColor colorWithRed:((value >> 16) & 0xFF) / 255.0
                           green:((value >> 8) & 0xFF) / 255.0
                            blue:(value & 0xFF) / 255.0
                           alpha:1.0];
}

${Object.entries(input.semantics).map(([key, value]) => `+ (UIColor *)${constantName(key, "camel")} { return [self colorWithHex:@"${colorValue(value).hex}"]; }`).join("\n")}

+ (UIFont *)fontOfSize:(CGFloat)size weight:(UIFontWeight)weight {
    return [UIFont systemFontOfSize:size weight:weight];
}

+ (CGFloat)spacing:(NSInteger)step {
    static const CGFloat table[] = {${input.spacing.join(", ")}};
    NSInteger count = ${input.spacing.length};
    if (step < 0 || step >= count) return 0;
    return table[step];
}

+ (CGFloat)radius:(NSString *)name {
    NSDictionary<NSString *, NSNumber *> *map = @{${Object.entries(input.radius).filter(([, v]) => v < 9999).map(([k, v]) => `@"${k}": @${v}`).join(", ")}};
    return map[name].doubleValue;
}

@end
`;
  return [
    { name: "TSDesignTokens.h", content: header, language: "objc" },
    { name: "TSDesignTokens.m", content: impl, language: "objc" }
  ];
}
function composeFiles(input) {
  const colorKt = `package com.example.theme

import androidx.compose.ui.graphics.Color

// \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u3002\u8BF7\u52FF\u624B\u6539\u3002
${Object.entries(input.semantics).map(([key, value]) => {
    const { hex, opacity } = colorValue(value);
    const argb = `0x${opacity < 1 ? Math.round(opacity * 255).toString(16).padStart(2, "0") : "FF"}${hex.replace("#", "").toUpperCase()}`;
    return `val ${constantName(key, "camel")} = Color(${argb})`;
  }).join("\n")}
`;
  const typeKt = `package com.example.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u3002\u8BF7\u52FF\u624B\u6539\u3002
object TsTypography {
${Object.entries(input.fontSizes).map(([name, px]) => `    val ${name} = TextStyle(fontSize = ${px}.sp, fontWeight = FontWeight.Normal)`).join("\n")}
}
`;
  const themeKt = `package com.example.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

// \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u3002\u8BF7\u52FF\u624B\u6539\u3002
private val TsColorScheme = lightColorScheme(
    background = ${constantName("bg.canvas", "camel")},
    surface = ${constantName("bg.surface", "camel")},
    onBackground = ${constantName("text.primary", "camel")},
    onSurface = ${constantName("text.primary", "camel")},
    primary = ${constantName("action.primary", "camel")},
    onPrimary = ${constantName("action.primaryText", "camel")},
    outline = ${constantName("border.default", "camel")},
)

val TsShapes = MaterialTheme.shapes.copy(
    small = RoundedCornerShape(${input.radius.sm ?? 6}.dp),
    medium = RoundedCornerShape(${input.radius.md ?? 10}.dp),
    large = RoundedCornerShape(${input.radius.lg ?? 14}.dp),
)

@Composable
fun TsTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = TsColorScheme, shapes = TsShapes, content = content)
}
`;
  return [
    { name: "Color.kt", content: colorKt, language: "kotlin" },
    { name: "Type.kt", content: typeKt, language: "kotlin" },
    { name: "Theme.kt", content: themeKt, language: "kotlin" }
  ];
}
function xmlFiles(input) {
  const colors = `<?xml version="1.0" encoding="utf-8"?>
<!-- \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u3002\u8BF7\u52FF\u624B\u6539\u3002 -->
<resources>
${Object.entries(input.semantics).map(([key, value]) => `    <color name="${constantName(key, "snake")}">${colorValue(value).hex}</color>`).join("\n")}
</resources>
`;
  const dimens = `<?xml version="1.0" encoding="utf-8"?>
<!-- \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u3002\u8BF7\u52FF\u624B\u6539\u3002 -->
<resources>
${input.spacing.map((v, i) => `    <dimen name="ts_space_${i}">${v}dp</dimen>`).join("\n")}
${Object.entries(input.radius).filter(([, v]) => v < 9999).map(([k, v]) => `    <dimen name="ts_radius_${k}">${v}dp</dimen>`).join("\n")}
</resources>
`;
  const themes = `<?xml version="1.0" encoding="utf-8"?>
<!-- \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u3002\u8BF7\u52FF\u624B\u6539\u3002 -->
<resources>
    <style name="Theme.Ts" parent="Theme.Material3.DayNight.NoActionBar">
        <item name="colorPrimary">@color/${constantName("action.primary", "snake")}</item>
        <item name="colorOnPrimary">@color/${constantName("action.primaryText", "snake")}</item>
        <item name="android:colorBackground">@color/${constantName("bg.canvas", "snake")}</item>
        <item name="colorSurface">@color/${constantName("bg.surface", "snake")}</item>
        <item name="colorOnSurface">@color/${constantName("text.primary", "snake")}</item>
        <item name="colorOutline">@color/${constantName("border.default", "snake")}</item>
    </style>
</resources>
`;
  return [
    { name: "res/values/colors.xml", content: colors, language: "xml" },
    { name: "res/values/dimens.xml", content: dimens, language: "xml" },
    { name: "res/values/themes.xml", content: themes, language: "xml" }
  ];
}
function weappFiles(input) {
  const wxss = `/* \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u3002\u8BF7\u52FF\u624B\u6539\u3002 */
page {
${Object.entries(input.semantics).map(([key, value]) => `  --${constantName(key, "kebab")}: ${colorValue(value).hex};`).join("\n")}
${Object.entries(input.fontSizes).map(([name, px]) => `  --fs-${name}: ${px}px;`).join("\n")}
${input.spacing.map((v, i) => `  --space-${i}: ${v}px;`).join("\n")}
${Object.entries(input.radius).filter(([, v]) => v < 9999).map(([k, v]) => `  --radius-${k}: ${v}px;`).join("\n")}
}
`;
  const themeJs = `// \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u3002\u8BF7\u52FF\u624B\u6539\u3002
module.exports = {
  colors: {
${Object.entries(input.semantics).map(([key, value]) => `    '${key}': '${colorValue(value).hex}',`).join("\n")}
  },
  fontSize: ${JSON.stringify(input.fontSizes, null, 2).replace(/\n/g, "\n  ")},
  spacing: ${JSON.stringify(input.spacing)},
}
`;
  return [
    { name: "app.wxss", content: wxss, language: "css" },
    { name: "theme.js", content: themeJs, language: "javascript" }
  ];
}
function uniappFiles(input) {
  const scss = `/* \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u3002\u8BF7\u52FF\u624B\u6539\u3002 */
${Object.entries(input.semantics).map(([key, value]) => `$ts-${constantName(key, "kebab")}: ${colorValue(value).hex};`).join("\n")}
${Object.entries(input.fontSizes).map(([name, px]) => `$ts-fs-${name}: ${px}px;`).join("\n")}
${input.spacing.map((v, i) => `$ts-space-${i}: ${v}px;`).join("\n")}
${Object.entries(input.radius).filter(([, v]) => v < 9999).map(([k, v]) => `$ts-radius-${k}: ${v}px;`).join("\n")}
`;
  return [{ name: "uni.scss", content: scss, language: "scss" }];
}
function taroFiles(input) {
  const scss = `/* \u7531\u5929\u67A2\u753B\u5E03\u751F\u6210\u3002\u8BF7\u52FF\u624B\u6539\u3002 */
:root {
${Object.entries(input.semantics).map(([key, value]) => `  --ts-${constantName(key, "kebab")}: ${colorValue(value).hex};`).join("\n")}
${Object.entries(input.fontSizes).map(([name, px]) => `  --ts-fs-${name}: ${px}px;`).join("\n")}
${input.spacing.map((v, i) => `  --ts-space-${i}: ${v}px;`).join("\n")}
${Object.entries(input.radius).filter(([, v]) => v < 9999).map(([k, v]) => `  --ts-radius-${k}: ${v}px;`).join("\n")}
}
`;
  return [{ name: "app.scss", content: scss, language: "scss" }];
}
function parseCssVars(css) {
  const out = {};
  for (const match of css.matchAll(/(--ts-[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim();
  }
  return out;
}
function semanticKeyFromPath(path) {
  const parts = path.split(".");
  return parts[0] === "color" ? parts.slice(1).join(".") : path;
}
function buildPlatformInput(style, components) {
  const vars = parseCssVars(style.tokensCss);
  const semantics = {};
  const semanticVars = {};
  for (const [path, entry] of Object.entries(style.manifest.resolvedSemantic)) {
    const key = semanticKeyFromPath(path);
    semantics[key] = entry.value;
    semanticVars[key] = `--ts-${key.replace(/\./g, "-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
  }
  const fontSizes = {};
  for (const [name, value] of Object.entries(vars)) {
    const fs = /^--ts-fs-(.+)$/.exec(name);
    if (fs) fontSizes[fs[1]] = parseFloat(value);
  }
  const spacing = Object.entries(vars).filter(([n]) => /^--ts-space-\d+$/.test(n)).sort((a, b) => Number(a[0].replace("--ts-space-", "")) - Number(b[0].replace("--ts-space-", ""))).map(([, v]) => parseFloat(v));
  const radius = {};
  for (const [name, value] of Object.entries(vars)) {
    const r = /^--ts-radius-(.+)$/.exec(name);
    if (r) radius[r[1]] = parseFloat(value);
  }
  const shadows = {};
  for (const [name, value] of Object.entries(vars)) {
    const s = /^--ts-shadow-(.+)$/.exec(name);
    if (s) shadows[s[1]] = value;
  }
  const fontFamilies = {};
  for (const [name, value] of Object.entries(vars)) {
    const f = /^--ts-font-(.+)$/.exec(name);
    if (f && !/^--ts-font-size/.test(name)) fontFamilies[f[1]] = value;
  }
  return {
    semantics,
    semanticVars,
    fontFamilies,
    fontSizes,
    weights: { regular: 400, medium: 500, semibold: 600, bold: 700 },
    lineHeights: { tight: 1.15, snug: 1.3, normal: 1.45, relaxed: 1.65 },
    spacing: spacing.length ? spacing : [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64],
    radius,
    shadows,
    components
  };
}
var GENERATORS = {
  swiftui: swiftUiFiles,
  uikit: uiKitFiles,
  compose: composeFiles,
  xml: xmlFiles,
  weapp: weappFiles,
  uniapp: uniappFiles,
  taro: taroFiles
};
function generatePlatformFiles(target, stack, input) {
  const allowed = STACKS[target];
  if (!allowed.includes(stack)) {
    throw new Error(`\u6280\u672F\u6808 ${stack} \u4E0D\u5C5E\u4E8E ${PLATFORM_LABEL[target]}\uFF08\u53EF\u9009\uFF1A${allowed.join("/")}\uFF09`);
  }
  return [
    { name: "design-spec.md", content: designSpec(target, stack, input), language: "markdown" },
    ...GENERATORS[stack](input)
  ];
}

// src/server.ts
import http2 from "node:http";
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync6, readFileSync as readFileSync6, statSync as statSync2 } from "node:fs";
import { join as join5 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/probe.ts
var PROBE_MARKER = "data-tianshu-probe";
var PROBE_SCRIPT = [
  "(function(){",
  "  if (window.__tianshu_probe__) return;",
  "  window.__tianshu_probe__ = true;",
  "  var PARENT = null;",
  "  var KNOWN = {",
  "    __vd_ping: 1, __vd_proto_state: 1, __vd_set_scope: 1,",
  "    __vd_request_add_to_chat: 1, __vd_request_select_xpath: 1,",
  "    __vd_apply_edits: 1, __vd_set_comments: 1",
  "  };",
  "  var STYLE_KEYS = [",
  "    'color','background-color','background-image','font-family','font-size','font-weight',",
  "    'font-style','line-height','letter-spacing','text-align','text-decoration',",
  "    'padding','margin','border','border-radius','border-color','border-width','border-style',",
  "    'display','flex-direction','justify-content','align-items','gap',",
  "    'width','height','opacity','box-shadow','position','overflow'",
  "  ];",
  "  var scopeXpath = null;",
  "",
  "  function post(type, payload){",
  "    var msg = { type: type, payload: payload === undefined ? null : payload };",
  '    try { if (PARENT) parent.postMessage(msg, PARENT); else parent.postMessage(msg, "*"); } catch (e) {}',
  "  }",
  "",
  '  window.addEventListener("message", function(e){',
  "    var d = e.data;",
  '    if (!d || typeof d.type !== "string" || !KNOWN[d.type]) return;',
  '    if (!PARENT) PARENT = e.origin || "*";',
  '    else if (PARENT !== "*" && e.origin !== PARENT) return;',
  "    try { handle(d); } catch (err) {}",
  "  });",
  "",
  "  function getXPath(el){",
  '    if (!el || el.nodeType !== 1) return "";',
  "    var parts = [];",
  "    while (el && el.nodeType === 1) {",
  "      var idx = 1, sib = el.previousElementSibling;",
  "      while (sib) { if (sib.tagName === el.tagName) idx++; sib = sib.previousElementSibling; }",
  '      parts.unshift(el.tagName.toLowerCase() + "[" + idx + "]");',
  "      el = el.parentElement;",
  "    }",
  '    return "/" + parts.join("/");',
  "  }",
  "",
  "  function byXPath(xp){",
  "    if (!xp) return null;",
  '    var parts = xp.split("/").filter(Boolean);',
  "    var cur = null;",
  "    for (var i = 0; i < parts.length; i++) {",
  "      var m = /^([a-zA-Z0-9:_-]+)\\[(\\d+)\\]$/.exec(parts[i]);",
  "      if (!m) return null;",
  "      var tag = m[1].toLowerCase(), idx = parseInt(m[2], 10);",
  "      var list = cur ? cur.children : document.children;",
  "      var count = 0, found = null;",
  "      for (var j = 0; j < list.length; j++) {",
  "        if (list[j].tagName && list[j].tagName.toLowerCase() === tag) {",
  "          count++; if (count === idx) { found = list[j]; break; }",
  "        }",
  "      }",
  "      if (!found) return null;",
  "      cur = found;",
  "    }",
  "    return cur;",
  "  }",
  "",
  "  function getCssSelector(el){",
  '    if (!el || el.nodeType !== 1) return "";',
  '    if (el.id) return "#" + el.id;',
  "    var tag = el.tagName.toLowerCase();",
  '    var cls = (typeof el.className === "string" ? el.className : "").trim().split(/\\s+/).filter(Boolean).slice(0, 3);',
  '    return tag + (cls.length ? "." + cls.join(".") : "");',
  "  }",
  "",
  "  // SVG \u5185\u5C42\u56FE\u5F62\u5F52\u4E00\u5230\u5916\u5C42 <svg>\uFF0C\u907F\u514D\u9009\u4E2D <path> \u7B49\u3002",
  "  function normalize(el){",
  '    while (el && el.namespaceURI === "http://www.w3.org/2000/svg" && el.parentElement && el.parentElement.namespaceURI === "http://www.w3.org/2000/svg") {',
  "      el = el.parentElement;",
  "    }",
  "    return el;",
  "  }",
  "",
  "  function hitStack(x, y){",
  "    var el = document.elementFromPoint(x, y);",
  "    var stack = [];",
  "    while (el && el.nodeType === 1) { stack.push(el); el = el.parentElement; }",
  "    if (stack.length) stack[0] = normalize(stack[0]);",
  "    return stack;",
  "  }",
  "",
  "  function resolveAtPoint(x, y, intent){",
  "    var stack = hitStack(x, y);",
  "    if (!stack.length) return null;",
  '    if (intent === "direct") return stack[0];',
  "    var scope = (scopeXpath && byXPath(scopeXpath)) || document.body;",
  "    var found = null;",
  "    for (var i = 0; i < stack.length; i++) { if (stack[i].parentElement === scope) { found = stack[i]; break; } }",
  "    if (!found && scope !== document.body) {",
  '      scopeXpath = null; post("__vd_scope_reset", null); scope = document.body;',
  "      for (var j = 0; j < stack.length; j++) { if (stack[j].parentElement === scope) { found = stack[j]; break; } }",
  "    }",
  "    return found || stack[stack.length - 1];",
  "  }",
  "",
  "  function payload(el){",
  "    var rect = el.getBoundingClientRect();",
  "    var cs = getComputedStyle(el);",
  "    var styles = {};",
  "    for (var i = 0; i < STYLE_KEYS.length; i++) {",
  "      var v = cs.getPropertyValue(STYLE_KEYS[i]);",
  "      if (v) styles[STYLE_KEYS[i]] = v;",
  "    }",
  '    var cls = typeof el.className === "string" ? el.className : "";',
  "    return {",
  "      xpath: getXPath(el),",
  "      selector: getCssSelector(el),",
  '      tagName: el.tagName ? el.tagName.toLowerCase() : "",',
  "      className: cls,",
  '      domId: el.getAttribute("data-dom-id") || el.id || null,',
  '      textContent: (el.textContent || "").trim().slice(0, 200),',
  '      editableText: (el.children.length === 0 && (el.textContent || "").trim()) ? el.textContent : null,',
  '      outerHtml: (el.outerHTML || "").slice(0, 2000),',
  "      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },",
  "      computedStyles: styles,",
  "      parentXpath: el.parentElement ? getXPath(el.parentElement) : null,",
  "      siblingIndex: el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0",
  "    };",
  "  }",
  "",
  "  function isEditable(t){",
  "    if (!t || t.nodeType !== 1) return false;",
  "    var tag = t.tagName.toLowerCase();",
  '    return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable === true;',
  "  }",
  "",
  "  // \u9AD8\u4EAE\u5728 iframe \u5185\u505A\uFF08\u7236\u4FA7\u65E0\u6CD5\u8BBF\u95EE\u5176 DOM\uFF09\uFF1B\u53EA\u5B58\u5728\u4E8E\u8FD0\u884C\u65F6\uFF0C\u4E0D\u4F1A\u5199\u56DE\u539F\u578B\u3002",
  "  var hovered = null, selectedEl = null;",
  "  function ensureStyle(){",
  '    if (document.querySelector("style[' + PROBE_MARKER + ']")) return;',
  '    var s = document.createElement("style");',
  '    s.setAttribute("' + PROBE_MARKER + '", "1");',
  '    s.textContent = "[data-tianshu-hover]{outline:2px solid #e07a3f;outline-offset:-1px}[data-tianshu-selected]{outline:2px solid #b85a24;outline-offset:-1px;box-shadow:0 0 0 2px rgba(224,122,63,.25)}";',
  "    (document.head || document.documentElement).appendChild(s);",
  "  }",
  "  function setHover(el){",
  "    if (hovered === el) return;",
  '    if (hovered) hovered.removeAttribute("data-tianshu-hover");',
  "    hovered = el;",
  '    if (hovered) hovered.setAttribute("data-tianshu-hover", "1");',
  "  }",
  "  function setSelected(el){",
  '    if (selectedEl) selectedEl.removeAttribute("data-tianshu-selected");',
  "    selectedEl = el;",
  '    if (selectedEl) selectedEl.setAttribute("data-tianshu-selected", "1");',
  "  }",
  "",
  "  // \u6279\u6CE8\u56FE\u9489\uFF1A\u7236\u4FA7\u8BFB\u4E0D\u5230\u672C iframe \u7684 DOM\uFF0C\u53EA\u80FD\u5728\u5185\u90E8\u6309 xpath \u5B9A\u4F4D\u5E76\u7ED8\u5236\u7F16\u53F7\u5FBD\u6807\u3002",
  "  var pinComments = [];",
  "  var pinLayer = null;",
  "  function ensurePinStyle(){",
  '    if (document.querySelector("style[data-tianshu-pinstyle]")) return;',
  '    var s = document.createElement("style");',
  '    s.setAttribute("data-tianshu-pinstyle", "1");',
  '    s.textContent = "[data-tianshu-pins]{position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647}[data-tianshu-pin]{position:absolute;display:flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:999px;background:#b85a24;color:#fff;font:600 12px/1 sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.35);pointer-events:auto;transform:translate(-50%,-50%)}";',
  "    (document.head || document.documentElement).appendChild(s);",
  "  }",
  "  function ensurePinLayer(){",
  "    if (pinLayer && pinLayer.parentNode) return pinLayer;",
  '    pinLayer = document.createElement("div");',
  '    pinLayer.setAttribute("data-tianshu-pins", "1");',
  "    (document.body || document.documentElement).appendChild(pinLayer);",
  "    return pinLayer;",
  "  }",
  "  function renderPins(){",
  "    var layer = ensurePinLayer();",
  '    layer.textContent = "";',
  "    if (!pinComments.length) return;",
  "    ensurePinStyle();",
  "    var sx = window.scrollX || window.pageXOffset || 0;",
  "    var sy = window.scrollY || window.pageYOffset || 0;",
  "    for (var i = 0; i < pinComments.length; i++) {",
  "      var el = byXPath(pinComments[i].xpath);",
  "      if (!el) continue;",
  "      var rect = el.getBoundingClientRect();",
  '      var pin = document.createElement("div");',
  '      pin.setAttribute("data-tianshu-pin", "1");',
  '      pin.style.left = (rect.left + sx) + "px";',
  '      pin.style.top = (rect.top + sy) + "px";',
  "      pin.textContent = String(i + 1);",
  '      if (pinComments[i].note) pin.setAttribute("title", pinComments[i].note);',
  "      layer.appendChild(pin);",
  "    }",
  "  }",
  '  window.addEventListener("resize", renderPins);',
  '  window.addEventListener("load", renderPins);',
  "",
  '  document.addEventListener("click", function(e){',
  "    if (isEditable(e.target)) return;",
  "    ensureStyle();",
  '    var el = resolveAtPoint(e.clientX, e.clientY, (e.metaKey || e.ctrlKey) ? "direct" : "descend");',
  "    if (!el) return;",
  "    if (e.preventDefault) e.preventDefault();",
  "    if (!(e.metaKey || e.ctrlKey)) scopeXpath = getXPath(el);",
  "    setSelected(el);",
  '    post("__vd_proto_element_selected", payload(el));',
  "  }, true);",
  "",
  "  var hoverRaf = 0;",
  '  document.addEventListener("mousemove", function(e){',
  "    if (hoverRaf) return;",
  "    hoverRaf = requestAnimationFrame(function(){",
  "      hoverRaf = 0;",
  "      ensureStyle();",
  '      var el = resolveAtPoint(e.clientX, e.clientY, "descend");',
  "      setHover(el);",
  '      post("__vd_proto_hover_changed", el ? payload(el) : null);',
  "    });",
  "  }, true);",
  "",
  '  document.addEventListener("mouseleave", function(){ setHover(null); post("__vd_proto_hover_changed", null); }, true);',
  "",
  '  window.addEventListener("wheel", function(e){',
  "    if (e.preventDefault) e.preventDefault();",
  '    post("__vd_wheel_forward", {',
  "      deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode,",
  "      ctrlKey: e.ctrlKey, metaKey: e.metaKey, clientX: e.clientX, clientY: e.clientY",
  "    });",
  "  }, { capture: true, passive: false });",
  "",
  "  function reportHeight(){",
  "    var h = Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement ? document.documentElement.scrollHeight : 0);",
  '    post("__vd_content_height", { height: h });',
  "  }",
  "",
  "  function handle(d){",
  "    var p = d.payload || {};",
  '    if (d.type === "__vd_ping") { post("__vd_iframe_ready", null); return; }',
  '    if (d.type === "__vd_proto_state") { scopeXpath = p.scopeXpath || null; return; }',
  '    if (d.type === "__vd_set_scope") { scopeXpath = p.xpath || null; return; }',
  '    if (d.type === "__vd_set_comments") { pinComments = Array.isArray(p.comments) ? p.comments : []; renderPins(); return; }',
  '    if (d.type === "__vd_request_select_xpath") {',
  '      var el = byXPath(p.xpath); if (el) post("__vd_proto_element_selected", payload(el)); return;',
  "    }",
  '    if (d.type === "__vd_request_add_to_chat") {',
  '      var el2 = byXPath(p.xpath); if (el2) post("__vd_proto_element_add_to_chat", payload(el2)); return;',
  "    }",
  '    if (d.type === "__vd_apply_edits") { applyEdits(p); return; }',
  "  }",
  "",
  "  var SAFE_PROP = /^[a-z-]+$/;",
  "  var BAD_VALUE = /url\\(|expression|javascript:|@import/i;",
  "",
  "  function applyEdits(p){",
  "    var el = byXPath(p.xpath);",
  '    if (!el) { post("__vd_edit_applied", { xpath: p.xpath, ok: false, error: "element not found" }); return; }',
  "    try {",
  '      if (typeof p.text === "string" && el.children.length === 0) el.textContent = p.text;',
  '      if (p.styles && typeof p.styles === "object") {',
  "        for (var k in p.styles) {",
  "          if (!Object.prototype.hasOwnProperty.call(p.styles, k)) continue;",
  "          if (!SAFE_PROP.test(k) || BAD_VALUE.test(String(p.styles[k]))) continue;",
  "          el.style.setProperty(k, String(p.styles[k]));",
  "        }",
  "      }",
  '      post("__vd_edit_applied", { xpath: p.xpath, ok: true });',
  "    } catch (err) {",
  '      post("__vd_edit_applied", { xpath: p.xpath, ok: false, error: String(err && err.message || err) });',
  "    }",
  "  }",
  "",
  '  if (document.readyState === "loading") {',
  '    document.addEventListener("DOMContentLoaded", function(){ post("__vd_iframe_ready", null); });',
  '  } else { post("__vd_iframe_ready", null); }',
  "  // \u53EA\u5728\u52A0\u8F7D\u5B8C\u6210\u65F6\u4E0A\u62A5\u4E00\u6B21\u3002\u4E0D\u80FD\u76D1\u542C resize\uFF1A\u8282\u70B9\u6309\u4E0A\u62A5\u503C\u8C03\u6574 iframe \u9AD8\u5EA6\uFF0C",
  "  // \u5185\u5BB9\u4F9D\u8D56\u89C6\u53E3\uFF08\u5982 100vh\uFF09\u65F6\u4F1A\u5F62\u6210\u53CD\u9988\u5FAA\u73AF\uFF0C\u9AD8\u5EA6\u6301\u7EED\u589E\u957F\u6216\u6536\u7F29\u3002",
  '  if (document.readyState === "complete") reportHeight();',
  '  else window.addEventListener("load", reportHeight);',
  "})();"
].join("\n");
function injectProbe(html) {
  if (html.includes(PROBE_MARKER)) return html;
  const safe = PROBE_SCRIPT.replace(/<\/script/gi, "<\\/script");
  const tag = `<script ${PROBE_MARKER}="1">
${safe}
</script>
`;
  const idx = html.search(/<\/head\s*>/i);
  if (idx >= 0) return html.slice(0, idx) + tag + html.slice(idx);
  const at = afterDoctype(html);
  return html.slice(0, at) + tag + html.slice(at);
}

// src/export.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync5, mkdirSync as mkdirSync3, mkdtempSync, readFileSync as readFileSync5, readdirSync as readdirSync2, rmSync as rmSync3, statSync, writeFileSync as writeFileSync3 } from "node:fs";
import { tmpdir } from "node:os";
import { join as join4 } from "node:path";
import { deflateRawSync } from "node:zlib";
var BROWSER_CANDIDATES = [
  process.env.TIANSHU_CANVAS_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter((p) => typeof p === "string" && p.length > 0);
function resolveBrowser() {
  return BROWSER_CANDIDATES.find((p) => existsSync5(p)) ?? null;
}
function exportsDir(cwd) {
  return join4(projectDir(cwd), "exports");
}
function stamp() {
  const d = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
var pngQueue = Promise.resolve();
function exportPng(cwd) {
  const run = pngQueue.then(() => exportPngOnce(cwd));
  pngQueue = run.catch(() => {
  });
  return run;
}
var LAUNCH_ARGS = [
  "--remote-debugging-port=0",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--headless=new",
  "--hide-scrollbars",
  "--mute-audio",
  "--disable-background-networking",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-breakpad",
  "--disable-crash-reporter"
];
var BrowserSpawnError = class extends Error {
};
async function readDevToolsEndpoint(userDataDir, proc, timeoutMs) {
  const portFile = join4(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  let stderr = "";
  proc.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  let exitCode = null;
  proc.once("exit", (code) => {
    exitCode = code;
  });
  let spawnError = null;
  proc.on("error", (err) => {
    spawnError = err;
  });
  while (Date.now() < deadline) {
    if (spawnError) throw new BrowserSpawnError(`\u65E0\u6CD5\u542F\u52A8\u6D4F\u89C8\u5668 ${proc.spawnfile}\uFF1A${spawnError.message}`);
    if (exitCode !== null) {
      throw new Error(`\u6D4F\u89C8\u5668\u8FDB\u7A0B\u5DF2\u9000\u51FA\uFF08exit code ${exitCode}\uFF09${stderr ? `\uFF1A${stderr.trim()}` : ""}`);
    }
    if (existsSync5(portFile)) {
      const lines = readFileSync5(portFile, "utf8").split("\n");
      const port = lines[0]?.trim();
      const wsPath = lines[1]?.trim();
      if (port && wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`\u7B49\u5F85\u6D4F\u89C8\u5668\u8C03\u8BD5\u7AEF\u53E3\u8D85\u65F6\uFF08${timeoutMs}ms\uFF09${stderr ? `\uFF1A${stderr.trim()}` : ""}`);
}
function killTree(proc) {
  if (proc.exitCode !== null || !proc.pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => {
      });
    } else {
      process.kill(-proc.pid, "SIGKILL");
    }
  } catch {
  }
}
function removeProfile(userDataDir) {
  try {
    rmSync3(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (err) {
    console.error(`[tianshu-canvas] \u4E34\u65F6 profile \u672A\u80FD\u5220\u9664\uFF1A${userDataDir}\uFF08${err.message}\uFF09`);
  }
}
function cleanStaleProfiles() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1e3;
  try {
    for (const entry of readdirSync2(tmpdir())) {
      if (!entry.startsWith("tsc-png-")) continue;
      const dir = join4(tmpdir(), entry);
      try {
        if (statSync(dir).mtimeMs < cutoff) rmSync3(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
      } catch {
      }
    }
  } catch {
  }
}
async function launchBrowser(exe) {
  const puppeteer = (await import("puppeteer-core")).default;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const userDataDir = mkdtempSync(join4(tmpdir(), "tsc-png-"));
    const proc = spawn(exe, [...LAUNCH_ARGS, `--user-data-dir=${userDataDir}`, "about:blank"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32"
    });
    try {
      const wsEndpoint = await readDevToolsEndpoint(userDataDir, proc, 6e4);
      const browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
        protocolTimeout: 12e4,
        defaultViewport: null
      });
      const dispose = async () => {
        await Promise.race([browser.close().catch(() => {
        }), new Promise((r) => setTimeout(r, 1e4))]);
        killTree(proc);
        await new Promise((r) => setTimeout(r, 500));
        removeProfile(userDataDir);
      };
      return { browser, dispose };
    } catch (err) {
      lastErr = err;
      killTree(proc);
      await new Promise((r) => setTimeout(r, 500));
      removeProfile(userDataDir);
      if (err instanceof BrowserSpawnError) break;
      await new Promise((r) => setTimeout(r, 1e3 * (attempt + 1)));
    }
  }
  throw lastErr;
}
async function exportPngOnce(cwd) {
  const exe = resolveBrowser();
  if (!exe) {
    throw new Error(
      "\u672A\u627E\u5230 Chrome/Edge\uFF0C\u65E0\u6CD5\u5BFC\u51FA PNG\u3002\u8BF7\u5B89\u88C5 Chrome/Edge\uFF0C\u6216\u7528\u73AF\u5883\u53D8\u91CF TIANSHU_CANVAS_BROWSER \u6307\u5B9A\u6D4F\u89C8\u5668\u8DEF\u5F84\u3002"
    );
  }
  const { url } = await ensureServer(cwd);
  cleanStaleProfiles();
  const { browser, dispose } = await launchBrowser(exe);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    await page.goto(`${url}&export=1`, { waitUntil: "domcontentloaded", timeout: 3e4 });
    await page.waitForSelector(".page-node", { timeout: 15e3 });
    await new Promise((r) => setTimeout(r, 800));
    const clip = await page.evaluate(() => {
      const doc = globalThis.document;
      const els = Array.from(doc.querySelectorAll(".page-node, .page-node__header"));
      if (!els.length) return null;
      const rects = els.map((e) => e.getBoundingClientRect());
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      const pad = 40;
      return { x: left - pad, y: top - pad, width: right - left + pad * 2, height: bottom - top + pad * 2 };
    });
    const dir = exportsDir(cwd);
    mkdirSync3(dir, { recursive: true });
    const name = `canvas-${stamp()}.png`;
    const path = join4(dir, name);
    await page.screenshot({ path, clip: clip ?? void 0 });
    return { name, path, bytes: readFileSync5(path).length };
  } finally {
    await dispose();
  }
}
var CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 4294967295;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const compressed = deflateRawSync(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(67324752, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(2048, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, compressed);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(33639248, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(2048, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(entry.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(101010256, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}
function galleryHtml(cwd) {
  const project = readProject(cwd);
  const cards = project.nodes.map(
    (n) => `<section><h2>${escapeHtml(n.title)} <small>${n.width}\xD7${n.height}</small></h2><iframe src="pages/${encodeURIComponent(n.id)}.html" style="width:${n.width}px;height:${n.height}px;max-width:100%;border:1.5px solid #2b2b2b;border-radius:12px 5px 14px 6px/6px 13px 5px 12px;background:#fffdf8"></iframe></section>`
  ).join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>\u5929\u67A2\u753B\u5E03\u8BBE\u8BA1 \xB7 \u539F\u578B\u96C6</title>
<style>body{font-family:system-ui;margin:0;padding:24px;background:#faf7f0;color:#2b2b2b}
h1{font-size:20px;font-family:"Kaiti SC","STKaiti","KaiTi",system-ui}h2{font-size:15px;margin:0 0 8px;font-family:"Kaiti SC","STKaiti","KaiTi",system-ui}section{margin:0 0 32px}small{color:#6b6152;font-weight:400}
iframe{display:block}</style></head>
<body><h1>\u5929\u67A2\u753B\u5E03\u8BBE\u8BA1 \xB7 \u539F\u578B\u96C6\uFF08\u5171 ${project.nodes.length} \u9875\uFF09</h1>
${cards || "<p>\uFF08\u65E0\u9875\u9762\uFF09</p>"}
</body></html>`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
async function exportZip(cwd) {
  const project = readProject(cwd);
  const entries = [];
  for (const node of project.nodes) {
    const html = readPageHtml(cwd, node.id);
    if (html !== null) entries.push({ name: `pages/${node.id}.html`, data: Buffer.from(html, "utf8") });
  }
  entries.push({ name: "project.json", data: Buffer.from(JSON.stringify(project, null, 2), "utf8") });
  entries.push({ name: "index.html", data: Buffer.from(galleryHtml(cwd), "utf8") });
  const zip2 = buildZip(entries);
  const dir = exportsDir(cwd);
  mkdirSync3(dir, { recursive: true });
  const name = `canvas-${stamp()}.zip`;
  const path = join4(dir, name);
  writeFileSync3(path, zip2);
  return { name, path, bytes: zip2.length };
}
async function runExport(cwd, kind) {
  const files = [];
  let pngError;
  if (kind === "png" || kind === "both") {
    try {
      files.push(await exportPng(cwd));
    } catch (err) {
      pngError = err.message;
    }
  }
  if (kind === "zip" || kind === "both") {
    files.push(await exportZip(cwd));
  }
  return { files, pngError };
}

// src/server.ts
var WEB_DIR = fileURLToPath2(new URL("./web/", import.meta.url));
var DEFAULT_PORT = 43117;
var MUTATION_HEADER = "x-tianshu-canvas";
var MAX_BODY = 4 * 1024 * 1024;
var MAX_VIEWPORT_BODY = 4096;
var BODY_DRAIN_MS = 2e3;
var state = null;
function tokenFor(cwd) {
  return createHash2("sha256").update(cwd).digest("hex").slice(0, 16);
}
function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}
async function listenWithFallback(server, preferred) {
  if (preferred === 0) return listen(server, 0);
  for (let i = 0; i < 21; i++) {
    try {
      return await listen(server, preferred + i);
    } catch (err) {
      if (err.code !== "EADDRINUSE") throw err;
    }
  }
  return listen(server, 0);
}
async function ensureServer(cwd, preferredPort = DEFAULT_PORT) {
  if (!state) {
    const server = http2.createServer(handleRequest);
    server.on("clientError", (_err, socket) => socket.destroy());
    const port = await listenWithFallback(server, preferredPort);
    server.unref();
    const created = { server, port, tokens: /* @__PURE__ */ new Map(), sse: /* @__PURE__ */ new Map() };
    state = created;
    projectEvents.on("change", ({ cwd: changed }) => {
      broadcast(created, tokenFor(changed), "project");
    });
    projectEvents.on("selection", ({ cwd: changed }) => {
      broadcast(created, tokenFor(changed), "selection");
    });
  }
  const token = tokenFor(cwd);
  state.tokens.set(token, cwd);
  return { token, port: state.port, url: `http://127.0.0.1:${state.port}/?ws=${token}` };
}
function currentUrl(cwd) {
  if (!state) return null;
  const token = tokenFor(cwd);
  if (!state.tokens.has(token)) return null;
  return `http://127.0.0.1:${state.port}/?ws=${token}`;
}
var ASSET_TYPES = {
  "canvas.js": "application/javascript; charset=utf-8",
  "canvas.css": "text/css; charset=utf-8",
  "canvas.js.map": "application/json; charset=utf-8"
};
function handleRequest(req, res) {
  try {
    routeRequest(req, res);
  } catch (err) {
    console.error("[tianshu-canvas] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A", err);
    if (res.headersSent) res.destroy();
    else send(res, 500, "text/plain; charset=utf-8", "internal error");
  }
}
function routeRequest(req, res) {
  const host = req.headers.host;
  if (!host || !isLocalHost(host)) {
    return send(res, 403, "text/plain; charset=utf-8", "forbidden host");
  }
  let url;
  try {
    url = new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    return send(res, 400, "text/plain; charset=utf-8", "bad request");
  }
  const path = url.pathname;
  if (req.method === "GET" && path === "/healthz") {
    return send(res, 200, "text/plain; charset=utf-8", "ok");
  }
  if (req.method === "GET" && path === "/") {
    return serveStatic(res, "index.html");
  }
  if (req.method === "GET" && path.startsWith("/assets/")) {
    const name = path.slice("/assets/".length);
    if (name in ASSET_TYPES) return serveStatic(res, name, ASSET_TYPES[name]);
    return send(res, 404, "text/plain; charset=utf-8", "not found");
  }
  if (req.method === "GET" && path === "/api/design-systems") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    try {
      return sendJson(res, loadDesignCatalog(cwd ?? void 0));
    } catch (err) {
      return send(res, 500, "application/json; charset=utf-8", JSON.stringify({ error: err.message }));
    }
  }
  if (req.method === "GET" && path === "/api/project") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
    const issue = projectIssue(cwd);
    return sendJson(res, { ...readProject(cwd), ...issue ? { issue } : {} });
  }
  if (req.method === "GET" && path === "/api/events") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    return handleSse(res, tokenFor(cwd));
  }
  if (req.method === "GET" && path.startsWith("/page/")) {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    let id;
    try {
      id = decodeURIComponent(path.slice("/page/".length));
    } catch (err) {
      if (err instanceof URIError) return send(res, 400, "text/plain; charset=utf-8", "bad page id");
      throw err;
    }
    const html = readPageHtml(cwd, id);
    if (html === null) return send(res, 404, "text/plain; charset=utf-8", "page not found");
    return sendUntrustedHtml(res, injectProbe(html));
  }
  if (req.method === "GET" && path === "/api/selection") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
    return sendJson(res, { selection: readSelection(cwd) });
  }
  if (req.method === "GET" && path === "/api/comments") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
    return sendJson(res, { comments: readComments(cwd) });
  }
  if (req.method === "GET" && path === "/api/page-html") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    const html = readPageHtml(cwd, url.searchParams.get("id") ?? "");
    if (html === null) return send(res, 404, "text/plain; charset=utf-8", "page not found");
    return send(res, 200, "text/plain; charset=utf-8", html);
  }
  if (req.method === "GET" && path === "/api/export-file") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    const name = url.searchParams.get("name") ?? "";
    if (!name || /[\\/]/.test(name) || name.includes("..")) {
      return send(res, 400, "text/plain; charset=utf-8", "bad name");
    }
    const file = join5(exportsDir(cwd), name);
    if (!existsSync6(file) || !statSync2(file).isFile()) return send(res, 404, "text/plain; charset=utf-8", "not found");
    const type = name.endsWith(".png") ? "image/png" : "application/zip";
    const data = readFileSync6(file);
    res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
    res.end(data);
    return;
  }
  if (req.method === "POST") {
    if (String(req.headers[MUTATION_HEADER] ?? "") !== "1") {
      return send(res, 403, "text/plain; charset=utf-8", "missing header");
    }
    if (path === "/api/viewport") return handleViewport(req, res);
    if (path === "/api/selection") return handleSelection(req, res);
    if (path === "/api/comments") return handleComments(req, res);
    if (path === "/api/page-html") return handlePageHtml(req, res);
    if (path === "/api/nodes") return handleNodes(req, res);
    if (path === "/api/edges") return handleEdges(req, res);
    if (path === "/api/export") return handleExport(req, res);
    if (path === "/api/design") return handleDesign(req, res);
  }
  return send(res, 404, "text/plain; charset=utf-8", "not found");
}
function handleExport(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const kindRaw = String(body.kind ?? "both");
    const kind = kindRaw === "png" || kindRaw === "zip" ? kindRaw : "both";
    void runExport(cwd, kind).then((result) => sendJson(res, { ok: true, ...result })).catch((err) => send(res, 500, "application/json; charset=utf-8", JSON.stringify({ error: err.message })));
  });
}
function handleDesign(req, res) {
  readJsonBody(
    req,
    res,
    (body) => {
      const cwd = String(body.__cwd);
      const raw = body.styleId;
      const styleId = raw === null || raw === void 0 ? null : String(raw);
      const result = applyProjectStyle(cwd, styleId === "free" ? null : styleId);
      sendJson(res, { ok: true, ...result });
    },
    1024
  );
}
function readJsonBody(req, res, onBody, maxBytes = MAX_BODY) {
  let raw = "";
  let rejected = false;
  req.setEncoding("utf8");
  req.on("error", () => {
  });
  req.on("data", (chunk) => {
    if (rejected) return;
    raw += chunk;
    if (raw.length > maxBytes) {
      rejected = true;
      raw = "";
      const drain = setTimeout(() => req.destroy(), BODY_DRAIN_MS);
      drain.unref();
      req.once("close", () => clearTimeout(drain));
      send(res, 413, "application/json; charset=utf-8", JSON.stringify({ error: "body too large" }));
    }
  });
  req.on("end", () => {
    if (rejected || res.writableEnded || res.headersSent) return;
    let parsed;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "bad json" }));
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "bad json" }));
    }
    const body = parsed;
    try {
      const cwd = resolveCwd(typeof body.ws === "string" ? body.ws : null);
      if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
      onBody({ ...body, __cwd: cwd });
    } catch (err) {
      if (err instanceof InvalidInputError) {
        return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: err.message }));
      }
      console.error("[tianshu-canvas] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A", err);
      if (res.headersSent) res.destroy();
      else send(res, 500, "application/json; charset=utf-8", JSON.stringify({ error: "internal error" }));
    }
  });
}
function handleSelection(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const pageId = typeof body.pageId === "string" ? body.pageId : "";
    const kind = body.kind === "page" ? "page" : "element";
    if (!pageId) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "missing pageId" }));
    assertSafeId(pageId);
    const raw = body.payload;
    const selection = {
      pageId,
      kind,
      at: Date.now(),
      ...kind === "element" && raw ? {
        element: {
          xpath: String(raw.xpath ?? ""),
          tagName: String(raw.tagName ?? ""),
          textContent: typeof raw.textContent === "string" ? raw.textContent : void 0,
          editableText: typeof raw.editableText === "string" ? raw.editableText : null,
          computedStyles: raw.computedStyles && typeof raw.computedStyles === "object" ? raw.computedStyles : void 0
        }
      } : {}
    };
    writeSelection(cwd, selection);
    return sendJson(res, { ok: true });
  });
}
function handleComments(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const op = String(body.op ?? "");
    if (op === "add") {
      const comment = addComment(cwd, {
        pageId: typeof body.pageId === "string" ? body.pageId : "",
        xpath: typeof body.xpath === "string" ? body.xpath : "",
        tagName: typeof body.tagName === "string" ? body.tagName : void 0,
        textContent: typeof body.textContent === "string" ? body.textContent : void 0,
        note: typeof body.note === "string" ? body.note : ""
      });
      return sendJson(res, { ok: true, comment });
    }
    if (op === "resolve") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((v) => typeof v === "string") : [];
      const changed = setCommentsResolved(cwd, ids, body.resolved !== false);
      return sendJson(res, { ok: true, changed });
    }
    if (op === "remove") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((v) => typeof v === "string") : void 0;
      const removed = removeComments(cwd, ids);
      return sendJson(res, { ok: true, removed });
    }
    return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: `unknown op: ${op}` }));
  });
}
function handlePageHtml(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const id = typeof body.id === "string" ? body.id : "";
    const html = typeof body.html === "string" ? body.html : "";
    if (!id || !html) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "missing id or html" }));
    if (html.length > 2 * 1024 * 1024) return send(res, 413, "application/json; charset=utf-8", JSON.stringify({ error: "html too large" }));
    writePageHtml(cwd, id, html);
    projectEvents.emit("change", { cwd });
    return sendJson(res, { ok: true });
  });
}
function handleNodes(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const op = String(body.op ?? "");
    const id = typeof body.id === "string" ? body.id : "";
    if (op === "remove") {
      if (!id) throw new InvalidInputError("missing id");
      removeNode(cwd, id);
      return sendJson(res, { ok: true, id });
    }
    if (op === "rename") {
      if (!id || typeof body.title !== "string") throw new InvalidInputError("missing id or title");
      renameNode(cwd, id, body.title);
      return sendJson(res, { ok: true, id, title: body.title });
    }
    if (op === "move") {
      if (!id) throw new InvalidInputError("missing id");
      moveNode(cwd, id, Number(body.x) || 0, Number(body.y) || 0);
      return sendJson(res, { ok: true, id });
    }
    if (op === "duplicate") {
      if (!id) throw new InvalidInputError("missing id");
      const node = duplicateNode(cwd, id, typeof body.title === "string" ? body.title : void 0);
      return sendJson(res, { ok: true, node });
    }
    return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: `unknown op: ${op}` }));
  });
}
function handleEdges(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const op = String(body.op ?? "");
    const source = typeof body.source === "string" ? body.source : "";
    const target = typeof body.target === "string" ? body.target : "";
    if (!source || !target) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "missing source or target" }));
    if (op === "add") {
      const edge = addEdge(cwd, source, target, typeof body.label === "string" ? body.label : void 0);
      return sendJson(res, { ok: true, edge });
    }
    if (op === "remove") {
      removeEdge(cwd, source, target);
      return sendJson(res, { ok: true });
    }
    return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: `unknown op: ${op}` }));
  });
}
function handleViewport(req, res) {
  readJsonBody(
    req,
    res,
    (body) => {
      const cwd = String(body.__cwd);
      const x = Number(body.x);
      const y = Number(body.y);
      const zoom = Number(body.zoom);
      setViewport(cwd, {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1
      });
      return sendJson(res, { ok: true });
    },
    MAX_VIEWPORT_BODY
  );
}
function handleSse(res, token) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("retry: 2000\n\n");
  const s = state;
  if (!s) {
    res.end();
    return;
  }
  const set = s.sse.get(token) ?? /* @__PURE__ */ new Set();
  set.add(res);
  s.sse.set(token, set);
  const keepAlive = setInterval(() => {
    try {
      res.write(": ka\n\n");
    } catch {
    }
  }, 25e3);
  keepAlive.unref();
  res.on("close", () => {
    clearInterval(keepAlive);
    set.delete(res);
  });
}
function broadcast(s, token, event = "project") {
  const set = s.sse.get(token);
  if (!set) return;
  const frame = `event: ${event}
data: ${JSON.stringify({ at: Date.now() })}

`;
  for (const res of set) {
    try {
      res.write(frame);
    } catch {
    }
  }
}
function resolveCwd(token) {
  if (!token || !state) return null;
  return state.tokens.get(token) ?? null;
}
function isLocalHost(host) {
  const name = host.split(":")[0]?.toLowerCase();
  return name === "127.0.0.1" || name === "localhost";
}
function serveStatic(res, name, type = "text/html; charset=utf-8") {
  const file = join5(WEB_DIR, name);
  if (!existsSync6(file)) return send(res, 404, "text/plain; charset=utf-8", "asset not built");
  const headers = { "Content-Type": type, "X-Content-Type-Options": "nosniff" };
  if (name === "index.html") {
    headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'";
  }
  res.writeHead(200, headers);
  res.end(readFileSync6(file));
}
function sendUntrustedHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; font-src data:; connect-src 'none'; form-action 'none'"
  });
  res.end(html);
}
function sendJson(res, body) {
  send(res, 200, "application/json; charset=utf-8", JSON.stringify(body));
}
function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

// src/tools.ts
function str(v) {
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}
function positive(v) {
  return v !== void 0 && v > 0 ? Math.round(v) : void 0;
}
function kbToBytes(v) {
  const n = num(v);
  return n !== void 0 && n > 0 ? Math.round(n * 1024) : void 0;
}
function withBackupNotice(run) {
  return async (call) => {
    const result = await run(call);
    const backup = takeProjectBackup(call.cwd);
    if (!backup) return result;
    return { ...result, content: `${result.content}
\u6CE8\u610F\uFF1Aproject.json \u66FE\u635F\u574F\u6216\u542B\u65E0\u6548\u6761\u76EE\uFF0C\u8986\u76D6\u524D\u5DF2\u5907\u4EFD\u5230 ${backup}` };
  };
}
function scriptIconNote(names) {
  if (names.length === 0) return "";
  return `
\u6CE8\u610F\uFF1A\u811A\u672C\u91CC\u7684\u56FE\u6807\u4E0D\u4F1A\u5C55\u5F00\uFF1A${names.slice(0, 8).join("\u3001")}\u3002\u8BF7\u628A\u56FE\u6807\u5199\u5728\u9759\u6001 HTML \u7684 <template> \u91CC\uFF0C\u7531\u811A\u672C\u514B\u9686\u4F7F\u7528\u3002`;
}
function projectHint(cwd) {
  return `${PROJECT_DIR_NAME}/\uFF08\u9879\u76EE\u6587\u4EF6\uFF1A${projectFile(cwd)}\uFF09`;
}
async function canvasOpen(call) {
  const port = num(call.args.port);
  const { url } = await ensureServer(call.cwd, port ?? void 0);
  writeUrlHint(call.cwd, url);
  if (call.args.open === true) openBrowser(url);
  return {
    content: `\u753B\u5E03\u670D\u52A1\u5DF2\u5C31\u7EEA\u3002\u8BF7\u7ACB\u523B\u628A\u4E0B\u9762\u8FD9\u4E00\u884C\u539F\u6837\u53D1\u7ED9\u7528\u6237\uFF08\u5355\u72EC\u4E00\u884C\uFF0C\u4FBF\u4E8E\u70B9\u51FB\uFF09\uFF1A
${url}
\u5728\u7528\u6237\u62FF\u5230\u94FE\u63A5\u540E\uFF0C\u5148\u786E\u8BA4\u8BBE\u8BA1\u98CE\u683C\uFF08canvas_get_state \u770B\u300C\u8BBE\u8BA1\u98CE\u683C\u300D\u6BB5\uFF1B\u82E5\u4E3A\u300C\u81EA\u7531\u53D1\u6325\u300D\u4E14\u7528\u6237\u6CA1\u6307\u5B9A\u8FC7\u98CE\u683C\uFF0C
\u7528 canvas_style\uFF08action=list\uFF09\u628A\u98CE\u683C\u540D\u4F5C\u4E3A\u9009\u9879\u95EE\u7528\u6237\u4E00\u6B21\u5E76\u7B49\u56DE\u7B54\uFF09\uFF0C\u518D\u5F00\u59CB\u5199\u539F\u578B\u3002
\u5DE5\u4F5C\u533A\uFF1A${call.cwd}
\u9879\u76EE\u6587\u4EF6\uFF1A${projectFile(call.cwd)}
\u64CD\u4F5C\u63D0\u793A\uFF1A\u7A7A\u683C+\u62D6\u62FD \u6216 \u4E2D\u952E\u62D6\u62FD \u5E73\u79FB\uFF1BCtrl+\u6EDA\u8F6E \u7F29\u653E\uFF1B\u666E\u901A\u6EDA\u8F6E \u5E73\u79FB\u3002`
  };
}
function writeUrlHint(cwd, url) {
  try {
    writeFileSync4(join6(cwd, PROJECT_DIR_NAME, "url.txt"), url + "\n", "utf8");
  } catch {
  }
}
function openBrowser(url) {
  try {
    const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn2(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", (err) => {
      console.error(`[tianshu-canvas] \u65E0\u6CD5\u6253\u5F00\u7CFB\u7EDF\u6D4F\u89C8\u5668\uFF1A${err.message}`);
    });
    child.unref();
  } catch {
  }
}
async function canvasUpsertPage(call) {
  const args = call.args;
  const htmlPath = str(args.html_path);
  let html;
  if (htmlPath) {
    if (!existsSync7(htmlPath)) {
      return { content: `\u8BFB\u53D6\u5931\u8D25\uFF1A\u6587\u4EF6\u4E0D\u5B58\u5728 ${htmlPath}`, isError: true };
    }
    try {
      html = readFileSync7(htmlPath, "utf8");
    } catch (err) {
      return { content: `\u8BFB\u53D6\u5931\u8D25\uFF1A${err.message}`, isError: true };
    }
  } else {
    html = str(args.html);
  }
  const requestedId = str(args.id);
  if (requestedId && !isSafeId(requestedId)) {
    return { content: `\u975E\u6CD5 id\uFF1A${requestedId}\uFF08\u4EC5\u5141\u8BB8\u5B57\u6BCD\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u3001\u8FDE\u5B57\u7B26\uFF0C1\u201364 \u4F4D\uFF09`, isError: true };
  }
  const project = readProject(call.cwd);
  const existing = requestedId ? project.nodes.find((n) => n.id === requestedId) : void 0;
  if (!html && !existing) {
    return {
      content: "\u7F3A\u5C11\u5185\u5BB9\uFF1A\u8BF7\u63D0\u4F9B html_path\uFF08\u5DE5\u4F5C\u533A\u5185\u7684 HTML \u6587\u4EF6\uFF09\u6216 html\uFF08\u5185\u8054 HTML\uFF09\u3002\u4EC5\u66F4\u65B0\u5DF2\u6709\u9875\u9762\u7684\u6807\u9898/\u4F4D\u7F6E/\u5C3A\u5BF8\u65F6\uFF0C\u9700\u4F20\u5DF2\u5B58\u5728\u7684 id\u3002",
      isError: true
    };
  }
  const id = requestedId ?? newPageId();
  const deviceProvided = isDeviceType(args.device_type);
  const deviceType = isDeviceType(args.device_type) ? args.device_type : existing?.deviceType ?? DEFAULT_DEVICE;
  const base = existing && !deviceProvided ? { width: existing.width, height: existing.height } : resolveSize(deviceType);
  const size = {
    width: positive(num(args.width)) ?? base.width,
    height: positive(num(args.height)) ?? base.height
  };
  let x = num(args.x);
  let y = num(args.y);
  if (x === void 0 || y === void 0) {
    if (existing) {
      x = x ?? existing.x;
      y = y ?? existing.y;
    } else {
      const pos = autoLayoutPosition(call.cwd, nextLayoutIndex(call.cwd), size);
      x = x ?? pos.x;
      y = y ?? pos.y;
    }
  }
  let assetNote = "";
  let workHtml = html;
  if (workHtml !== void 0 && args.inline_assets === true) {
    const inlineResult = await inlineAssets(workHtml, {
      origin: str(args.inline_assets_origin),
      maxBytesPer: kbToBytes(args.inline_assets_max_kb)
    });
    workHtml = inlineResult.html;
    const skipped = inlineResult.skipped;
    assetNote = `
\u8D44\u6E90\u5185\u8054\uFF1A\u6210\u529F ${inlineResult.inlined} \u9879` + (skipped.length ? `\uFF0C\u8DF3\u8FC7 ${skipped.length} \u9879\uFF1A
${skipped.slice(0, 8).map((s) => `  - ${s.ref}\uFF08${s.reason}\uFF09`).join("\n")}${skipped.length > 8 ? `
  \u2026\u7B49 ${skipped.length} \u9879` : ""}` : "");
  }
  const styleId = currentStyleId(call.cwd);
  const injection = workHtml !== void 0 ? injectDesign(workHtml, styleId, call.cwd) : null;
  const pageHtml = injection ? injection.html : workHtml;
  const rel = pageHtml !== void 0 ? writePageHtml(call.cwd, id, pageHtml) : existing?.htmlPath ?? "";
  const now = Date.now();
  const node = {
    id,
    type: "page",
    title: str(args.title) ?? existing?.title ?? id,
    x,
    y,
    width: size.width,
    height: size.height,
    deviceType,
    htmlPath: rel,
    htmlRev: pageHtml !== void 0 ? now : existing?.htmlRev,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  upsertNode(call.cwd, node);
  const { url } = await ensureServer(call.cwd);
  const blocked = pageHtml !== void 0 ? findBlockedResources(pageHtml) : [];
  const styleLine = injection ? injection.injected ? `
\u5DF2\u5E94\u7528\u8BBE\u8BA1\u98CE\u683C\u300C${designStyleSummary(call.cwd, injection.styleId ?? "")?.name ?? injection.styleId}\u300D\uFF08${injection.styleId}\uFF09\uFF1A\u6CE8\u5165 token/\u7EC4\u4EF6\u6837\u5F0F${injection.usedIcons.length ? `\uFF0C\u5185\u8054 ${injection.usedIcons.length} \u4E2A\u56FE\u6807` : ""}\u3002` : "\n\u5F53\u524D\u4E3A\u81EA\u7531\u53D1\u6325\uFF08\u672A\u9501\u5B9A\u98CE\u683C\uFF09\uFF1B\u5982\u9700\u7EDF\u4E00\u89C6\u89C9\uFF0C\u5148 canvas_style\uFF08action=set\uFF09\u3002" : "";
  const missingLine = injection?.missingIcons.length ? `
\u6CE8\u610F\uFF1A\u8FD9\u4E9B\u56FE\u6807\u540D\u4E0D\u5728\u76EE\u5F55\u4E2D\uFF0C\u672A\u5185\u8054\uFF1A${injection.missingIcons.slice(0, 8).join("\u3001")}${injection.missingIcons.length > 8 ? ` \u7B49 ${injection.missingIcons.length} \u4E2A` : ""}\u3002\u53EF\u7528 canvas_style\uFF08action=get\uFF09\u67E5\u770B\u56FE\u6807\u6E05\u5355\u3002` : "";
  return {
    content: `${existing ? "\u5DF2\u66F4\u65B0" : "\u5DF2\u6DFB\u52A0"}\u9875\u9762\u8282\u70B9\u300C${node.title}\u300D\uFF08id=${id}\uFF09\u3002
\u4F4D\u7F6E\uFF1Ax=${node.x}, y=${node.y}\uFF1B\u5C3A\u5BF8\uFF1A${node.width}\xD7${node.height}\uFF08${deviceType}\uFF09
` + (pageHtml !== void 0 ? `\u539F\u578B\u6587\u4EF6\uFF1A${join6(call.cwd, rel)}
` : `\u539F\u578B HTML \u672A\u6539\u52A8\uFF08\u4EC5\u66F4\u65B0\u4E86\u8282\u70B9\u4FE1\u606F\uFF09\u3002
`) + `\u753B\u5E03 URL\uFF1A${url}
\u9879\u76EE\uFF1A${projectHint(call.cwd)}` + styleLine + missingLine + assetNote + scriptIconNote(injection?.scriptIcons ?? []) + (blocked.length ? `
\u6CE8\u610F\uFF1A\u753B\u5E03 CSP \u4F1A\u62E6\u622A\u8FD9\u4E9B\u5916\u94FE\u6216\u76F8\u5BF9\u8DEF\u5F84\u8D44\u6E90\uFF0C\u9875\u9762\u91CC\u5C06\u52A0\u8F7D\u4E0D\u5230\uFF1A${blocked.slice(0, 8).join("\u3001")}${blocked.length > 8 ? ` \u7B49 ${blocked.length} \u5904` : ""}\u3002\u8BF7\u6539\u4E3A\u5185\u8054\uFF08<style>\u3001<script>\u3001data: URI\uFF09\u6216\u7528 CSS/SVG \u7ED8\u5236\u3002` : "")
  };
}
function formatSelection(selection, project) {
  const node = project.nodes.find((n) => n.id === selection.pageId);
  const pageTitle = node ? node.title : selection.pageId;
  const lines = [
    `\u9009\u4E2D\u7C7B\u578B\uFF1A${selection.kind === "element" ? "\u9875\u9762\u5185\u5143\u7D20" : "\u6574\u4E2A\u9875\u9762\u8282\u70B9"}`,
    `\u6240\u5C5E\u9875\u9762\uFF1A${pageTitle}\uFF08id=${selection.pageId}\uFF09`
  ];
  if (selection.kind === "element" && selection.element) {
    const el = selection.element;
    lines.push(`\u5143\u7D20\uFF1A<${el.tagName}> xpath=${el.xpath}`);
    if (el.textContent) lines.push(`\u6587\u672C\uFF1A${el.textContent}`);
    if (el.computedStyles) {
      const keys = ["color", "background-color", "font-size", "font-weight", "padding", "margin", "border-radius"];
      const picked = keys.filter((k) => el.computedStyles?.[k]).map((k) => `${k}: ${el.computedStyles?.[k]}`);
      if (picked.length) lines.push(`\u5173\u952E\u6837\u5F0F\uFF1A${picked.join("\uFF1B")}`);
    }
  }
  return lines;
}
async function canvasGetState(call) {
  const project = readProject(call.cwd);
  const selection = readSelection(call.cwd);
  const url = currentUrl(call.cwd);
  const sections = [];
  const issue = projectIssue(call.cwd);
  if (issue) sections.push(`\u8B66\u544A\uFF1A${issue}`);
  const styleId = project.design?.styleId ?? null;
  if (styleId === null) {
    sections.push("\u8BBE\u8BA1\u98CE\u683C\uFF1A\u81EA\u7531\u53D1\u6325\uFF08\u672A\u9501\u5B9A\u98CE\u683C\uFF09\u3002\u751F\u6210\u539F\u578B\u524D\u5148\u4E0E\u7528\u6237\u786E\u8BA4\u98CE\u683C\uFF1B\u53EF\u7528 canvas_style\uFF08action=list\uFF09\u7ED9\u51FA\u9009\u9879\u3002");
  } else {
    const summary = designStyleSummary(call.cwd, styleId);
    sections.push(
      summary ? `\u8BBE\u8BA1\u98CE\u683C\uFF1A${summary.name}\uFF08${styleId}\uFF0C\u5DF2\u9501\u5B9A\uFF09\u3002\u9875\u9762\u5FC5\u987B\u4F7F\u7528\u8BE5\u98CE\u683C\u7684 --ts-* \u53D8\u91CF\u4E0E ts-* \u7EC4\u4EF6\u7C7B\u3002` : `\u8BBE\u8BA1\u98CE\u683C\uFF1A\u672A\u77E5\uFF08${styleId}\uFF09\uFF1B\u8BF7\u91CD\u65B0\u7528 canvas_style\uFF08action=set\uFF09\u8BBE\u7F6E\u3002`
    );
  }
  if (project.nodes.length === 0) {
    sections.push("\u753B\u5E03\u4E0A\u6682\u65E0\u9875\u9762\u8282\u70B9\u3002\n\u7528 canvas_upsert_page \u6DFB\u52A0\u4E00\u4E2A HTML \u539F\u578B\u3002");
  } else {
    const lines = project.nodes.map((n, i) => {
      return `${i + 1}. ${n.title} (id=${n.id})
   \u4F4D\u7F6E x=${n.x}, y=${n.y}\uFF1B\u5C3A\u5BF8 ${n.width}\xD7${n.height}\uFF08${n.deviceType}\uFF09`;
    });
    sections.push(`\u753B\u5E03\u4E0A\u6709 ${project.nodes.length} \u4E2A\u9875\u9762\u8282\u70B9\uFF1A
${lines.join("\n")}`);
  }
  if (project.edges.length > 0) {
    const titleOf = (id) => project.nodes.find((n) => n.id === id)?.title ?? id;
    const lines = project.edges.map(
      (e) => `- ${titleOf(e.source)}\uFF08${e.source}\uFF09 \u2192 ${titleOf(e.target)}\uFF08${e.target}\uFF09${e.label ? `\uFF1A${e.label}` : ""}`
    );
    sections.push(`\u9875\u9762\u8FDE\u7EBF\uFF08${project.edges.length} \u6761\uFF09\uFF1A
${lines.join("\n")}`);
  }
  if (selection) {
    sections.push(`\u5F53\u524D\u9009\u4E2D\uFF1A
${formatSelection(selection, project).join("\n")}`);
  } else {
    sections.push(
      "\u5F53\u524D\u753B\u5E03\u6CA1\u6709\u9009\u4E2D\u9879\u3002\n\u8BF7\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u753B\u5E03\uFF0C\u70B9\u51FB\u67D0\u4E2A\u9875\u9762\u8282\u70B9\uFF08\u6216\u6309\u4F4F Ctrl \u70B9\u51FB\u9875\u9762\u5185\u7684\u5143\u7D20\uFF09\u540E\u518D\u8BD5\u3002"
    );
  }
  const pending = (project.comments ?? []).filter((c) => !c.resolved).length;
  if (pending > 0) {
    sections.push(`\u5F85\u5904\u7406\u6279\u6CE8\uFF1A${pending} \u6761\u3002\u7528 canvas_comments\uFF08action=list\uFF09\u67E5\u770B\u5168\u90E8\u6279\u6CE8\u5E76\u9010\u6761\u4FEE\u6539\u3002`);
  }
  sections.push(url ? `\u753B\u5E03 URL\uFF1A${url}` : "\u63D0\u793A\uFF1A\u5148\u8C03\u7528 canvas_open \u83B7\u53D6\u753B\u5E03 URL\u3002");
  return { content: sections.join("\n\n") };
}
async function canvasArrange(call) {
  const action = str(call.args.action);
  switch (action) {
    case "remove": {
      const id = str(call.args.id);
      if (!id) return { content: "remove \u9700\u8981 id\u3002", isError: true };
      const project = readProject(call.cwd);
      if (!project.nodes.some((n) => n.id === id)) return { content: `\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${id}`, isError: true };
      const next = removeNode(call.cwd, id);
      return { content: `\u5DF2\u5220\u9664\u9875\u9762\u8282\u70B9 ${id}\uFF08\u8FDE\u5E26\u5176\u8FDE\u7EBF\u4E0E\u539F\u578B\u6587\u4EF6\uFF09\u3002\u5269\u4F59 ${next.nodes.length} \u4E2A\u8282\u70B9\u3002` };
    }
    case "duplicate": {
      const id = str(call.args.id);
      if (!id) return { content: "duplicate \u9700\u8981 id\u3002", isError: true };
      try {
        const node = duplicateNode(call.cwd, id, str(call.args.title));
        const { url } = await ensureServer(call.cwd);
        return {
          content: `\u5DF2\u590D\u5236\u9875\u9762\u8282\u70B9\uFF0C\u65B0 id=${node.id}\uFF0C\u6807\u9898\u300C${node.title}\u300D\u3002
\u4F4D\u7F6E\uFF1Ax=${node.x}, y=${node.y}
\u753B\u5E03 URL\uFF1A${url}`
        };
      } catch (err) {
        return { content: err.message, isError: true };
      }
    }
    case "link": {
      const source = str(call.args.source);
      const target = str(call.args.target);
      if (!source || !target) return { content: "link \u9700\u8981 source \u548C target\u3002", isError: true };
      try {
        const edge = addEdge(call.cwd, source, target, str(call.args.label));
        return { content: `\u5DF2\u8FDE\u7EBF ${edge.source} \u2192 ${edge.target}${edge.label ? `\uFF08${edge.label}\uFF09` : ""}\u3002` };
      } catch (err) {
        return { content: err.message, isError: true };
      }
    }
    case "unlink": {
      const source = str(call.args.source);
      const target = str(call.args.target);
      if (!source || !target) return { content: "unlink \u9700\u8981 source \u548C target\u3002", isError: true };
      const before = readProject(call.cwd).edges.length;
      const next = removeEdge(call.cwd, source, target);
      if (next.edges.length === before) return { content: `\u6CA1\u6709\u5339\u914D\u7684\u8FDE\u7EBF ${source} \u2192 ${target}\uFF0C\u672A\u4F5C\u6539\u52A8\u3002` };
      return { content: `\u5DF2\u53D6\u6D88\u8FDE\u7EBF ${source} \u2192 ${target}\u3002` };
    }
    default:
      return {
        content: `\u672A\u77E5\u6216\u7F3A\u5931\u7684 action\uFF1A${action ?? "(\u7A7A)"}\u3002\u53EF\u9009\uFF1Aremove / duplicate / link / unlink\u3002`,
        isError: true
      };
  }
}
function formatStyleList(cwd) {
  let catalog;
  try {
    catalog = loadDesignCatalog(cwd);
  } catch (err) {
    return err.message;
  }
  if (catalog.styles.length === 0) return "\u5F53\u524D\u6784\u5EFA\u4E0D\u5305\u542B\u4EFB\u4F55\u8BBE\u8BA1\u98CE\u683C\u3002";
  const current = currentStyleId(cwd);
  const lines = catalog.styles.map((s) => {
    const templates = s.templates.map((t) => t.name).join(" / ");
    const tag = isBuiltinStyle(s.id) ? "\u5185\u7F6E" : "\u81EA\u5B9A\u4E49";
    return `- ${s.name}\uFF08${s.id}\uFF09[${tag}]\uFF1A${s.tagline}
  \u8272\u677F ${s.swatches.join(" ")}\uFF1B\u56FE\u6807 ${s.counts.icons} \u4E2A\u3001\u7EC4\u4EF6 ${s.counts.components} \u4E2A\uFF1B\u6A21\u677F ${templates || "\u65E0"}`;
  });
  return `${catalog.notice}

\u53EF\u9009\u8BBE\u8BA1\u98CE\u683C\uFF08\u9879\u76EE\u7EA7\u9501\u5B9A\uFF09\uFF1A
${lines.join("\n")}

\u5F53\u524D\uFF1A${current ? `\u5DF2\u9501\u5B9A ${designStyleSummary(cwd, current)?.name ?? current}\uFF08${current}\uFF09` : "\u81EA\u7531\u53D1\u6325\uFF08\u672A\u9501\u5B9A\uFF09"}
\u9501\u5B9A/\u5207\u6362\uFF1Acanvas_style\uFF08action=set, style_id=<id>\uFF09\uFF1B\u56DE\u5230\u81EA\u7531\u53D1\u6325\uFF1Astyle_id=free\u3002
\u7528\u6237\u6CA1\u6709\u6307\u5B9A\u98CE\u683C\u65F6\uFF0C\u628A\u4E0A\u9762\u7684\u98CE\u683C\u540D\u4F5C\u4E3A\u9009\u9879\u95EE\u7528\u6237\u4E00\u6B21\uFF08\u542B\u300C\u81EA\u7531\u53D1\u6325\u300D\uFF09\u3002`;
}
function formatStyleBrief(cwd, styleId) {
  const style = resolveDesignStyle(cwd, styleId);
  if (!style) return `\u672A\u77E5\u7684\u8BBE\u8BA1\u98CE\u683C\uFF1A${styleId}`;
  const { manifest, summary } = style;
  const group = (prefix) => manifest.vars.filter((v) => v.startsWith(prefix));
  const semanticLines = Object.entries(manifest.resolvedSemantic).filter(([key]) => key.startsWith("color.")).map(([key, entry]) => {
    const varName = `--ts-${key.replace(/^color\./, "color-").replace(/\./g, "-")}`;
    const name = varName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    return `${name}=${entry.value}${entry.primitive ? ` (${entry.primitive})` : ""}`;
  });
  const primitives = group("--ts-color-").filter((v) => !Object.keys(manifest.resolvedSemantic).some((k) => {
    const varName = `--ts-${k.replace(/^color\./, "color-").replace(/\./g, "-")}`.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    return varName === v;
  }));
  const families = group("--ts-font-");
  const sizes = group("--ts-fs-");
  const weights = group("--ts-weight-");
  const lineHeights = group("--ts-lh-");
  const spacing = group("--ts-space-");
  const radiusVars = group("--ts-radius-");
  const shadows = group("--ts-shadow-");
  const sizesBox = group("--ts-size-");
  const motion = group("--ts-motion-");
  const icons = manifest.iconNames;
  const iconLines = [];
  for (let i = 0; i < icons.length; i += 10) iconLines.push(icons.slice(i, i + 10).join(" "));
  return `\u8BBE\u8BA1\u98CE\u683C\u300C${summary.name}\u300D\uFF08${styleId}\uFF09
${summary.description}

\u8BED\u4E49\u8272\uFF08${semanticLines.length}\uFF09\uFF1A
${semanticLines.join("\uFF1B")}

\u539F\u8272\u9636\uFF08${primitives.length}\uFF09\uFF1A${primitives.join(" ")}

\u5B57\u4F53\u65CF\uFF1A${families.join(" ")}
\u5B57\u53F7\uFF1A${sizes.join(" ")}
\u5B57\u91CD\uFF1A${weights.join(" ")}
\u884C\u9AD8\uFF1A${lineHeights.join(" ")}

\u95F4\u8DDD\uFF1A${spacing.join(" ")}
\u5706\u89D2\uFF1A${radiusVars.join(" ")}
\u9634\u5F71\uFF1A${shadows.join(" ")}
\u5C3A\u5BF8\uFF1A${sizesBox.join(" ")}
\u52A8\u6548\uFF1A${motion.join(" ")}

\u7EC4\u4EF6\u7C7B\uFF08${manifest.componentClasses.length}\uFF09\uFF1A${manifest.componentClasses.join(" ")}

\u56FE\u6807\uFF08${icons.length}\uFF09\uFF1A
${iconLines.join("\n")}

\u6A21\u677F\uFF1A${Object.keys(style.templates).join(" / ")}
\u5199\u6CD5\uFF1A\u989C\u8272 var(--ts-color-*)\uFF1B\u56FE\u6807 <svg data-icon="\u540D\u5B57" class="ts-icon"></svg>\uFF08\u5199\u5165\u65F6\u81EA\u52A8\u5185\u8054\uFF09\u3002`;
}
var WEB_TARGETS = /* @__PURE__ */ new Set(["react", "css-vars", "tailwind"]);
var PLATFORM_TARGETS = /* @__PURE__ */ new Set(["ios", "android", "miniprogram"]);
function resolveCodegenHtml(call) {
  const inline = str(call.args.html);
  if (inline) return { html: inline, label: "\u4F20\u5165\u7684 HTML" };
  const project = readProject(call.cwd);
  const pageId = str(call.args.page_id);
  if (pageId) {
    const node = project.nodes.find((n) => n.id === pageId);
    if (!node) return { html: null, label: "", error: `\u9875\u9762\u4E0D\u5B58\u5728\uFF1A${pageId}` };
    const html = readPageHtml(call.cwd, pageId);
    if (html === null) return { html: null, label: "", error: `\u9875\u9762\u6587\u4EF6\u7F3A\u5931\uFF1A${pageId}` };
    return { html, label: `\u9875\u9762\u300C${node.title}\u300D(id=${pageId})` };
  }
  if (project.nodes.length === 1) {
    const node = project.nodes[0];
    const html = readPageHtml(call.cwd, node.id);
    if (html !== null) return { html, label: `\u9875\u9762\u300C${node.title}\u300D(id=${node.id})` };
  }
  if (project.nodes.length === 0) return { html: null, label: "", error: "\u753B\u5E03\u4E0A\u6CA1\u6709\u9875\u9762\uFF1B\u8BF7\u5148\u7528 canvas_upsert_page \u5199\u5165\u539F\u578B\uFF0C\u6216\u7528 html \u76F4\u63A5\u4F20\u5165\u3002" };
  return { html: null, label: "", error: `\u753B\u5E03\u4E0A\u6709 ${project.nodes.length} \u4E2A\u9875\u9762\uFF0C\u8BF7\u7528 page_id \u6307\u5B9A\u4E00\u4E2A\uFF0C\u6216\u7528 html \u76F4\u63A5\u4F20\u5165\u3002` };
}
function buildCodegenFiles(call, target, stack) {
  const resolved = resolveCodegenHtml(call);
  if (resolved.error || resolved.html === null) return { files: [], label: "", error: resolved.error };
  if (WEB_TARGETS.has(target)) {
    const styleId = str(call.args.style_id) ?? currentStyleId(call.cwd);
    if (target === "react") {
      return { files: toReactComponent(resolved.html).map((f) => ({ name: f.name, content: f.content })), label: resolved.label };
    }
    if (!styleId || styleId === "free") {
      return { files: [], label: "", error: `${target} \u9700\u8981\u5DF2\u9501\u5B9A\u98CE\u683C\uFF08\u6216\u4F20 style_id\uFF09\uFF1B\u5F53\u524D\u4E3A\u81EA\u7531\u53D1\u6325\u3002` };
    }
    const style = resolveDesignStyle(call.cwd, styleId);
    if (!style) return { files: [], label: "", error: `\u672A\u77E5\u7684\u8BBE\u8BA1\u98CE\u683C\uFF1A${styleId}` };
    if (target === "css-vars") {
      return {
        files: toFrameworklessHtml(resolved.html, { tokensCss: style.tokensCss, componentsCss: style.componentsCss }).map((f) => ({ name: f.name, content: f.content })),
        label: resolved.label
      };
    }
    const vars = parseCssVars(style.tokensCss);
    const colors = {};
    for (const [path, entry] of Object.entries(style.manifest.resolvedSemantic)) {
      const key = path.replace(/^color\./, "").replace(/\./g, "-");
      colors[key] = entry.value;
    }
    const fontSizes = {};
    for (const [name, value] of Object.entries(vars)) {
      const m = /^--ts-fs-(.+)$/.exec(name);
      if (m) fontSizes[m[1]] = value.replace("px", "");
    }
    const spacing = style.manifest.spacing;
    const shadows = {};
    for (const [name, value] of Object.entries(vars)) {
      const m = /^--ts-shadow-(.+)$/.exec(name);
      if (m) shadows[m[1]] = value;
    }
    const families = { sans: vars["--ts-font-sans"] ?? "system-ui", display: vars["--ts-font-display"] ?? "system-ui", mono: vars["--ts-font-mono"] ?? "monospace" };
    return {
      files: [{ name: "tailwind.config.js", content: toTailwindConfig({ colors, fontFamilies: families, fontSizes, spacing, radius: style.manifest.radius, shadows }) }],
      label: resolved.label
    };
  }
  if (PLATFORM_TARGETS.has(target)) {
    const styleId = str(call.args.style_id) ?? currentStyleId(call.cwd);
    if (!styleId || styleId === "free") return { files: [], label: "", error: `target=${target} \u9700\u8981\u5DF2\u9501\u5B9A\u98CE\u683C\uFF08\u6216\u4F20 style_id\uFF09\uFF1B\u5F53\u524D\u4E3A\u81EA\u7531\u53D1\u6325\u3002` };
    const style = resolveDesignStyle(call.cwd, styleId);
    if (!style) return { files: [], label: "", error: `\u672A\u77E5\u7684\u8BBE\u8BA1\u98CE\u683C\uFF1A${styleId}` };
    const platform = target;
    const allowed = STACKS[platform];
    const chosen = stack ?? allowed[0];
    if (!allowed.includes(chosen)) {
      return { files: [], label: "", error: `\u6280\u672F\u6808 ${stack} \u4E0D\u9002\u7528\u4E8E ${target}\uFF1B\u53EF\u9009\uFF1A${allowed.join(" / ")}\u3002` };
    }
    const input = buildPlatformInput(style, defaultComponents());
    try {
      return { files: generatePlatformFiles(platform, chosen, input).map((f) => ({ name: f.name, content: f.content })), label: `${resolved.label} \xB7 ${target}/${chosen}` };
    } catch (err) {
      return { files: [], label: "", error: err.message };
    }
  }
  return { files: [], label: "", error: `\u672A\u77E5\u7684 target\uFF1A${target}\u3002Web\uFF1Areact / css-vars / tailwind\uFF1B\u591A\u7AEF\uFF1Aios / android / miniprogram\u3002` };
}
async function canvasCodegen(call) {
  const target = str(call.args.target);
  if (!target) {
    return {
      content: "codegen \u9700\u8981 target\u3002**\u5148\u95EE\u7528\u6237\u8981\u54EA\u79CD\u76EE\u6807**\uFF08\u4E0D\u8981\u81EA\u884C\u5047\u5B9A\uFF09\uFF1A\n  - react\uFF08React + TSX \u7EC4\u4EF6\uFF09/ css-vars\uFF08CSS \u53D8\u91CF + \u65E0\u6846\u67B6 HTML\uFF09/ tailwind\uFF08Tailwind \u914D\u7F6E + \u6620\u5C04\uFF09\n  - ios / android / miniprogram\uFF08\u591A\u7AEF\uFF1A\u63D2\u4EF6\u51FA\u300C\u4E3B\u9898/Token \u6587\u4EF6 + design-spec.md \u89C4\u683C\u300D\uFF0C\u9875\u9762\u4EE3\u7801\u7531\u4F60\u6309\u89C4\u683C\u7F16\u5199\uFF09\n\u9009\u591A\u7AEF\u65F6\u518D\u95EE**\u6280\u672F\u6808**\uFF08\u5B58\u5230 stack \u53C2\u6570\uFF09\uFF1Aios \u2208 swiftui/uikit\uFF1Bandroid \u2208 compose/xml\uFF1Bminiprogram \u2208 weapp/uniapp/taro\u3002",
      isError: true
    };
  }
  const { files, label, error } = buildCodegenFiles(call, target, str(call.args.stack));
  if (error) return { content: error, isError: true };
  const writeFiles = call.args.write_files === true || typeof call.args.out_dir === "string";
  if (writeFiles) {
    const base = str(call.args.out_dir) ?? join6(PROJECT_DIR_NAME, "exports", `${target}`);
    const dir = join6(call.cwd, base);
    for (const file of files) {
      const abs = join6(dir, file.name);
      mkdirSync4(dirname(abs), { recursive: true });
      writeFileSync4(abs, file.content, "utf8");
    }
    return {
      content: `\u5DF2\u751F\u6210 ${files.length} \u4E2A\u6587\u4EF6\uFF08${label}\uFF0Ctarget=${target}${call.args.stack ? `\uFF0Cstack=${call.args.stack}` : ""}\uFF09\uFF1A
` + files.map((f) => `  - ${join6(base, f.name)}`).join("\n") + `

${codegenCaveat(target)}`
    };
  }
  const body = files.map((f) => `### ${f.name}

\`\`\`
${f.content}
\`\`\``).join("\n\n");
  return {
    content: `\u5DF2\u751F\u6210 ${files.length} \u4E2A\u6587\u4EF6\uFF08${label}\uFF0Ctarget=${target}${call.args.stack ? `\uFF0Cstack=${call.args.stack}` : ""}\uFF09\uFF1A

${body}

\uFF08\u5982\u9700\u843D\u76D8\uFF1A\u4F20 write_files=true \u6216 out_dir\u3002<name> \u4F1A\u5199\u5230 <cwd>/.tianshu-canvas/exports/ \u4E0B\u3002\uFF09

${codegenCaveat(target)}`
  };
}
function codegenCaveat(target) {
  if (target === "react") {
    return "\u6CE8\u610F\uFF1A\u4EA7\u7269\u4F9D\u8D56\u540C\u76EE\u5F55\u7684 components.css \u4E0E tokens.css\uFF08--ts-* \u53D8\u91CF\uFF09\uFF1B\u539F\u578B\u7684 <style>/\u5185\u8054\u6837\u5F0F\u65E0\u6CD5 1:1 \u6620\u5C04\uFF0C\u5FC5\u8981\u5904\u8BF7\u4EBA\u5DE5\u6821\u5BF9\u3002";
  }
  if (PLATFORM_TARGETS.has(target)) {
    return "\u6CE8\u610F\uFF1A\u591A\u7AEF\u4EA7\u7269\u53EA\u4FDD\u8BC1**\u4E3B\u9898/Token \u4E0E design-spec.md \u89C4\u683C**\u786E\u5B9A\u6027\u6B63\u786E\uFF1B**\u9875\u9762\u4EE3\u7801\u9700\u4F60\u6309\u89C4\u683C\u7F16\u5199**\uFF08HTML\u2192\u539F\u751F\u5FC5\u7136\u6709\u635F\uFF0Cflex/grid\u3001\u4F2A\u5143\u7D20\u3001\u81EA\u5B9A\u4E49\u6EDA\u52A8\u65E0\u6CD5 1:1\uFF09\u3002\u8BF7\u4E0D\u8981\u58F0\u79F0\u300C\u50CF\u7D20\u7EA7\u8FD8\u539F\u300D\u3002";
  }
  return "\u6CE8\u610F\uFF1A\u4EA7\u7269\u4E3A\u786E\u5B9A\u6027\u8F6C\u6362\uFF1B\u5982\u9875\u9762\u7528\u4E86\u590D\u6742\u5D4C\u5957\u6216\u811A\u672C\u751F\u6210\u7684\u7ED3\u6784\uFF0C\u8BF7\u4EBA\u5DE5\u6821\u5BF9\u3002";
}
async function canvasStyle(call) {
  const action = str(call.args.action) ?? "list";
  try {
    if (action === "list") return { content: formatStyleList(call.cwd) };
    if (action === "get") {
      const styleId = str(call.args.style_id) ?? currentStyleId(call.cwd);
      if (!styleId || styleId === "free") {
        return {
          content: "\u5F53\u524D\u672A\u9501\u5B9A\u98CE\u683C\uFF08\u81EA\u7531\u53D1\u6325\uFF09\u3002\u5148\u7528 canvas_style\uFF08action=list\uFF09\u67E5\u770B\u53EF\u9009\u98CE\u683C\uFF0C\u518D\u7528 action=set \u9501\u5B9A\u3002"
        };
      }
      if (!designStyleExists(call.cwd, styleId)) return { content: `\u672A\u77E5\u7684\u8BBE\u8BA1\u98CE\u683C\uFF1A${styleId}`, isError: true };
      return { content: formatStyleBrief(call.cwd, styleId) };
    }
    if (action === "set") {
      const raw = str(call.args.style_id);
      if (!raw) return { content: "set \u9700\u8981 style_id\uFF08\u98CE\u683C id\uFF0C\u6216 free \u8868\u793A\u89E3\u9664\u9501\u5B9A\uFF09\u3002", isError: true };
      const styleId = raw === "free" ? null : raw;
      const result = applyProjectStyle(call.cwd, styleId);
      const { url } = await ensureServer(call.cwd);
      const missing = result.missingIcons.length ? `
\u6CE8\u610F\uFF1A\u8FD9\u4E9B\u56FE\u6807\u540D\u4E0D\u5728\u76EE\u5F55\u4E2D\uFF0C\u672A\u5185\u8054\uFF1A${result.missingIcons.slice(0, 8).join("\u3001")}\u3002` : "";
      return {
        content: styleId === null ? `\u5DF2\u89E3\u9664\u98CE\u683C\u9501\u5B9A\uFF1A\u56DE\u5230\u81EA\u7531\u53D1\u6325\uFF1B\u5DF2\u6709\u9875\u9762\u4FDD\u7559\u5F53\u524D\u6CE8\u5165\u7684\u6837\u5F0F\u5757\uFF0C\u65B0\u9875\u9762\u4E0D\u518D\u6CE8\u5165\u3002
\u753B\u5E03 URL\uFF1A${url}` : `\u5DF2\u9501\u5B9A\u8BBE\u8BA1\u98CE\u683C\u300C${result.name}\u300D\uFF08${styleId}\uFF09\uFF1A\u91CD\u5199 ${result.pagesUpdated} \u4E2A\u9875\u9762\uFF08\u753B\u5E03\u4F1A\u81EA\u52A8\u5237\u65B0\uFF09\u3002
\u753B\u5E03 URL\uFF1A${url}${missing}${scriptIconNote(result.scriptIcons)}`
      };
    }
    if (action === "codegen") return await canvasCodegen(call);
    if (action === "template") {
      const styleId = str(call.args.style_id) ?? currentStyleId(call.cwd);
      if (!styleId || styleId === "free") {
        return { content: "template \u9700\u8981\u5DF2\u9501\u5B9A\u7684\u98CE\u683C\uFF0C\u6216\u663E\u5F0F\u4F20 style_id\u3002", isError: true };
      }
      const templateId = str(call.args.template_id) ?? "dashboard";
      const doc = templateDocument(call.cwd, styleId, templateId);
      if (!doc) {
        return { content: `\u53D6\u6A21\u677F\u5931\u8D25\uFF1A\u98CE\u683C ${styleId} \u6CA1\u6709\u6A21\u677F ${templateId}\u3002`, isError: true };
      }
      return {
        content: `\u5DF2\u53D6\u5230\u6A21\u677F\u300C${doc.name}\u300D\uFF08\u98CE\u683C ${styleId}\uFF0C\u8BBE\u5907 ${doc.device}\uFF09\u3002
\u76F4\u63A5\u628A\u4E0B\u9762\u7684 HTML \u4F5C\u4E3A canvas_upsert_page \u7684 html \u4F20\u5165\u5373\u53EF\uFF08\u6837\u5F0F\u5757\u4F1A\u5728\u5199\u5165\u65F6\u6CE8\u5165\uFF09\uFF1A

` + doc.html
      };
    }
    return { content: `\u672A\u77E5\u7684 action\uFF1A${action}\u3002\u53EF\u9009\uFF1Alist / get / set / template / codegen\u3002`, isError: true };
  } catch (err) {
    return { content: err.message, isError: true };
  }
}
async function canvasCheckStyle(call) {
  const inlineHtml = str(call.args.html);
  const override = str(call.args.style_id);
  if (override && override !== "free" && !designStyleExists(call.cwd, override)) {
    return { content: `\u672A\u77E5\u7684\u8BBE\u8BA1\u98CE\u683C\uFF1A${override}\u3002\u53EF\u7528 canvas_style\uFF08action=list\uFF09\u67E5\u770B\u53EF\u9009\u98CE\u683C\u3002`, isError: true };
  }
  const styleId = override === "free" ? null : override ?? currentStyleId(call.cwd);
  if (inlineHtml !== void 0) {
    const report = lintHtml(inlineHtml, styleId, call.cwd);
    return { content: formatLintReport(report, "\u76F4\u63A5\u68C0\u67E5\u4F20\u5165\u7684 HTML") };
  }
  const pageId = str(call.args.page_id);
  if (pageId) {
    const html = readPageHtml(call.cwd, pageId);
    if (html === null) return { content: `\u9875\u9762\u4E0D\u5B58\u5728\uFF1A${pageId}`, isError: true };
    const report = lintHtml(html, styleId, call.cwd);
    return { content: formatLintReport(report, `\u9875\u9762 id=${pageId}`) };
  }
  const project = readProject(call.cwd);
  if (project.nodes.length === 0) return { content: "\u753B\u5E03\u4E0A\u6CA1\u6709\u9875\u9762\u53EF\u68C0\u67E5\u3002" };
  const reports = [];
  let total = 0;
  for (const node of project.nodes) {
    const html = readPageHtml(call.cwd, node.id);
    if (html === null) continue;
    const report = lintHtml(html, styleId, call.cwd);
    total += report.total;
    if (report.total > 0) reports.push(formatLintReport(report, `\u9875\u9762\u300C${node.title}\u300D(id=${node.id})`));
  }
  if (reports.length === 0) {
    const name = styleId ? designStyleSummary(call.cwd, styleId)?.name ?? styleId : null;
    return {
      content: `\u98CE\u683C\u68C0\u67E5\uFF1A${name ? `${name}\uFF08${styleId}\uFF09` : "\u672A\u9501\u5B9A\u98CE\u683C"} \xB7 \u5168\u90E8 ${project.nodes.length} \u4E2A\u9875\u9762
\u672A\u53D1\u73B0\u4E0D\u7B26\u5408\u9879\uFF080 \u5904\uFF09\u3002`
    };
  }
  return { content: `${reports.join("\n\n")}

\u5408\u8BA1\uFF1A${total} \u5904\u3002` };
}
function builtinIds() {
  return designStyleIds();
}
function formatCustomList(cwd) {
  const customs = loadCustomSummaries(cwd, designDir());
  if (customs.length === 0) {
    return `\u5F53\u524D\u9879\u76EE\u8FD8\u6CA1\u6709\u81EA\u5B9A\u4E49\u8BBE\u8BA1\u7CFB\u7EDF\uFF08\u76EE\u5F55\uFF1A${libraryDir(cwd)}\uFF09\u3002
\u7528 canvas_design_system\uFF08action=create\uFF09\u521B\u5EFA\u4E00\u5957\u3002`;
  }
  const current = currentStyleId(cwd);
  const lines = customs.map(
    (s) => `- ${s.name}\uFF08${s.id}\uFF09${s.id === current ? " \u2190 \u5F53\u524D" : ""}
  \u8272\u677F ${s.swatches.join(" ")}\uFF1B\u56FE\u6807 ${s.counts.icons} \u4E2A\u3001\u7EC4\u4EF6 ${s.counts.components} \u4E2A\uFF1B\u6A21\u677F ${s.templates.map((t) => t.name).join(" / ") || "\u65E0"}`
  );
  return `\u672C\u9879\u76EE\u81EA\u5B9A\u4E49\u8BBE\u8BA1\u7CFB\u7EDF\uFF08${customs.length} \u5957\uFF0C\u4EC5\u672C\u5DE5\u4F5C\u533A\u751F\u6548\uFF09\uFF1A
${lines.join("\n")}

\u67E5\u770B\u7EC6\u8282\uFF1Acanvas_design_system\uFF08action=get, id=<id>\uFF09\u3002`;
}
async function canvasDesignSystem(call) {
  const action = str(call.args.action) ?? "list";
  try {
    if (action === "list") {
      const all = await canvasStyle({ ...call, args: { action: "list" } });
      return { content: `${formatCustomList(call.cwd)}

${all.content}` };
    }
    if (action === "get") {
      const id = str(call.args.id) ?? currentStyleId(call.cwd) ?? "";
      if (!id) return { content: "get \u9700\u8981 id\uFF08\u6216\u5148\u9501\u5B9A\u4E00\u5957\u98CE\u683C\uFF09\u3002", isError: true };
      if (!designStyleExists(call.cwd, id)) return { content: `\u672A\u77E5\u7684\u8BBE\u8BA1\u98CE\u683C\uFF1A${id}`, isError: true };
      const brief = formatStyleBrief(call.cwd, id);
      const isCustom = customStyleExists(call.cwd, id);
      const darkNote = isCustom && resolveDesignStyle(call.cwd, id)?.tokensCss.includes(".dark {") ? '\n\n\u6DF1\u8272\u6A21\u5F0F\uFF1A\u9875\u9762\u6839\u5143\u7D20\u52A0 class="dark" \u5373\u5207\u6362\uFF08\u6D45\u8272\u4E3A\u9ED8\u8BA4\uFF09\u3002' : "";
      return { content: `${brief}

\u6765\u6E90\uFF1A${isCustom ? `\u81EA\u5B9A\u4E49\uFF08${libraryDir(call.cwd)}\uFF09` : "\u5185\u7F6E"}${darkNote}` };
    }
    if (action === "extract") {
      const id = str(call.args.id);
      if (!id) return { content: "extract \u9700\u8981 id\uFF08\u65B0\u5EFA\u7684\u98CE\u683C id\uFF1A\u5B57\u6BCD\u6570\u5B57/_/-\uFF0C1\u201364 \u4F4D\uFF09\u3002", isError: true };
      const filePath = str(call.args.path);
      const url = str(call.args.url);
      const source = str(call.args.source);
      if (!source && !filePath && !url) {
        return { content: "extract \u9700\u8981\u6765\u6E90\uFF1Asource\uFF08\u5185\u8054 HTML/CSS\uFF09\u3001path\uFF08\u5DE5\u4F5C\u533A\u5185\u6587\u4EF6\uFF09\u6216 url \u4E4B\u4E00\u3002", isError: true };
      }
      let extracted;
      try {
        extracted = await extractTokens({ source, file: filePath, url });
      } catch (err) {
        return { content: `\u53CD\u62BD\u53D6\u5931\u8D25\uFF1A${err.message}`, isError: true };
      }
      const summary = `\u4ECE\u6765\u6E90\u53CD\u62BD\u53D6\u8BBE\u8BA1\u7CFB\u7EDF\uFF08${extracted.report.length} \u7EC4\uFF09\uFF1A
${extracted.report.map((r) => `  ${r}`).join("\n")}
\u89C2\u6D4B ${extracted.observed} \u9879\u3001\u63A8\u65AD ${extracted.synthesized} \u9879\u3002` + (extracted.warnings.length ? `
\u63D0\u793A\uFF1A${extracted.warnings.join("\uFF1B")}` : "");
      if (call.args.dry_run === true) {
        return {
          content: `${summary}

\uFF08dry_run\uFF1A\u672A\u5199\u5165\u3002\u4E0B\u9762\u662F\u5B8C\u6574 tokens\uFF0C\u53EF\u68C0\u67E5\u540E\u53BB\u6389 dry_run \u518D\u6267\u884C\uFF09
\`\`\`json
${JSON.stringify(extracted.tokens, null, 2)}
\`\`\``
        };
      }
      const result = createCustomStyle(call.cwd, id, extracted.tokens, {
        name: call.args.name ?? `${id}\uFF08\u53CD\u62BD\u53D6\uFF09`,
        tagline: call.args.tagline ?? "\u4ECE\u73B0\u6709\u9875\u9762\u53CD\u62BD\u53D6",
        description: call.args.description ?? "\u7531 canvas_design_system extract \u4ECE\u73B0\u6709 HTML/CSS \u53CD\u62BD\u53D6\u751F\u6210\u3002",
        tags: call.args.tags,
        swatches: call.args.swatches ?? Object.values(extracted.tokens.color.primitives.neutral).slice(0, 4),
        iconStyle: call.args.iconStyle ?? extracted.iconStyle,
        overwrite: call.args.overwrite
      }, designDir(), { overwrite: call.args.overwrite === true, builtinIds: builtinIds() });
      invalidateDesignCache(call.cwd);
      const setCurrent = call.args.set_current !== false;
      let lockLine = "\u672A\u9501\u5B9A\uFF08\u5982\u9700\u4F7F\u7528\uFF1Acanvas_style action=set\uFF09\u3002";
      if (setCurrent) {
        const applied = applyProjectStyle(call.cwd, id);
        const { url: canvasUrl } = await ensureServer(call.cwd);
        lockLine = `\u5DF2\u9501\u5B9A\u4E3A\u5F53\u524D\u9879\u76EE\u98CE\u683C\uFF1A\u91CD\u5199 ${applied.pagesUpdated} \u4E2A\u9875\u9762\uFF08\u753B\u5E03\u4F1A\u81EA\u52A8\u5237\u65B0\uFF09\u3002
\u753B\u5E03 URL\uFF1A${canvasUrl}`;
      }
      return {
        content: `${summary}

\u5DF2\u521B\u5EFA\u81EA\u5B9A\u4E49\u8BBE\u8BA1\u7CFB\u7EDF\u300C${result.summary.name}\u300D\uFF08${id}\uFF09\u5E76\u5B8C\u6210\u6821\u9A8C\u3002
\u6587\u4EF6\uFF1A${libraryDir(call.cwd)}/${id}/{tokens.json,meta.json}
${lockLine}
\uFF08\u53EA\u5728\u672C\u5DE5\u4F5C\u533A\u751F\u6548\uFF0C\u968F .tianshu-canvas/ \u4E00\u8D77\u88AB gitignore\u3002\uFF09`
      };
    }
    if (action === "create") {
      const id = str(call.args.id);
      if (!id) return { content: "create \u9700\u8981 id\uFF08\u98CE\u683C id\uFF1A\u5B57\u6BCD\u6570\u5B57/_/-\uFF0C1\u201364 \u4F4D\uFF09\u3002", isError: true };
      const result = createCustomStyle(call.cwd, id, call.args.tokens, {
        name: call.args.name,
        tagline: call.args.tagline,
        description: call.args.description,
        tags: call.args.tags,
        swatches: call.args.swatches,
        iconStyle: call.args.iconStyle,
        license: call.args.license,
        notice: call.args.notice
      }, designDir(), { overwrite: call.args.overwrite === true, builtinIds: builtinIds() });
      invalidateDesignCache(call.cwd);
      const setCurrent = call.args.set_current !== false;
      let lockLine = "\u672A\u9501\u5B9A\uFF08\u5982\u9700\u4F7F\u7528\uFF1Acanvas_style action=set\uFF09\u3002";
      if (setCurrent) {
        const applied = applyProjectStyle(call.cwd, id);
        const { url } = await ensureServer(call.cwd);
        lockLine = `\u5DF2\u9501\u5B9A\u4E3A\u5F53\u524D\u9879\u76EE\u98CE\u683C\uFF1A\u91CD\u5199 ${applied.pagesUpdated} \u4E2A\u9875\u9762\uFF08\u753B\u5E03\u4F1A\u81EA\u52A8\u5237\u65B0\uFF09\u3002
\u753B\u5E03 URL\uFF1A${url}` + (applied.missingIcons.length ? `
\u6CE8\u610F\uFF1A\u8FD9\u4E9B\u56FE\u6807\u540D\u4E0D\u5728\u76EE\u5F55\u4E2D\uFF1A${applied.missingIcons.slice(0, 8).join("\u3001")}\u3002` : "") + scriptIconNote(applied.scriptIcons);
      }
      const warnLine = result.warnings.length ? `
\u63D0\u793A\uFF1A${result.warnings.join("\uFF1B")}` : "";
      return {
        content: `\u5DF2\u521B\u5EFA\u81EA\u5B9A\u4E49\u8BBE\u8BA1\u7CFB\u7EDF\u300C${result.summary.name}\u300D\uFF08${id}\uFF09\uFF1A${result.summary.swatches.length} \u4E2A\u8272\u5361\u3001\u56FE\u6807 ${result.summary.counts.icons} \u4E2A\u3001\u7EC4\u4EF6 ${result.summary.counts.components} \u4E2A\uFF08\u5171\u4EAB\uFF0C\u4E0D\u53EF\u6269\u5C55\uFF09\u3002
\u6587\u4EF6\uFF1A${libraryDir(call.cwd)}/${id}/{tokens.json,meta.json}
${lockLine}${warnLine}
\u6CE8\u610F\uFF1A\u81EA\u5B9A\u4E49\u8BBE\u8BA1\u7CFB\u7EDF\u53EA\u5728\u672C\u5DE5\u4F5C\u533A\u751F\u6548\uFF08\u968F .tianshu-canvas/ \u4E00\u8D77\u88AB gitignore\uFF09\u3002`
      };
    }
    if (action === "remove") {
      const id = str(call.args.id);
      if (!id) return { content: "remove \u9700\u8981 id\u3002", isError: true };
      if (isBuiltinStyle(id)) return { content: `\u300C${id}\u300D\u662F\u5185\u7F6E\u98CE\u683C\uFF0C\u4E0D\u80FD\u5220\u9664\u3002`, isError: true };
      const wasCurrent = currentStyleId(call.cwd) === id;
      removeCustomStyle(call.cwd, id);
      invalidateDesignCache(call.cwd);
      let unlinkLine = "";
      if (wasCurrent) {
        applyProjectStyle(call.cwd, null);
        unlinkLine = "\n\u5B83\u539F\u672C\u662F\u5F53\u524D\u9501\u5B9A\u7684\u98CE\u683C\uFF0C\u5DF2\u89E3\u9664\u9501\u5B9A\uFF08\u5DF2\u6709\u9875\u9762\u4FDD\u7559\u6CE8\u5165\u7684\u6837\u5F0F\u5757\uFF09\u3002";
      }
      return { content: `\u5DF2\u5220\u9664\u81EA\u5B9A\u4E49\u8BBE\u8BA1\u7CFB\u7EDF\u300C${id}\u300D\u3002${unlinkLine}` };
    }
    return { content: `\u672A\u77E5\u7684 action\uFF1A${action}\u3002\u53EF\u9009\uFF1Acreate / extract / list / get / remove\u3002`, isError: true };
  } catch (err) {
    return { content: err.message, isError: true };
  }
}
function formatComment(c, index, project) {
  const node = project.nodes.find((n) => n.id === c.pageId);
  const pageTitle = node ? node.title : c.pageId;
  const lines = [`${index}. [${c.id}] ${pageTitle}\uFF08${c.pageId}\uFF09\xB7 <${c.tagName || "?"}> xpath=${c.xpath}`];
  if (c.textContent) lines.push(`   \u5F53\u524D\u6587\u672C\uFF1A${c.textContent}`);
  lines.push(`   \u6279\u6CE8\uFF1A${c.note}`);
  if (c.resolved) lines.push("   \uFF08\u5DF2\u89E3\u51B3\uFF09");
  return lines.join("\n");
}
async function canvasComments(call) {
  const action = str(call.args.action) ?? "list";
  try {
    if (action === "list") {
      const project = readProject(call.cwd);
      const all = project.comments ?? [];
      const includeResolved = call.args.include_resolved === true;
      const shown = includeResolved ? all : all.filter((c) => !c.resolved);
      if (all.length === 0) {
        return {
          content: "\u5F53\u524D\u6CA1\u6709\u5143\u7D20\u6279\u6CE8\u3002\n\u7528\u6237\u5728\u753B\u5E03\u4E0A\u9009\u4E2D\u9875\u9762\u5185\u5143\u7D20\u540E\uFF0C\u53EF\u5728\u300C\u9009\u4E2D\u9762\u677F\u300D\u91CC\u5199\u4E00\u53E5\u8BDD\u5E76\u6DFB\u52A0\u6279\u6CE8\uFF1B\u4FDD\u5B58\u540E\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002"
        };
      }
      if (shown.length === 0) {
        return { content: `\u5171\u6709 ${all.length} \u6761\u6279\u6CE8\uFF0C\u5168\u90E8\u5DF2\u89E3\u51B3\u3002\u4F20 include_resolved=true \u53EF\u67E5\u770B\u3002` };
      }
      const sorted = [...shown].sort((a, b) => a.createdAt - b.createdAt);
      const body = sorted.map((c, i) => formatComment(c, i + 1, project)).join("\n");
      const resolved = all.length - all.filter((c) => !c.resolved).length;
      return {
        content: `\u5F85\u5904\u7406\u6279\u6CE8 ${sorted.length} \u6761${resolved ? `\uFF08\u53E6\u6709 ${resolved} \u6761\u5DF2\u89E3\u51B3\uFF09` : ""}\uFF1A

${body}

\u8BF7\u9010\u6761\u6309 xpath \u5B9A\u4F4D\u5E76\u4FEE\u6539\uFF08\u901A\u5E38\u7528 canvas_upsert_page \u91CD\u5199\u8BE5\u9875 HTML\uFF09\uFF1B\u6539\u5B8C\u540E\u8C03\u7528 canvas_comments\uFF08action=resolve, ids=[...]\uFF09\u6807\u8BB0\u5DF2\u89E3\u51B3\u3002`
      };
    }
    if (action === "resolve" || action === "reopen") {
      const ids = Array.isArray(call.args.ids) ? call.args.ids.filter((v) => typeof v === "string") : [];
      if (ids.length === 0) return { content: `${action} \u9700\u8981 ids\uFF08\u6279\u6CE8 id \u6570\u7EC4\uFF09\u3002`, isError: true };
      const project = readProject(call.cwd);
      const known = new Set((project.comments ?? []).map((c) => c.id));
      const missing = ids.filter((id) => !known.has(id));
      const changed = setCommentsResolved(call.cwd, ids, action === "resolve");
      const { url } = await ensureServer(call.cwd);
      const missLine = missing.length ? `
\u672A\u627E\u5230\uFF1A${missing.join("\u3001")}` : "";
      return {
        content: `${action === "resolve" ? "\u5DF2\u6807\u8BB0" : "\u5DF2\u91CD\u65B0\u6253\u5F00"} ${changed} \u6761\u6279\u6CE8\u3002
\u753B\u5E03 URL\uFF1A${url}${missLine}`
      };
    }
    if (action === "remove") {
      const ids = Array.isArray(call.args.ids) ? call.args.ids.filter((v) => typeof v === "string") : void 0;
      const all = call.args.all === true;
      if (!all && (!ids || ids.length === 0)) {
        return { content: "remove \u9700\u8981 ids\uFF08\u6279\u6CE8 id \u6570\u7EC4\uFF09\uFF0C\u6216\u7528 all=true \u6E05\u7A7A\u5168\u90E8\u3002", isError: true };
      }
      const removed = removeComments(call.cwd, all ? void 0 : ids);
      const { url } = await ensureServer(call.cwd);
      return { content: `\u5DF2\u5220\u9664 ${removed} \u6761\u6279\u6CE8\u3002
\u753B\u5E03 URL\uFF1A${url}` };
    }
    return { content: `\u672A\u77E5\u7684 action\uFF1A${action}\u3002\u53EF\u9009\uFF1Alist / resolve / reopen / remove\u3002`, isError: true };
  } catch (err) {
    return { content: err.message, isError: true };
  }
}
var tools = [
  {
    definition: {
      name: "canvas_open",
      description: "\u542F\u52A8/\u590D\u7528\u672C\u5DE5\u4F5C\u533A\u7684\u672C\u5730\u753B\u5E03\u670D\u52A1\uFF0C\u8FD4\u56DE\u53EF\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u7684 URL\uFF08127.0.0.1\uFF09\u3002**\u8FD9\u662F\u753B\u5E03\u8BBE\u8BA1\u7684\u7B2C\u4E00\u6B65\uFF1A\u5148\u8C03\u7528\u672C\u5DE5\u5177\u628A\u753B\u5E03\u94FE\u63A5\u7ED9\u7528\u6237\uFF0C\u518D\u5F00\u59CB\u751F\u6210\u539F\u578B\u3002**",
      input_schema: {
        type: "object",
        properties: {
          port: { type: "integer", description: "\u53EF\u9009\u9996\u9009\u7AEF\u53E3\uFF1B0=\u81EA\u52A8\u5206\u914D\uFF08\u9ED8\u8BA4 43117\uFF0C\u88AB\u5360\u7528\u5219\u9012\u589E\uFF09" },
          open: { type: "boolean", description: "\u53EF\u9009\uFF1A\u5C1D\u8BD5\u7528\u7CFB\u7EDF\u9ED8\u8BA4\u6D4F\u89C8\u5668\u6253\u5F00\uFF08\u9ED8\u8BA4 false\uFF09" }
        },
        required: []
      }
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: canvasOpen
  },
  {
    definition: {
      name: "canvas_upsert_page",
      description: "\u65B0\u589E\u6216\u66F4\u65B0\u753B\u5E03\u4E0A\u7684\u9875\u9762\u8282\u70B9\u3002\u4F18\u5148\u4F20 html\uFF08\u5185\u8054\uFF09\u5199\u5165 HTML \u539F\u578B\uFF08\u539F\u578B\u81EA\u52A8\u4FDD\u5B58\u5230 .tianshu-canvas/pages/\uFF0C\u65E0\u9700\u4E5F\u4E0D\u8981\u5728\u5DE5\u4F5C\u533A\u53E6\u5EFA\u6587\u4EF6\u5939\uFF09\uFF0Chtml_path \u4EC5\u7528\u4E8E\u5BFC\u5165\u5DF2\u6709\u6587\u4EF6\u3002\u539F\u578B\u5FC5\u987B\u81EA\u5305\u542B\uFF1A\u5916\u94FE\uFF08CDN\u3001\u5B57\u4F53\u3001\u56FE\u7247\uFF09\u548C\u76F8\u5BF9\u8DEF\u5F84\u90FD\u4F1A\u88AB\u753B\u5E03 CSP \u62E6\u622A\uFF0C\u8D44\u6E90\u8BF7\u5185\u8054\uFF1B\u5BF9\u5DF2\u6709 id \u53EF\u7701\u7565 html\uFF0C\u4EC5\u66F4\u65B0\u6807\u9898/\u4F4D\u7F6E/\u5C3A\u5BF8/\u8BBE\u5907\uFF08\u5373\u91CD\u547D\u540D\u3001\u79FB\u52A8\u3001\u8C03\u6574\u5C3A\u5BF8\uFF0C\u672A\u6307\u5B9A\u7684\u5B57\u6BB5\u4FDD\u6301\u539F\u503C\uFF09\u3002\u8FD4\u56DE\u91CC\u4F1A\u5E26\u4E0A\u753B\u5E03 URL\uFF08\u82E5\u753B\u5E03\u670D\u52A1\u5C1A\u672A\u542F\u52A8\u4F1A\u81EA\u52A8\u542F\u52A8\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          html_path: { type: "string", description: "\u5DF2\u6709 HTML \u6587\u4EF6\u8DEF\u5F84\uFF08\u5DE5\u4F5C\u533A\u5185\uFF0C\u4F18\u5148\u4E8E html\uFF09\uFF1B\u4E00\u822C\u4E0D\u8981\u7528\uFF0C\u8BF7\u76F4\u63A5\u7528 html \u5185\u8054\uFF0C\u907F\u514D\u5728\u5DE5\u4F5C\u533A\u4EA7\u751F\u591A\u4F59\u6587\u4EF6" },
          html: { type: "string", description: "\u5185\u8054 HTML\uFF08\u63A8\u8350\u65B9\u5F0F\uFF1A\u539F\u578B\u53EA\u5B58\u653E\u5728 .tianshu-canvas/pages/\uFF0C\u4E0D\u8981\u53E6\u5EFA\u6587\u4EF6\u5939\uFF09\uFF1B\u66F4\u65B0\u5DF2\u6709\u9875\u9762\u7684\u5143\u6570\u636E\u65F6\u53EF\u7701\u7565" },
          title: { type: "string", description: "\u9875\u9762\u6807\u9898" },
          id: { type: "string", description: "\u9875\u9762 id\uFF08\u5B57\u6BCD\u6570\u5B57/_/-\uFF09\u3002\u7F3A\u7701\u5219\u65B0\u5EFA\u5E76\u81EA\u52A8\u751F\u6210\uFF1B\u4F20\u5DF2\u5B58\u5728\u7684 id \u5219\u66F4\u65B0\u8BE5\u9875\u9762" },
          x: { type: "number", description: "\u753B\u5E03 X \u5750\u6807\uFF08\u65B0\u5EFA\u7F3A\u7701\u6309\u7F51\u683C\u81EA\u52A8\u6392\u5E03\uFF1B\u66F4\u65B0\u7F3A\u7701\u4FDD\u6301\u539F\u4F4D\uFF09" },
          y: { type: "number", description: "\u753B\u5E03 Y \u5750\u6807\uFF08\u65B0\u5EFA\u7F3A\u7701\u6309\u7F51\u683C\u81EA\u52A8\u6392\u5E03\uFF1B\u66F4\u65B0\u7F3A\u7701\u4FDD\u6301\u539F\u4F4D\uFF09" },
          width: { type: "number", description: "\u903B\u8F91\u5BBD\u5EA6 px\uFF08\u8986\u76D6\u8BBE\u5907\u9884\u8BBE\uFF09" },
          height: { type: "number", description: "\u903B\u8F91\u9AD8\u5EA6 px\uFF08\u8986\u76D6\u8BBE\u5907\u9884\u8BBE\uFF09" },
          device_type: {
            type: "string",
            enum: ["desktop", "tablet", "mobile", "free"],
            description: "\u8BBE\u5907\u9884\u8BBE\uFF08\u65B0\u5EFA\u9ED8\u8BA4 desktop\uFF1B\u66F4\u65B0\u7F3A\u7701\u4FDD\u6301\u539F\u8BBE\u5907\u4E0E\u5C3A\u5BF8\uFF09"
          },
          inline_assets: {
            type: "boolean",
            description: "\u53EF\u9009\uFF08\u9ED8\u8BA4 false\uFF09\uFF1A\u628A\u539F\u578B\u91CC\u4F1A\u88AB\u753B\u5E03 CSP \u62E6\u622A\u7684\u5916\u94FE/\u76F8\u5BF9\u8DEF\u5F84\u8D44\u6E90\u6293\u53D6\u5E76\u5185\u8054\u4E3A data: URI\uFF08\u56FE\u7247/\u5B57\u4F53/CSS/SVG/\u811A\u672C\uFF09\u3002\u76F8\u5BF9\u8DEF\u5F84\u9700\u8981\u540C\u65F6\u7ED9\u51FA inline_assets_origin\u3002\u6293\u53D6\u5931\u8D25\u6216\u8D85\u9650\u7684\u8D44\u6E90\u4FDD\u7559\u539F\u5F15\u7528\u5E76\u5728\u8FD4\u56DE\u91CC\u8BF4\u660E\u3002\u5F00\u542F\u524D\u8BF7\u786E\u8BA4\u8FD9\u4E9B\u5916\u90E8\u8D44\u6E90\u662F\u4F60\u4FE1\u4EFB\u7684\u6765\u6E90\u3002"
          },
          inline_assets_origin: {
            type: "string",
            description: "\u53EF\u9009\uFF1A\u5185\u8054\u76F8\u5BF9\u8DEF\u5F84\u8D44\u6E90\u65F6\u7684\u57FA\u51C6\u5730\u5740\uFF08\u5982 https://example.com/page\uFF09\uFF0C\u7528\u4E8E\u628A ./img/a.png \u89E3\u6790\u6210\u7EDD\u5BF9 URL\u3002"
          },
          inline_assets_max_kb: {
            type: "integer",
            description: "\u53EF\u9009\uFF1A\u5355\u4E2A\u5185\u8054\u8D44\u6E90\u7684\u4F53\u79EF\u4E0A\u9650\uFF08KB\uFF0C\u9ED8\u8BA4 2048\uFF0C\u786C\u9876 5120\uFF09\u3002"
          }
        },
        required: []
      }
    },
    pathParams: { html_path: "read" },
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: withBackupNotice(canvasUpsertPage)
  },
  {
    definition: {
      name: "canvas_get_state",
      description: "\u8BFB\u53D6\u753B\u5E03\u5F53\u524D\u72B6\u6001\uFF1A\u6240\u6709\u9875\u9762\u8282\u70B9\uFF08id/\u6807\u9898/\u4F4D\u7F6E/\u5C3A\u5BF8/\u8BBE\u5907\uFF09\u3001\u9875\u9762\u8FDE\u7EBF\u3001\u7528\u6237\u5728\u753B\u5E03\u4E0A\u7684\u9009\u4E2D\u9879\uFF08\u6574\u4E2A\u9875\u9762\u6216\u9875\u9762\u5185\u5143\u7D20\uFF0C\u542B xpath/\u6807\u7B7E/\u6587\u6848/\u5173\u952E\u6837\u5F0F\uFF09\u4EE5\u53CA\u753B\u5E03 URL\u3002\u4FEE\u6539\u8BBE\u8BA1\u524D\u5148\u8C03\u7528\uFF0C\u636E\u6B64\u5B9A\u4F4D\u7528\u6237\u6307\u7684\u662F\u54EA\u4E2A\u9875\u9762/\u5143\u7D20\u3002",
      input_schema: { type: "object", properties: {}, required: [] }
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: withBackupNotice(canvasGetState)
  },
  {
    definition: {
      name: "canvas_arrange",
      description: "\u7F16\u6392\u753B\u5E03\uFF1A\u6309 action \u5220\u9664\u9875\u9762\uFF08remove\uFF0C\u8FDE\u5E26\u5176\u8FDE\u7EBF\u4E0E\u539F\u578B\u6587\u4EF6\uFF09\u3001\u590D\u5236\u9875\u9762\uFF08duplicate\uFF09\u3001\u5728\u4E24\u4E2A\u9875\u9762\u95F4\u8FDE\u7EBF\uFF08link\uFF09\u6216\u53D6\u6D88\u8FDE\u7EBF\uFF08unlink\uFF09\u3002\u91CD\u547D\u540D/\u79FB\u52A8\u8BF7\u7528 canvas_upsert_page\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["remove", "duplicate", "link", "unlink"],
            description: "\u64CD\u4F5C\u7C7B\u578B"
          },
          id: { type: "string", description: "remove / duplicate \u4F7F\u7528\uFF1A\u9875\u9762\u8282\u70B9 id" },
          title: { type: "string", description: "duplicate \u53EF\u9009\uFF1A\u65B0\u6807\u9898\uFF08\u9ED8\u8BA4\u300C\u539F\u6807\u9898 \u526F\u672C\u300D\uFF09" },
          source: { type: "string", description: "link / unlink \u4F7F\u7528\uFF1A\u6E90\u9875\u9762 id" },
          target: { type: "string", description: "link / unlink \u4F7F\u7528\uFF1A\u76EE\u6807\u9875\u9762 id" },
          label: { type: "string", description: "link \u53EF\u9009\uFF1A\u8FDE\u7EBF\u6807\u7B7E" }
        },
        required: ["action"]
      }
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: withBackupNotice(canvasArrange)
  },
  {
    definition: {
      name: "canvas_style",
      description: "\u67E5\u770B/\u9501\u5B9A/\u5207\u6362\u9879\u76EE\u7EA7\u8BBE\u8BA1\u98CE\u683C\uFF0C\u53D6\u9875\u9762\u6A21\u677F HTML\uFF0C\u6216\u628A\u8BBE\u8BA1**\u5BFC\u51FA\u4E3A\u751F\u4EA7\u4EE3\u7801**\u3002action=list \u5217\u51FA\u5168\u90E8\u53EF\u9009\u98CE\u683C\u4E0E\u5F53\u524D\u72B6\u6001\uFF08\u7528\u6237\u6CA1\u6307\u5B9A\u98CE\u683C\u65F6\u636E\u6B64\u63D0\u95EE\uFF09\uFF1Bget \u67E5\u770B\u67D0\u98CE\u683C\u7684 token/\u7EC4\u4EF6\u7C7B/\u56FE\u6807\u540D\uFF1Bset \u9501\u5B9A\u6216\u5207\u6362\u98CE\u683C\uFF08style_id=\u98CE\u683C id\uFF0Cfree \u8868\u793A\u89E3\u9664\u9501\u5B9A\uFF0C\u4F1A\u91CD\u5199\u6240\u6709\u9875\u9762\u5E76\u5237\u65B0\u753B\u5E03\uFF09\uFF1Btemplate \u53D6 dashboard/landing \u6A21\u677F\u7684\u5B8C\u6574 HTML\uFF0C\u53EF\u76F4\u63A5\u4F20\u7ED9 canvas_upsert_page\uFF1Bcodegen \u751F\u6210\u751F\u4EA7\u4EE3\u7801\uFF08**\u5FC5\u987B\u5148\u95EE\u7528\u6237\u8981\u54EA\u79CD\u76EE\u6807**\uFF0C\u4E0D\u8981\u81EA\u884C\u5047\u5B9A\uFF09\u3002\ncodegen \u7684 target\uFF1Areact\uFF08React+TSX \u7EC4\u4EF6\uFF09/ css-vars\uFF08CSS \u53D8\u91CF+\u65E0\u6846\u67B6 HTML\uFF09/ tailwind\uFF08Tailwind \u914D\u7F6E\uFF09\uFF1B\u591A\u7AEF\uFF08ios / android / miniprogram\uFF09\u9700\u518D\u95EE**\u6280\u672F\u6808**\u5E76\u4F20\u5165 stack\uFF08ios: swiftui|uikit\uFF1Bandroid: compose|xml\uFF1Bminiprogram: weapp|uniapp|taro\uFF09\u3002\u591A\u7AEF\u4EA7\u7269\u662F\u300C\u4E3B\u9898/Token \u6587\u4EF6 + design-spec.md \u89C4\u683C\u6E05\u5355\u300D\uFF0C**\u9875\u9762\u4EE3\u7801\u7531\u4F60\u6309\u89C4\u683C\u7F16\u5199**\uFF08HTML\u2192\u539F\u751F\u5FC5\u7136\u6709\u635F\uFF0C\u4E0D\u5F97\u58F0\u79F0\u50CF\u7D20\u7EA7\u8FD8\u539F\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "get", "set", "template", "codegen"], description: "list=\u5217\u51FA\u98CE\u683C\uFF1Bget=\u67E5\u770B\u7EC6\u8282\uFF1Bset=\u9501\u5B9A/\u5207\u6362\uFF1Btemplate=\u53D6\u6A21\u677F\uFF1Bcodegen=\u5BFC\u51FA\u751F\u4EA7\u4EE3\u7801" },
          style_id: {
            type: "string",
            description: "\u98CE\u683C id\uFF08set/get/template/codegen \u4F7F\u7528\uFF09\uFF0C\u5185\u7F6E\u6216\u81EA\u5B9A\u4E49\u5747\u53EF\uFF1Bfree \u8868\u793A\u89E3\u9664\u9501\u5B9A"
          },
          template_id: { type: "string", description: "action=template \u65F6\u4F7F\u7528\uFF1A\u6A21\u677F id\uFF08\u5982 dashboard / landing\uFF09" },
          target: {
            type: "string",
            enum: ["react", "css-vars", "tailwind", "ios", "android", "miniprogram"],
            description: "codegen\uFF1A\u76EE\u6807\u3002Web\uFF1Areact / css-vars / tailwind\uFF1B\u591A\u7AEF\uFF1Aios / android / miniprogram\uFF08\u9700\u914D\u5408 stack\uFF09"
          },
          stack: {
            type: "string",
            enum: ["swiftui", "uikit", "compose", "xml", "weapp", "uniapp", "taro"],
            description: "codegen \u591A\u7AEF\u4E13\u7528\uFF1A\u6280\u672F\u6808\u3002ios\u2192swiftui|uikit\uFF1Bandroid\u2192compose|xml\uFF1Bminiprogram\u2192weapp|uniapp|taro\u3002Web \u76EE\u6807\u5FFD\u7565\u3002"
          },
          page_id: { type: "string", description: "codegen\uFF1A\u8981\u8F6C\u6362\u7684\u9875\u9762 id\uFF1B\u7701\u7565\u65F6\u82E5\u753B\u5E03\u53EA\u6709\u4E00\u4E2A\u9875\u9762\u5219\u7528\u5B83" },
          html: { type: "string", description: "codegen\uFF1A\u76F4\u63A5\u4F20\u5165\u6E90 HTML\uFF08\u4F18\u5148\u4E8E page_id\uFF09" },
          out_dir: { type: "string", description: "codegen\uFF1A\u843D\u76D8\u76EE\u5F55\uFF08\u76F8\u5BF9 cwd\uFF1B\u9ED8\u8BA4 .tianshu-canvas/exports/<target>/\uFF09" },
          write_files: { type: "boolean", description: "codegen\uFF1A\u662F\u5426\u5199\u5230\u78C1\u76D8\uFF08\u9ED8\u8BA4 false\uFF0C\u76F4\u63A5\u8FD4\u56DE\u6587\u4EF6\u5185\u5BB9\uFF09" }
        },
        required: ["action"]
      }
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: withBackupNotice(canvasStyle)
  },
  {
    definition: {
      name: "canvas_check_style",
      description: "\u53EA\u8BFB\u68C0\u67E5\u9875\u9762\u662F\u5426\u7B26\u5408\u5F53\u524D\u8BBE\u8BA1\u98CE\u683C\uFF08\u88F8\u8272\u503C\u3001\u975E token \u5B57\u4F53\u3001\u8D8A\u754C\u95F4\u8DDD/\u5706\u89D2\u3001\u76EE\u5F55\u5916\u56FE\u6807\u4E0E\u7EC4\u4EF6\u7C7B\u3001\u672A\u77E5\u53D8\u91CF\u3001\u4F1A\u88AB CSP \u62E6\u622A\u7684\u8D44\u6E90\uFF09\u3002\u6309 page_id \u68C0\u67E5\u5355\u9875\u3001\u7701\u7565\u5219\u68C0\u67E5\u5168\u90E8\u9875\u9762\uFF1B\u4E5F\u53EF\u7528 html \u76F4\u63A5\u68C0\u67E5\u4E00\u6BB5\u672A\u843D\u76D8\u7684 HTML\u3002\u53EA\u62A5\u544A\u3001\u4E0D\u4FEE\u6539\u6587\u4EF6\u3001\u4E0D\u963B\u585E\u5199\u5165\u3002",
      input_schema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "\u8981\u68C0\u67E5\u7684\u9875\u9762 id\uFF1B\u7701\u7565\u5219\u68C0\u67E5\u5168\u90E8\u9875\u9762" },
          html: { type: "string", description: "\u76F4\u63A5\u68C0\u67E5\u4E00\u6BB5 HTML\uFF08\u4F18\u5148\u4E8E page_id\uFF09\uFF0C\u7528\u4E8E\u5199\u5165\u524D\u81EA\u67E5" },
          style_id: {
            type: "string",
            description: "\u8986\u76D6\u5F53\u524D\u9501\u5B9A\u7684\u98CE\u683C\uFF08\u5185\u7F6E\u6216\u81EA\u5B9A\u4E49 id\uFF09\uFF1Bfree \u8868\u793A\u53EA\u68C0\u67E5\u8D44\u6E90\u5F15\u7528"
          }
        },
        required: []
      }
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: canvasCheckStyle
  },
  {
    definition: {
      name: "canvas_design_system",
      description: '\u5728**\u5F53\u524D\u9879\u76EE**\u521B\u5EFA/\u67E5\u770B/\u5220\u9664\u4E00\u5957\u81EA\u5B9A\u4E49\u8BBE\u8BA1\u7CFB\u7EDF\uFF08\u4EC5\u672C\u5DE5\u4F5C\u533A\u751F\u6548\uFF0C\u5B58 .tianshu-canvas/library/\uFF09\u3002\u7528\u6237\u8BF4\u300C\u8981\u505A\u4E00\u5957\u8BBE\u8BA1\u7CFB\u7EDF\u300D\u65F6\u7528\u5B83\uFF1A\u5148\u4E3B\u52A8\u95EE\u6E05\u914D\u7F6E\uFF08\u914D\u8272\u3001\u5706\u89D2\u3001\u5B57\u53F7\u3001\u5B57\u4F53\u3001\u52A8\u6548\u3001\u9634\u5F71\u3001\u63A7\u4EF6\u5C3A\u5BF8\u3001\u662F\u5426\u8981\u6DF1\u8272\uFF09\uFF0C\u7136\u540E action=create \u4F20\u5165\u5B8C\u6574 tokens\u3002\ntokens \u5951\u7EA6\uFF08\u503C\u81EA\u7531\u3001\u53D8\u91CF\u540D\u5FC5\u987B\u4E0E\u5185\u7F6E\u98CE\u683C\u4E00\u81F4\uFF09\uFF1A\n- color.primitives\uFF1Aneutral{0,50,100,200,300,500,700,900}\u3001brand{100,300,500,600,700}\u3001success{50,500}\u3001warning{50,500}\u3001danger{50,500}\u3001info{50,500}\uFF0C\u503C\u5747\u4E3A #hex\u3002\n- color.semantic\uFF08\u6D45\u8272\uFF09\u4E0E color.semanticDark\uFF08\u6DF1\u8272\uFF0C\u540C\u7ED3\u6784\uFF09\uFF1A\u4E03\u7EC4\u2014\u2014bg{canvas,surface,raised,sunken,inverse}\u3001text{primary,secondary,muted,inverse,link}\u3001border{default,strong,subtle,focus}\u3001action{primary,primaryHover,primaryText,secondary,secondaryHover,secondaryText,ghostHover,danger,dangerText}\u3001status{success,successBg,warning,warningBg,danger,dangerBg,info,infoBg}\u3001chart{1,2,3,4,5}\u3001overlay{scrim}\uFF1B\u503C\u5199 "\u7EC4.\u6B65"\uFF08\u5982 neutral.900\uFF09\u6216 #hex/rgba()\u3002\n- font\uFF1Afamilies{sans,display,mono}\u3001sizes{xs,sm,md,lg,xl,2xl,3xl,4xl}(px)\u3001weights{regular,medium,semibold,bold}\u3001lineHeights{tight,snug,normal,relaxed}\u3001letterSpacing{tight,normal,wide}\u3002\n- space\uFF08\u952E 0..16\uFF0C\u503C\u987B\u4E25\u683C\u9012\u589E\uFF09\u3001radius{none,sm,md,lg,xl,full}\uFF08\u503C\u9012\u589E\uFF0Cfull=9999\uFF09\u3001borderWidth{hairline,thin,thick}\u3001size{controlSm..containerLg,sidebar}\u3001shadow{sm,md,lg}\u3001motion{fast,base,easing}\u3002\n\u5199\u5165\u524D\u4F1A\u6821\u9A8C\uFF1A\u5BF9\u6BD4\u5EA6\uFF08\u6D45\u8272\u4E0E\u6DF1\u8272\u5404\u4E00\u904D\uFF0C\u6B63\u6587\u22654.5\uFF09\u3001\u5C3A\u5EA6\u9012\u589E\u3001\u53D8\u91CF\u540D\u8986\u76D6\u5171\u4EAB\u7EC4\u4EF6/\u6A21\u677F\uFF1B\u4E0D\u901A\u8FC7\u4F1A\u8FD4\u56DE\u9010\u6761\u9519\u8BEF\u3002\u6DF1\u8272\u7528\u9875\u9762\u6839\u5143\u7D20 class="dark" \u5207\u6362\u3002\u7EC4\u4EF6\uFF08ts-*\uFF09\u4E0E\u56FE\u6807\u4E3A\u5171\u4EAB\u8D44\u6E90\uFF0C\u4E0D\u652F\u6301\u6269\u5C55\u3002\naction=extract\uFF1A**\u4ECE\u73B0\u6709 HTML/CSS\uFF08\u6216\u4E00\u4E2A URL\uFF09\u53CD\u63A8**\u51FA\u4E00\u5957\u80FD\u901A\u8FC7\u4E0A\u8FF0\u6821\u9A8C\u7684\u8BBE\u8BA1\u7CFB\u7EDF \u2014\u2014 \u7528\u6237\u8BF4\u300C\u7167\u8FD9\u4E2A\u7AD9\u70B9\u7684\u98CE\u683C\u505A\u300D\u300C\u7528\u8FD9\u4E2A\u9875\u9762\u7684\u914D\u8272\u300D\u65F6\u7528\u5B83\u3002\u4F20 source\uFF08\u5185\u8054 HTML/CSS\uFF09\u3001path\uFF08\u5DE5\u4F5C\u533A\u5185 .html/.css \u6587\u4EF6\uFF09\u6216 url \u4E4B\u4E00\uFF1B\u5148\u7528 dry_run=true \u9884\u89C8 tokens\u3002',
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "extract", "list", "get", "remove"], description: "create=\u521B\u5EFA\uFF1Bextract=\u4ECE\u73B0\u6709 HTML/CSS/URL \u53CD\u62BD\u53D6\uFF1Blist=\u5217\u51FA\uFF1Bget=\u67E5\u770B\u7EC6\u8282\uFF1Bremove=\u5220\u9664" },
          source: { type: "string", description: "extract\uFF1A\u5185\u8054 HTML \u6216 CSS \u6587\u672C\uFF08\u6700\u9AD8\u4F18\u5148\uFF09" },
          path: { type: "string", description: "extract\uFF1A\u5DE5\u4F5C\u533A\u5185\u7684 HTML/CSS \u6587\u4EF6\u8DEF\u5F84" },
          url: { type: "string", description: "extract\uFF1A\u8FDC\u7A0B\u9875\u9762 URL\uFF08\u4EC5 http/https\uFF1B\u4F1A\u505A SSRF \u9632\u62A4\uFF0C\u7981\u5185\u7F51\uFF09" },
          dry_run: { type: "boolean", description: "extract\uFF1A\u53EA\u9884\u89C8\uFF08\u8FD4\u56DE\u6458\u8981 + \u5B8C\u6574 tokens\uFF09\uFF0C\u4E0D\u5199\u76D8\uFF08\u9ED8\u8BA4 false\uFF09" },
          id: { type: "string", description: "\u98CE\u683C id\uFF1A\u5B57\u6BCD\u6570\u5B57/_/-\uFF0C1\u201364 \u4F4D\uFF1B\u4E0D\u5F97\u4E0E\u5185\u7F6E\u98CE\u683C\u91CD\u540D" },
          name: { type: "string", description: "create\uFF1A\u98CE\u683C\u663E\u793A\u540D" },
          tagline: { type: "string", description: "create\uFF1A\u4E00\u53E5\u8BDD\u63CF\u8FF0" },
          description: { type: "string", description: "create\uFF1A\u8F83\u957F\u63CF\u8FF0" },
          tags: { type: "array", items: { type: "string" }, description: "create\uFF1A\u6807\u7B7E" },
          swatches: { type: "array", items: { type: "string" }, description: "create\uFF1A\u8272\u5361\uFF084 \u4E2A hex\uFF0C\u7528\u4E8E\u753B\u5E03\u9876\u680F\u5C55\u793A\uFF09" },
          iconStyle: {
            type: "object",
            description: "create\uFF1A\u56FE\u6807\u63CF\u8FB9\u98CE\u683C\uFF1BstrokeWidth \u5FC5\u586B\uFF08\u6570\u5B57\uFF0C\u5982 1.5 / 1.75\uFF09\uFF0Clinecap/linejoin \u53EF\u9009",
            properties: {
              strokeWidth: { type: "number" },
              linecap: { type: "string" },
              linejoin: { type: "string" }
            },
            required: ["strokeWidth"]
          },
          tokens: { type: "object", description: "create\uFF1A\u5B8C\u6574 tokens \u5BF9\u8C61\uFF08\u5951\u7EA6\u89C1\u672C\u5DE5\u5177\u63CF\u8FF0\uFF09" },
          overwrite: { type: "boolean", description: "create\uFF1Aid \u5DF2\u5B58\u5728\u65F6\u662F\u5426\u8986\u76D6\uFF08\u9ED8\u8BA4 false\uFF09" },
          set_current: { type: "boolean", description: "create\uFF1A\u662F\u5426\u7ACB\u5373\u9501\u5B9A\u4E3A\u5F53\u524D\u9879\u76EE\u98CE\u683C\uFF08\u9ED8\u8BA4 true\uFF09" }
        },
        required: ["action"]
      }
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: canvasDesignSystem
  },
  {
    definition: {
      name: "canvas_comments",
      description: "\u8BFB\u53D6/\u5904\u7406\u7528\u6237\u5728\u753B\u5E03\u4E0A\u7559\u4E0B\u7684\u5143\u7D20\u6279\u6CE8\uFF08\u7528\u6237\u5728\u753B\u5E03\u9009\u4E2D\u5143\u7D20\u540E\u5199\u4E00\u53E5\u8BDD\u6253\u56FE\u9489\uFF09\u3002action=list \u4E00\u6B21\u8FD4\u56DE\u5168\u90E8\u5F85\u5904\u7406\u6279\u6CE8\uFF08\u542B\u9875\u7801\u6807\u9898\u3001\u6807\u7B7E\u3001xpath\u3001\u5F53\u524D\u6587\u672C\u4E0E\u6279\u6CE8\u5185\u5BB9\uFF09\uFF0C\u636E\u6B64\u9010\u6761\u4FEE\u6539\uFF1B\u6539\u5B8C\u540E\u7528 resolve \u4F20 ids \u6807\u8BB0\u5DF2\u89E3\u51B3\uFF0Creopen \u91CD\u65B0\u6253\u5F00\uFF0Cremove \u5220\u9664\uFF08\u6216 all=true \u6E05\u7A7A\u5168\u90E8\uFF09\u3002\u7528\u6237\u8BF4\u300C\u753B\u5E03\u4E0A\u6709\u51E0\u5904\u8981\u6539\u300D\u300C\u6211\u5708\u4E86\u51E0\u5904\u95EE\u9898\u300D\u65F6\u7528\u5B83\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "resolve", "reopen", "remove"], description: "list=\u5217\u51FA\u6279\u6CE8\uFF08\u9ED8\u8BA4\uFF09\uFF1Bresolve=\u6807\u8BB0\u5DF2\u89E3\u51B3\uFF1Breopen=\u91CD\u65B0\u6253\u5F00\uFF1Bremove=\u5220\u9664" },
          ids: { type: "array", items: { type: "string" }, description: "resolve / reopen / remove \u4F7F\u7528\uFF1A\u6279\u6CE8 id \u6570\u7EC4" },
          include_resolved: { type: "boolean", description: "list \u53EF\u9009\uFF1A\u662F\u5426\u4E00\u5E76\u5217\u51FA\u5DF2\u89E3\u51B3\u7684\u6279\u6CE8\uFF08\u9ED8\u8BA4 false\uFF09" },
          all: { type: "boolean", description: "remove \u53EF\u9009\uFF1A\u6E05\u7A7A\u5168\u90E8\u6279\u6CE8\uFF08\u5FFD\u7565 ids\uFF09" }
        },
        required: ["action"]
      }
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: withBackupNotice(canvasComments)
  }
];

// src/index.ts
var PLUGIN_ID = "tianshu-canvas";
var index_default = defineTianshuPlugin({
  id: PLUGIN_ID,
  activate() {
    return {
      tools: tools.map((tool) => ({
        name: tool.definition.name,
        description: tool.definition.description,
        inputSchema: tool.definition.input_schema,
        concurrencySafe: tool.isConcurrencySafe?.() === true,
        requiresApproval: tool.requiresApproval?.() === true,
        pathParams: tool.pathParams ?? {},
        execute: (call) => tool.execute({ args: call.args, cwd: call.cwd, sessionId: call.sessionId ?? "default" })
      }))
    };
  }
});
export {
  assertUrlAllowed,
  index_default as default,
  extractTokens,
  fetchUrl,
  inlineAssets,
  isBlockedIp,
  resolveBrowser,
  toDataUri,
  tools
};
