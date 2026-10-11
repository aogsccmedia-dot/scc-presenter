// SCC Presenter — main process. Created by AOG Sandton City Church. Free and open source (MIT).
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, screen, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.js";
import { createBible } from "./bible.js";
import { createAI } from "./ai.js";
import { createUpdates } from "./updates.js";
import { createServer, lanAddresses } from "./server.js";
import { createImporter } from "./importer.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = { "/shared/": path.join(SRC, "shared"), "/control/": path.join(SRC, "renderer", "control"), "/web/": path.join(SRC, "renderer", "web"), "/live/": path.join(SRC, "renderer", "live") };
const PAGES = { "/output": "web/output.html", "/stage": "web/stage.html" };
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".woff2": "font/woff2" };
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i, VIDEO = /\.(mp4|webm|mov|m4v|mkv)$/i, AUDIO = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
// Smooth playback on modest hardware: use the graphics card for video and drawing, and never pause the output.
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("enable-features", "PlatformHEVCDecoderSupport");
if (process.argv.includes("--safe-graphics")) app.disableHardwareAcceleration();

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

let store, bible, ai, updates, server, atem, importer, serverInfo = { ok: false };
let control = null, liveDesk = null, netKeyWin = null;
const outWins = new Map();   // output id → window
let remoteView = { title: "", index: -1, slides: [] };
let live = {
  slide: null, next: null, themeId: "classic", themes: [], background: { type: "theme" }, blackout: false, clear: false, logo: false, logoSrc: null,
  item: { title: "", index: -1, count: 0 }, stageMessage: "", timer: null, version: 0,
};

const newId = () => crypto.randomBytes(6).toString("hex");
const mediaDir = () => path.join(app.getPath("userData"), "media");

function mediaPath(id) {
  if (!id) return null;
  const m = store.read("media").find((x) => x.id === id);
  if (m && fs.existsSync(m.path)) return m.path;
  return null;
}

