// Live desk: control the ATEM, OBS Studio, cameras, recording and streaming from one window.
import { h, toast, modal } from "../control/ui.js";
import { OBS } from "./obs.js";
import { Studio, listInputs, QUALITY } from "./studio.js";

if (!window.scc) await import("../control/mock.js");   // browser preview only
const scc = window.scc;
const $ = (s, r = document) => r.querySelector(s);
const pane = (n) => $(`[data-pane="${n}"]`);
let settings = {}, live = {}, serverInfo = {};

function wordsFrom(st) {
  if (!st || st.blackout || st.clear || st.logo) return "";
  const s = st.slide;
  if (!s || s.kind === "media") return "";
  return `${s.text || ""}${s.reference ? `\n${s.reference}` : ""}`.trim();
}
async function saveSettings(patch) { settings = await scc.lib.setSettings(patch); }

// ── Tabs and window placement ─────────────────────────────────────────────────────────────
function showTab(t) {
  document.querySelectorAll(".desk-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  document.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== t; });
  saveSettings({ deskTab: t });
  if (t === "studio") studioPane.ensure();
}
async function fillMove() {
  const sc = await scc.screens.get();
  const sel = $("#moveTo");
  sel.replaceChildren(h("option", { value: "" }, "This window"), ...sc.displays.map((d, i) => h("option", { value: d.id }, `Screen ${i + 1}${d.primary ? " (main)" : ""} · ${d.pixelsWide}×${d.pixelsHigh}`)));
  sel.onchange = () => { if (sel.value) scc.desk.open(Number(sel.value)); sel.value = ""; };
}

// ── ATEM ──────────────────────────────────────────────────────────────────────────────────────
const atemPane = (() => {
  let st = { connected: false }, sig = "";
  const act = (a) => scc.atem.action(a).catch((e) => toast(e.message, "error"));
  const led = () => { const l = $("#ledAtem"); l.className = `led${st.connected && st.status === "connected" ? (st.streaming?.state === "streaming" ? " live" : " on") : st.status === "connecting" || st.status === "reconnecting" ? " warn" : ""}`; };

  function render() {
    const p = pane("atem");
    led();
    if (!(st.connected && st.status === "connected")) {
      const ip = h("input.input", { placeholder: "e.g. 192.168.10.240", value: st.ip || settings.atem?.ip || "" });
      const go = h("button.btn.primary", { onclick: async () => {
        go.classList.add("busy");
        try { await scc.atem.connect(ip.value); } catch (e) { toast(e.message, "error", 6000); } finally { go.classList.remove("busy"); }
      } }, st.status === "connecting" || st.status === "reconnecting" ? "Connecting…" : "Connect");
      ip.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
      p.replaceChildren(h("div.card",
        h("div.head", h("h3", "Connect your ATEM switcher")),
        h("div.connect", ip, go, st.status === "reconnecting" ? h("span.pill2", "Reconnecting…") : null),
        st.error ? h("p.hint2", { style: { color: "#ffb3b3" } }, st.error) : null,
        h("ol.steps",
          h("li", "Plug the ATEM into the same network as this computer with an Ethernet cable (USB only carries the picture, not control)."),
          h("li", "Find its IP address in ATEM Software Control → Settings (or on the ATEM's front panel/LCD)."),
          h("li", "Type it above and press Connect. SCC Presenter remembers it and reconnects next time.")),
        h("p.hint2", "Works with ATEM Mini, Mini Pro, Mini Extreme, Television Studio, Constellation and other models on firmware 7.2 or newer. No ATEM? Use the OBS Studio or Cameras & stream tabs.")));
      sig = "";
      return;
    }
    const s = `${st.model}|${st.inputs.map((i) => i.id + i.short).join()}|${st.dsk.length}|${st.usk.length}|${st.macros.map((m) => m.name).join()}|${st.streaming.supported}|${st.recording.supported}|${JSON.stringify(st.autoKey)}`;
    if (s !== sig) { sig = s; build(p); }
    update(p);
  }

  function build(p) {
    const bus = (kind) => h(`div.bus.${kind}`, h("span", kind === "pgm" ? "PROGRAM" : "PREVIEW"),
      h("div.btns", ...st.inputs.map((i) => h("button.src", { dataset: { id: i.id, bus: kind }, title: i.long, onclick: () => act({ type: kind === "pgm" ? "program" : "preview", input: i.id }) }, i.short, h("small", i.long)))));
    const k = st.autoKey;
    const wordsCard = h("div.card",
      h("div.head", h("h3", "Words on the stream"), h("span.pill2", { id: "wordsState" }, "—")),
      k ? h("p.hint2", k.method === "network"
        ? `Each slide is sent to the ATEM's media player over the network and keyed on ${k.keyer === "usk" ? `upstream key ${k.index + 1}` : `DSK ${k.index + 1}`}. Words come on and off by themselves as you present.`
        : `Your laptop's “Words on black” output (ATEM input ${k.input}) is keyed on ${k.keyer === "usk" ? `upstream key ${k.index + 1}` : `DSK ${k.index + 1}`}. Words come on and off by themselves as you present.`)
        : h("p.hint2", "Put the song words and Bible verses over your cameras on the livestream — they follow the slides automatically."),
      h("div.btns",
        h("button.btn.primary", { onclick: setupWords }, k ? "Change set-up" : "Set up words on the stream"),
        k ? h("button.btn", { onclick: () => scc.atem.stopAuto() }, "Stop following slides") : null));
    const keys = h("div.card", h("h3", "Keyers"), h("div.btns",
      ...st.dsk.map((d) => h("button.key", { dataset: { dsk: d.index }, onclick: () => act({ type: "dsk", index: d.index, auto: true }) }, `DSK ${d.index + 1}`)),
      ...st.usk.map((u) => h("button.key", { dataset: { usk: u.index }, onclick: () => act({ type: "usk", index: u.index, onAir: !st.usk[u.index]?.onAir }) }, `Key ${u.index + 1}`))));
    const stream = st.streaming.supported ? h("div.card",
      h("div.head", h("h3", "Live stream (from the ATEM)"), h("span.pill2", { id: "atemStream" }, "Idle")),
      h("div.statusline", h("span", { id: "atemStreamTime" }, ""), h("span.muted", { id: "atemStreamRate" }, ""), h("span.muted", st.streaming.service ? `${st.streaming.service.serviceName || "Custom"} · ${st.streaming.service.hasKey ? "key set" : "no key"}` : "")),
      h("div.btns", h("button.go", { id: "atemGo", onclick: () => toggleStream() }, "Go live"), h("button.btn", { onclick: streamSettings }, "Stream settings"))) : null;
    const rec = st.recording.supported ? h("div.card",
      h("div.head", h("h3", "Recording (on the ATEM's USB drive)"), h("span.pill2", { id: "atemRec" }, "Idle")),
      h("div.btns", h("button.btn", { id: "atemRecBtn", onclick: () => act({ type: "record", on: st.recording.state !== "recording" }) }, "Record"), h("span", { id: "atemRecTime" }, ""))) : null;
    const macros = st.macros.length ? h("div.card", h("h3", "Macros"), h("div.btns", ...st.macros.map((m) => h("button.key", { onclick: () => act({ type: "macro", index: m.index }) }, m.name)))) : null;
    p.replaceChildren(
      h("div.card",
        h("div.head", h("h3", `${st.model} · ${st.ip}`), h("button.btn.small.ghost", { onclick: () => scc.atem.disconnect() }, "Disconnect")),
        bus("pgm"), bus("pvw"),
        h("div.trans",
          h("button.big.cut", { onclick: () => act({ type: "cut" }) }, "CUT"),
          h("button.big.auto", { id: "atemAuto", onclick: () => act({ type: "auto" }) }, "AUTO"),
          h("button.big", { id: "atemFtb", onclick: () => act({ type: "ftb" }) }, "FADE TO BLACK"))),
      h("div.grid2c", ...[wordsCard, keys, stream, rec, macros].filter(Boolean)));
  }

  function update(p) {
    p.querySelectorAll(".src").forEach((b) => b.classList.toggle("on", Number(b.dataset.id) === (b.dataset.bus === "pgm" ? st.program : st.preview)));
    p.querySelectorAll("[data-dsk]").forEach((b) => b.classList.toggle("on", !!st.dsk[b.dataset.dsk]?.onAir));
    p.querySelectorAll("[data-usk]").forEach((b) => b.classList.toggle("on", !!st.usk[b.dataset.usk]?.onAir));
    $("#atemFtb", p)?.classList.toggle("on", !!(st.ftb?.black || st.ftb?.inTransition));
    const k = st.autoKey, onAir = k ? (k.keyer === "usk" ? st.usk[k.index]?.onAir : st.dsk[k.index]?.onAir) : null;
    const ws = $("#wordsState", p); if (ws) { ws.textContent = !k ? "Not set up" : onAir ? "Words on air" : "Waiting for words"; ws.className = `pill2${onAir ? " live" : k ? " ok" : ""}`; }
    const ss = st.streaming;
    if ($("#atemStream", p)) {
      $("#atemStream", p).textContent = { idle: "Idle", connecting: "Connecting…", streaming: "LIVE", stopping: "Stopping…" }[ss.state] || ss.state;
      $("#atemStream", p).className = `pill2${ss.state === "streaming" ? " live" : ""}`;
      $("#atemStreamTime", p).textContent = ss.state === "streaming" ? ss.duration : "";
      $("#atemStreamRate", p).textContent = ss.state === "streaming" && ss.kbps ? `${ss.kbps} kbps${ss.cache ? ` · cache ${ss.cache}%` : ""}` : "";
      const g = $("#atemGo", p); g.textContent = ss.state === "streaming" || ss.state === "connecting" ? "End stream" : "Go live"; g.classList.toggle("stop", ss.state === "streaming" || ss.state === "connecting");
    }
    if ($("#atemRec", p)) {
      $("#atemRec", p).textContent = st.recording.state === "recording" ? "Recording" : "Idle";
      $("#atemRec", p).className = `pill2${st.recording.state === "recording" ? " live" : ""}`;
      $("#atemRecBtn", p).textContent = st.recording.state === "recording" ? "Stop recording" : "Record";
      $("#atemRecTime", p).textContent = st.recording.state === "recording" ? st.recording.duration : "";
    }
  }

  async function toggleStream() {
    const on = !(st.streaming.state === "streaming" || st.streaming.state === "connecting");
    if (on && !st.streaming.service?.hasKey) return streamSettings();
    if (!on && !confirm("End the live stream now?")) return;
    act({ type: "stream", on });
  }

  function streamSettings() {
    const presets = { "YouTube": "rtmp://a.rtmp.youtube.com/live2", "Facebook": "rtmps://live-api-s.facebook.com:443/rtmp/", "Cloudflare Stream": "rtmps://live.cloudflare.com:443/live/", "Custom": "" };
    const svc = h("select", ...Object.keys(presets).map((k) => h("option", { value: k }, k)));
    const url = h("input.input", { placeholder: "rtmps://…", value: st.streaming.service?.url || presets.YouTube });
    const key = h("input.input", { type: "password", placeholder: "Stream key", autocomplete: "off" });
    svc.value = Object.keys(presets).find((k) => k === st.streaming.service?.serviceName) || "YouTube";
    svc.onchange = () => { if (presets[svc.value]) url.value = presets[svc.value]; };
    modal({ title: "ATEM stream settings", width: 520, body: h("div", { style: { display: "grid", gap: "10px" } },
      h("label.field", h("span", "Service"), svc), h("label.field", h("span", "Server URL"), url), h("label.field", h("span", "Stream key"), key),
      h("p.hint2", "Cloudflare Stream: create a Live Input, then copy its RTMPS URL and key. Cloudflare can also send the stream on to YouTube and Facebook at the same time (Simulcast), and records it for you.")),
      actions: [{ label: "Cancel" }, { label: "Save on the ATEM", kind: "primary", onClick: async () => { await scc.atem.action({ type: "streamService", serviceName: svc.value, url: url.value, key: key.value }); toast("Saved on the ATEM", "ok"); } }] });
  }

  function setupWords() {
    let method = st.mediaPlayers ? "network" : "cable";
    const input = h("select", ...st.inputs.filter((i) => i.type === "camera").map((i) => h("option", { value: i.id }, `${i.short} — ${i.long}`)));
    const keyer = h("select", ...st.dsk.map((d) => h("option", { value: `dsk:${d.index}` }, `DSK ${d.index + 1} (stays on through camera cuts)`)), ...st.usk.map((u) => h("option", { value: `usk:${u.index}` }, `Upstream key ${u.index + 1}`)));
    const cableBox = h("div", { hidden: method !== "cable", style: { display: "grid", gap: "8px" } },
      h("label.field", h("span", "Which ATEM input is your laptop plugged into?"), input),
      h("p.hint2", "Then in SCC Presenter: Settings → Screens → set that screen to “Words on black — for ATEM luma key”."));
    const choice = h("div.choice",
      st.mediaPlayers ? h("label", h("input", { type: "radio", name: "m", value: "network", checked: method === "network", onchange: () => { method = "network"; cableBox.hidden = true; } }), h("div", h("b", "Over the network (no extra cable)"), h("br"), h("span.muted", "Each slide is sent to the ATEM media player, with a clean see-through background. Takes a second per slide."))) : null,
      h("label", h("input", { type: "radio", name: "m", value: "cable", checked: method === "cable", onchange: () => { method = "cable"; cableBox.hidden = false; } }), h("div", h("b", "With an HDMI cable from this laptop"), h("br"), h("span.muted", "Instant. The laptop's HDMI goes into an ATEM input and is keyed over the cameras."))));
    modal({ title: "Words on the stream", width: 560, body: h("div", { style: { display: "grid", gap: "12px" } }, choice, cableBox, h("label.field", h("span", "Key the words with"), keyer)),
      actions: [{ label: "Cancel" }, { label: "Set it up", kind: "primary", onClick: async () => {
        const [kt, ki] = keyer.value.split(":");
        if (method === "network") await scc.atem.setupNet({ keyer: kt, index: Number(ki) });
        else await scc.atem.setupCable({ input: Number(input.value), keyer: kt, index: Number(ki) });
        toast("Done. Words now follow your slides on the stream.", "ok", 5000);
      } }] });
  }

  return { set(s) { st = s || { connected: false }; render(); }, render };
})();

// ── OBS Studio ────────────────────────────────────────────────────────────────────────────────
const obsPane = (() => {
  const obs = new OBS();
  let scenes = [], program = "", previewScene = "", studio = false, stream = {}, rec = {}, inputs = [], shotTimer = null, statTimer = null, lastBytes = null;
  const call = (t, d) => obs.call(t, d).catch((e) => { toast(e.message, "error"); throw e; });
  const led = () => { $("#ledObs").className = `led${obs.connected ? (stream.outputActive ? " live" : " on") : ""}`; };

  async function connect(host, port, password) {
    await obs.connect(host, port, password);
    await saveSettings({ obs: { host, port, password: password ? "saved" : "" } });
    if (password) localStorage.setItem("obsPass", password);
    await refresh();
    clearInterval(statTimer); statTimer = setInterval(stats, 1000);
    clearInterval(shotTimer); shotTimer = setInterval(shot, 1000);
  }
  async function refresh() {
    const sl = await obs.call("GetSceneList");
    scenes = sl.scenes.map((s) => s.sceneName).reverse(); program = sl.currentProgramSceneName; previewScene = sl.currentPreviewSceneName || "";
    studio = (await obs.call("GetStudioModeEnabled").catch(() => ({}))).studioModeEnabled || false;
    const il = await obs.call("GetInputList").catch(() => ({ inputs: [] }));
    const audioKinds = /wasapi|coreaudio|pulse|alsa|dshow_input|av_capture|input_capture|output_capture|jack/;
    inputs = [];
    for (const i of il.inputs.filter((x) => audioKinds.test(x.inputKind || "")).slice(0, 10)) {
      const m = await obs.call("GetInputMute", { inputName: i.inputName }).catch(() => null);
      if (m) inputs.push({ name: i.inputName, muted: m.inputMuted });
    }
    render();
  }
  async function stats() {
    if (!obs.connected) return;
    stream = await obs.call("GetStreamStatus").catch(() => ({}));
    rec = await obs.call("GetRecordStatus").catch(() => ({}));
    const kbps = lastBytes != null && stream.outputActive ? Math.max(0, Math.round(((stream.outputBytes - lastBytes) * 8) / 1000)) : 0;
    lastBytes = stream.outputBytes ?? null;
    const p = pane("obs");
    const sEl = $("#obsStream", p);
    if (sEl) {
      sEl.textContent = stream.outputReconnecting ? "Reconnecting…" : stream.outputActive ? "LIVE" : "Off air";
      sEl.className = `pill2${stream.outputActive ? " live" : ""}`;
      const dropped = stream.outputTotalFrames ? ((stream.outputSkippedFrames / stream.outputTotalFrames) * 100).toFixed(1) : "0.0";
      $("#obsStreamInfo", p).textContent = stream.outputActive ? `${(stream.outputTimecode || "").slice(0, 8)} · ${kbps} kbps · ${dropped}% dropped` : "";
      $("#obsHealth", p).textContent = !stream.outputActive ? "" : Number(dropped) > 5 ? "Weak connection — lower the bitrate in OBS settings" : kbps < 1000 ? "Low upload speed" : "Healthy";
      const go = $("#obsGo", p); go.textContent = stream.outputActive ? "End stream" : "Go live"; go.classList.toggle("stop", !!stream.outputActive);
      $("#obsRec", p).textContent = rec.outputActive ? `Stop recording · ${(rec.outputTimecode || "").slice(0, 8)}` : "Record";
    }
    led();
  }
  async function shot() {
    if (!obs.connected || pane("obs").hidden || !program) return;
    const img = $("#obsShot img"); if (!img) return;
    const r = await obs.call("GetSourceScreenshot", { sourceName: program, imageFormat: "jpg", imageWidth: 640, imageCompressionQuality: 70 }).catch(() => null);
    if (r?.imageData) img.src = r.imageData;
  }
  async function addLyrics() {
    const info = await scc.server.info();
    if (!info.ok) return toast("Turn on network connections in Settings → Network first.", "error");
    const url = `http://127.0.0.1:${info.port}/output?transparent=1`;
    try {
      await obs.call("CreateInput", { sceneName: program, inputName: "SCC Presenter words", inputKind: "browser_source", inputSettings: { url, width: 1920, height: 1080, reroute_audio: false, shutdown: false }, sceneItemEnabled: true });
      toast(`Added “SCC Presenter words” to the scene “${program}”.`, "ok", 5000);
    } catch (e) {
      if (/exist/i.test(e.message)) toast("It's already in OBS. Add it to other scenes with Add Existing.", "info", 5000); else toast(e.message, "error");
    }
  }

  function render() {
    const p = pane("obs"); led();
    if (!obs.connected) {
      const host = h("input.input", { value: settings.obs?.host || "127.0.0.1", style: { maxWidth: "160px" } });
      const port = h("input.input", { value: settings.obs?.port || 4455, type: "number", style: { maxWidth: "100px" } });
      const pass = h("input.input", { type: "password", placeholder: "Password (if set)", value: localStorage.getItem("obsPass") || "" });
      const go = h("button.btn.primary", { onclick: async () => { go.classList.add("busy"); try { await connect(host.value.trim(), Number(port.value) || 4455, pass.value); } catch (e) { toast(e.message, "error", 6000); } finally { go.classList.remove("busy"); } } }, "Connect");
      p.replaceChildren(h("div.card", h("h3", "Connect OBS Studio"), h("div.connect", host, port, pass, go),
        h("ol.steps", h("li", "Open OBS Studio (version 28 or newer)."), h("li", "Tools → WebSocket Server Settings → tick Enable WebSocket server."), h("li", "Click Show Connect Info and copy the password here. If OBS is on another computer, use that computer's IP address.")),
        h("p.hint2", "Then switch scenes, go live, record and mute microphones from here — big, clear buttons, nothing else to learn.")));
      return;
    }
    p.replaceChildren(
      h("div.studio",
        h("div.card",
          h("div.head", h("h3", `Scenes${studio ? " (studio mode: click = preview, then Transition)" : ""}`), h("button.btn.small.ghost", { onclick: () => { obs.close(); clearInterval(statTimer); clearInterval(shotTimer); render(); } }, "Disconnect")),
          h("div.scenes", ...scenes.map((n) => h(`button.scene${n === program ? ".pgm" : n === previewScene && studio ? ".pvw" : ""}`, { onclick: () => call(studio ? "SetCurrentPreviewScene" : "SetCurrentProgramScene", { sceneName: n }).then(refresh) }, n))),
          studio ? h("div.trans", h("button.big.auto", { onclick: () => call("TriggerStudioModeTransition").then(refresh) }, "TRANSITION")) : null,
          inputs.length ? h("div", h("h3", { style: { marginBottom: "8px" } }, "Microphones & sound"), h("div.mutes", ...inputs.map((i) => h(`button.mute${i.muted ? ".off" : ""}`, { onclick: () => call("SetInputMute", { inputName: i.name, inputMuted: !i.muted }).then(refresh) }, `${i.muted ? "🔇" : "🔊"} ${i.name}`)))) : null),
        h("div.card",
          h("div.obs-shot", { id: "obsShot" }, h("img", { alt: "OBS program" })),
          h("div.statusline", h("span.pill2", { id: "obsStream" }, "Off air"), h("span", { id: "obsStreamInfo" }, ""), h("span.muted", { id: "obsHealth" }, "")),
          h("div.btns",
            h("button.go", { id: "obsGo", onclick: () => { if (stream.outputActive && !confirm("End the live stream now?")) return; call(stream.outputActive ? "StopStream" : "StartStream").then(stats); } }, "Go live"),
            h("button.btn", { id: "obsRec", onclick: () => call(rec.outputActive ? "StopRecord" : "StartRecord").then(stats) }, "Record")),
          h("button.btn", { onclick: addLyrics }, "Add SCC Presenter words to this OBS scene"),
          h("p.hint2", "Adds a see-through browser source with your slides' words. Stream key, bitrate and quality stay in OBS → Settings → Stream/Output."))));
    stats(); shot();
  }
  obs.addEventListener("event", (e) => {
    const t = e.detail.eventType;
    if (/Scene|StudioMode|InputMute|InputCreated|InputRemoved/.test(t)) refresh().catch(() => {});
    if (/StreamStateChanged|RecordStateChanged/.test(t)) stats();
  });
  obs.addEventListener("close", () => { toast("OBS disconnected", "error"); render(); });
  return {
    render,
    async auto() { if (settings.obs?.host && (!settings.obs.password || localStorage.getItem("obsPass"))) { try { await connect(settings.obs.host, settings.obs.port, localStorage.getItem("obsPass") || ""); } catch { render(); } } else render(); },
  };
})();

// ── Cameras & stream (built-in) ───────────────────────────────────────────────────────────────
const studioPane = (() => {
  let studio = null, devices = { video: [], audio: [] }, built = false, statTimer = null, meterRaf = null;
  async function ensure() {
    if (built) return;
    built = true;
    const p = pane("studio");
    const canvas = h("canvas");
    studio = new Studio(canvas);
    studio.setQuality(settings.studio?.quality || "1080p30");
    studio.words = wordsFrom(live);
    p.replaceChildren(h("div.card", h("p.hint2", "Finding cameras and capture devices…")));
    devices = await listInputs();
    const prog = h("div.program", { id: "program" }, canvas, h("span.tag.pill2", { id: "progTag" }, "Preview"));
    const cams = h("div.cams", ...devices.video.map((d) => {
      const v = h("video", { muted: true, autoplay: true, playsInline: true });
      navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: d.id }, width: 640, height: 360 } }).then((s) => { v.srcObject = s; }).catch(() => {});
      const tile = h("div.cam", { dataset: { id: d.id }, title: d.label, onclick: async () => { await studio.useCamera(d.id); saveSettings({ studio: { ...(settings.studio || {}), camera: d.id } }); cams.querySelectorAll(".cam").forEach((c) => c.classList.toggle("on", c === tile)); } }, v, h("span", d.atem ? `ATEM · ${d.label}` : d.label));
      return tile;
    }));
    const mic = h("select", h("option", { value: "" }, "No sound"), ...devices.audio.map((d) => h("option", { value: d.id }, d.atem ? `ATEM · ${d.label}` : d.label)));
    const meter = h("div.meter", h("i"));
    mic.onchange = async () => { const s = await studio.useMic(mic.value).catch((e) => { toast(e.message, "error"); return null; }); saveSettings({ studio: { ...(settings.studio || {}), mic: mic.value } }); runMeter(s, meter); };
    const quality = h("select", ...Object.keys(QUALITY).map((k) => h("option", { value: k }, k)));
    quality.value = settings.studio?.quality || "1080p30";
    quality.onchange = () => { studio.setQuality(quality.value); saveSettings({ studio: { ...(settings.studio || {}), quality: quality.value } }); };
    const showWords = h("input", { type: "checkbox", checked: settings.studio?.words !== false, onchange: () => { studio.showWords = showWords.checked; saveSettings({ studio: { ...(settings.studio || {}), words: showWords.checked } }); } });
    studio.showWords = showWords.checked;
    const style = h("select", h("option", { value: "lower" }, "Lower third"), h("option", { value: "full" }, "Full screen words"));
    style.value = settings.studio?.style || "lower"; studio.style = style.value;
    style.onchange = () => { studio.style = style.value; saveSettings({ studio: { ...(settings.studio || {}), style: style.value } }); };
    const recBtn = h("button.btn", { onclick: async () => {
      if (studio.rec) { const f = await studio.stopRecording(); recBtn.textContent = "Record"; toast("Recording saved", "ok"); if (f) scc.rec.reveal(f); }
      else { try { const info = await studio.startRecording(); recBtn.textContent = "Stop recording"; toast(`Recording to ${info.file}`, "ok", 4000); } catch (e) { toast(e.message, "error"); } }
    } }, "Record");
    const whipUrl = h("input.input", { placeholder: "https://customer-….cloudflarestream.com/…/webRTC/publish", value: settings.studio?.whip || "" });
    const goBtn = h("button.go", { onclick: async () => {
      if (studio.whip) { if (!confirm("End the live stream now?")) return; await studio.stopWhip(); goBtn.textContent = "Go live"; goBtn.classList.remove("stop"); $("#program").classList.remove("live"); $("#progTag").textContent = "Preview"; $("#progTag").className = "tag pill2"; return; }
      goBtn.classList.add("busy");
      try {
        await studio.startWhip(whipUrl.value.trim());
        saveSettings({ studio: { ...(settings.studio || {}), whip: whipUrl.value.trim() } });
        goBtn.textContent = "End stream"; goBtn.classList.add("stop"); $("#program").classList.add("live"); $("#progTag").textContent = "LIVE"; $("#progTag").className = "tag pill2 live";
      } catch (e) { toast(e.message, "error", 6000); } finally { goBtn.classList.remove("busy"); }
    } }, "Go live");
    p.replaceChildren(h("div.studio",
      h("div.card", h("div.head", h("h3", "Program"), h("label.check.small", showWords, "Words on the picture"), style, quality), prog,
        h("div.statusline", h("span", { id: "whipStats" }, ""), h("span.muted", { id: "recStats" }, ""))),
      h("div", { style: { display: "grid", gap: "14px" } },
        h("div.card", h("h3", `Cameras & capture (${devices.video.length})`), devices.video.length ? cams : h("p.hint2", "No cameras found. Plug in a webcam, a capture card, or an ATEM Mini with USB (it shows up as a webcam)."),
          h("label.field", h("span", "Sound"), mic), meter),
        h("div.card", h("h3", "Record"), h("div.btns", recBtn, h("button.btn.ghost", { onclick: () => scc.rec.reveal() }, "Open recordings folder")), h("p.hint2", "Saved to Videos → SCC Presenter while you record, so nothing is lost if the computer switches off.")),
        h("div.card", h("h3", "Stream with Cloudflare (WebRTC)"), whipUrl, h("div.btns", goBtn),
          h("p.hint2", "In Cloudflare: Stream → Live inputs → create one → copy its WebRTC (WHIP) URL here. Viewers watch with less than a second of delay on your website. For YouTube or Facebook, use the ATEM's own streaming or OBS.")))));
    if (settings.studio?.camera && devices.video.some((d) => d.id === settings.studio.camera)) { await studio.useCamera(settings.studio.camera).catch(() => {}); cams.querySelector(`[data-id="${CSS.escape(settings.studio.camera)}"]`)?.classList.add("on"); }
    if (settings.studio?.mic && devices.audio.some((d) => d.id === settings.studio.mic)) { mic.value = settings.studio.mic; mic.onchange(); }
    clearInterval(statTimer);
    statTimer = setInterval(async () => {
      const s = await studio.whipStats();
      $("#whipStats").textContent = s ? `${s.state === "connected" ? "Live" : s.state} · ${Math.floor(s.seconds / 60)}:${String(s.seconds % 60).padStart(2, "0")} · ${s.kbps} kbps · ${s.fps} fps` : "";
      $("#ledStudio").className = `led${s ? " live" : studio.rec ? " warn" : studio.cam ? " on" : ""}`;
      $("#recStats").textContent = studio.rec ? `Recording ${Math.floor((Date.now() - studio.rec.started) / 60000)} min` : "";
    }, 1000);
  }
  function runMeter(stream, meter) {
    cancelAnimationFrame(meterRaf);
    if (!stream) { meter.firstChild.style.width = "0"; return; }
    const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const tick = () => { an.getFloatTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v)); meter.firstChild.style.width = `${Math.min(100, peak * 140)}%`; meterRaf = requestAnimationFrame(tick); };
    tick();
  }
  return { ensure, words(w) { if (studio) studio.words = w; } };
})();

