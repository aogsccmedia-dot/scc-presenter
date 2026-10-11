// Software updates from GitHub Releases.
// Windows: downloads in the background and installs on restart (or when you press "Restart now").
// macOS: builds aren't Apple-signed yet, so the Mac can't replace itself. We check for a new version and open the download.
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
      if (latest && newer(latest, app.getVersion())) set({ status: "available", latest, message: `Version ${latest} is available.` });
      else set({ status: "current", latest, message: "You have the latest version." });
    } catch { set({ status: "error", message: "Couldn't check for updates right now." }); }
    return state;
  }

  function install() {
    if (selfUpdating && state.status === "ready") { autoUpdater.quitAndInstall(false, true); return; }
    shell.openExternal(RELEASES_URL);
  }

  return { check, install, get: () => state, selfUpdating };
}