// ── app:// protocol: serves the app's own pages and the media library (nothing else on disk) ──────────
async function handleApp(request) {
  const url = new URL(request.url);
  let p = decodeURIComponent(url.pathname);
  if (PAGES[p]) p = "/" + PAGES[p];
  let file = null;
  if (p.startsWith("/media/")) file = mediaPath(p.slice(7));
  else for (const [prefix, dir] of Object.entries(ROUTES)) {
    if (p.startsWith(prefix)) { const f = path.resolve(dir, p.slice(prefix.length)); if (f.startsWith(dir + path.sep)) file = f; }
  }
  if (!file) return new Response("Not found", { status: 404 });
  let st; try { st = fs.statSync(file); } catch { return new Response("Not found", { status: 404 }); }
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") || "");
  if (range && st.size) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers: { "content-type": type, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${st.size}`, "accept-ranges": "bytes" } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { "content-type": type, "content-length": String(st.size), "accept-ranges": "bytes" } });
}

// ── Live state: one source of truth sent to every screen ─────────────────────────────────────────
function broadcast() {
  live.version++;
  for (const w of [control, liveDesk, netKeyWin, ...outWins.values()]) if (w && !w.isDestroyed()) w.webContents.send("live:state", live);
  atem?.onLive(live);
  server?.broadcast(live);
}
function setLive(patch) { live = { ...live, ...patch }; broadcast(); return live; }

// ── Windows ───────────────────────────────────────────────────────────────────────────────────────
const webPrefs = { preload: path.join(SRC, "main", "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false };

function createControl() {
  control = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1080, minHeight: 680, show: false, backgroundColor: "#0f1115", title: "SCC Presenter",
    icon: path.join(SRC, "..", "build", "icon.png"), titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default", webPreferences: webPrefs,
  });
  control.loadURL("app://local/control/index.html");
  if (process.argv.includes("--smoke-test")) smokeTest(control);
  control.once("ready-to-show", () => { control.maximize(); control.show(); });
  control.on("close", (e) => {
    if ([...outWins.values()].some((w) => !w.isDestroyed()) && !app.isQuitting) {
      const r = dialog.showMessageBoxSync(control, { type: "question", buttons: ["Quit", "Cancel"], defaultId: 1, cancelId: 1, message: "Quit SCC Presenter?", detail: "The projector output is still showing." });
      if (r === 1) { e.preventDefault(); return; }
    }
    app.isQuitting = true;
  });
  control.on("closed", () => { control = null; app.quit(); });
  lockNavigation(control);
}

// Used by the release pipeline: install the app, start it with --smoke-test, and only publish if it opens cleanly.
function smokeTest(win) {
  const errors = [];
  const log = (line) => { console.log(line); if (process.env.SCC_SMOKE_LOG) try { fs.appendFileSync(process.env.SCC_SMOKE_LOG, line + "\n"); } catch { /* ignore */ } };
  const fail = (why) => { log(`SMOKE FAIL: ${why}`); app.exit(1); };
  const timer = setTimeout(() => fail("timed out"), 60000);
  log(`SMOKE START ${process.platform} ${app.getVersion()}`);
  win.webContents.on("console-message", (_e, level, message, line, source) => { if (level >= 3) errors.push(`${message} (${source}:${line})`); });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => fail(`load failed ${code} ${desc} ${url}`));
  win.webContents.on("preload-error", (_e, p, err) => fail(`preload error ${err?.message}`));
  win.webContents.on("render-process-gone", (_e, d) => fail(`renderer gone: ${d.reason}`));
  win.webContents.once("did-finish-load", async () => {
    await new Promise((r) => setTimeout(r, 4000));
    const ready = await win.webContents.executeJavaScript("!document.body.classList.contains('booting') && !!document.querySelector('#slides')").catch(() => false);
    if (!ready || errors.length) return fail(errors.join(" | ") || "control screen did not finish loading");
    const out = openOutputs("output");
    await new Promise((r) => setTimeout(r, 2500));
    const first = [...outWins.values()][0];
    if (!out?.ok || !first || first.isDestroyed()) return fail("output window did not open");
    const outOk = await first.webContents.executeJavaScript("!!document.querySelector('.scc-canvas')").catch(() => false);
    if (!outOk) return fail("output did not render");
    openLiveDesk();
    await new Promise((r) => setTimeout(r, 2500));
    const deskOk = await liveDesk?.webContents.executeJavaScript("!!document.querySelector('#desk') && !document.body.classList.contains('booting')").catch(() => false);
    if (!deskOk) return fail("live desk did not open");
    const atemErr = atem?.get()?.error || "";
    if (/couldn't start/.test(atemErr)) return fail(atemErr);
    clearTimeout(timer);
    log(`SMOKE OK ${app.getVersion()} server=${serverInfo.ok} outputs=${outWins.size} desk=ok atem=ready`);
    app.isQuitting = true; app.exit(0);
  });
}

function lockNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("app://local/")) e.preventDefault(); });
}

function displayList() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id, label: d.label || `Display ${i + 1}`, primary: d.id === primary, internal: !!d.internal,
    width: d.size.width, height: d.size.height, scale: d.scaleFactor,
    pixelsWide: Math.round(d.size.width * d.scaleFactor), pixelsHigh: Math.round(d.size.height * d.scaleFactor),
    hz: Math.round(d.displayFrequency || 0) || null, colorDepth: d.colorDepth, rotation: d.rotation, bounds: d.bounds,
  }));
}
// ── Outputs: any number of screens, each with its own content (see shared/modes.js) ─────────────────
const DEFAULT_OUTPUTS = [
  { id: "main", name: "Projector", mode: "full", displayId: null, enabled: true },
  { id: "stage", name: "Stage screen", mode: "stage", displayId: null, enabled: true },
];
export function outputsConfig() {
  const list = store.read("settings").outputs;
  return Array.isArray(list) && list.length ? list : DEFAULT_OUTPUTS;
}
/** Screens without a chosen display get the external screens in order (never the laptop's own screen if avoidable). */
function assignDisplays(list) {
  const all = screen.getAllDisplays(), primary = screen.getPrimaryDisplay();
  const external = all.filter((d) => d.id !== primary.id);
  const used = new Set(list.map((o) => o.displayId).filter(Boolean));
  let k = 0;
  return list.map((o) => {
    if (o.displayId && all.some((d) => d.id === o.displayId)) return { ...o, display: all.find((d) => d.id === o.displayId) };
    while (k < external.length && used.has(external[k].id)) k++;
    const d = external[k++] || null;
    return { ...o, display: d };
  });
}

function openOutputWindow(o) {
  outWins.get(o.id)?.destroy();
  const d = o.display;
  const windowed = !d || d.id === screen.getPrimaryDisplay().id;
  const b = (d || screen.getPrimaryDisplay()).workArea;
  const n = outWins.size;
  const page = o.mode === "stage" ? "stage" : `output?mode=${encodeURIComponent(o.mode || "full")}`;
  const win = new BrowserWindow({
    x: windowed ? b.x + b.width - 660 - n * 30 : d.bounds.x, y: windowed ? b.y + 40 + n * 30 : d.bounds.y, width: windowed ? 640 : d.bounds.width, height: windowed ? 360 : d.bounds.height,
    frame: windowed, fullscreen: !windowed && process.platform !== "darwin", backgroundColor: o.mode === "green" ? "#00b140" : "#000000", title: `SCC Presenter – ${o.name}`,
    autoHideMenuBar: true, show: false, skipTaskbar: !windowed, webPreferences: { ...webPrefs, backgroundThrottling: false },
  });
  if (windowed) win.setAspectRatio(16 / 9);
  win.loadURL(`app://local/${page}`);
  win.once("ready-to-show", () => {
    // macOS: simple full screen avoids a separate Space and the slide-in animation on the projector.
    if (!windowed && process.platform === "darwin") win.setSimpleFullScreen(true);
    if (!windowed) win.setAlwaysOnTop(true, "screen-saver");
    win.showInactive();
    win.webContents.send("live:state", live);
  });
  win.on("closed", () => { if (outWins.get(o.id) === win) outWins.delete(o.id); notifyScreens(); });
  lockNavigation(win);
  outWins.set(o.id, win);
  return windowed;
}

/** kind "output" = every enabled non-stage output; "stage" = stage outputs; or a single output id. */
function openOutputs(kind) {
  const list = assignDisplays(outputsConfig().filter((o) => o.enabled !== false));
  const pick = list.filter((o) => kind === "stage" ? o.mode === "stage" : kind === "output" ? o.mode !== "stage" : o.id === kind);
  let windowed = false;
  for (const o of pick) windowed = openOutputWindow(o) || windowed;
  notifyScreens();
  return { ok: pick.length > 0, windowed, count: pick.length };
}
function closeOutputs(kind) {
  const cfg = new Map(outputsConfig().map((o) => [o.id, o]));
  for (const [id, w] of outWins) {
    const mode = cfg.get(id)?.mode;
    if (kind === "output" ? mode !== "stage" : kind === "stage" ? mode === "stage" : id === kind) w.destroy();
  }
  notifyScreens();
}
function screensState() {
  const cfg = outputsConfig();
  const open = [...outWins.keys()];
  const mode = (id) => cfg.find((o) => o.id === id)?.mode;
  return {
    output: open.some((id) => mode(id) !== "stage"), stage: open.some((id) => mode(id) === "stage"),
    open, outputs: assignDisplays(cfg).map(({ display, ...o }) => ({ ...o, displayLabel: display ? (display.label || "Screen") : "Laptop window" })),
    displays: displayList(),
  };
}
function notifyScreens() { control?.webContents.send("screens", screensState()); }

// ── Live desk: ATEM, OBS, cameras and streaming in a window you can put on its own screen ─────────
function openLiveDesk(displayId) {
  if (liveDesk && !liveDesk.isDestroyed()) {
    if (displayId) { const d = screen.getAllDisplays().find((x) => x.id === displayId); if (d) { liveDesk.setBounds(d.workArea); liveDesk.maximize(); } }
    liveDesk.show(); liveDesk.focus(); return true;
  }
  const d = displayId ? screen.getAllDisplays().find((x) => x.id === displayId) : null;
  liveDesk = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 640, show: false, backgroundColor: "#0b0d11", title: "SCC Presenter – Live desk",
    ...(d ? { x: d.workArea.x, y: d.workArea.y } : {}), webPreferences: { ...webPrefs, backgroundThrottling: false },
  });
  liveDesk.loadURL("app://local/live/index.html");
  liveDesk.once("ready-to-show", () => { if (d) liveDesk.maximize(); liveDesk.show(); });
  liveDesk.on("closed", () => { liveDesk = null; control?.webContents.send("desk", false); });
  lockNavigation(liveDesk);
  control?.webContents.send("desk", true);
  return true;
}

