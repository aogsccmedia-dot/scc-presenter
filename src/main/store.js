// Library storage: one JSON file per collection in the app's data folder, written atomically
// (write to a temp file, then rename) so a crash or power cut never leaves a half-written library.
import fs from "node:fs";
import path from "node:path";

const DEFAULTS = {
  songs: [],
  shows: [],
  media: [],
  settings: {
    themeId: "classic", outputDisplay: null, stageDisplay: null, translation: "kjv", maxLines: 4,
    logoSrc: null, remotePin: null, serverEnabled: true, port: 4747, autoUpdate: true, customThemes: [],
  },
};

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (name) => path.join(dir, `${name}.json`);
  const cache = {};
  function read(name) {
    if (cache[name]) return cache[name];
    let value = structuredClone(DEFAULTS[name] ?? null);
    try {
      const raw = JSON.parse(fs.readFileSync(file(name), "utf8"));
      value = name === "settings" ? { ...value, ...raw } : raw;
    } catch { /* first run, or unreadable: start from defaults */ }
    cache[name] = value;
    return value;
  }
  function write(name, value) {
    cache[name] = value;
    const tmp = file(name) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
    fs.renameSync(tmp, file(name));
    return value;
  }
  /** Insert or replace an item (matched by id) in a list collection. */
  function upsert(name, item) {
    const list = read(name).filter((x) => x.id !== item.id);
    list.push({ ...item, updatedAt: Date.now() });
    write(name, list);
    return item;
  }
  function remove(name, id) { write(name, read(name).filter((x) => x.id !== id)); }
  return { read, write, upsert, remove, dir };
}
