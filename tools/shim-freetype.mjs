// atem-connection pulls in a native font library that is only used to draw labels on the ATEM multiviewer.
// SCC Presenter doesn't use that, and a native module would stop the Mac app being built for both Apple Silicon
// and Intel at once. So after install we swap it for a tiny stand-in with the same shape (no native code).
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve("node_modules/@julusian/freetype2");
if (!fs.existsSync(dir)) process.exit(0);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@julusian/freetype2", version: "1.3.1-scc", main: "index.js", license: "MIT" }, null, 1));
fs.writeFileSync(path.join(dir, "index.js"), `"use strict";
class FontFace {}
function unsupported() { throw new Error("ATEM multiviewer labels aren't available in SCC Presenter."); }
module.exports = { FontFace, NewMemoryFace: unsupported, NewFace: unsupported, RenderMode: {}, LoadFlags: {} };
`);
console.log("freetype2 replaced with a JS stand-in");
