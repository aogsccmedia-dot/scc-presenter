import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createImporter, collectFiles } from "../src/main/importer.js";
import { createStore } from "../src/main/store.js";
import { importOpenLyricsText } from "../src/shared/importers.js";
import { summarise, wordsOnAir } from "../src/main/atem-state.js";
import { stateForMode } from "../src/shared/modes.js";

const show = (name, line) => JSON.stringify(["x", { name, settings: { activeLayout: "L" }, layouts: { L: { slides: [{ id: "a" }] } }, slides: { a: { group: "Verse", items: [{ lines: [{ text: [{ value: line }] }] }] } } }]);

test("OpenLyrics without a DOM", () => {
  const s = importOpenLyricsText(`<song><properties><titles><title>Grace &amp; Peace</title></titles><verseOrder>v1 c v1</verseOrder><authors><author>A. Writer</author></authors></properties><lyrics><verse name="v1"><lines>Line one<br/>Line two</lines></verse><verse name="c"><lines>Chorus line</lines></verse></lyrics></song>`);
  assert.equal(s.title, "Grace & Peace");
  assert.equal(s.sections[0].text, "Line one\nLine two");
  assert.deepEqual(s.arrangement, [0, 1, 0]);
});

test("background import: finds files, skips duplicates, resumes after a restart", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scc-imp-"));
  const src = path.join(root, "FreeShow", "Shows"); fs.mkdirSync(src, { recursive: true });
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(src, `song${i}.show`), show(`Song ${i}`, `Words ${i}`));
  fs.writeFileSync(path.join(src, "dup.show"), show("Song 1", "Words 1"));
  fs.writeFileSync(path.join(src, "broken.show"), "{not json");
  fs.writeFileSync(path.join(src, "notes.pdf"), "x");
  assert.equal(collectFiles({ folders: [src] }).length, 62);
  const dir = path.join(root, "data"); const store = createStore(dir);
  const events = [];
  let imp = createImporter({ dir, store, importPackage: () => {}, send: (p) => events.push(p) });
  imp.start({ folders: [src], label: "FreeShow" });
  await new Promise((r) => setTimeout(r, 70));
  imp.pause();                                         // "the app closed" part-way through
  await new Promise((r) => setTimeout(r, 60));
  const partial = createStore(dir).read("songs").length;
  assert.ok(partial > 0 && partial < 60, `partial import (${partial})`);
  // A fresh start of the app picks the job up again.
  const store2 = createStore(dir);
  imp = createImporter({ dir, store: store2, importPackage: () => {}, send: (p) => events.push(p) });
  imp.resume();
  for (let i = 0; i < 100 && imp.get().status === "running"; i++) await new Promise((r) => setTimeout(r, 20));
  const v = imp.get();
  assert.equal(v.status, "done");
  assert.equal(createStore(dir).read("songs").length, 60);
  assert.equal(v.failed, 1);
  assert.ok(v.skipped >= 1);
});

test("output modes", () => {
  const live = { themeId: "classic", slide: { text: "Hi" }, background: { type: "motion", preset: "aurora" }, logo: true };
  const w = stateForMode(live, "words");
  assert.equal(w.background.value, "#000000");
  assert.equal(w.logo, false);
  assert.equal(stateForMode(live, "green").background.value, "#00b140");
  assert.equal(stateForMode(live, "key").themes[0].color, "#ffffff");
  assert.equal(stateForMode(live, "visuals").clear, true);
  assert.equal(stateForMode({ ...live, slide: { kind: "media" } }, "words").slide, null);
});

test("ATEM summary and keyed words", () => {
  const st = {
    info: { productIdentifier: "ATEM Mini Pro" },
    inputs: { 1: { inputId: 1, shortName: "CAM1", longName: "Camera 1", internalPortType: 0, meAvailability: 1 }, 0: { inputId: 0, shortName: "BLK", longName: "Black", internalPortType: 1, meAvailability: 1 }, 10010: { inputId: 10010, shortName: "PGM", longName: "Program", internalPortType: 128, meAvailability: 0 } },
    video: { mixEffects: [{ programInput: 1, previewInput: 0, transitionPosition: { inTransition: false }, fadeToBlack: { isFullyBlack: false }, upstreamKeyers: [{ onAir: false }] }], downstreamKeyers: [{ onAir: true }] },
    macro: { macroProperties: [{ isUsed: true, name: "Intro" }, { isUsed: false }] },
    streaming: { status: { state: 4 }, stats: { encodingBitrate: 6000000 }, service: { serviceName: "YouTube", url: "rtmp://a", key: "k" }, duration: { hours: 0, minutes: 5, seconds: 3 } },
    media: { stillPool: new Array(20), players: [{}] },
  };
  const s = summarise(st, { ip: "1.2.3.4" });
  assert.equal(s.model, "ATEM Mini Pro");
  assert.deepEqual(s.inputs.map((i) => i.id), [1, 0]);
  assert.equal(s.streaming.state, "streaming");
  assert.equal(s.streaming.duration, "00:05:03");
  assert.equal(s.macros.length, 1);
  assert.equal(wordsOnAir({ slide: { text: "Amazing grace" } }), "Amazing grace");
  assert.equal(wordsOnAir({ slide: { text: "x" }, clear: true }), null);
  assert.equal(wordsOnAir({ slide: { kind: "media" } }), null);
});
