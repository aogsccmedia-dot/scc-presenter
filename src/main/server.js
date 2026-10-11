// Local network server (default port 4747).
//   /output  – full-screen output for OBS Studio, vMix, a browser or a smart TV (add ?transparent=1 for an overlay)
//   /stage   – stage screen for the band and speaker (current + next + clock)
//   /remote  – phone remote, protected by a PIN
//   /api/share – lets another SCC Presenter on the same network pull shared shows (PIN protected)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATIC = { "/shared/": path.join(SRC, "shared"), "/web/": path.join(SRC, "renderer", "web") };
const PAGES = { "/": "index.html", "/output": "output.html", "/stage": "stage.html", "/remote": "remote.html" };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
const SECURITY = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store" };

export function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
}

export function createServer({ getState, getRemoteView, onRemote, getPin, listShared, sharePackage, mediaPath }) {
  const clients = new Set();
  const fails = new Map(); // ip → { n, until } — slows down PIN guessing

  const send = (res, code, body, type = "application/json; charset=utf-8") => {
    res.writeHead(code, { "content-type": type, ...SECURITY });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const pinOk = (req, pin) => {
    const ip = req.socket.remoteAddress || "";
    const f = fails.get(ip);
    if (f && f.until > Date.now()) return false;
    const ok = !!getPin() && String(pin || "") === String(getPin());
    if (!ok) { const n = (f?.n || 0) + 1; fails.set(ip, { n, until: n >= 5 ? Date.now() + 60000 : 0 }); }
    else fails.delete(ip);
    return ok;
  };
  const readBody = (req) => new Promise((resolve) => {
    let raw = ""; req.on("data", (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
  });

  function serveFile(req, res, file) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, "Not found", "text/plain");
      const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
        if (start > end || start >= st.size) { res.writeHead(416, { "content-range": `bytes */${st.size}` }); return res.end(); }
        res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${st.size}`, "accept-ranges": "bytes", ...SECURITY });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes", ...SECURITY });
        fs.createReadStream(file).pipe(res);
      }
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://local");
    const p = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (req.method === "GET" && PAGES[p]) return serveFile(req, res, path.join(STATIC["/web/"], PAGES[p]));
      for (const [prefix, dir] of Object.entries(STATIC)) {
        if (req.method === "GET" && p.startsWith(prefix)) {
          const file = path.resolve(dir, p.slice(prefix.length));
          if (!file.startsWith(dir + path.sep)) return send(res, 403, "Forbidden", "text/plain");
          return serveFile(req, res, file);
        }
      }
      if (req.method === "GET" && p.startsWith("/media/")) {
        const file = mediaPath(decodeURIComponent(p.slice(7)));   // only files in the media library or the logo
        return file ? serveFile(req, res, file) : send(res, 404, "Not found", "text/plain");
      }
      if (req.method === "GET" && p === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...SECURITY });
        res.write(`retry: 1500\ndata: ${JSON.stringify(getState())}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 20000);
        req.on("close", () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      if (p === "/api/remote") {
        if (req.method === "GET") return pinOk(req, url.searchParams.get("pin")) ? send(res, 200, getRemoteView()) : send(res, 401, { error: "Wrong PIN" });
        if (req.method === "POST") {
          const body = await readBody(req);
          if (!pinOk(req, body.pin)) return send(res, 401, { error: "Wrong PIN" });
          onRemote(body);
          return send(res, 200, getRemoteView());
        }
      }
      if (req.method === "GET" && p === "/api/share") {
        if (!pinOk(req, url.searchParams.get("pin"))) return send(res, 401, { error: "Wrong PIN" });
        const id = url.searchParams.get("id");
        if (!id) return send(res, 200, { shows: listShared() });
        const pkg = sharePackage(id);
        return pkg ? send(res, 200, pkg) : send(res, 404, { error: "That show isn't shared" });
      }
      send(res, 404, "Not found", "text/plain");
    } catch (e) {
      send(res, 500, { error: "Something went wrong" });
    }
  });

  return {
    listen(port) {
      return new Promise((resolve) => {
        server.once("error", (e) => resolve({ ok: false, error: e.code === "EADDRINUSE" ? `Port ${port} is already in use.` : e.message }));
        server.listen(port, "0.0.0.0", () => resolve({ ok: true, port }));
      });
    },
    broadcast(state) { const msg = `data: ${JSON.stringify(state)}\n\n`; for (const c of clients) c.write(msg); },
    close() { for (const c of clients) c.end(); server.close(); server.closeAllConnections?.(); },
    clientCount: () => clients.size,
  };
}
