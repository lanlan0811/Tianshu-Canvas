// src/tpi.ts
function defineTianshuPlugin(spec) {
  const sdk = globalThis.__tianshuTPI;
  if (!sdk) throw new Error("not running inside Tianshu: TPI plugins load only through the Tianshu host");
  return sdk.defineTianshuPlugin(spec);
}

// src/tools.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync6, readFileSync as readFileSync6, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join6 } from "node:path";

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
  return {
    project,
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

// src/export.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync5, mkdirSync as mkdirSync3, mkdtempSync, readFileSync as readFileSync5, readdirSync as readdirSync2, rmSync as rmSync3, statSync as statSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { tmpdir } from "node:os";
import { join as join5 } from "node:path";
import { deflateRawSync } from "node:zlib";

// src/server.ts
import http from "node:http";
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync4, readFileSync as readFileSync4, statSync } from "node:fs";
import { join as join4 } from "node:path";
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
  "    __vd_apply_edits: 1",
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
    const server = http.createServer(handleRequest);
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
    const file = join4(exportsDir(cwd), name);
    if (!existsSync4(file) || !statSync(file).isFile()) return send(res, 404, "text/plain; charset=utf-8", "not found");
    const type = name.endsWith(".png") ? "image/png" : "application/zip";
    const data = readFileSync4(file);
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
  const file = join4(WEB_DIR, name);
  if (!existsSync4(file)) return send(res, 404, "text/plain; charset=utf-8", "asset not built");
  const headers = { "Content-Type": type, "X-Content-Type-Options": "nosniff" };
  if (name === "index.html") {
    headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'";
  }
  res.writeHead(200, headers);
  res.end(readFileSync4(file));
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

