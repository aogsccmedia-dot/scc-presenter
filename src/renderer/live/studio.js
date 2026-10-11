// Built-in studio: camera / capture inputs (an ATEM Mini over USB appears as a webcam), the words drawn over the
// picture, recording to the Videos folder, and live streaming with WHIP (Cloudflare Stream and other WebRTC services).

export async function listInputs() {
  try {
    // Ask once so device names are shown (the stream is closed straight away).
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null));
    s?.getTracks().forEach((t) => t.stop());
  } catch { /* no permission or no devices */ }
  const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const vids = all.filter((d) => d.kind === "videoinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}`, atem: /blackmagic|atem/i.test(d.label) }));
  const auds = all.filter((d) => d.kind === "audioinput" && d.deviceId !== "communications").map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}`, atem: /blackmagic|atem/i.test(d.label) }));
  return { video: vids, audio: auds };
}

export const QUALITY = {
  "720p30": { w: 1280, h: 720, fps: 30, kbps: 3000 },
  "1080p30": { w: 1920, h: 1080, fps: 30, kbps: 5000 },
  "1080p60": { w: 1920, h: 1080, fps: 60, kbps: 7000 },
};

/** Fits the words into a lower-third band. */
function drawWords(ctx, W, H, text, style) {
  if (!text) return;
  const lines = text.split("\n").filter(Boolean).slice(0, 6);
  const bandH = H * (style === "full" ? 1 : 0.3), y0 = style === "full" ? 0 : H - bandH - H * 0.04;
  const pad = W * 0.05;
  let size = Math.round(H * 0.06);
  ctx.font = `700 ${size}px Inter, "Segoe UI", Arial, sans-serif`;
  const fits = () => lines.every((l) => ctx.measureText(l).width <= W - pad * 4) && lines.length * size * 1.2 <= bandH - pad * 0.6;
  while (size > 14 && !fits()) { size -= 2; ctx.font = `700 ${size}px Inter, "Segoe UI", Arial, sans-serif`; }
  if (style !== "full") {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const boxW = Math.min(W - pad * 2, widest + pad * 1.6), boxH = lines.length * size * 1.2 + size * 0.9;
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    const bx = (W - boxW) / 2, by = y0 + bandH - boxH;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, boxW, boxH, H * 0.015) : ctx.rect(bx, by, boxW, boxH); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, W / 2, by + size * 0.45 + i * size * 1.2));
  } else {
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = size * 0.3;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * size * 1.2));
    ctx.shadowBlur = 0;
  }
}

export class Studio {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.video = document.createElement("video"); this.video.muted = true; this.video.playsInline = true;
    this.cam = null; this.mic = null; this.words = ""; this.showWords = true; this.style = "lower";
    this.q = QUALITY["1080p30"]; this.timer = null; this.out = null;
    this.rec = null; this.whip = null;
  }
  setQuality(key) { this.q = QUALITY[key] || QUALITY["1080p30"]; this.canvas.width = this.q.w; this.canvas.height = this.q.h; this.loop(); }
  async useCamera(deviceId) {
    this.cam?.getTracks().forEach((t) => t.stop());
    this.cam = deviceId ? await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: this.q.w }, height: { ideal: this.q.h }, frameRate: { ideal: this.q.fps } }, audio: false }) : null;
    this.video.srcObject = this.cam;
    if (this.cam) await this.video.play().catch(() => {});
  }
  async useMic(deviceId) {
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = deviceId ? await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 } }) : null;
    return this.mic;
  }
  loop() {
    clearInterval(this.timer);
    this.canvas.width = this.q.w; this.canvas.height = this.q.h;
    // A timer (not requestAnimationFrame) keeps drawing even when this window is behind others.
    this.timer = setInterval(() => this.draw(), 1000 / this.q.fps);
  }
  draw() {
    const { ctx } = this, W = this.canvas.width, H = this.canvas.height;
    if (this.cam && this.video.readyState >= 2) {
      const vw = this.video.videoWidth, vh = this.video.videoHeight, k = Math.max(W / vw, H / vh);
      ctx.drawImage(this.video, (W - vw * k) / 2, (H - vh * k) / 2, vw * k, vh * k);
    } else { ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#555"; ctx.font = `600 ${H * 0.04}px Inter, Arial`; ctx.textAlign = "center"; ctx.fillText("Choose a camera", W / 2, H / 2); }
    if (this.showWords) drawWords(ctx, W, H, this.words, this.style);
  }
  stream() {
    if (!this.out) this.out = this.canvas.captureStream(this.q.fps);
    const tracks = [...this.out.getVideoTracks(), ...(this.mic ? this.mic.getAudioTracks() : [])];
    return new MediaStream(tracks);
  }

  async startRecording() {
    if (this.rec) return this.rec.info;
    const types = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    const info = await window.scc.rec.start(mimeType?.startsWith("video/mp4") ? "mp4" : "webm");
    const mr = new MediaRecorder(this.stream(), { mimeType, videoBitsPerSecond: this.q.kbps * 1000 * 1.6, audioBitsPerSecond: 192000 });
    let chain = Promise.resolve();
    mr.ondataavailable = (e) => { if (e.data?.size) chain = chain.then(async () => window.scc.rec.chunk(info.id, await e.data.arrayBuffer())); };
    const done = new Promise((r) => { mr.onstop = () => chain.then(() => window.scc.rec.stop(info.id)).then(r); });
    mr.start(2000);   // a chunk every 2 seconds is written to disk straight away
    this.rec = { mr, info, done, started: Date.now() };
    return info;
  }
  async stopRecording() { if (!this.rec) return null; const r = this.rec; this.rec = null; r.mr.stop(); return r.done; }

  /** WHIP (WebRTC-HTTP Ingestion Protocol, RFC 9725): one HTTP POST of an SDP offer, and you're live. */
  async startWhip(url, token = "") {
    if (this.whip) return;
    if (!/^https:\/\//.test(url)) throw new Error("Paste the WHIP / WebRTC URL from Cloudflare Stream (it starts with https://).");
    const pc = new RTCPeerConnection({ bundlePolicy: "max-bundle", iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
    const ms = this.stream();
    for (const t of ms.getTracks()) {
      const tr = pc.addTransceiver(t, { direction: "sendonly", streams: [ms] });
      if (t.kind === "video") {
        const caps = RTCRtpSender.getCapabilities("video")?.codecs || [];
        const h264 = caps.filter((c) => /h264/i.test(c.mimeType) && /42e01f/i.test(c.sdpFmtpLine || ""));
        if (h264.length && tr.setCodecPreferences) tr.setCodecPreferences([...h264, ...caps.filter((c) => !h264.includes(c))]);
        const p = tr.sender.getParameters(); p.encodings = [{ maxBitrate: this.q.kbps * 1000, maxFramerate: this.q.fps }]; tr.sender.setParameters(p).catch(() => {});
      }
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise((r) => { if (pc.iceGatheringState === "complete") r(); pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && r()); setTimeout(r, 2500); });
    const headers = { "content-type": "application/sdp" };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url, { method: "POST", headers, body: pc.localDescription.sdp }).catch(() => null);
    if (!res || !res.ok) { pc.close(); throw new Error(res ? `The streaming service said no (${res.status}). Check the URL.` : "Couldn't reach the streaming service. Check the internet connection."); }
    const answer = await res.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    const loc = res.headers.get("location");
    this.whip = { pc, resource: loc ? new URL(loc, url).toString() : null, headers, started: Date.now() };
    return pc;
  }
  async stopWhip() {
    const w = this.whip; this.whip = null;
    if (!w) return;
    if (w.resource) fetch(w.resource, { method: "DELETE", headers: w.headers }).catch(() => {});
    w.pc.close();
  }
  async whipStats() {
    if (!this.whip) return null;
    const stats = await this.whip.pc.getStats();
    let bytes = 0, fps = 0;
    stats.forEach((s) => { if (s.type === "outbound-rtp" && s.kind === "video") { bytes = s.bytesSent; fps = s.framesPerSecond || 0; } });
    const now = Date.now(), prev = this._last || { bytes, at: now };
    const kbps = now > prev.at ? Math.round(((bytes - prev.bytes) * 8) / (now - prev.at)) : 0;
    this._last = { bytes, at: now };
    return { state: this.whip.pc.connectionState, kbps, fps: Math.round(fps), seconds: Math.round((now - this.whip.started) / 1000) };
  }
}
