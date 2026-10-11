// Scripture text from bible-api.com (free, open source; public-domain translations only).
// Every passage fetched is cached on disk so it keeps working offline during a service.
import fs from "node:fs";
import path from "node:path";
import { formatReference, parseReference } from "../shared/scripture.js";

export const TRANSLATIONS = [
  { id: "kjv", name: "King James Version" },
  { id: "web", name: "World English Bible" },
  { id: "asv", name: "American Standard Version" },
  { id: "bbe", name: "Bible in Basic English" },
  { id: "ylt", name: "Young's Literal Translation" },
];

export function createBible(dir) {
  const cacheFile = path.join(dir, "bible-cache.json");
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { /* empty */ }
  const save = () => { try { fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch { /* ignore */ } };

  async function lookup(input, translation = "kjv") {
    const ref = parseReference(input);
    if (!ref) throw new Error("Try a reference like John 3:16 or Psalm 23.");
    const q = formatReference(ref);
    const key = `${translation}|${q}`;
    if (cache[key]) return { ref, ...cache[key], cached: true };
    const url = `https://bible-api.com/${encodeURIComponent(q)}?translation=${encodeURIComponent(translation)}`;
    let res;
    try { res = await fetch(url, { signal: AbortSignal.timeout(12000) }); }
    catch { throw new Error("Couldn't reach the Bible service. Check the internet connection (passages you've used before work offline)."); }
    if (!res.ok) throw new Error(res.status === 404 ? `Couldn't find ${q}.` : "The Bible service is busy. Try again in a moment.");
    const data = await res.json();
    const verses = (data.verses || []).map((v) => ({ chapter: v.chapter, verse: v.verse, text: String(v.text || "").replace(/\s+/g, " ").trim() }));
    if (!verses.length) throw new Error(`Couldn't find ${q}.`);
    const entry = { reference: data.reference || q, translation: (data.translation_id || translation).toUpperCase(), verses };
    cache[key] = entry; save();
    return { ref, ...entry, cached: false };
  }
  return { lookup, translations: TRANSLATIONS };
}
