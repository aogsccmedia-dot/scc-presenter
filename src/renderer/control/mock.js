// Browser stand-in for the desktop bridge, so the control screen can be developed and tested in a normal browser.
// Only loaded when window.scc is missing (never inside the app).
const KEY = "scc-mock";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const db = load() || {
  songs: [
    { id: "s1", title: "Amazing Grace", author: "John Newton", ccli: "", sections: [
      { label: "Verse 1", text: "Amazing grace, how sweet the sound\nThat saved a wretch like me\nI once was lost, but now am found\nWas blind, but now I see" },
      { label: "Verse 2", text: "'Twas grace that taught my heart to fear\nAnd grace my fears relieved\nHow precious did that grace appear\nThe hour I first believed" },
      { label: "Verse 3", text: "When we've been there ten thousand years\nBright shining as the sun\nWe've no less days to sing God's praise\nThan when we'd first begun" }], arrangement: [0, 1, 2] },
    { id: "s2", title: "Holy, Holy, Holy", author: "Reginald Heber", ccli: "", sections: [
      { label: "Verse 1", text: "Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee\nHoly, holy, holy, merciful and mighty\nGod in three Persons, blessed Trinity" }], arrangement: [0] },
  ],
  shows: [], media: [], settings: { themeId: "classic", maxLines: 4, translation: "kjv", remotePin: "1234" },
};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } };
const listeners = { live: new Set(), screens: new Set() };
let live = { themeId: "classic", background: { type: "theme" }, blackout: false, clear: false, logo: false, item: {}, version: 0 };
const screens = { output: false, stage: false, open: [], outputs: [{ id: "main", name: "Projector", mode: "full", displayId: null, enabled: true, displayLabel: "EPSON Projector" }, { id: "stage", name: "Stage screen", mode: "stage", displayId: null, enabled: true, displayLabel: "Laptop window" }], displays: [{ id: 1, label: "Built-in display", primary: true, internal: true, width: 1536, height: 864, scale: 1.25, pixelsWide: 1920, pixelsHigh: 1080, hz: 60, colorDepth: 24 }, { id: 2, label: "EPSON Projector", primary: false, width: 1920, height: 1080, scale: 1, pixelsWide: 1920, pixelsHigh: 1080, hz: 60, colorDepth: 24 }] };
const sub = (set) => (cb) => { set.add(cb); return () => set.delete(cb); };
const id = () => Math.random().toString(36).slice(2, 10);

const DEMO_ATEM = { connected: true, status: "connected", ip: "192.168.10.240", model: "ATEM Mini Extreme ISO", program: 2, preview: 1, ftb: { black: false }, inTransition: false,
  inputs: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: i, short: i === 5 ? "LAPT" : `CAM${i}`, long: i === 5 ? "Laptop words" : ["Wide", "Pulpit", "Choir", "Close-up", "", "Drums", "Keys", "Crowd"][i - 1], type: "camera" })).concat([{ id: 0, short: "BLK", long: "Black", type: "black" }, { id: 3010, short: "MP1", long: "Media Player 1", type: "media" }]),
  dsk: [{ index: 0, onAir: true }, { index: 1, onAir: false }], usk: [{ index: 0, onAir: false }, { index: 1, onAir: false }],
  macros: [{ index: 0, name: "Opening" }, { index: 1, name: "Sermon wide" }, { index: 2, name: "Closing" }], mediaPlayers: 2,
  streaming: { supported: true, state: "streaming", duration: "00:42:17", kbps: 6000, cache: 3, service: { serviceName: "YouTube", hasKey: true } },
  recording: { supported: true, state: "recording", duration: "00:42:15" }, autoKey: { keyer: "dsk", index: 0, method: "network" } };