// ── Words for the ATEM media pool: an invisible 1080p window draws the slide with a transparent background ──
let netKeyImage = null;
function ensureNetKeyWin() {
  if (netKeyWin && !netKeyWin.isDestroyed()) return netKeyWin;
  netKeyWin = new BrowserWindow({ show: false, width: 1920, height: 1080, frame: false, transparent: true, useContentSize: true,
    webPreferences: { ...webPrefs, offscreen: true, backgroundThrottling: false } });
  netKeyWin.webContents.setFrameRate(10);
  netKeyWin.webContents.on("paint", (_e, _dirty, image) => { netKeyImage = image; });
  netKeyWin.loadURL("app://local/output?transparent=1&still=1&sound=0");
  netKeyWin.webContents.once("did-finish-load", () => netKeyWin?.webContents.send("live:state", live));
  netKeyWin.on("closed", () => { netKeyWin = null; });
  return netKeyWin;
}
async function captureWords(width, height) {
  const win = ensureNetKeyWin();
  win.webContents.send("live:state", live);
  await new Promise((r) => setTimeout(r, 180));
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 120));
  let img = netKeyImage;
  if (!img || img.isEmpty()) return null;
  const sz = img.getSize();
  if (sz.width !== width || sz.height !== height) img = img.resize({ width, height, quality: "best" });
  const bgra = img.toBitmap();
  const rgba = Buffer.allocUnsafe(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) { rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3]; }
  return rgba;
}

