// AI helpers. With the church's own Claude API key (kept encrypted on this computer) the results are smarter;
// without a key every feature still works using built-in rules, so nothing breaks offline.
import fs from "node:fs";
import path from "node:path";
import { parseLyrics, songToText, dedupeSections } from "../shared/lyrics.js";
import { parseReference, formatReference } from "../shared/scripture.js";

const MODEL = "claude-haiku-5-5";

// Built-in topic list used when there's no key or no internet.
const TOPICS = {
  love: ["1 Corinthians 13:4-7", "John 3:16", "Romans 8:38-39", "1 John 4:7-8", "John 15:12-13"],
  faith: ["Hebrews 11:1", "Hebrews 11:6", "Romans 10:17", "Mark 11:22-24", "2 Corinthians 5:7"],
  hope: ["Jeremiah 29:11", "Romans 15:13", "Isaiah 40:31", "Lamentations 3:22-23", "Romans 5:3-5"],
  peace: ["Philippians 4:6-7", "John 14:27", "Isaiah 26:3", "Matthew 11:28-30", "Psalm 4:8"],
  fear: ["Isaiah 41:10", "2 Timothy 1:7", "Psalm 27:1", "Joshua 1:9", "Psalm 56:3-4"],
  strength: ["Philippians 4:13", "Isaiah 40:29-31", "Psalm 46:1", "2 Corinthians 12:9-10", "Nehemiah 8:10"],
  forgiveness: ["1 John 1:9", "Ephesians 4:32", "Colossians 3:13", "Psalm 103:12", "Matthew 6:14-15"],
  prayer: ["Philippians 4:6", "1 Thessalonians 5:16-18", "Matthew 6:9-13", "James 5:16", "Jeremiah 33:3"],
  grace: ["Ephesians 2:8-9", "2 Corinthians 12:9", "Titus 2:11", "Hebrews 4:16", "Romans 5:20"],
  salvation: ["Romans 10:9-10", "Acts 4:12", "John 14:6", "Romans 6:23", "Ephesians 2:8-9"],
  thanksgiving: ["Psalm 100:4", "1 Thessalonians 5:18", "Colossians 3:17", "Psalm 107:1", "Psalm 136:1"],
  worship: ["John 4:23-24", "Psalm 95:1-6", "Romans 12:1", "Psalm 150:6", "Hebrews 13:15"],
  youth: ["1 Timothy 4:12", "Ecclesiastes 12:1", "Psalm 119:9", "2 Timothy 2:22", "Proverbs 3:5-6"],
  family: ["Joshua 24:15", "Ephesians 6:1-4", "Proverbs 22:6", "Colossians 3:18-21", "Psalm 127:1"],
  healing: ["Isaiah 53:5", "James 5:14-15", "Jeremiah 17:14", "Psalm 103:2-3", "3 John 1:2"],
  giving: ["2 Corinthians 9:7", "Malachi 3:10", "Luke 6:38", "Acts 20:35", "Proverbs 3:9-10"],
  holy_spirit: ["Acts 1:8", "Galatians 5:22-23", "John 14:26", "Romans 8:26", "Acts 2:4"],
  guidance: ["Proverbs 3:5-6", "Psalm 32:8", "Psalm 119:105", "Isaiah 30:21", "James 1:5"],
  purpose: ["Jeremiah 29:11", "Ephesians 2:10", "Romans 8:28", "Proverbs 19:21", "Philippians 1:6"],
  joy: ["Nehemiah 8:10", "Psalm 16:11", "John 15:11", "Romans 15:13", "James 1:2-3"],
};
const SYNONYMS = { anxiety: "peace", worry: "peace", afraid: "fear", courage: "fear", power: "strength", weak: "strength", mercy: "grace", saved: "salvation", gospel: "salvation", thanks: "thanksgiving", praise: "worship", young: "youth", marriage: "family", parents: "family", sick: "healing", tithe: "giving", offering: "giving", spirit: "holy_spirit", direction: "guidance", wisdom: "guidance", calling: "purpose", happiness: "joy", trust: "faith", believe: "faith" };

