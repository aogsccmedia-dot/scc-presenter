// Lyrics → sections → slides. Pure functions, used by the app and the tests.

const LABEL_RE = /^\s*[\[(]?\s*(verse|chorus|refrain|pre[- ]?chorus|bridge|tag|intro|outro|ending|interlude|vamp|hook)\s*(\d+)?\s*[\])]?\s*:?\s*$/i;
const nice = (s) => s.toLowerCase().replace(/pre[- ]?chorus/, "Pre-chorus").replace(/^\w/, (c) => c.toUpperCase());

/** Plain lyrics (with optional [Verse 1] / Chorus: labels) → [{ label, text }]. */
export function parseLyrics(raw) {
  const lines = String(raw || "").replace(/\r\n?/g, "\n").split("\n");
  const sections = [];
  let current = null;
  const push = () => { if (current && current.lines.some((l) => l.trim())) sections.push({ label: current.label, text: trimBlock(current.lines) }); current = null; };
  for (const line of lines) {
    const m = LABEL_RE.exec(line);
    if (m) { push(); current = { label: nice(m[1]) + (m[2] ? ` ${m[2]}` : ""), lines: [] }; continue; }
    if (!line.trim()) { if (current && current.lines.some((l) => l.trim())) { if (current.explicit === false) push(); else current.lines.push(""); } continue; }
    if (!current) current = { label: null, lines: [], explicit: false };
    current.lines.push(line.trim());
  }
  push();
  // Collapse blank-line runs inside labelled sections into stanza breaks; label unlabelled stanzas.
  const out = [];
  for (const s of sections) for (const part of s.text.split(/\n{2,}/)) out.push({ label: s.label, text: part.trim() });
  return autoLabel(out);
}

const trimBlock = (lines) => lines.join("\n").replace(/^\n+|\n+$/g, "");

/** Unlabelled stanzas: repeated text becomes "Chorus", the rest "Verse n". */
export function autoLabel(sections) {
  const seen = new Map();
  for (const s of sections) { const k = norm(s.text); seen.set(k, (seen.get(k) || 0) + 1); }
  let verse = 0;
  return sections.map((s) => {
    if (s.label) return s;
    if (seen.get(norm(s.text)) > 1) return { ...s, label: "Chorus" };
    verse++;
    return { ...s, label: `Verse ${verse}` };
  });
}
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Remove duplicate sections (keep first), so "Chorus" is stored once and repeated through the arrangement. */
export function dedupeSections(sections) {
  const order = [], unique = [];
  const index = new Map();
  for (const s of sections) {
    const k = `${s.label}|${norm(s.text)}`;
    if (!index.has(k)) { index.set(k, unique.length); unique.push(s); }
    order.push(index.get(k));
  }
  return { sections: unique, arrangement: order };
}

/** A song → slides. Long sections are split into chunks of up to maxLines lines. */
export function songSlides(song, { maxLines = 4 } = {}) {
  const order = song.arrangement?.length ? song.arrangement : song.sections.map((_, i) => i);
  const slides = [];
  for (const i of order) {
    const s = song.sections[i];
    if (!s) continue;
    const lines = s.text.split("\n").filter((l) => l.trim());
    const chunks = splitLines(lines, maxLines);
    chunks.forEach((chunk, n) => slides.push({ kind: "lyrics", label: chunks.length > 1 ? `${s.label} (${n + 1}/${chunks.length})` : s.label, section: s.label, text: chunk.join("\n") }));
  }
  return slides;
}

/** Split lines evenly: 6 lines with max 4 → 3+3, not 4+2. */
export function splitLines(lines, max) {
  if (lines.length <= max) return [lines];
  const parts = Math.ceil(lines.length / max), size = Math.ceil(lines.length / parts), out = [];
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size));
  return out;
}

/** Song as editable text (for the editor): sections with [Label] headers. */
export function songToText(song) {
  return song.sections.map((s) => `[${s.label}]\n${s.text}`).join("\n\n");
}