// ── Recordings from the live desk are written straight to disk as they happen (nothing lost if the app closes) ──
const recordings = new Map();
function recordingsDir() { const d = path.join(app.getPath("videos"), "SCC Presenter"); fs.mkdirSync(d, { recursive: true }); return d; }

// ── Show packages (.sccshow): a show plus its songs and media, for sharing ────────────────────────
const MAX_EMBED = 60 * 1024 * 1024;
function buildPackage(showId, { embedMedia = true } = {}) {
  const show = store.read("shows").find((s) => s.id === showId);
  if (!show) return null;
  const songIds = new Set(show.items.filter((i) => i.type === "song").map((i) => i.songId));
  const mediaIds = new Set(show.items.filter((i) => i.type === "media").map((i) => i.mediaId));
  for (const i of show.items) if (i.background?.src) mediaIds.add(i.background.src);
  const songs = store.read("songs").filter((s) => songIds.has(s.id));
  let total = 0;
  const media = store.read("media").filter((m) => mediaIds.has(m.id)).map((m) => {
    const out = { id: m.id, name: m.name, type: m.type, ext: path.extname(m.path) };
    try {
      const size = fs.statSync(m.path).size;
      if (embedMedia && total + size <= MAX_EMBED) { out.data = fs.readFileSync(m.path).toString("base64"); total += size; }
      else out.skipped = true;
    } catch { out.missing = true; }
    return out;
  });
  return { format: "scc-show", version: 1, app: `SCC Presenter ${app.getVersion()}`, exportedAt: new Date().toISOString(), show: { ...show, shared: false }, songs, media };
}

function importPackage(pkg) {
  if (!pkg || pkg.format !== "scc-show" || !pkg.show) throw new Error("This isn't an SCC Presenter show file.");
  fs.mkdirSync(mediaDir(), { recursive: true });
  const existingSongs = new Map(store.read("songs").map((s) => [s.id, s]));
  for (const s of pkg.songs || []) if (!existingSongs.has(s.id) || (existingSongs.get(s.id).updatedAt || 0) < (s.updatedAt || 0)) store.upsert("songs", s);
  let skipped = 0;
  for (const m of pkg.media || []) {
    if (store.read("media").some((x) => x.id === m.id && fs.existsSync(x.path))) continue;
    if (!m.data) { skipped++; continue; }
    const safeExt = /^\.[a-z0-9]{1,5}$/i.test(m.ext || "") ? m.ext : "";
    const file = path.join(mediaDir(), `${m.id}${safeExt}`);
    fs.writeFileSync(file, Buffer.from(m.data, "base64"));
    store.upsert("media", { id: m.id, name: String(m.name || "Media"), type: m.type, path: file });
  }
  const show = { ...pkg.show, id: store.read("shows").some((s) => s.id === pkg.show.id) ? newId() : pkg.show.id, shared: false };
  store.upsert("shows", show);
  return { show, songs: (pkg.songs || []).length, skipped };
}

