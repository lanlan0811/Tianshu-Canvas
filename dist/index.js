// src/tpi.ts
function defineTianshuPlugin(spec) {
  const sdk = globalThis.__tianshuTPI;
  if (!sdk) throw new Error("not running inside Tianshu: TPI plugins load only through the Tianshu host");
  return sdk.defineTianshuPlugin(spec);
}

// src/tools.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";

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
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
      edges: Array.isArray(parsed.edges) ? parsed.edges : []
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

// src/server.ts
import http from "node:http";
import { createHash } from "node:crypto";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
var WEB_DIR = fileURLToPath(new URL("./web/", import.meta.url));
var DEFAULT_PORT = 43117;
var MUTATION_HEADER = "x-tianshu-canvas";
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
      broadcast(created, tokenFor(changed));
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
    return sendUntrustedHtml(res, html);
  }
  if (req.method === "POST" && path === "/api/viewport") {
    if (String(req.headers[MUTATION_HEADER] ?? "") !== "1") {
      return send(res, 403, "text/plain; charset=utf-8", "missing header");
    }
    return handleViewport(req, res);
  }
  return send(res, 404, "text/plain; charset=utf-8", "not found");
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
function broadcast(s, token) {
  const set = s.sse.get(token);
  if (!set) return;
  const frame = `event: project
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

// src/tools.ts
function str(v) {
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
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
    writeFileSync2(join3(cwd, PROJECT_DIR_NAME, "url.txt"), url + "\n", "utf8");
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
async function canvasAddPage(call) {
  const args = call.args;
  const htmlPath = str(args.html_path);
  let html;
  if (htmlPath) {
    if (!existsSync3(htmlPath)) {
      return { content: `\u8BFB\u53D6\u5931\u8D25\uFF1A\u6587\u4EF6\u4E0D\u5B58\u5728 ${htmlPath}`, isError: true };
    }
    try {
      html = readFileSync3(htmlPath, "utf8");
    } catch (err) {
      return { content: `\u8BFB\u53D6\u5931\u8D25\uFF1A${err.message}`, isError: true };
    }
  } else {
    html = str(args.html);
  }
  if (!html) {
    return { content: "\u7F3A\u5C11\u5185\u5BB9\uFF1A\u8BF7\u63D0\u4F9B html_path\uFF08\u5DE5\u4F5C\u533A\u5185\u7684 HTML \u6587\u4EF6\uFF09\u6216 html\uFF08\u5185\u8054 HTML\uFF09\u3002", isError: true };
  }
  const requestedId = str(args.id);
  if (requestedId && !isSafeId(requestedId)) {
    return { content: `\u975E\u6CD5 id\uFF1A${requestedId}\uFF08\u4EC5\u5141\u8BB8\u5B57\u6BCD\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u3001\u8FDE\u5B57\u7B26\uFF0C1\u201364 \u4F4D\uFF09`, isError: true };
  }
  const id = requestedId ?? newPageId();
  const deviceType = isDeviceType(args.device_type) ? args.device_type : DEFAULT_DEVICE;
  const size = resolveSize(deviceType, num(args.width), num(args.height));
  const project = readProject(call.cwd);
  const existing = project.nodes.find((n) => n.id === id);
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
  const rel = writePageHtml(call.cwd, id, html);
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
  const url = currentUrl(call.cwd);
  return {
    content: `${existing ? "\u5DF2\u66F4\u65B0" : "\u5DF2\u6DFB\u52A0"}\u9875\u9762\u8282\u70B9 "${node.title}"\uFF08id=${id}\uFF09\u3002
\u4F4D\u7F6E\uFF1Ax=${node.x}, y=${node.y}\uFF1B\u5C3A\u5BF8\uFF1A${node.width}\xD7${node.height}\uFF08${deviceType}\uFF09
\u539F\u578B\u6587\u4EF6\uFF1A${join3(call.cwd, rel)}
` + (url ? `\u753B\u5E03 URL\uFF1A${url}` : `\u63D0\u793A\uFF1A\u5148\u8C03\u7528 canvas_open \u83B7\u53D6\u753B\u5E03 URL\u3002`) + `
\u9879\u76EE\uFF1A${projectHint(call.cwd)}`
  };
}
async function canvasListPages(call) {
  const project = readProject(call.cwd);
  const url = currentUrl(call.cwd);
  if (project.nodes.length === 0) {
    return {
      content: `\u753B\u5E03\u4E0A\u6682\u65E0\u9875\u9762\u8282\u70B9\u3002
\u7528 canvas_add_page \u6DFB\u52A0\u4E00\u4E2A HTML \u539F\u578B\u3002
` + (url ? `\u753B\u5E03 URL\uFF1A${url}` : `\u63D0\u793A\uFF1A\u5148\u8C03\u7528 canvas_open \u83B7\u53D6\u753B\u5E03 URL\u3002`)
    };
  }
  const lines = project.nodes.map((n, i) => {
    return `${i + 1}. ${n.title} (id=${n.id})
   \u4F4D\u7F6E x=${n.x}, y=${n.y}\uFF1B\u5C3A\u5BF8 ${n.width}\xD7${n.height}\uFF08${n.deviceType}\uFF09`;
  });
  return {
    content: `\u753B\u5E03\u4E0A\u6709 ${project.nodes.length} \u4E2A\u9875\u9762\u8282\u70B9\uFF1A
` + lines.join("\n") + `
` + (url ? `\u753B\u5E03 URL\uFF1A${url}` : `\u63D0\u793A\uFF1A\u5148\u8C03\u7528 canvas_open \u83B7\u53D6\u753B\u5E03 URL\u3002`)
  };
}
var tools = [
  {
    definition: {
      name: "canvas_open",
      description: "\u542F\u52A8/\u590D\u7528\u672C\u5DE5\u4F5C\u533A\u7684\u672C\u5730\u753B\u5E03\u670D\u52A1\uFF0C\u8FD4\u56DE\u53EF\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u7684 URL\uFF08127.0.0.1\uFF09\u3002",
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
      name: "canvas_add_page",
      description: "\u628A\u4E00\u6BB5 HTML \u539F\u578B\u4F5C\u4E3A\u9875\u9762\u8282\u70B9\u52A0\u5165\u753B\u5E03\uFF08\u53EF\u7528 html_path \u8BFB\u6587\u4EF6\uFF0C\u6216\u76F4\u63A5\u7ED9 html\uFF09\u3002\u53EF\u6307\u5B9A\u6807\u9898/\u4F4D\u7F6E/\u5C3A\u5BF8/\u8BBE\u5907\u3002",
      input_schema: {
        type: "object",
        properties: {
          html_path: { type: "string", description: "\u539F\u578B HTML \u6587\u4EF6\u8DEF\u5F84\uFF08\u5DE5\u4F5C\u533A\u5185\uFF0C\u4F18\u5148\u4E8E html\uFF09" },
          html: { type: "string", description: "\u5185\u8054 HTML\uFF08\u5F53\u6CA1\u6709 html_path \u65F6\u4F7F\u7528\uFF09" },
          title: { type: "string", description: "\u9875\u9762\u6807\u9898" },
          id: { type: "string", description: "\u53EF\u9009\u9875\u9762 id\uFF08\u5B57\u6BCD\u6570\u5B57/_/-\uFF0C\u7F3A\u7701\u81EA\u52A8\u751F\u6210\uFF09" },
          x: { type: "number", description: "\u753B\u5E03 X \u5750\u6807\uFF08\u7F3A\u7701\u6309\u7F51\u683C\u81EA\u52A8\u6392\u5E03\uFF09" },
          y: { type: "number", description: "\u753B\u5E03 Y \u5750\u6807\uFF08\u7F3A\u7701\u6309\u7F51\u683C\u81EA\u52A8\u6392\u5E03\uFF09" },
          width: { type: "number", description: "\u903B\u8F91\u5BBD\u5EA6 px\uFF08\u8986\u76D6\u8BBE\u5907\u9884\u8BBE\uFF09" },
          height: { type: "number", description: "\u903B\u8F91\u9AD8\u5EA6 px\uFF08\u8986\u76D6\u8BBE\u5907\u9884\u8BBE\uFF09" },
          device_type: {
            type: "string",
            enum: ["desktop", "tablet", "mobile", "free"],
            description: "\u8BBE\u5907\u9884\u8BBE\uFF08\u9ED8\u8BA4 desktop\uFF09"
          }
        },
        required: []
      }
    },
    pathParams: { html_path: "read" },
    requiresApproval: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    execute: canvasAddPage
  },
  {
    definition: {
      name: "canvas_list_pages",
      description: "\u5217\u51FA\u753B\u5E03\u4E0A\u5DF2\u6709\u7684\u9875\u9762\u8282\u70B9\uFF08id/\u6807\u9898/\u4F4D\u7F6E/\u5C3A\u5BF8/\u8BBE\u5907\uFF09\u3002",
      input_schema: { type: "object", properties: {}, required: [] }
    },
    pathParams: {},
    requiresApproval: () => false,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    execute: canvasListPages
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
  tools
};