// src/export.ts
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
  return join5(projectDir(cwd), "exports");
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
  const portFile = join5(userDataDir, "DevToolsActivePort");
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
      const dir = join5(tmpdir(), entry);
      try {
        if (statSync2(dir).mtimeMs < cutoff) rmSync3(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
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
    const userDataDir = mkdtempSync(join5(tmpdir(), "tsc-png-"));
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
    const path = join5(dir, name);
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
  const zip = buildZip(entries);
  const dir = exportsDir(cwd);
  mkdirSync3(dir, { recursive: true });
  const name = `canvas-${stamp()}.zip`;
  const path = join5(dir, name);
  writeFileSync3(path, zip);
  return { name, path, bytes: zip.length };
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

// src/lint.ts
var MAX_FINDINGS = 40;
var RULES = ["color", "font", "spacing", "radius", "icon", "component", "token", "resource"];
var HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;
var FUNC_COLOR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/gi;
var COLOR_PROP = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline))*(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|text-decoration(?:-color)?|caret-color|accent-color|column-rule(?:-color)?)$/;
var NAMED_COLORS = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" ")
);
var CSS_WORD = /(?<![\w-])[a-z]+(?![\w-])/gi;
var VAR_REF = /var\(\s*(--ts-[A-Za-z0-9-]+)\s*\)/g;
var CLASS_ATTR = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
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
  for (const match of masked.matchAll(CLASS_ATTR)) {
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
function pxValues(value) {
  if (/calc\(/i.test(value)) return [];
  const literal = value.replace(/var\([^)]*\)/gi, " ");
  const found = /* @__PURE__ */ new Set();
  for (const match of literal.matchAll(/(?<![\w.-])-?(\d+(?:\.\d+)?)px\b/g)) found.add(Number(match[1]));
  return [...found];
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
    if (!existsSync6(htmlPath)) {
      return { content: `\u8BFB\u53D6\u5931\u8D25\uFF1A\u6587\u4EF6\u4E0D\u5B58\u5728 ${htmlPath}`, isError: true };
    }
    try {
      html = readFileSync6(htmlPath, "utf8");
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
  const styleId = currentStyleId(call.cwd);
  const injection = html !== void 0 ? injectDesign(html, styleId, call.cwd) : null;
  const pageHtml = injection ? injection.html : html;
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
\u9879\u76EE\uFF1A${projectHint(call.cwd)}` + styleLine + missingLine + scriptIconNote(injection?.scriptIcons ?? []) + (blocked.length ? `
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
async function canvasExport(call) {
  const kindRaw = str(call.args.kind);
  const kind = kindRaw === "png" || kindRaw === "zip" ? kindRaw : "both";
  await ensureServer(call.cwd);
  let result;
  try {
    result = await runExport(call.cwd, kind);
  } catch (err) {
    return { content: `\u5BFC\u51FA\u5931\u8D25\uFF1A${err.message}`, isError: true };
  }
  const lines = [];
  for (const f of result.files) {
    lines.push(`${f.name}\uFF08${(f.bytes / 1024).toFixed(1)} KB\uFF09
  \u8DEF\u5F84\uFF1A${f.path}`);
  }
  const url = currentUrl(call.cwd);
  const head = `\u5DF2\u5BFC\u51FA ${result.files.length} \u4E2A\u6587\u4EF6\uFF1A`;
  const pngNote = result.pngError ? `
\u6CE8\u610F\uFF1APNG \u5BFC\u51FA\u672A\u5B8C\u6210\u2014\u2014${result.pngError}` : "";
  const linkNote = url ? `
\u753B\u5E03 URL\uFF1A${url}` : "";
  return { content: `${head}
${lines.join("\n")}${pngNote}${linkNote}` };
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
    return { content: `\u672A\u77E5\u7684 action\uFF1A${action}\u3002\u53EF\u9009\uFF1Alist / get / set / template\u3002`, isError: true };
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
    return { content: `\u672A\u77E5\u7684 action\uFF1A${action}\u3002\u53EF\u9009\uFF1Acreate / list / get / remove\u3002`, isError: true };
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
      name: "canvas_export",
      description: "\u5BFC\u51FA\u753B\u5E03\u6210\u679C\uFF1A\u6574\u5757\u753B\u5E03\u622A\u56FE PNG \u4E0E/\u6216\u539F\u578B\u6253\u5305 ZIP\uFF08\u542B index.html \u753B\u5ECA + project.json\uFF09\u3002",
      input_schema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["png", "zip", "both"], description: "\u5BFC\u51FA\u7C7B\u578B\uFF08\u9ED8\u8BA4 both\uFF09" }
        },
        required: []
      }
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: canvasExport
  },
  {
    definition: {
      name: "canvas_style",
      description: "\u67E5\u770B/\u9501\u5B9A/\u5207\u6362\u9879\u76EE\u7EA7\u8BBE\u8BA1\u98CE\u683C\uFF0C\u6216\u53D6\u4E00\u4EFD\u9875\u9762\u6A21\u677F HTML\u3002action=list \u5217\u51FA\u5168\u90E8\u53EF\u9009\u98CE\u683C\u4E0E\u5F53\u524D\u72B6\u6001\uFF08\u7528\u6237\u6CA1\u6307\u5B9A\u98CE\u683C\u65F6\u636E\u6B64\u63D0\u95EE\uFF09\uFF1Bget \u67E5\u770B\u67D0\u98CE\u683C\u7684 token/\u7EC4\u4EF6\u7C7B/\u56FE\u6807\u540D\uFF1Bset \u9501\u5B9A\u6216\u5207\u6362\u98CE\u683C\uFF08style_id=\u98CE\u683C id\uFF0Cfree \u8868\u793A\u89E3\u9664\u9501\u5B9A\uFF0C\u4F1A\u91CD\u5199\u6240\u6709\u9875\u9762\u5E76\u5237\u65B0\u753B\u5E03\uFF09\uFF1Btemplate \u53D6 dashboard/landing \u6A21\u677F\u7684\u5B8C\u6574 HTML\uFF0C\u53EF\u76F4\u63A5\u4F20\u7ED9 canvas_upsert_page\u3002",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "get", "set", "template"], description: "list=\u5217\u51FA\u98CE\u683C\uFF1Bget=\u67E5\u770B\u7EC6\u8282\uFF1Bset=\u9501\u5B9A/\u5207\u6362\uFF1Btemplate=\u53D6\u6A21\u677F" },
          style_id: {
            type: "string",
            description: "\u98CE\u683C id\uFF08set/get/template \u4F7F\u7528\uFF09\uFF0C\u5185\u7F6E\u6216\u81EA\u5B9A\u4E49\u5747\u53EF\uFF1Bfree \u8868\u793A\u89E3\u9664\u9501\u5B9A"
          },
          template_id: { type: "string", description: "action=template \u65F6\u4F7F\u7528\uFF1A\u6A21\u677F id\uFF08\u5982 dashboard / landing\uFF09" }
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
      description: '\u5728**\u5F53\u524D\u9879\u76EE**\u521B\u5EFA/\u67E5\u770B/\u5220\u9664\u4E00\u5957\u81EA\u5B9A\u4E49\u8BBE\u8BA1\u7CFB\u7EDF\uFF08\u4EC5\u672C\u5DE5\u4F5C\u533A\u751F\u6548\uFF0C\u5B58 .tianshu-canvas/library/\uFF09\u3002\u7528\u6237\u8BF4\u300C\u8981\u505A\u4E00\u5957\u8BBE\u8BA1\u7CFB\u7EDF\u300D\u65F6\u7528\u5B83\uFF1A\u5148\u4E3B\u52A8\u95EE\u6E05\u914D\u7F6E\uFF08\u914D\u8272\u3001\u5706\u89D2\u3001\u5B57\u53F7\u3001\u5B57\u4F53\u3001\u52A8\u6548\u3001\u9634\u5F71\u3001\u63A7\u4EF6\u5C3A\u5BF8\u3001\u662F\u5426\u8981\u6DF1\u8272\uFF09\uFF0C\u7136\u540E action=create \u4F20\u5165\u5B8C\u6574 tokens\u3002\ntokens \u5951\u7EA6\uFF08\u503C\u81EA\u7531\u3001\u53D8\u91CF\u540D\u5FC5\u987B\u4E0E\u5185\u7F6E\u98CE\u683C\u4E00\u81F4\uFF09\uFF1A\n- color.primitives\uFF1Aneutral{0,50,100,200,300,500,700,900}\u3001brand{100,300,500,600,700}\u3001success{50,500}\u3001warning{50,500}\u3001danger{50,500}\u3001info{50,500}\uFF0C\u503C\u5747\u4E3A #hex\u3002\n- color.semantic\uFF08\u6D45\u8272\uFF09\u4E0E color.semanticDark\uFF08\u6DF1\u8272\uFF0C\u540C\u7ED3\u6784\uFF09\uFF1A\u4E03\u7EC4\u2014\u2014bg{canvas,surface,raised,sunken,inverse}\u3001text{primary,secondary,muted,inverse,link}\u3001border{default,strong,subtle,focus}\u3001action{primary,primaryHover,primaryText,secondary,secondaryHover,secondaryText,ghostHover,danger,dangerText}\u3001status{success,successBg,warning,warningBg,danger,dangerBg,info,infoBg}\u3001chart{1,2,3,4,5}\u3001overlay{scrim}\uFF1B\u503C\u5199 "\u7EC4.\u6B65"\uFF08\u5982 neutral.900\uFF09\u6216 #hex/rgba()\u3002\n- font\uFF1Afamilies{sans,display,mono}\u3001sizes{xs,sm,md,lg,xl,2xl,3xl,4xl}(px)\u3001weights{regular,medium,semibold,bold}\u3001lineHeights{tight,snug,normal,relaxed}\u3001letterSpacing{tight,normal,wide}\u3002\n- space\uFF08\u952E 0..16\uFF0C\u503C\u987B\u4E25\u683C\u9012\u589E\uFF09\u3001radius{none,sm,md,lg,xl,full}\uFF08\u503C\u9012\u589E\uFF0Cfull=9999\uFF09\u3001borderWidth{hairline,thin,thick}\u3001size{controlSm..containerLg,sidebar}\u3001shadow{sm,md,lg}\u3001motion{fast,base,easing}\u3002\n\u5199\u5165\u524D\u4F1A\u6821\u9A8C\uFF1A\u5BF9\u6BD4\u5EA6\uFF08\u6D45\u8272\u4E0E\u6DF1\u8272\u5404\u4E00\u904D\uFF0C\u6B63\u6587\u22654.5\uFF09\u3001\u5C3A\u5EA6\u9012\u589E\u3001\u53D8\u91CF\u540D\u8986\u76D6\u5171\u4EAB\u7EC4\u4EF6/\u6A21\u677F\uFF1B\u4E0D\u901A\u8FC7\u4F1A\u8FD4\u56DE\u9010\u6761\u9519\u8BEF\u3002\u6DF1\u8272\u7528\u9875\u9762\u6839\u5143\u7D20 class="dark" \u5207\u6362\u3002\u7EC4\u4EF6\uFF08ts-*\uFF09\u4E0E\u56FE\u6807\u4E3A\u5171\u4EAB\u8D44\u6E90\uFF0C\u4E0D\u652F\u6301\u6269\u5C55\u3002',
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "list", "get", "remove"], description: "create=\u521B\u5EFA\uFF1Blist=\u5217\u51FA\uFF1Bget=\u67E5\u770B\u7EC6\u8282\uFF1Bremove=\u5220\u9664" },
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
  index_default as default,
  resolveBrowser,
  tools
};
