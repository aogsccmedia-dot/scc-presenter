// Sound for the main output: choose the speaker, sound presets (clear voice, warm music…) and built-in worship pads.
// Everything is made live with the Web Audio API, so it costs no download size and very little processor time.

export const SOUND_PRESETS = {
  natural: { name: "Natural", low: 0, mid: 0, high: 0, comp: false },
  voice: { name: "Clear voice", low: -6, mid: 4, high: 2, comp: true, lowCut: 120 },
  music: { name: "Warm music", low: 3, mid: -1, high: 2, comp: true },
  room: { name: "Big room (louder, even)", low: 1, mid: 2, high: 3, comp: true, strong: true },
};
export const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

let ctx = null, chain = null, sinkId = "", padVoice = null, padKey = "";
const connected = new WeakSet();

function ensure() {
  if (ctx) return ctx;
  ctx = new AudioContext({ latencyHint: "playback" });
  const input = ctx.createGain();
  const lowCut = ctx.createBiquadFilter(); lowCut.type = "highpass"; lowCut.frequency.value = 20;
  const low = ctx.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 180;
  const mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 2200; mid.Q.value = 0.9;
  const high = ctx.createBiquadFilter(); high.type = "highshelf"; high.frequency.value = 7000;
  const comp = ctx.createDynamicsCompressor();
  const master = ctx.createGain();
  input.connect(lowCut).connect(low).connect(mid).connect(high).connect(comp).connect(master).connect(ctx.destination);
  chain = { input, lowCut, low, mid, high, comp, master };
  applyPreset("natural");
  if (sinkId) setSink(sinkId);
  return ctx;
}

export function applyPreset(name) {
  if (!chain) return;
  const p = SOUND_PRESETS[name] || SOUND_PRESETS.natural, t = ctx.currentTime;
  chain.low.gain.setTargetAtTime(p.low, t, 0.1);
  chain.mid.gain.setTargetAtTime(p.mid, t, 0.1);
  chain.high.gain.setTargetAtTime(p.high, t, 0.1);
  chain.lowCut.frequency.setTargetAtTime(p.lowCut || 20, t, 0.1);
  const c = chain.comp;
  c.threshold.value = p.comp ? (p.strong ? -28 : -20) : 0;
  c.ratio.value = p.comp ? (p.strong ? 6 : 3) : 1;
  c.knee.value = 12; c.attack.value = 0.01; c.release.value = 0.25;
}

/** Route a <video>/<audio> element through the sound chain (once per element). */
export function attach(el) {
  if (!el || connected.has(el)) return;
  try { ensure(); ctx.createMediaElementSource(el).connect(chain.input); connected.add(el); } catch { /* already attached elsewhere */ }
}

/** Send all sound to a chosen speaker / audio interface. */
export async function setSink(id) {
  sinkId = id || "";
  try { if (ctx?.setSinkId) await ctx.setSinkId(sinkId); } catch { /* device gone: stay on default */ }
}

export function setVolume(v) { if (chain) chain.master.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), ctx.currentTime, 0.05); }
export function resume() { ctx?.state === "suspended" && ctx.resume(); }

// ── Worship pads: a soft, slowly moving chord on the chosen key ─────────────────────────────
const freq = (key, octave) => 440 * Math.pow(2, (KEYS.indexOf(key) - 9 + (octave - 4) * 12) / 12);

function makePad(key, volume, bright) {
  ensure();
  const out = ctx.createGain(); out.gain.value = 0;
  const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = bright ? 1800 : 900; filter.Q.value = 0.4;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = bright ? 500 : 250;
  lfo.connect(lfoGain).connect(filter.frequency); lfo.start();
  filter.connect(out).connect(chain.input);
  const root = freq(key, 3);
  const notes = [root, root * 1.5, root * 2, root * 2.25 * (bright ? 1 : 1), root * 3]; // root, fifth, octave, ninth, fifth above
  const oscs = [];
  notes.forEach((f, i) => {
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = i === 0 ? "triangle" : "sawtooth"; o.frequency.value = f; o.detune.value = detune + (i * 3);
      const g = ctx.createGain(); g.gain.value = (i === 0 ? 0.16 : 0.07) / 2;
      o.connect(g).connect(filter); o.start(); oscs.push(o);
    }
  });
  out.gain.setTargetAtTime(volume * 0.5, ctx.currentTime, 1.6);   // slow swell in
  return { out, stop: () => { out.gain.setTargetAtTime(0, ctx.currentTime, 1.2); setTimeout(() => { oscs.forEach((o) => o.stop()); lfo.stop(); out.disconnect(); }, 6000); }, setVolume: (v) => out.gain.setTargetAtTime(v * 0.5, ctx.currentTime, 0.3) };
}

/** pad: { key, volume, bright } or null to fade out. */
export function setPad(pad) {
  const key = pad?.key ? `${pad.key}|${pad.bright ? 1 : 0}` : "";
  if (key !== padKey) {
    padVoice?.stop(); padVoice = null; padKey = key;
    if (pad?.key) { resume(); padVoice = makePad(pad.key, pad.volume ?? 0.6, !!pad.bright); }
  } else if (padVoice && pad) padVoice.setVolume(pad.volume ?? 0.6);
}
