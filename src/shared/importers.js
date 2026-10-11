// Bring songs in from other tools: FreeShow (.show), OpenLyrics (.xml, used by OpenLP and others), and plain text.
import { autoLabel, dedupeSections, parseLyrics } from "./lyrics.js";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const newId = uid;

/** FreeShow .show file (JSON: [id, show] or show). Takes slide groups and their text lines, in layout order. */
export function importFreeShow(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const show = Array.isArray(data) ? data[1] : data;
  if (!show || typeof show !== "object" || !show.slides) throw new Error("This doesn't look like a FreeShow show file.");
  const textOf = (slide) => (slide.items || []).map((it) => (it.lines || []).map((l) => (l.text || []).map((t) => t.value || "").join("")).join("\n")).filter(Boolean).join("\n").replace(/<[^>]+>/g, "").trim();
  const layout = show.layouts && (show.layouts[show.settings?.activeLayout] || Object.values(show.layouts)[0]);
  const order = layout?.slides?.map((s) => s.id) || Object.keys(show.slides);
  const sections = [];
  for (const id of order) {
    const s = show.slides[id]; if (!s) continue;
    const text = [textOf(s), ...(s.children || []).map((c) => show.slides[c] ? textOf(show.slides[c]) : "")].filter(Boolean).join("\n\n");
    if (text) sections.push({ label: s.group || null, text });
  }
  const { sections: unique, arrangement } = dedupeSections(autoLabel(sections));
  return { id: uid(), title: show.name || "Imported song", author: show.meta?.artist || show.meta?.author || "", ccli: show.meta?.CCLI || "", sections: unique, arrangement, source: "FreeShow" };
}

/** OpenLyrics XML (needs a DOMParser: the browser's, or one passed in for tests). */
export function importOpenLyrics(xml, Parser = globalThis.DOMParser) {
  const doc = new Parser().parseFromString(xml, "application/xml");
  const q = (sel) => [...doc.getElementsByTagName(sel)];
  const title = q("title")[0]?.textContent?.trim() || "Imported song";
  const author = q("author").map((a) => a.textContent.trim()).filter(Boolean).join(", ");
  const ccli = q("ccliNo")[0]?.textContent?.trim() || "";
  const LABELS = { v: "Verse", c: "Chorus", b: "Bridge", p: "Pre-chorus", e: "Ending", i: "Intro", o: "Outro" };
  const named = (n) => { const m = /^([a-z])(\d*)([a-z]?)$/i.exec(n || ""); return m ? `${LABELS[m[1].toLowerCase()] || "Verse"}${m[2] ? ` ${m[2]}` : ""}` : n || null; };
  const sections = q("verse").map((v) => {
    const lines = [...v.getElementsByTagName("lines")].map((l) => {
      const html = new XMLSerializerLike(l).text();
      return html;
    }).join("\n");
    return { key: v.getAttribute("name"), label: named(v.getAttribute("name")), text: lines.trim() };
  }).filter((s) => s.text);
  const orderAttr = q("verseOrder")[0]?.textContent?.trim();
  const unique = sections.map(({ label, text }) => ({ label, text }));
  const arrangement = orderAttr ? orderAttr.split(/\s+/).map((k) => sections.findIndex((s) => s.key === k)).filter((i) => i >= 0) : unique.map((_, i) => i);
  return { id: uid(), title, author, ccli, sections: unique, arrangement, source: "OpenLyrics" };
}
// <lines>Line one<br/>Line two</lines> → "Line one\nLine two" without relying on XMLSerializer.
class XMLSerializerLike {
  constructor(node) { this.node = node; }
  text() {
    let out = "";
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) out += c.nodeValue; else if (c.nodeName === "br") out += "\n"; else if (c.nodeName !== "comment") walk(c); } };
    walk(this.node);
    return out.split("\n").map((l) => l.trim()).join("\n");
  }
}

/** Plain text: first line can be the title ("Title: …" or a lone first line followed by a blank line). */
export function importPlainText(text, fallbackTitle = "New song") {
  let body = String(text || "").replace(/\r\n?/g, "\n").trim();
  let title = fallbackTitle;
  const t = /^title\s*:\s*(.+)\n/i.exec(body);
  if (t) { title = t[1].trim(); body = body.slice(t[0].length); }
  else { const first = body.split("\n"); if (first.length > 2 && first[1] === "" && first[0].length < 60 && !/[.,;]$/.test(first[0])) { title = first[0].trim(); body = first.slice(2).join("\n"); } }
  const { sections, arrangement } = dedupeSections(parseLyrics(body));
  return { id: uid(), title, author: "", ccli: "", sections, arrangement, source: "Text" };
}

/** OpenLyrics without a DOM (used by the background importer in the main process). */
export function importOpenLyricsText(xml) {
  const text = String(xml || "");
  if (!/<song[\s>]/i.test(text)) throw new Error("This doesn't look like an OpenLyrics song.");
  const decode = (s) => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
  const tag = (name) => { const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(text); return m ? decode(m[1]).trim() : ""; };
  const title = tag("title") || "Imported song";
  const authors = [...text.matchAll(/<author[^>]*>([\s\S]*?)<\/author>/gi)].map((m) => decode(m[1]).trim()).filter(Boolean).join(", ");
  const LABELS = { v: "Verse", c: "Chorus", b: "Bridge", p: "Pre-chorus", e: "Ending", i: "Intro", o: "Outro" };
  const named = (n) => { const m = /^([a-z])(\d*)([a-z]?)$/i.exec(n || ""); return m ? `${LABELS[m[1].toLowerCase()] || "Verse"}${m[2] ? ` ${m[2]}` : ""}` : n || null; };
  const sections = [...text.matchAll(/<verse\b([^>]*)>([\s\S]*?)<\/verse>/gi)].map((m) => {
    const key = /name="([^"]*)"/i.exec(m[1])?.[1] || "";
    const lines = [...m[2].matchAll(/<lines\b[^>]*>([\s\S]*?)<\/lines>/gi)].map((l) => decode(l[1]).split("\n").map((x) => x.trim()).join("\n")).join("\n");
    return { key, label: named(key), text: lines.trim() };
  }).filter((s) => s.text);
  const order = tag("verseOrder");
  const arrangement = order ? order.split(/\s+/).map((k) => sections.findIndex((s) => s.key === k)).filter((i) => i >= 0) : sections.map((_, i) => i);
  return { id: uid(), title, author: authors, ccli: tag("ccliNo"), sections: sections.map(({ label, text: t }) => ({ label, text: t })), arrangement: arrangement.length ? arrangement : sections.map((_, i) => i), source: "OpenLyrics" };
}