// ── IPC ────────────────────────────────────────────────────────────────────────────────────────────
const LISTS = new Set(["songs", "shows", "media"]);
function registerIpc() {
  const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });

  handle("lib:get", (name) => { if (!LISTS.has(name) && name !== "settings") throw new Error("Unknown"); return store.read(name); });
  handle("lib:upsert", (name, item) => { if (!LISTS.has(name)) throw new Error("Unknown"); return store.upsert(name, { ...item, id: item.id || newId() }); });
  handle("lib:remove", (name, id) => { if (!LISTS.has(name)) throw new Error("Unknown"); store.remove(name, id); return true; });
  handle("settings:set", (patch) => {
    const s = { ...store.read("settings"), ...patch };
    store.write("settings", s);
    if ("logoSrc" in patch || "customThemes" in patch) setLive({ logoSrc: s.logoSrc, themes: s.customThemes || [] });
    return s;
  });

  handle("live:get", () => live);
  handle("live:set", (patch) => setLive(patch));
  handle("remote:view", (view) => { remoteView = view; return true; });

  handle("screens:get", () => screensState());
  handle("screens:open", (kind) => openOutputs(kind || "output"));
  handle("screens:close", (kind) => { closeOutputs(kind || "output"); return true; });
  handle("outputs:set", (list) => {
    const clean = (Array.isArray(list) ? list : []).slice(0, 8).map((o, i) => ({
      id: String(o.id || `out${i}`).replace(/[^\w-]/g, "").slice(0, 20) || `out${i}`, name: String(o.name || `Output ${i + 1}`).slice(0, 40),
      mode: ["full", "words", "green", "fill", "key", "visuals", "stage"].includes(o.mode) ? o.mode : "full",
      displayId: o.displayId ? Number(o.displayId) : null, enabled: o.enabled !== false,
    }));
    store.write("settings", { ...store.read("settings"), outputs: clean });
    // Re-open any outputs that are showing so changes apply straight away.
    const open = [...outWins.keys()];
    for (const id of open) { outWins.get(id)?.destroy(); outWins.delete(id); }
    const assigned = assignDisplays(clean.filter((o) => o.enabled));
    for (const o of assigned) if (open.includes(o.id)) openOutputWindow(o);
    notifyScreens();
    return screensState();
  });
  handle("desk:open", (displayId) => openLiveDesk(displayId ? Number(displayId) : null));
  handle("atem:get", () => atem.get());
  handle("atem:connect", (ip) => atem.connect(ip));
  handle("atem:disconnect", () => atem.disconnect());
  handle("atem:action", (a) => atem.action(a));
  handle("atem:setupCable", (o) => atem.setupCableKey(o || {}));
  handle("atem:setupNet", (o) => atem.setupNetKey(o || {}));
  handle("atem:stopAuto", () => atem.stopAuto());
  handle("rec:start", (ext) => {
    const id = newId(), stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const file = path.join(recordingsDir(), `Service ${stamp}.${ext === "mp4" ? "mp4" : "webm"}`);
    recordings.set(id, fs.createWriteStream(file)); recordings.get(id).path = file;
    return { id, file };
  });
  handle("rec:chunk", (id, data) => { const w = recordings.get(id); if (w) w.write(Buffer.from(data)); return true; });
  handle("rec:stop", (id) => new Promise((resolve) => { const w = recordings.get(id); if (!w) return resolve(null); recordings.delete(id); w.end(() => resolve(w.path)); }));
  handle("rec:reveal", (file) => { if (file && file.startsWith(recordingsDir())) shell.showItemInFolder(file); else shell.openPath(recordingsDir()); return true; });
  handle("import:start", (opts) => importer.start(opts || {}));
  handle("import:get", () => importer.get());
  handle("import:cancel", () => importer.cancel());
  handle("import:freeshow", () => importer.findFreeShow());
  handle("import:pickFolder", async () => { const r = await dialog.showOpenDialog(control, { title: "Choose a folder to import", properties: ["openDirectory", "multiSelections"] }); return r.canceled ? [] : r.filePaths; });
  handle("import:pickFiles", async () => { const r = await dialog.showOpenDialog(control, { title: "Choose files to import", properties: ["openFile", "multiSelections"], filters: [{ name: "Songs and shows", extensions: ["show", "xml", "txt", "sccshow", "json"] }] }); return r.canceled ? [] : r.filePaths; });
  handle("screens:identify", () => {
    for (const [i, d] of screen.getAllDisplays().entries()) {
      const w = new BrowserWindow({ x: d.bounds.x + 40, y: d.bounds.y + 40, width: 260, height: 160, frame: false, alwaysOnTop: true, transparent: true, focusable: false, skipTaskbar: true });
      w.loadURL(`data:text/html,<body style="margin:0;display:grid;place-items:center;height:100vh;background:rgba(20,24,32,.92);color:white;font:700 64px system-ui;border-radius:16px">${i + 1}</body>`);
      setTimeout(() => !w.isDestroyed() && w.close(), 2500);
    }
    return true;
  });

  handle("media:add", async (paths) => {
    let list = paths;
    if (!list?.length) {
      const r = await dialog.showOpenDialog(control, { title: "Add media", properties: ["openFile", "multiSelections"], filters: [{ name: "Images, videos and audio", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "mp4", "webm", "mov", "m4v", "mkv", "mp3", "wav", "ogg", "m4a", "aac", "flac"] }] });
      if (r.canceled) return [];
      list = r.filePaths;
    }
    const added = [];
    for (const p of list) {
      const type = IMAGE.test(p) ? "image" : VIDEO.test(p) ? "video" : AUDIO.test(p) ? "audio" : null;
      if (!type || !fs.existsSync(p)) continue;
      const existing = store.read("media").find((m) => m.path === p);
      if (existing) { added.push(existing); continue; }
      added.push(store.upsert("media", { id: newId(), name: path.basename(p).replace(/\.[^.]+$/, ""), type, path: p }));
    }
    return added;
  });
  handle("media:reveal", (id) => { const p = mediaPath(id); if (p) shell.showItemInFolder(p); return !!p; });

  handle("file:open", async (kind) => {
    const filters = {
      songs: [{ name: "Songs (FreeShow, OpenLyrics/OpenLP, text)", extensions: ["show", "xml", "txt", "json"] }],
      show: [{ name: "SCC Presenter show", extensions: ["sccshow"] }],
      text: [{ name: "Text", extensions: ["txt", "md"] }],
    }[kind] || [];
    const r = await dialog.showOpenDialog(control, { properties: ["openFile", "multiSelections"], filters });
    if (r.canceled) return [];
    return r.filePaths.filter((p) => fs.statSync(p).size < 80 * 1024 * 1024).map((p) => ({ name: path.basename(p), ext: path.extname(p).toLowerCase(), text: fs.readFileSync(p, "utf8") }));
  });
  handle("show:export", async (showId) => {
    const pkg = buildPackage(showId);
    if (!pkg) throw new Error("Show not found");
    const r = await dialog.showSaveDialog(control, { title: "Save show to share", defaultPath: `${(pkg.show.title || "Show").replace(/[\\/:*?"<>|]+/g, "-")}.sccshow`, filters: [{ name: "SCC Presenter show", extensions: ["sccshow"] }] });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(pkg));
    shell.showItemInFolder(r.filePath);
    return { path: r.filePath, skipped: pkg.media.filter((m) => m.skipped).length };
  });
  handle("show:import", (text) => importPackage(typeof text === "string" ? JSON.parse(text) : text));
  handle("show:fetchLan", async (host, pin, id) => {
    const h = String(host || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!/^[\w.-]+(:\d{2,5})?$/.test(h)) throw new Error("Type the address shown on the other computer, like 192.168.1.20:4747");
    const base = `http://${h.includes(":") ? h : `${h}:4747`}/api/share?pin=${encodeURIComponent(pin || "")}`;
    const res = await fetch(id ? `${base}&id=${encodeURIComponent(id)}` : base, { signal: AbortSignal.timeout(id ? 120000 : 8000) }).catch(() => null);
    if (!res) throw new Error("Couldn't reach that computer. Check both are on the same Wi-Fi and SCC Presenter is open there.");
    if (res.status === 401) throw new Error("Wrong PIN. Use the PIN shown in Connect on the other computer.");
    if (!res.ok) throw new Error("That computer didn't share the show.");
    const data = await res.json();
    return id ? importPackage(data) : data.shows;
  });

  handle("bible:lookup", (ref, tr) => bible.lookup(ref, tr));
  handle("bible:translations", () => bible.translations);

  handle("ai:status", () => ai.getStatus());
  handle("ai:setKey", (key) => ai.setKey(key));
  handle("ai:tidy", (text) => ai.tidyLyrics(text));
  handle("ai:scriptures", (topic) => ai.scripturesFor(topic));
  handle("ai:sermon", (notes) => ai.sermonSlides(notes));

  handle("updates:check", () => updates.check());
  handle("updates:get", () => updates.get());
  handle("updates:install", () => updates.install());

  handle("server:info", () => {
    const s = store.read("settings");
    return { ...serverInfo, pin: s.remotePin, addresses: lanAddresses(), clients: server?.clientCount() || 0 };
  });
  handle("server:newPin", () => { const pin = String(crypto.randomInt(1000, 9999)); store.write("settings", { ...store.read("settings"), remotePin: pin }); return pin; });

  handle("beta:feedback", async (data) => {
    const res = await fetch("https://aogsccyouth.com/api/presenter/feedback", {
      method: "POST", headers: { "content-type": "application/json", "user-agent": `SCC-Presenter/${app.getVersion()}` },
      body: JSON.stringify({ ...data, version: app.getVersion(), platform: process.platform }), signal: AbortSignal.timeout(20000),
    }).catch(() => null);
    if (!res) throw new Error("Couldn't send — check the internet connection and try again.");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Couldn't send feedback right now.");
    return true;
  });
  handle("app:system", async () => {
    const gpu = await app.getGPUInfo("basic").catch(() => ({}));
    const status = app.getGPUFeatureStatus();
    const cpus = os.cpus();
    return {
      os: `${{ win32: "Windows", darwin: "macOS", linux: "Linux" }[process.platform] || process.platform} ${os.release()}`, arch: process.arch,
      cpu: cpus[0]?.model?.replace(/\s+/g, " ").trim() || "Unknown", cores: cpus.length,
      memoryGB: Math.round(os.totalmem() / 1073741824 * 10) / 10, freeGB: Math.round(os.freemem() / 1073741824 * 10) / 10,
      gpu: (gpu.gpuDevice || []).map((d) => ({ active: !!d.active, vendor: d.vendorId, device: d.deviceId, name: d.deviceString || null })),
      videoDecode: status.video_decode, gpuCompositing: status.gpu_compositing, electron: process.versions.electron, version: app.getVersion(),
    };
  });
  handle("app:info", () => ({ version: app.getVersion(), platform: process.platform, data: app.getPath("userData") }));
  handle("app:open", (url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });
  handle("app:openData", () => shell.openPath(app.getPath("userData")));
}

