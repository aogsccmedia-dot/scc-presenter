import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLyrics, dedupeSections, songSlides, splitLines } from "../src/shared/lyrics.js";
import { parseReference, formatReference, findBook, scriptureSlides } from "../src/shared/scripture.js";
import { importFreeShow, importPlainText } from "../src/shared/importers.js";
import { tidyLocally, topicLocally, sermonLocally } from "../src/main/ai.js";

test("labelled lyrics become sections", () => {
  const s = parseLyrics("[Verse 1]\nA\nB\n\n[Chorus]\nC\nD\n\n[Verse 2]\nE\n\n[Chorus]\nC\nD");
  assert.deepEqual(s.map((x) => x.label), ["Verse 1", "Chorus", "Verse 2", "Chorus"]);
  const { sections, arrangement } = dedupeSections(s);
  assert.equal(sections.length, 3);
  assert.deepEqual(arrangement, [0, 1, 2, 1]);
});

test("unlabelled stanzas: repeats become the chorus", () => {
  const s = parseLyrics("one\ntwo\n\nchorus a\nchorus b\n\nthree\n\nchorus a\nchorus b");
  assert.deepEqual(s.map((x) => x.label), ["Verse 1", "Chorus", "Verse 2", "Chorus"]);
});

test("long sections split evenly", () => {
  assert.deepEqual(splitLines(["1", "2", "3", "4", "5", "6"], 4).map((x) => x.length), [3, 3]);
  const slides = songSlides({ sections: [{ label: "Verse 1", text: "a\nb\nc\nd\ne\nf" }], arrangement: [0] }, { maxLines: 4 });
  assert.equal(slides.length, 2);
  assert.equal(slides[0].label, "Verse 1 (1/2)");
});

test("bible references", () => {
  assert.deepEqual(parseReference("John 3:16-18"), { book: 42, name: "John", chapter: 3, from: 16, to: 18 });
  assert.equal(formatReference(parseReference("1 cor 13:4–7")), "1 Corinthians 13:4-7");
  assert.equal(formatReference(parseReference("Ps 23")), "Psalms 23");
  assert.equal(formatReference(parseReference("jn 3 16")), "John 3:16");
  assert.equal(formatReference(parseReference("John 3:16-4:2")), "John 3:16-4:2");
  assert.equal(findBook("Revelations"), 65);
  assert.equal(parseReference("hello"), null);
});

test("long verses split into readable slides", () => {
  const long = "First part of a very long verse that keeps going. ".repeat(8);
  const slides = scriptureSlides({ name: "Esther", chapter: 8 }, [{ chapter: 8, verse: 9, text: long }], { maxChars: 120 });
  assert.ok(slides.length > 1);
  assert.ok(slides.every((s) => s.text.length <= 160));
  assert.match(slides[0].reference, /Esther 8:9 KJV/);
});

test("FreeShow import keeps layout order", () => {
  const show = ["id", { name: "Test Song", meta: { artist: "Someone" }, settings: { activeLayout: "L" }, layouts: { L: { slides: [{ id: "a" }, { id: "b" }, { id: "a" }] } },
    slides: { a: { group: "Verse", items: [{ lines: [{ text: [{ value: "Line one" }] }] }] }, b: { group: "Chorus", items: [{ lines: [{ text: [{ value: "Sing" }] }] }] } } }];
  const song = importFreeShow(JSON.stringify(show));
  assert.equal(song.title, "Test Song");
  assert.equal(song.sections.length, 2);
  assert.deepEqual(song.arrangement, [0, 1, 0]);
});

test("plain text import takes the title from the first line", () => {
  const song = importPlainText("My Song\n\nverse line\n\nsing it out\n\nsing it out");
  assert.equal(song.title, "My Song");
  assert.ok(song.sections.length >= 2);
});

test("built-in AI fallbacks", () => {
  const tidy = tidyLocally("G  D  Em  C\nAmazing grace (x2)\nhow sweet\n\nCCLI 12345");
  assert.doesNotMatch(tidy, /CCLI|x2|Em/);
  assert.match(tidy, /\[Verse 1\]/);
  const t = topicLocally("dealing with anxiety");
  assert.ok(t.some((x) => x.ref === "Philippians 4:6-7"));
  const s = sermonLocally("Title\n- God is faithful, see Lamentations 3:22-23\n- Point two");
  assert.ok(s.some((x) => x.kind === "scripture" && x.ref === "Lamentations 3:22-23"));
});
