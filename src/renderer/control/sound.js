// Audio tracks and worship pads, played from the control window (always open) through the shared sound chain.
import { attach, setSink, applyPreset, setPad, resume } from "../web/audio.js";

let audio = null, key = "", sink = null, preset = null;
export function syncSound(state, mediaUrl) {
  if (state.audioSink !== sink) { sink = state.audioSink ?? ""; setSink(sink); }
  if (state.soundPreset !== preset) { preset = state.soundPreset || "natural"; applyPreset(preset); }
  const k = state.audio?.src ? `${state.audio.src}|${state.audio.startedAt}` : "";
  if (k !== key) {
    key = k; audio?.pause(); audio = null;
    if (state.audio?.src) {
      audio = new Audio(mediaUrl(state.audio.src)); audio.loop = !!state.audio.loop; audio.preload = "auto";
      attach(audio); resume(); audio.play().catch(() => {});
    }
  }
  if (audio && state.audio) {
    audio.volume = Math.max(0, Math.min(1, state.audio.volume ?? 1));
    if (state.audio.paused && !audio.paused) audio.pause();
    if (!state.audio.paused && audio.paused) audio.play().catch(() => {});
  }
  setPad(state.pad || null);
}
export function audioProgress() { return audio && audio.duration ? { t: audio.currentTime, d: audio.duration } : null; }