function buildMenu() {
  const send = (cmd) => () => control?.webContents.send("menu", cmd);
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ label: "SCC Presenter", submenu: [{ role: "about" }, { type: "separator" }, { label: "Settings…", accelerator: "Cmd+,", click: send("settings") }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] }] : []),
    { label: "File", submenu: [
      { label: "New song", accelerator: "CmdOrCtrl+N", click: send("new-song") },
      { label: "New show", accelerator: "CmdOrCtrl+Shift+N", click: send("new-show") },
      { type: "separator" },
      { label: "Import songs…", accelerator: "CmdOrCtrl+I", click: send("import-songs") },
      { label: "Open shared show…", accelerator: "CmdOrCtrl+O", click: send("import-show") },
      { label: "Receive show over network…", click: send("receive-lan") },
      { type: "separator" },
      ...(isMac ? [] : [{ label: "Settings", accelerator: "Ctrl+,", click: send("settings") }, { type: "separator" }, { role: "quit" }]),
    ] },
    { role: "editMenu" },
    { label: "Present", submenu: [
      { label: "Show output", accelerator: "CmdOrCtrl+Shift+O", click: send("toggle-output") },
      { label: "Show stage screen", accelerator: "CmdOrCtrl+Shift+S", click: send("toggle-stage") },
      { label: "Live desk (ATEM, OBS, streaming)", accelerator: "CmdOrCtrl+L", click: () => openLiveDesk() },
      { type: "separator" },
      { label: "Clear all", accelerator: "Escape", registerAccelerator: false, click: send("clear-all") },
    ] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "Help", submenu: [
      { label: "Keyboard shortcuts", click: send("shortcuts") },
      { label: "Check for updates", click: send("updates") },
      { label: "Release notes", click: () => shell.openExternal("https://aogsccyouth.com/presenter") },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on("second-instance", () => { if (control) { if (control.isMinimized()) control.restore(); control.focus(); } });
app.on("before-quit", () => { app.isQuitting = true; server?.close(); importer?.pause(); for (const w of recordings.values()) w.end(); atem?.disconnect().catch(() => {}); });
app.on("window-all-closed", () => app.quit());

app.whenReady().then(async () => {
  if (!gotLock) return;
  const dir = app.getPath("userData");
  store = createStore(dir);
  bible = createBible(dir);
  ai = createAI(dir, safeStorage);
  updates = createUpdates((s) => control?.webContents.send("updates", s));
  const settings = store.read("settings");
  if (!settings.remotePin) store.write("settings", { ...settings, remotePin: String(crypto.randomInt(1000, 9999)) });
  live = { ...live, themeId: settings.themeId || "classic", logoSrc: settings.logoSrc || null, themes: settings.customThemes || [] };

  const sendDesk = (ch) => (data) => { if (liveDesk && !liveDesk.isDestroyed()) liveDesk.webContents.send(ch, data); };
  // ATEM support loads on its own, so a problem with it can never stop the rest of the app from starting.
  let createAtem;
  try { ({ createAtem } = await import("./atem.js")); }
  catch (e) {
    const why = `ATEM support couldn't start on this computer (${e?.message || e}).`;
    createAtem = () => ({ connect: async () => { throw new Error(why); }, disconnect: async () => {}, action: async () => { throw new Error(why); }, setupCableKey: async () => { throw new Error(why); },
      setupNetKey: async () => { throw new Error(why); }, stopAuto: async () => {}, onLive: () => {}, get: () => ({ connected: false, status: "off", error: why }) });
  }
  atem = createAtem({
    send: (st) => { sendDesk("atem")(st); control?.webContents.send("atem", st); },
    getSettings: () => store.read("settings"),
    setSettings: (patch) => store.write("settings", { ...store.read("settings"), ...patch }),
    captureWords,
  });
  importer = createImporter({ dir, store, importPackage, send: (p) => control?.webContents.send("import", p) });
  protocol.handle("app", handleApp);
  // Only the app's own pages may list speakers/microphones, pick a speaker or use the clipboard. Everything else is refused.
  const ALLOWED = new Set(["media", "speaker-selection", "clipboard-read", "clipboard-sanitized-write", "fullscreen"]);
  const own = (url) => String(url || "").startsWith("app://local");
  session.defaultSession.setPermissionCheckHandler((_wc, perm, origin) => own(origin) && ALLOWED.has(perm));
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(own(wc.getURL()) && ALLOWED.has(perm)));
  registerIpc();
  buildMenu();
  createControl();

  server = createServer({
    getState: () => live,
    getRemoteView: () => ({ ...remoteView, blackout: live.blackout, clear: live.clear, logo: live.logo }),
    onRemote: (cmd) => control?.webContents.send("remote", cmd),
    getPin: () => store.read("settings").remotePin,
    listShared: () => store.read("shows").filter((s) => s.shared).map((s) => ({ id: s.id, title: s.title, date: s.date, items: s.items.length })),
    sharePackage: (id) => store.read("shows").find((s) => s.id === id && s.shared) ? buildPackage(id) : null,
    mediaPath: (id) => mediaPath(id),
  });
  serverInfo = settings.serverEnabled === false ? { ok: false, error: "Turned off in settings" } : await server.listen(settings.port || 4747);

  screen.on("display-added", notifyScreens);
  screen.on("display-removed", () => {
    // If the projector is unplugged, close its window instead of leaving it on the laptop screen.
    for (const w of outWins.values()) if (!w.isDestroyed() && !screen.getAllDisplays().some((d) => { const b = w.getBounds(); return b.x >= d.bounds.x && b.x < d.bounds.x + d.bounds.width; })) w.close();
    notifyScreens();
  });
  if (settings.autoUpdate !== false && app.isPackaged) setTimeout(() => updates.check(), 8000);
  // Reconnect to the ATEM used last time, and finish any import that was interrupted.
  if (settings.atem?.ip && !process.argv.includes("--smoke-test")) setTimeout(() => atem.connect(settings.atem.ip).catch(() => {}), 2500);
  control?.webContents.once("did-finish-load", () => setTimeout(() => importer.resume(), 1500));
});

