import { createView } from "../shared/render.js";
import { subscribe, mediaUrl } from "./live.js";
import { attach, setSink, applyPreset } from "./audio.js";

const params = new URLSearchParams(location.search);
const transparent = params.get("transparent") === "1";
const inApp = !!window.scc;
// Video sound plays from the main output only; OBS/browser copies stay silent unless ?audio=1, so sound is never doubled.
// Music, audio tracks and worship pads play from the control window, so they work even with no projector attached.
const withSound = inApp || params.get("audio") === "1";
if (transparent) document.documentElement.classList.add("transparent");

const view = createView(document.getElementById("view"), { mediaUrl, animate: true, muted: !withSound });
let lastCmd = 0, sink = null, preset = null;

const video = () => document.querySelector(".scc-bg video");

subscribe((state) => {
  view.update({ ...state, transparent });
  if (withSound) {
    if (state.audioSink !== sink) { sink = state.audioSink ?? ""; setSink(sink); }
    if (state.soundPreset !== preset) { preset = state.soundPreset || "natural"; applyPreset(preset); }
    const v = video();
    if (v && !v.muted) attach(v);
  }
  const cmd = state.videoCmd;
  if (cmd && cmd.at !== lastCmd) {
    lastCmd = cmd.at;
    const v = video();
    if (v) { if (cmd.action === "pause") v.pause(); else if (cmd.action === "play") v.play().catch(() => {}); else if (cmd.action === "restart") { v.currentTime = 0; v.play().catch(() => {}); } }
  }
});
