import { createView } from "../shared/render.js";
import { subscribe, mediaUrl } from "./live.js";

const params = new URLSearchParams(location.search);
const transparent = params.get("transparent") === "1";
const inApp = !!window.scc;
if (transparent) document.documentElement.classList.add("transparent");

const view = createView(document.getElementById("view"), { mediaUrl, animate: true, muted: !(inApp || params.get("audio") === "1") });
let audio = null, audioKey = "", lastCmd = 0;

function video() { return document.querySelector(".scc-bg video"); }

subscribe((state) => {
  view.update({ ...state, transparent });
  // Audio tracks play only on the main output inside the app (never doubled on OBS pages).
  if (inApp) {
    const key = state.audio?.src ? `${state.audio.src}|${state.audio.startedAt}` : "";
    if (key !== audioKey) {
      audioKey = key; audio?.pause(); audio = null;
      if (state.audio?.src) { audio = new Audio(mediaUrl(state.audio.src)); audio.loop = !!state.audio.loop; audio.volume = state.audio.volume ?? 1; audio.play().catch(() => {}); }
    }
    if (audio && state.audio) { audio.volume = state.audio.volume ?? 1; if (state.audio.paused && !audio.paused) audio.pause(); if (!state.audio.paused && audio.paused) audio.play().catch(() => {}); }
  }
  const cmd = state.videoCmd;
  if (cmd && cmd.at !== lastCmd) {
    lastCmd = cmd.at;
    const v = video();
    if (v) { if (cmd.action === "pause") v.pause(); else if (cmd.action === "play") v.play().catch(() => {}); else if (cmd.action === "restart") { v.currentTime = 0; v.play().catch(() => {}); } }
  }
});
