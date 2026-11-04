// src/tpi.ts
function defineTianshuPlugin(spec) {
  const sdk = globalThis.__tianshuTPI;
  if (!sdk) throw new Error("not running inside Tianshu: TPI plugins load only through the Tianshu host");
  return sdk.defineTianshuPlugin(spec);
}

// src/tools.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync4, readFileSync as readFileSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join4 } from "node:path";

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

// src/export.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, mkdtempSync, readFileSync as readFileSync3, rmSync as rmSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { tmpdir } from "node:os";
import { join as join3 } from "node:path";
import { deflateRawSync } from "node:zlib";

// src/project.ts
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// src/ids.ts
import { randomUUID } from "node:crypto";
var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function isSafeId(id) {
  return typeof id === "string" && ID_RE.test(id);
}
function assertSafeId(id) {
  if (!isSafeId(id)) throw new Error(`invalid page id: ${String(id)}`);
}
function newPageId() {
  return "page-" + randomUUID().replace(/-/g, "").slice(0, 8);
}

// src/project.ts
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
function readProject(cwd) {
  const file = projectFile(cwd);
  if (!existsSync(file)) return emptyProject();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || !Array.isArray(parsed.nodes)) return emptyProject();
    return {
      version: 1,
      viewport: normalizeViewport(parsed.viewport),
      nodes: parsed.nodes.filter(isPageNode),
      edges: Array.isArray(parsed.edges) ? parsed.edges.filter(isEdge) : []
    };
  } catch {
    return emptyProject();
  }
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
function writeProjectAtomic(cwd, project) {
  mkdirSync(pagesDir(cwd), { recursive: true });
  const file = projectFile(cwd);
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(project, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
  projectEvents.emit("change", { cwd });
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
  const project = readProject(cwd);
  project.viewport = normalizeViewport(viewport);
  writeProjectAtomic(cwd, project);
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
  if (!node) throw new Error(`\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${id}`);
  node.title = title;
  node.updatedAt = Date.now();
  writeProjectAtomic(cwd, project);
  return project;
}
function moveNode(cwd, id, x, y) {
  assertSafeId(id);
  const project = readProject(cwd);
  const node = project.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${id}`);
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
  if (!src) throw new Error(`\u8282\u70B9\u4E0D\u5B58\u5728\uFF1A${id}`);
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
function addEdge(cwd, source, target, label) {
  const project = readProject(cwd);
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
  project.edges = project.edges.filter((e) => !(e.source === source && e.target === target));
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

// src/server.ts
import http from "node:http";
import { createHash } from "node:crypto";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { fileURLToPath } from "node:url";

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
  "    __vd_apply_edits: 1, __vd_request_serialize: 1",
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
  "      var m = /^([a-zA-Z0-9]+)\\[(\\d+)\\]$/.exec(parts[i]);",
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
  "  // \u9AD8\u4EAE\u5728 iframe \u5185\u505A\uFF08\u7236\u4FA7\u65E0\u6CD5\u8BBF\u95EE\u5176 DOM\uFF09\uFF1B\u5E8F\u5217\u5316\u65F6\u6309\u6807\u8BB0\u5265\u79BB\uFF0C\u4E0D\u6C61\u67D3\u539F\u578B\u3002",
  "  var hovered = null, selectedEl = null;",
  "  function ensureStyle(){",
  '    if (document.querySelector("style[' + PROBE_MARKER + ']")) return;',
  '    var s = document.createElement("style");',
  '    s.setAttribute("' + PROBE_MARKER + '", "1");',
  '    s.textContent = "[data-tianshu-hover]{outline:2px solid #3b82f6;outline-offset:-1px}[data-tianshu-selected]{outline:2px solid #2563eb;outline-offset:-1px;box-shadow:0 0 0 2px rgba(37,99,235,.25)}";',
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
  '    if (d.type === "__vd_ping") { post("__vd_iframe_ready", null); reportHeight(); return; }',
  '    if (d.type === "__vd_proto_state") { scopeXpath = p.scopeXpath || null; return; }',
  '    if (d.type === "__vd_set_scope") { scopeXpath = p.xpath || null; return; }',
  '    if (d.type === "__vd_request_select_xpath") {',
  '      var el = byXPath(p.xpath); if (el) post("__vd_proto_element_selected", payload(el)); return;',
  "    }",
  '    if (d.type === "__vd_request_add_to_chat") {',
  '      var el2 = byXPath(p.xpath); if (el2) post("__vd_proto_element_add_to_chat", payload(el2)); return;',
  "    }",
  '    if (d.type === "__vd_request_serialize") { post("__vd_edit_applied", { xpath: null, ok: true, html: serialize() }); return; }',
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
  '      if (typeof p.text === "string") el.textContent = p.text;',
  '      if (p.styles && typeof p.styles === "object") {',
  "        for (var k in p.styles) {",
  "          if (!Object.prototype.hasOwnProperty.call(p.styles, k)) continue;",
  "          if (!SAFE_PROP.test(k) || BAD_VALUE.test(String(p.styles[k]))) continue;",
  "          el.style.setProperty(k, String(p.styles[k]));",
  "        }",
  "      }",
  '      post("__vd_edit_applied", { xpath: p.xpath, ok: true, html: serialize() });',
  "    } catch (err) {",
  '      post("__vd_edit_applied", { xpath: p.xpath, ok: false, error: String(err && err.message || err) });',
  "    }",
  "  }",
  "",
  "  function serialize(){",
  "    var clone = document.documentElement.cloneNode(true);",
  '    var probes = clone.querySelectorAll("[' + PROBE_MARKER + ']");',
  "    for (var i = 0; i < probes.length; i++) probes[i].parentNode.removeChild(probes[i]);",
  '    var marked = clone.querySelectorAll("[data-tianshu-hover],[data-tianshu-selected]");',
  "    for (var j = 0; j < marked.length; j++) {",
  '      marked[j].removeAttribute("data-tianshu-hover");',
  '      marked[j].removeAttribute("data-tianshu-selected");',
  "    }",
  '    return "<!doctype html>\\n" + clone.outerHTML;',
  "  }",
  "",
  '  if (document.readyState === "loading") {',
  '    document.addEventListener("DOMContentLoaded", function(){ post("__vd_iframe_ready", null); reportHeight(); });',
  '  } else { post("__vd_iframe_ready", null); reportHeight(); }',
  '  window.addEventListener("load", reportHeight);',
  '  window.addEventListener("resize", reportHeight);',
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
  return tag + html;
}

// src/server.ts
var WEB_DIR = fileURLToPath(new URL("./web/", import.meta.url));
var DEFAULT_PORT = 43117;
var MUTATION_HEADER = "x-tianshu-canvas";
var MAX_BODY = 4 * 1024 * 1024;
var state = null;
function tokenFor(cwd) {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
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
  const host = req.headers.host;
  if (!host || !isLocalHost(host)) {
    return send(res, 403, "text/plain; charset=utf-8", "forbidden host");
  }
  const url = new URL(req.url ?? "/", `http://${host}`);
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
  if (req.method === "GET" && path === "/api/project") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
    return sendJson(res, readProject(cwd));
  }
  if (req.method === "GET" && path === "/api/events") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    return handleSse(res, tokenFor(cwd));
  }
  if (req.method === "GET" && path.startsWith("/page/")) {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    const id = decodeURIComponent(path.slice("/page/".length));
    const html = readPageHtml(cwd, id);
    if (html === null) return send(res, 404, "text/plain; charset=utf-8", "page not found");
    return sendUntrustedHtml(res, injectProbe(html));
  }
  if (req.method === "GET" && path === "/api/selection") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
    return sendJson(res, { selection: readSelection(cwd) });
  }
  if (req.method === "GET" && path === "/api/export-file") {
    const cwd = resolveCwd(url.searchParams.get("ws"));
    if (!cwd) return send(res, 404, "text/plain; charset=utf-8", "unknown workspace");
    const name = url.searchParams.get("name") ?? "";
    if (!name || /[\\/]/.test(name) || name.includes("..")) {
      return send(res, 400, "text/plain; charset=utf-8", "bad name");
    }
    const file = join2(exportsDir(cwd), name);
    if (!existsSync2(file)) return send(res, 404, "text/plain; charset=utf-8", "not found");
    const type = name.endsWith(".png") ? "image/png" : "application/zip";
    res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
    res.end(readFileSync2(file));
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
function readJsonBody(req, res, onBody) {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > MAX_BODY) req.destroy();
  });
  req.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "bad json" }));
    }
    const cwd = resolveCwd(typeof parsed.ws === "string" ? parsed.ws : null);
    if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
    onBody({ ...parsed, __cwd: cwd });
  });
}
function handleSelection(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const pageId = typeof body.pageId === "string" ? body.pageId : "";
    const kind = body.kind === "page" ? "page" : "element";
    if (!pageId) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "missing pageId" }));
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
    try {
      writePageHtml(cwd, id, html);
      projectEvents.emit("change", { cwd });
      return sendJson(res, { ok: true });
    } catch (err) {
      return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: err.message }));
    }
  });
}
function handleNodes(req, res) {
  readJsonBody(req, res, (body) => {
    const cwd = String(body.__cwd);
    const op = String(body.op ?? "");
    const id = typeof body.id === "string" ? body.id : "";
    try {
      if (op === "remove") {
        if (!id) throw new Error("missing id");
        removeNode(cwd, id);
        return sendJson(res, { ok: true, id });
      }
      if (op === "rename") {
        if (!id || typeof body.title !== "string") throw new Error("missing id or title");
        renameNode(cwd, id, body.title);
        return sendJson(res, { ok: true, id, title: body.title });
      }
      if (op === "move") {
        if (!id) throw new Error("missing id");
        moveNode(cwd, id, Number(body.x) || 0, Number(body.y) || 0);
        return sendJson(res, { ok: true, id });
      }
      if (op === "duplicate") {
        if (!id) throw new Error("missing id");
        const node = duplicateNode(cwd, id, typeof body.title === "string" ? body.title : void 0);
        return sendJson(res, { ok: true, node });
      }
      return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: `unknown op: ${op}` }));
    } catch (err) {
      return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: err.message }));
    }
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
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 4096) req.destroy();
  });
  req.on("end", () => {
    try {
      const parsed = JSON.parse(body);
      const cwd = resolveCwd(typeof parsed.ws === "string" ? parsed.ws : null);
      if (!cwd) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "unknown workspace" }));
      const x = Number(parsed.x);
      const y = Number(parsed.y);
      const zoom = Number(parsed.zoom);
      setViewport(cwd, {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1
      });
      return sendJson(res, { ok: true });
    } catch {
      return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: "bad json" }));
    }
  });
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
  const file = join2(WEB_DIR, name);
  if (!existsSync2(file)) return send(res, 404, "text/plain; charset=utf-8", "asset not built");
  const headers = { "Content-Type": type, "X-Content-Type-Options": "nosniff" };
  if (name === "index.html") {
    headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'";
  }
  res.writeHead(200, headers);
  res.end(readFileSync2(file));
}
function sendUntrustedHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
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
  return BROWSER_CANDIDATES.find((p) => existsSync3(p)) ?? null;
}
function exportsDir(cwd) {
  return join3(projectDir(cwd), "exports");
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
async function launchBrowser(exe) {
  const puppeteer = (await import("puppeteer-core")).default;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const userDataDir = mkdtempSync(join3(tmpdir(), "tsc-png-"));
    try {
      const browser = await puppeteer.launch({
        executablePath: exe,
        headless: true,
        userDataDir,
        timeout: 6e4,
        protocolTimeout: 12e4,
        args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--disable-extensions"]
      });
      const dispose = async () => {
        const proc = browser.process();
        await Promise.race([browser.close().catch(() => {
        }), new Promise((r) => setTimeout(r, 1e4))]);
        if (proc && proc.exitCode === null) proc.kill("SIGKILL");
        try {
          rmSync2(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        } catch {
        }
      };
      return { browser, dispose };
    } catch (err) {
      lastErr = err;
      try {
        rmSync2(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      } catch {
      }
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
  const { browser, dispose } = await launchBrowser(exe);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    await page.goto(`${url}&export=1`, { waitUntil: "domcontentloaded", timeout: 3e4 });
    await page.waitForSelector(".page-node", { timeout: 15e3 });
    await new Promise((r) => setTimeout(r, 800));
    const clip = await page.evaluate(() => {
      const doc = globalThis.document;
      const els = Array.from(doc.querySelectorAll(".page-node"));
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
    mkdirSync2(dir, { recursive: true });
    const name = `canvas-${stamp()}.png`;
    const path = join3(dir, name);
    await page.screenshot({ path, clip: clip ?? void 0 });
    return { name, path, bytes: readFileSync3(path).length };
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
    (n) => `<section><h2>${escapeHtml(n.title)} <small>${n.width}\xD7${n.height}</small></h2><iframe src="pages/${encodeURIComponent(n.id)}.html" style="width:${n.width}px;height:${n.height}px;max-width:100%;border:1px solid #ddd;border-radius:8px;background:#fff"></iframe></section>`
  ).join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>\u5929\u67A2\u753B\u5E03\u8BBE\u8BA1 \xB7 \u539F\u578B\u96C6</title>
<style>body{font-family:system-ui;margin:0;padding:24px;background:#f5f6f8;color:#1f2328}
h1{font-size:20px}section{margin:0 0 32px}h2{font-size:15px;margin:0 0 8px}small{color:#6b7280;font-weight:400}
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
  mkdirSync2(dir, { recursive: true });
  const name = `canvas-${stamp()}.zip`;
  const path = join3(dir, name);
  writeFileSync2(path, zip);
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
function projectHint(cwd) {
  return `${PROJECT_DIR_NAME}/\uFF08\u9879\u76EE\u6587\u4EF6\uFF1A${projectFile(cwd)}\uFF09`;
}
async function canvasOpen(call) {
  const port = num(call.args.port);
  const { url } = await ensureServer(call.cwd, port ?? void 0);
  writeUrlHint(call.cwd, url);
  if (call.args.open === true) openBrowser(url);
  return {
    content: `\u753B\u5E03\u670D\u52A1\u5DF2\u5C31\u7EEA\u3002
\u753B\u5E03 URL\uFF1A${url}
\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u4E0A\u9762\u7684 URL \u5373\u53EF\u770B\u5230\u65E0\u9650\u753B\u5E03\u3002
\u5DE5\u4F5C\u533A\uFF1A${call.cwd}
\u9879\u76EE\u6587\u4EF6\uFF1A${projectFile(call.cwd)}
\u64CD\u4F5C\u63D0\u793A\uFF1A\u7A7A\u683C+\u62D6\u62FD \u6216 \u4E2D\u952E\u62D6\u62FD \u5E73\u79FB\uFF1BCtrl+\u6EDA\u8F6E \u7F29\u653E\uFF1B\u666E\u901A\u6EDA\u8F6E \u5E73\u79FB\u3002`
  };
}
function writeUrlHint(cwd, url) {
  try {
    writeFileSync3(join4(cwd, PROJECT_DIR_NAME, "url.txt"), url + "\n", "utf8");
  } catch {
  }
}
function openBrowser(url) {
  try {
    const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
  }
}
async function canvasUpsertPage(call) {
  const args = call.args;
  const htmlPath = str(args.html_path);
  let html;
  if (htmlPath) {
    if (!existsSync4(htmlPath)) {
      return { content: `\u8BFB\u53D6\u5931\u8D25\uFF1A\u6587\u4EF6\u4E0D\u5B58\u5728 ${htmlPath}`, isError: true };
    }
    try {
      html = readFileSync4(htmlPath, "utf8");
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
  const rel = html !== void 0 ? writePageHtml(call.cwd, id, html) : existing?.htmlPath ?? "";
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
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  upsertNode(call.cwd, node);
  const { url } = await ensureServer(call.cwd);
  return {
    content: `${existing ? "\u5DF2\u66F4\u65B0" : "\u5DF2\u6DFB\u52A0"}\u9875\u9762\u8282\u70B9\u300C${node.title}\u300D\uFF08id=${id}\uFF09\u3002
\u4F4D\u7F6E\uFF1Ax=${node.x}, y=${node.y}\uFF1B\u5C3A\u5BF8\uFF1A${node.width}\xD7${node.height}\uFF08${deviceType}\uFF09
` + (html !== void 0 ? `\u539F\u578B\u6587\u4EF6\uFF1A${join4(call.cwd, rel)}
` : `\u539F\u578B HTML \u672A\u6539\u52A8\uFF08\u4EC5\u66F4\u65B0\u4E86\u8282\u70B9\u4FE1\u606F\uFF09\u3002
`) + `\u753B\u5E03 URL\uFF1A${url}
\u9879\u76EE\uFF1A${projectHint(call.cwd)}`
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
      const edge = addEdge(call.cwd, source, target, str(call.args.label));
      return { content: `\u5DF2\u8FDE\u7EBF ${edge.source} \u2192 ${edge.target}${edge.label ? `\uFF08${edge.label}\uFF09` : ""}\u3002` };
    }
    case "unlink": {
      const source = str(call.args.source);
      const target = str(call.args.target);
      if (!source || !target) return { content: "unlink \u9700\u8981 source \u548C target\u3002", isError: true };
      removeEdge(call.cwd, source, target);
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
      description: "\u65B0\u589E\u6216\u66F4\u65B0\u753B\u5E03\u4E0A\u7684\u9875\u9762\u8282\u70B9\u3002\u4F18\u5148\u4F20 html\uFF08\u5185\u8054\uFF09\u5199\u5165 HTML \u539F\u578B\uFF08\u539F\u578B\u81EA\u52A8\u4FDD\u5B58\u5230 .tianshu-canvas/pages/\uFF0C\u65E0\u9700\u4E5F\u4E0D\u8981\u5728\u5DE5\u4F5C\u533A\u53E6\u5EFA\u6587\u4EF6\u5939\uFF09\uFF0Chtml_path \u4EC5\u7528\u4E8E\u5BFC\u5165\u5DF2\u6709\u6587\u4EF6\uFF1B\u5BF9\u5DF2\u6709 id \u53EF\u7701\u7565 html\uFF0C\u4EC5\u66F4\u65B0\u6807\u9898/\u4F4D\u7F6E/\u5C3A\u5BF8/\u8BBE\u5907\uFF08\u5373\u91CD\u547D\u540D\u3001\u79FB\u52A8\u3001\u8C03\u6574\u5C3A\u5BF8\uFF0C\u672A\u6307\u5B9A\u7684\u5B57\u6BB5\u4FDD\u6301\u539F\u503C\uFF09\u3002\u8FD4\u56DE\u91CC\u4F1A\u5E26\u4E0A\u753B\u5E03 URL\uFF08\u82E5\u753B\u5E03\u670D\u52A1\u5C1A\u672A\u542F\u52A8\u4F1A\u81EA\u52A8\u542F\u52A8\uFF09\u3002",
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
    execute: canvasUpsertPage
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
    execute: canvasGetState
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
    execute: canvasArrange
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