export function createAI(dir, safeStorage) {
  const keyFile = path.join(dir, "ai-key.bin");
  const canEncrypt = () => { try { return safeStorage?.isEncryptionAvailable?.(); } catch { return false; } };
  function getKey() {
    try {
      const buf = fs.readFileSync(keyFile);
      return canEncrypt() ? safeStorage.decryptString(buf) : null;
    } catch { return null; }
  }
  function setKey(key) {
    if (!key) { try { fs.unlinkSync(keyFile); } catch { /* none */ } return { ok: true, hasKey: false }; }
    if (!canEncrypt()) throw new Error("This computer can't store the key securely, so it wasn't saved.");
    fs.writeFileSync(keyFile, safeStorage.encryptString(String(key).trim()));
    return { ok: true, hasKey: true };
  }

  async function ask(system, user, maxTokens = 2000) {
    const key = getKey();
    if (!key) return null;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.content || []).map((c) => c.text || "").join("").trim();
    } catch { return null; }
  }
  const jsonFrom = (text) => { if (!text) return null; const m = text.match(/[[{][\s\S]*[\]}]/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };

  /** Messy pasted lyrics → clean sections with [Verse 1] / [Chorus] labels. */
  async function tidyLyrics(raw) {
    const out = await ask(
      "You format worship song lyrics for church projection. Return ONLY the lyrics with section headers in square brackets like [Verse 1], [Chorus], [Bridge]. Remove chords, repeat markers like 'x2' (write the lines out instead), copyright notes and extra blank lines. Keep each stanza to at most 4–6 short lines. Do not invent or change words.",
      String(raw).slice(0, 12000));
    if (out && /\[[^\]]+\]/.test(out)) return { text: out.replace(/^```\w*\n?|```$/g, "").trim(), ai: true };
    return { text: tidyLocally(raw), ai: false };
  }

  /** A sermon topic → Bible references with a one-line reason each. */
  async function scripturesFor(topic) {
    const out = jsonFrom(await ask(
      "You help a church media team. Suggest 6 well-known Bible passages for the topic. Reply ONLY with JSON: [{\"ref\":\"Book chapter:verse-verse\",\"why\":\"under 12 words\"}]. Use standard English book names.",
      `Topic: ${String(topic).slice(0, 300)}`, 600));
    if (Array.isArray(out) && out.length) {
      const items = out.map((x) => ({ ref: parseReference(x.ref) ? formatReference(parseReference(x.ref)) : null, why: String(x.why || "") })).filter((x) => x.ref);
      if (items.length) return { items, ai: true };
    }
    return { items: topicLocally(topic), ai: false };
  }

  /** Sermon notes → presentation slides (points + scripture references). */
  async function sermonSlides(notes) {
    const out = jsonFrom(await ask(
      "Turn sermon notes into projection slides. Each slide is short (max 20 words) — a title slide, then main points and key quotes. When the notes cite a Bible verse, add a slide with kind \"scripture\" and the reference. Reply ONLY with JSON: [{\"kind\":\"text\"|\"scripture\",\"text\":\"...\",\"ref\":\"John 3:16\"}].",
      String(notes).slice(0, 15000), 2500));
    if (Array.isArray(out) && out.length) return { slides: out.map((s) => ({ kind: s.kind === "scripture" ? "scripture" : "text", text: String(s.text || ""), ref: s.ref || null })).filter((s) => s.text || s.ref), ai: true };
    return { slides: sermonLocally(notes), ai: false };
  }

  return { getStatus: () => ({ hasKey: !!getKey(), secure: !!canEncrypt() }), setKey, tidyLyrics, scripturesFor, sermonSlides };
}

// ── Built-in fallbacks (also used by the tests) ─────────────────────────────

export function tidyLocally(raw) {
  const cleaned = String(raw || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !/^\s*([A-G][#b]?(m|maj|min|sus|dim|aug|add)?\d*(\/[A-G][#b]?)?\s*)+$/.test(l)) // chord-only lines
    .filter((l) => !/(ccli|copyright|©|all rights reserved)/i.test(l))
    .map((l) => l.replace(/\s*\(?\s*x\s*\d\s*\)?\s*$/i, "").replace(/\s{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  const { sections, arrangement } = dedupeSections(parseLyrics(cleaned));
  return songToText({ sections: arrangement.filter((v, i, a) => a.indexOf(v) === i).map((i) => sections[i]) });
}

export function topicLocally(topic) {
  const words = String(topic || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const keys = new Set();
  for (const w of words) {
    if (TOPICS[w]) keys.add(w);
    else if (SYNONYMS[w]) keys.add(SYNONYMS[w]);
    else { const k = Object.keys(TOPICS).find((t) => t.startsWith(w) && w.length >= 4); if (k) keys.add(k); }
  }
  if (!keys.size) keys.add("hope");
  const refs = [...new Set([...keys].flatMap((k) => TOPICS[k]))].slice(0, 8);
  return refs.map((ref) => ({ ref, why: `About ${[...keys].join(", ").replace(/_/g, " ")}` }));
}

const REF_IN_TEXT = /\b((?:[1-3]\s?)?[A-Z][a-z]+\.?\s\d{1,3}(?::\d{1,3}(?:\s?[-–]\s?\d{1,3})?)?)\b/g;
export function sermonLocally(notes) {
  const lines = String(notes || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  const slides = [];
  lines.forEach((line, i) => {
    const refs = [...line.matchAll(REF_IN_TEXT)].map((m) => m[1]).filter((r) => parseReference(r));
    const text = line.length > 140 ? line.slice(0, 137).replace(/\s+\S*$/, "") + "…" : line;
    slides.push({ kind: "text", text: i === 0 ? text : text, ref: null });
    for (const r of refs) slides.push({ kind: "scripture", text: "", ref: formatReference(parseReference(r)) });
  });
  return slides;
}
