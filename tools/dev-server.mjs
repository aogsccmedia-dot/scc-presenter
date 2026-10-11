// Serves the control screen in a normal browser (with a stand-in bridge) for quick UI work:
//   node tools/dev-server.mjs  →  http://localhost:5173/control/index.html
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const ROUTES = { "/shared/": path.join(SRC, "shared"), "/control/": path.join(SRC, "renderer", "control"), "/web/": path.join(SRC, "renderer", "web") };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const port = Number(process.env.PORT || 5173);

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  for (const [prefix, dir] of Object.entries(ROUTES)) {
    if (!p.startsWith(prefix)) continue;
    const file = path.resolve(dir, p.slice(prefix.length));
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) break;
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(p === "/" ? 302 : 404, p === "/" ? { location: "/control/index.html" } : {}); res.end();
}).listen(port, () => console.log(`SCC Presenter UI preview: http://localhost:${port}/control/index.html`));