window.scc = {
  lib: {
    get: async (n) => structuredClone(db[n]),
    upsert: async (n, item) => { const it = { ...item, id: item.id || id(), updatedAt: Date.now() }; db[n] = db[n].filter((x) => x.id !== it.id).concat(it); save(); return it; },
    remove: async (n, i) => { db[n] = db[n].filter((x) => x.id !== i); save(); return true; },
    setSettings: async (p) => { db.settings = { ...db.settings, ...p }; save(); return structuredClone(db.settings); },
  },
  live: { get: async () => live, set: async (p) => { live = { ...live, ...p, version: live.version + 1 }; for (const cb of listeners.live) cb(live); return live; }, onState: sub(listeners.live) },
  remote: { setView: async () => true, onCommand: () => () => {} },
  screens: { get: async () => screens, open: async (k) => { screens[k] = true; for (const cb of listeners.screens) cb(screens); return { ok: true, windowed: true }; }, close: async (k) => { screens[k] = false; for (const cb of listeners.screens) cb(screens); return true; }, identify: async () => true, onChange: sub(listeners.screens) },
  media: { add: async () => [], reveal: async () => true, pathFor: () => "" },
  files: { open: async () => [] },
  shows: { exportFile: async () => null, importText: async () => { throw new Error("Not available in the browser preview"); }, fetchLan: async () => [] },
  bible: {
    lookup: async (ref) => ({ ref: { name: "John", chapter: 3 }, reference: ref, translation: "KJV", verses: [
      { chapter: 3, verse: 16, text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." },
      { chapter: 3, verse: 17, text: "For God sent not his Son into the world to condemn the world; but that the world through him might be saved." }] }),
    translations: async () => [{ id: "kjv", name: "King James Version" }, { id: "web", name: "World English Bible" }],
  },
  ai: { status: async () => ({ hasKey: false, secure: true }), setKey: async () => ({ ok: true }), tidy: async (t) => ({ text: t, ai: false }), scriptures: async () => ({ items: [{ ref: "Jeremiah 29:11", why: "About hope" }], ai: false }), sermon: async (t) => ({ slides: t.split("\n").filter(Boolean).map((x) => ({ kind: "text", text: x })), ai: false }) },
  updates: { check: async () => ({ status: "current", message: "You have the latest version." }), get: async () => ({ status: "idle" }), install: async () => true, onStatus: () => () => {} },
  server: { info: async () => ({ ok: true, port: 4747, pin: db.settings.remotePin, addresses: ["192.168.1.20"], clients: 0 }), newPin: async () => "4321" },
  app: { info: async () => ({ version: "0.1.0", platform: "browser" }), system: async () => ({ os: "Windows 10.0.22631", cpu: "Intel Core i5-8250U", cores: 8, memoryGB: 8, gpu: [{ active: true, name: "Intel UHD Graphics 620" }], videoDecode: "enabled" }), open: async (u) => window.open(u, "_blank"), openData: async () => true },
  beta: { feedback: async () => true },
  outputs: { set: async (list) => { db.settings.outputs = list; save(); screens.outputs = list; return screens; } },
  desk: { open: async () => true, onChange: () => () => {} },
  atem: { get: async () => (location.search.includes("demo") ? DEMO_ATEM : { connected: false, status: "off" }), connect: async () => { throw new Error("No ATEM in the browser preview"); }, disconnect: async () => true, action: async () => true, setupCable: async () => true, setupNet: async () => true, stopAuto: async () => true, onState: () => () => {} },
  rec: { start: async () => ({ id: "r", file: "preview.webm" }), chunk: async () => true, stop: async () => "preview.webm", reveal: async () => true },
  importer: { start: async () => ({ status: "running", total: 120, done: 0 }), get: async () => ({ status: "idle" }), cancel: async () => ({ status: "cancelled" }), freeshow: async () => ({ folders: ["C:\\Users\\Media\\Documents\\FreeShow\\Shows"], shows: 342 }), pickFolder: async () => [], pickFiles: async () => [], onProgress: (cb) => { window.__importCb = cb; return () => {}; } },
  onMenu: () => () => {},
};