// ── Start ─────────────────────────────────────────────────────────────────────────────────────
async function start() {
  settings = await scc.lib.get("settings");
  live = await scc.live.get();
  scc.live.onState((s) => { live = s; studioPane.words(wordsFrom(s)); });
  scc.atem.onState((s) => atemPane.set(s));
  atemPane.set(await scc.atem.get());
  document.querySelectorAll(".desk-tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("#btnHelp").addEventListener("click", () => modal({ title: "Live desk", width: 560, body: h("div", { style: { display: "grid", gap: "8px" } },
    h("p.hint2", h("b", "ATEM: "), "switch cameras, keyers, macros, and start the ATEM's own stream and recording. Set up “Words on the stream” once and your song words follow the slides."),
    h("p.hint2", h("b", "OBS Studio: "), "big scene buttons, Go live, Record and microphone mutes. One button adds your words to the scene."),
    h("p.hint2", h("b", "Cameras & stream: "), "no other software needed — pick a camera (an ATEM Mini over USB works too), add the words, record, and stream with Cloudflare."),
    h("p.hint2", "Tip: drag this window to its own screen with “Show on”, so the presentation and the stream each have their own screen.")), actions: [{ label: "Close", kind: "primary" }] }));
  await fillMove();
  scc.screens.onChange?.(() => fillMove());
  obsPane.auto();
  const tab = settings.deskTab || (settings.atem?.ip ? "atem" : settings.obs?.host ? "obs" : "atem");
  showTab(tab);
  document.body.classList.remove("booting");
}
start().catch((e) => { document.body.classList.remove("booting"); document.body.append(h("div.callout", { style: { margin: "40px" } }, `The live desk couldn't start: ${e.message}`)); });
