// Minimal OBS Studio remote control over obs-websocket v5 (built into OBS 28 and newer:
// OBS → Tools → WebSocket Server Settings → Enable, port 4455). Protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
async function sha256b64(text) { return b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))); }
/** obs-websocket v5 auth string: base64(sha256(base64(sha256(password + salt)) + challenge)). */
export async function obsAuth(password, salt, challenge) { return sha256b64((await sha256b64(password + salt)) + challenge); }

export class OBS extends EventTarget {
  constructor() { super(); this.ws = null; this.pending = new Map(); this.n = 0; this.connected = false; }

  connect(host = "127.0.0.1", port = 4455, password = "") {
    this.close();
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(`ws://${host}:${port}`, "obswebsocket.json"); } catch (e) { reject(e); return; }
      this.ws = ws;
      const fail = (msg) => { reject(new Error(msg)); try { ws.close(); } catch { /* ignore */ } };
      const timer = setTimeout(() => fail("OBS didn't answer. Check OBS is open and the WebSocket server is on (Tools → WebSocket Server Settings)."), 6000);
      ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.op === 0) {                                     // Hello
          const d = { rpcVersion: 1, eventSubscriptions: 0x7ff };
          if (msg.d.authentication) {
            if (!password) { clearTimeout(timer); return fail("OBS asks for a password. Copy it from OBS → Tools → WebSocket Server Settings → Show Connect Info."); }
            d.authentication = await obsAuth(password, msg.d.authentication.salt, msg.d.authentication.challenge);
          }
          ws.send(JSON.stringify({ op: 1, d }));
        } else if (msg.op === 2) {                              // Identified
          clearTimeout(timer); this.connected = true; resolve(true); this.emit("open", {});
        } else if (msg.op === 5) {                              // Event
          this.emit("event", msg.d);
        } else if (msg.op === 7) {                              // RequestResponse
          const p = this.pending.get(msg.d.requestId);
          if (p) { this.pending.delete(msg.d.requestId); msg.d.requestStatus.result ? p.resolve(msg.d.responseData || {}) : p.reject(new Error(msg.d.requestStatus.comment || `OBS refused ${msg.d.requestType}`)); }
        }
      };
      ws.onerror = () => { clearTimeout(timer); if (!this.connected) fail(`Couldn't reach OBS at ${host}:${port}.`); };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        const was = this.connected; this.connected = false;
        for (const p of this.pending.values()) p.reject(new Error("OBS disconnected"));
        this.pending.clear();
        if (!was && ev.code === 4009) reject(new Error("Wrong OBS password."));
        if (was) this.emit("close", {});
      };
    });
  }
  close() { try { this.ws?.close(); } catch { /* ignore */ } this.ws = null; this.connected = false; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  call(requestType, requestData = {}) {
    if (!this.connected) return Promise.reject(new Error("Connect to OBS first."));
    const requestId = `r${++this.n}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      setTimeout(() => { if (this.pending.delete(requestId)) reject(new Error("OBS took too long to answer.")); }, 8000);
    });
  }
}
