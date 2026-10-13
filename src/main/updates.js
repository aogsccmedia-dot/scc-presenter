// Software updates from GitHub Releases.
// Windows: downloads in the background and installs on restart (or when you press "Restart now").
// macOS: builds aren't Apple-signed yet, so the Mac can't replace itself. We check for a new version and open the download.
//
// Release rings (canary): each new version first reaches ~10% of computers, then 50%, then everyone (the release
// workflow sets "stagingPercentage" in latest.yml / latest-mac.yml and widens it while no blocking bugs are reported).
// Each computer has a stable random number, so it stays in or out of the early group. People who choose the "Early"
// ring always get new versions first.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { app, shell } from "electron";
import updaterPkg from "electron-updater";

const { autoUpdater } = updaterPkg;
const REPO = "aogsccmedia-dot/scc-presenter";
export const RELEASES_URL = "https://aogsccyouth.com/presenter";

export function newer(a, b) {
  const pa = String(a).replace(/^v/, "").split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
  return false;
}

// electron-updater keeps this computer's rollout number in <userData>/.updaterId (a UUID; its last 4 bytes decide the
// bucket). The "Early" ring uses a UUID whose bucket is 0, so it's inside every rollout from the first 10%.
const EARLY_ID = "00000000-0000-4000-8000-000000000000";
const idFile = () => path.join(app.getPath("userData"), ".updaterId");
export function setRing(ring) {
  try {
    if (ring === "canary") fs.writeFileSync(idFile(), EARLY_ID);
    else if (fs.existsSync(idFile()) && fs.readFileSync(idFile(), "utf8").trim() === EARLY_ID) fs.writeFileSync(idFile(), crypto.randomUUID());
  } catch { /* first run: electron-updater creates it */ }
}
/** 0–100: where this computer sits in a staged rollout (same maths as electron-updater). */
export function rolloutBucket() {
  let id = null;
  try { id = fs.readFileSync(idFile(), "utf8").trim(); } catch { /* none yet */ }
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) { id = crypto.randomUUID(); try { fs.writeFileSync(idFile(), id); } catch { /* read-only */ } }
  const hex = id.replace(/-/g, "");
  return (parseInt(hex.slice(24, 32), 16) / 0xffffffff) * 100;
}
export const inRollout = (pct, bucket) => pct == null || !Number.isFinite(pct) || bucket < pct;

export function createUpdates(send) {
  let state = { status: "idle", version: app.getVersion(), latest: null, progress: 0, message: "" };
  const set = (patch) => { state = { ...state, ...patch }; send(state); };
  const selfUpdating = process.platform === "win32" && app.isPackaged;

  if (selfUpdating) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = true; // beta builds are published as pre-releases
    autoUpdater.on("checking-for-update", () => set({ status: "checking", message: "Checking for updates…" }));
    autoUpdater.on("update-available", (i) => set({ status: "downloading", latest: i.version, message: `Downloading version ${i.version}…` }));
    autoUpdater.on("update-not-available", () => set({ status: "current", message: "You have the latest version." }));
    autoUpdater.on("download-progress", (p) => set({ progress: Math.round(p.percent || 0) }));
    autoUpdater.on("update-downloaded", (i) => set({ status: "ready", latest: i.version, message: `Version ${i.version} is ready. It installs when you restart.` }));
    autoUpdater.on("error", () => set({ status: "error", message: "Couldn't check for updates right now." }));
  }

  async function check() {
    if (selfUpdating) { try { await autoUpdater.checkForUpdates(); } catch { set({ status: "error", message: "Couldn't check for updates right now." }); } return state; }
    set({ status: "checking", message: "Checking for updates…" });
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`, { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error();
      const rel = (await res.json()).find((r) => !r.draft) || {};
      const latest = String(rel.tag_name || "").replace(/^v/, "");
      // Staged rollout: read the percentage from latest-mac.yml and only offer it if this Mac is in the group so far.
      let pct = null;
      const yml = (rel.assets || []).find((a) => a.name === "latest-mac.yml");
      if (yml) { try { const t = await (await fetch(yml.browser_download_url, { signal: AbortSignal.timeout(10000) })).text(); const m = /stagingPercentage:\s*(\d+)/.exec(t); pct = m ? Number(m[1]) : null; } catch { /* treat as everyone */ } }
      if (latest && newer(latest, app.getVersion()) && inRollout(pct, rolloutBucket())) set({ status: "available", latest, message: `Version ${latest} is available.` });
      else set({ status: "current", latest, message: "You have the latest version." });
    } catch { set({ status: "error", message: "Couldn't check for updates right now." }); }
    return state;
  }

  function install() {
    if (selfUpdating && state.status === "ready") { autoUpdater.quitAndInstall(false, true); return; }
    shell.openExternal(RELEASES_URL);
  }

  return { check, install, get: () => state, selfUpdating, ring: (r) => { setRing(r); return check(); } };
}
