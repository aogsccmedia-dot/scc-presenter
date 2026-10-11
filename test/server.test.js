import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/main/server.js";
import { createStore } from "../src/main/store.js";

test("store writes atomically and merges settings defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scc-"));
  const s = createStore(dir);
  s.upsert("songs", { id: "a", title: "A" });
  assert.equal(createStore(dir).read("songs")[0].title, "A");
  assert.equal(createStore(dir).read("settings").port, 4747);
});

test("server: pages, PIN-protected remote and share, media whitelist", async () => {
  const media = path.join(os.tmpdir(), "scc-test.png");
  fs.writeFileSync(media, Buffer.from([137, 80, 78, 71]));
  const cmds = [];
  const srv2 = createServer({
    getState: () => ({}), getRemoteView: () => ({ title: "Song" }), onRemote: (c) => cmds.push(c), getPin: () => "1234",
    listShared: () => [{ id: "s1" }], sharePackage: (id) => (id === "s1" ? { format: "scc-show" } : null), mediaPath: (id) => (id === "m1" ? media : null),
  });
  const P = 47000 + Math.floor(Math.random() * 1000);
  assert.ok((await srv2.listen(P)).ok);
  const base = `http://127.0.0.1:${P}`;
  assert.equal((await fetch(`${base}/output`)).status, 200);
  assert.equal((await fetch(`${base}/shared/render.js`)).status, 200);
  assert.notEqual((await fetch(`${base}/shared/%2e%2e/main/ai.js`)).status, 200);
  assert.equal((await fetch(`${base}/api/remote?pin=0000`)).status, 401);
  assert.equal((await fetch(`${base}/api/remote?pin=1234`)).status, 200);
  const post = await fetch(`${base}/api/remote`, { method: "POST", body: JSON.stringify({ pin: "1234", action: "next" }) });
  assert.equal(post.status, 200);
  assert.deepEqual(cmds.at(-1), { pin: "1234", action: "next" });
  assert.equal((await fetch(`${base}/api/share?pin=1234`)).status, 200);
  assert.equal((await fetch(`${base}/api/share?pin=1234&id=nope`)).status, 404);
  assert.equal((await fetch(`${base}/media/m1`)).status, 200);
  assert.equal((await fetch(`${base}/media/other`)).status, 404);
  const ranged = await fetch(`${base}/media/m1`, { headers: { range: "bytes=0-1" } });
  assert.equal(ranged.status, 206);
  srv2.close();
});
