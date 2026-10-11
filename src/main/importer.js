// Background import: hundreds of songs from FreeShow, OpenLP/OpenLyrics, text files and shared shows.
// Progress is saved to disk after every batch, so if the computer or app closes, the import carries on
// from where it stopped the next time SCC Presenter opens. Songs already in the library are skipped.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importFreeShow, importOpenLyricsText, importPlainText, newId } from "../shared/importers.js";

const EXTS = new Set([".show", ".xml", ".txt", ".sccshow"]);
const MAX_FILES = 20000, MAX_BYTES = 80 * 1024 * 1024, BATCH = 25;

const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const songKey = (s) => `${norm(s.title)}|${norm(s.sections?.[0]?.text || "").slice(0, 60)}`;

/** Every importable file under the given folders (and the files given directly). */
export function collectFiles({ folders = [], files = [] }) {
  const out = [], seen = new Set();
  const add = (f) => { if (!seen.has(f) && EXTS.has(path.extname(f).toLowerCase())) { seen.add(f); out.push(f); } };
  for (const f of files) add(f);
  const walk = (dir, depth) => {
    if (depth > 6 || out.length >= MAX_FILES) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (e.isFile()) add(p);
      if (out.length >= MAX_FILES) return;
    }
  };
  for (const d of folders) walk(d, 0);
  return out;
}

/** One file → songs (or a shared show). */
export function parseFile(file, text, importPackage) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".sccshow") { importPackage(JSON.parse(text)); return { songs: [], show: true }; }
  let song;
  if (ext === ".show") song = importFreeShow(text);
  else if (ext === ".xml") song = importOpenLyricsText(text);
  else song = importPlainText(text, path.basename(file).replace(/\.[^.]+$/, ""));
  if (!song.sections.length) throw new Error("no words found");
  return { songs: [song] };
}

export function createImporter({ dir, store, importPackage, send }) {
  const jobFile = path.join(dir, "import-job.json");
  let job = null, running = false, stopFlag = false;
  try { job = JSON.parse(fs.readFileSync(jobFile, "utf8")); } catch { job = null; }
  const save = () => { try { fs.writeFileSync(jobFile + ".tmp", JSON.stringify(job)); fs.renameSync(jobFile + ".tmp", jobFile); } catch { /* ignore */ } };
  const view = () => job ? { status: job.status, label: job.label, total: job.files.length, done: job.done, imported: job.imported, skipped: job.skipped, failed: job.failed.length, failures: job.failed.slice(-20), current: job.current || "", resumed: !!job.resumed } : { status: "idle" };
  const emit = () => send(view());

  async function run() {
    if (running || !job || job.status !== "running") return;
    running = true; stopFlag = false;
    const known = new Set(store.read("songs").map(songKey));
    try {
      while (job.done < job.files.length && !stopFlag) {
        const batch = job.files.slice(job.done, job.done + BATCH);
        const add = [];
        for (const file of batch) {
          job.current = path.basename(file);
          try {
            const st = fs.statSync(file);
            if (st.size > MAX_BYTES) throw new Error("file too large");
            const r = parseFile(file, fs.readFileSync(file, "utf8"), importPackage);
            if (r.show) job.imported++;
            for (const s of r.songs) {
              const k = songKey(s);
              if (known.has(k)) { job.skipped++; continue; }
              known.add(k); add.push({ ...s, id: s.id || newId(), updatedAt: Date.now(), importedFrom: job.label }); job.imported++;
            }
          } catch (e) { job.failed.push({ file: path.basename(file), error: String(e?.message || e).slice(0, 120) }); }
          job.done++;
        }
        if (add.length) store.write("songs", [...store.read("songs"), ...add]);
        save(); emit();
        await new Promise((r) => setTimeout(r, 15));   // let the app breathe between batches
      }
      if (job.done >= job.files.length) { job.status = "done"; job.finishedAt = Date.now(); job.current = ""; save(); emit(); }
    } finally { running = false; }
  }

  return {
    start({ folders = [], files = [], label = "Import" }) {
      if (running) throw new Error("An import is already running.");
      const list = collectFiles({ folders, files });
      if (!list.length) throw new Error("No songs found there. SCC Presenter imports FreeShow (.show), OpenLP/OpenLyrics (.xml), text (.txt) and shared shows (.sccshow).");
      job = { id: newId(), label, files: list, done: 0, imported: 0, skipped: 0, failed: [], status: "running", startedAt: Date.now() };
      save(); emit(); setTimeout(run, 50);
      return view();
    },
    resume() { if (job?.status === "running" && job.done < job.files.length) { job.resumed = true; emit(); run(); } else if (job) emit(); },
    pause() { stopFlag = true; if (job) save(); },
    cancel() { stopFlag = true; if (job && job.status === "running") { job.status = "cancelled"; save(); } emit(); return view(); },
    get: view,
    findFreeShow() {
      const home = os.homedir();
      const docs = [path.join(home, "Documents"), path.join(home, "OneDrive", "Documents"), path.join(home, "My Documents"), home];
      const found = [];
      for (const d of docs) for (const p of [path.join(d, "FreeShow", "Shows"), path.join(d, "FreeShow")]) {
        try { if (fs.statSync(p).isDirectory() && !found.some((f) => p.startsWith(f))) found.push(p); } catch { /* not there */ }
      }
      const shows = found.length ? collectFiles({ folders: [found[0]] }).filter((f) => f.endsWith(".show")).length : 0;
      return { folders: found, shows };
    },
  };
}
