// Pure helpers for the ATEM panel (no hardware or library needed, so they can be unit-tested).
// Status bit values match atem-connection's Enums.StreamingStatus / Enums.RecordingStatus.
const S_CONNECTING = 1 << 1, S_STREAMING = 1 << 2, S_STOPPING = 1 << 5;
const R_RECORDING = 1 << 0, R_STOPPING = 1 << 7;

const tc = (t) => t ? `${String(t.hours).padStart(2, "0")}:${String(t.minutes).padStart(2, "0")}:${String(t.seconds).padStart(2, "0")}` : "";
const streamState = (v) => v == null ? null : v & S_STOPPING ? "stopping" : v & S_STREAMING ? "streaming" : v & S_CONNECTING ? "connecting" : "idle";
const recState = (v) => v == null ? null : v & R_STOPPING ? "stopping" : v & R_RECORDING ? "recording" : "idle";

/** A small, UI-friendly picture of the switcher. Pure: tested without hardware. */
export function summarise(state, extra = {}) {
  if (!state) return { connected: false, ...extra };
  const me = state.video?.mixEffects?.[0];
  const inputs = Object.values(state.inputs || {}).filter(Boolean)
    .filter((i) => [0, 1, 2, 3, 4, 7].includes(i.internalPortType) && (i.meAvailability ?? 1) & 1)
    .map((i) => ({ id: i.inputId, short: i.shortName, long: i.longName, type: ["camera", "black", "bars", "color", "media", "", "", "camera"][i.internalPortType] || "other" }))
    .sort((a, b) => (a.type === "camera" ? 0 : 1) - (b.type === "camera" ? 0 : 1) || a.id - b.id);
  const dsk = (state.video?.downstreamKeyers || []).map((k, i) => k && ({ index: i, onAir: !!k.onAir, inTransition: !!k.inTransition, fill: k.sources?.fillSource, cut: k.sources?.cutSource })).filter(Boolean);
  const usk = (me?.upstreamKeyers || []).map((k, i) => k && ({ index: i, onAir: !!k.onAir, type: k.mixEffectKeyType })).filter(Boolean);
  const macros = (state.macro?.macroProperties || []).map((m, i) => m?.isUsed ? { index: i, name: m.name || `Macro ${i + 1}` } : null).filter(Boolean);
  const st = state.streaming, rec = state.recording;
  return {
    connected: true, ...extra,
    model: state.info?.productIdentifier || "ATEM",
    program: me?.programInput ?? null, preview: me?.previewInput ?? null,
    inTransition: !!me?.transitionPosition?.inTransition,
    ftb: { black: !!me?.fadeToBlack?.isFullyBlack, inTransition: !!me?.fadeToBlack?.inTransition },
    inputs, dsk, usk, macros,
    stills: (state.media?.stillPool || []).length,
    mediaPlayers: (state.media?.players || []).length,
    streaming: st ? { supported: true, state: streamState(st.status?.state) || "idle", duration: tc(st.duration), kbps: st.stats ? Math.round(st.stats.encodingBitrate / 1000) : null, cache: st.stats?.cacheUsed ?? null, service: st.service ? { serviceName: st.service.serviceName, url: st.service.url, hasKey: !!st.service.key } : null } : { supported: false },
    recording: rec ? { supported: true, state: recState(rec.status?.state) || "idle", duration: tc(rec.duration), filename: rec.properties?.filename || "" } : { supported: false },
  };
}

/** Text that should be keyed on air right now (null = nothing). */
export function wordsOnAir(live) {
  if (!live || live.blackout || live.clear || live.logo) return null;
  const s = live.slide;
  if (!s || s.kind === "media") return null;
  const t = `${s.text || ""}${s.reference ? `\n${s.reference}` : ""}`.trim();
  return t || null;
}

