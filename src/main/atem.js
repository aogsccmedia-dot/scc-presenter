// Blackmagic ATEM switcher control over the network (UDP 9910) using the open-source atem-connection library.
// Works with ATEM Mini / Mini Pro / Mini Extreme, Television Studio, Constellation and other models on firmware 7.2+.
// Note: ATEMs are controlled over Ethernet. A USB cable gives you the webcam picture, not control.
import atemPkg from "atem-connection";
import { summarise, wordsOnAir } from "./atem-state.js";

const { Atem, Enums } = atemPkg;
export { summarise, wordsOnAir };
const MP_FILL = (p) => 3010 + p * 10, MP_KEY = (p) => 3011 + p * 10;

export function createAtem({ send, getSettings, setSettings, captureWords }) {
  let atem = null, ip = "", status = "off", timer = null, lastError = "", lastSent = 0, pending = null;
  let lastWords = undefined, uploading = false, queued = null, slotFlip = 0;

  const extra = () => ({ ip, status, error: lastError, autoKey: getSettings().atem?.autoKey ?? null, netKey: getSettings().atem?.netKey ?? null });
  const push = () => {
    const now = Date.now();
    if (now - lastSent < 90) { clearTimeout(pending); pending = setTimeout(push, 100); return; }
    lastSent = now;
    send(summarise(atem?.state, extra()));
  };

  async function connect(address) {
    await disconnect();
    ip = String(address || "").trim();
    if (!/^[\w.-]+$/.test(ip)) throw new Error("Type the ATEM's IP address, e.g. 192.168.10.240 (see ATEM Software Control → Settings → Network).");
    atem = new Atem({ disableMultithreaded: true });
    status = "connecting"; lastError = "";
    atem.on("connected", () => { status = "connected"; setSettings({ atem: { ...(getSettings().atem || {}), ip } }); push(); });
    atem.on("disconnected", () => { status = "reconnecting"; push(); });
    atem.on("stateChanged", () => push());
    atem.on("error", (e) => { lastError = String(e?.message || e); push(); });
    push();
    await atem.connect(ip);
    clearInterval(timer);
    timer = setInterval(() => {
      if (status !== "connected") return;
      const s = atem.state;
      if (s?.streaming?.status?.state & Enums.StreamingStatus.Streaming) atem.requestStreamingDuration().catch(() => {});
      if (s?.recording?.status?.state & Enums.RecordingStatus.Recording) atem.requestRecordingDuration().catch(() => {});
    }, 1000);
    return true;
  }
  async function disconnect() {
    clearInterval(timer);
    if (atem) { try { await atem.disconnect(); await atem.destroy(); } catch { /* already gone */ } }
    atem = null; status = "off"; push();
  }
  const need = () => { if (!atem || status !== "connected") throw new Error("Connect to the ATEM first."); return atem; };

  async function action(a = {}) {
    const x = need();
    switch (a.type) {
      case "program": return x.changeProgramInput(Number(a.input));
      case "preview": return x.changePreviewInput(Number(a.input));
      case "cut": return x.cut();
      case "auto": return x.autoTransition();
      case "ftb": return x.fadeToBlack();
      case "dsk": return a.auto ? x.autoDownstreamKey(Number(a.index) || 0) : x.setDownstreamKeyOnAir(!!a.onAir, Number(a.index) || 0);
      case "usk": return x.setUpstreamKeyerOnAir(!!a.onAir, 0, Number(a.index) || 0);
      case "macro": return x.macroRun(Number(a.index));
      case "stream": return a.on ? x.startStreaming() : x.stopStreaming();
      case "record": return a.on ? x.startRecording() : x.stopRecording();
      case "streamService": {
        const url = String(a.url || "").trim(), key = String(a.key || "").trim();
        if (!/^rtmps?:\/\//i.test(url)) throw new Error("The server URL should start with rtmp:// or rtmps://");
        if (!key) throw new Error("Paste the stream key from YouTube, Facebook or Cloudflare.");
        return x.setStreamingService({ serviceName: String(a.serviceName || "Custom").slice(0, 60), url, key });
      }
      case "saveStartup": return x.saveStartupState();
      default: throw new Error("Unknown ATEM action");
    }
  }

  /**
   * Put the laptop's "Words on black" output on air as a key.
   * input = the ATEM input the laptop's HDMI is plugged into. keyer "dsk" stays on top of every camera cut (recommended).
   */
  async function setupCableKey({ input, keyer = "dsk", index = 0 }) {
    const x = need(), id = Number(input), i = Number(index) || 0;
    if (!id) throw new Error("Choose the ATEM input your laptop is plugged into.");
    if (keyer === "usk") {
      await x.setUpstreamKeyerType({ mixEffectKeyType: Enums.MixEffectKeyType.Luma, flyEnabled: false }, 0, i);
      await x.setUpstreamKeyerFillSource(id, 0, i);
      await x.setUpstreamKeyerCutSource(id, 0, i);
      await x.setUpstreamKeyerLumaSettings({ preMultiplied: false, clip: 150, gain: 650, invert: false }, 0, i);
    } else {
      await x.setDownstreamKeyFillSource(id, i);
      await x.setDownstreamKeyCutSource(id, i);
      await x.setDownstreamKeyGeneralProperties({ preMultiply: false, clip: 150, gain: 650, invert: false }, i);
    }
    setSettings({ atem: { ...(getSettings().atem || {}), autoKey: { keyer, index: i, method: "cable", input: id } } });
    push();
    return true;
  }

  /** No cable needed: each slide is sent to the ATEM media pool over the network and keyed with its own transparency. */
  async function setupNetKey({ player = 0, slots = [18, 19], keyer = "dsk", index = 0 }) {
    const x = need(), p = Number(player) || 0, i = Number(index) || 0;
    if (!(x.state?.media?.players?.length)) throw new Error("This ATEM has no media player.");
    const pool = x.state.media.stillPool.length;
    const [a, b] = slots.map((n) => Math.min(Math.max(0, Number(n) || 0), pool - 1));
    if (keyer === "usk") {
      await x.setUpstreamKeyerType({ mixEffectKeyType: Enums.MixEffectKeyType.Luma, flyEnabled: false }, 0, i);
      await x.setUpstreamKeyerFillSource(MP_FILL(p), 0, i);
      await x.setUpstreamKeyerCutSource(MP_KEY(p), 0, i);
      await x.setUpstreamKeyerLumaSettings({ preMultiplied: true, clip: 0, gain: 1000, invert: false }, 0, i);
    } else {
      await x.setDownstreamKeyFillSource(MP_FILL(p), i);
      await x.setDownstreamKeyCutSource(MP_KEY(p), i);
      await x.setDownstreamKeyGeneralProperties({ preMultiply: true, clip: 0, gain: 1000, invert: false }, i);
    }
    setSettings({ atem: { ...(getSettings().atem || {}), autoKey: { keyer, index: i, method: "network" }, netKey: { player: p, slots: [a, b] } } });
    lastWords = undefined;
    push();
    return true;
  }
  async function stopAuto() { setSettings({ atem: { ...(getSettings().atem || {}), autoKey: null, netKey: null } }); push(); }

  async function setKey(on) {
    const k = getSettings().atem?.autoKey;
    if (!k || !atem || status !== "connected") return;
    const keyer = k.keyer === "usk" ? atem.state?.video?.mixEffects?.[0]?.upstreamKeyers?.[k.index] : atem.state?.video?.downstreamKeyers?.[k.index];
    if (!keyer || !!keyer.onAir === on) return;
    if (k.keyer === "usk") await atem.setUpstreamKeyerOnAir(on, 0, k.index);
    else await atem.autoDownstreamKey(k.index, on);   // smooth mix on/off
  }

  async function uploadWords() {
    const nk = getSettings().atem?.netKey;
    if (!nk || uploading) return;
    uploading = true;
    try {
      while (queued !== null) {
        queued = null;
        const mode = atem.videoMode;
        const rgba = await captureWords(mode?.width || 1920, mode?.height || 1080);
        if (!rgba) break;
        const slot = nk.slots[slotFlip % 2]; slotFlip++;
        await atem.uploadStill(slot, rgba, "SCC Presenter", "Words from SCC Presenter");
        await atem.setMediaPlayerSource({ sourceType: Enums.MediaSourceType.Still, stillIndex: slot }, nk.player);
      }
    } catch (e) { lastError = `Couldn't send words to the ATEM: ${e?.message || e}`; push(); }
    finally { uploading = false; }
  }

  /** Called on every live change: keeps the ATEM's words in step with the slide on screen. */
  function onLive(live) {
    const k = getSettings().atem?.autoKey;
    if (!k || !atem || status !== "connected") return;
    const words = wordsOnAir(live);
    if (words === lastWords) return;
    const had = lastWords; lastWords = words;
    if (k.method === "network" && words) {
      queued = words;
      uploadWords().then(() => setKey(true)).catch(() => {});
    } else setKey(!!words).catch(() => {});
    void had;
  }

  return { connect, disconnect, action, setupCableKey, setupNetKey, stopAuto, onLive, get: () => summarise(atem?.state, extra()) };
}
