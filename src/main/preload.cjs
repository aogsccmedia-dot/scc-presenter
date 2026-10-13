// Bridge between the app's pages and the main process. Pages get a small, fixed API — no Node access.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error || "Something went wrong");
  return r.data;
};
const on = (ch) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld("scc", {
  lib: {
    get: (name) => call("lib:get", name),
    upsert: (name, item) => call("lib:upsert", name, item),
    remove: (name, id) => call("lib:remove", name, id),
    setSettings: (patch) => call("settings:set", patch),
  },
  live: { get: () => call("live:get"), set: (patch) => call("live:set", patch), onState: on("live:state") },
  remote: { setView: (v) => call("remote:view", v), onCommand: on("remote") },
  screens: { get: () => call("screens:get"), open: (k, d) => call("screens:open", k, d), close: (k) => call("screens:close", k), identify: () => call("screens:identify"), onChange: on("screens") },
  media: { add: (paths) => call("media:add", paths), reveal: (id) => call("media:reveal", id), pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch { return ""; } } },
  files: { open: (kind) => call("file:open", kind) },
  shows: { exportFile: (id) => call("show:export", id), importText: (t) => call("show:import", t), fetchLan: (host, pin, id) => call("show:fetchLan", host, pin, id) },
  bible: { lookup: (ref, tr) => call("bible:lookup", ref, tr), translations: () => call("bible:translations") },
  ai: { status: () => call("ai:status"), setKey: (k) => call("ai:setKey", k), config: (p) => call("ai:config", p), test: () => call("ai:test"), tidy: (t) => call("ai:tidy", t), scriptures: (t) => call("ai:scriptures", t), sermon: (t) => call("ai:sermon", t) },
  updates: { ring: (r) => call("updates:ring", r), check: () => call("updates:check"), get: () => call("updates:get"), install: () => call("updates:install"), onStatus: on("updates") },
  server: { info: () => call("server:info"), newPin: () => call("server:newPin") },
  app: { info: () => call("app:info"), system: () => call("app:system"), open: (url) => call("app:open", url), openData: () => call("app:openData") },
  beta: { feedback: (d) => call("beta:feedback", d) },
  outputs: { set: (list) => call("outputs:set", list) },
  desk: { open: (displayId) => call("desk:open", displayId), onChange: on("desk") },
  atem: { get: () => call("atem:get"), connect: (ip) => call("atem:connect", ip), disconnect: () => call("atem:disconnect"), action: (a) => call("atem:action", a),
    setupCable: (o) => call("atem:setupCable", o), setupNet: (o) => call("atem:setupNet", o), stopAuto: () => call("atem:stopAuto"), onState: on("atem") },
  rec: { start: (ext) => call("rec:start", ext), chunk: (id, data) => call("rec:chunk", id, data), stop: (id) => call("rec:stop", id), reveal: (f) => call("rec:reveal", f) },
  importer: { start: (o) => call("import:start", o), get: () => call("import:get"), cancel: () => call("import:cancel"), freeshow: () => call("import:freeshow"),
    pickFolder: () => call("import:pickFolder"), pickFiles: () => call("import:pickFiles"), onProgress: on("import") },
  onMenu: on("menu"),
});
