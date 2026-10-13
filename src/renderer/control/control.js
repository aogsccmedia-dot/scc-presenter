// SCC Presenter — control screen.
import { createView } from "../shared/render.js";
import { THEMES } from "../shared/themes.js";
import { songSlides } from "../shared/lyrics.js";
import { scriptureSlides, parseReference, formatReference } from "../shared/scripture.js";
import { importFreeShow, importOpenLyrics, importPlainText, newId } from "../shared/importers.js";
import { h, icon, toast, modal, modalOpen, confirmBox, askText, debounce, plural } from "./ui.js";
import { openSongEditor, openTextEditor, openSettings, openConnect, openAI, openReceive, openShortcuts, openSetup, openFeedback, openGuide, openImport, onImportProgress } from "./dialogs.js";
import { syncSound } from "./sound.js";
import { MOTION } from "../shared/render.js";
import { SOUND_PRESETS, KEYS } from "../web/audio.js";

if (!window.scc) await import("./mock.js");   // lets the screen run in a normal browser for development
const scc = window.scc;
const $ = (id) => document.getElementById(id);
const mediaUrl = (id) => `/media/${encodeURIComponent(id)}`;

export const S = {
  songs: [], shows: [], media: [], settings: {},
  tab: "songs", query: "",
  showId: null,
  selected: null,          // item shown in the slide grid
  selectedShowItem: null,  // id of the service item that's selected (if any)
  liveItem: null, liveIndex: -1, liveShowItem: null,
  cursor: -1,              // keyboard focus in the grid
  live: {}, screens: { output: false, stage: false, displays: [] },
  bibleResult: null, translations: [],
  timer: null,
};
export { scc, mediaUrl };

// ── Items: everything that can be shown is turned into { key, type, title, slides } ───────────────
const SECTION_COLORS = { verse: "#4f8cff", chorus: "#f5b942", "pre-chorus": "#2fc4b2", bridge: "#b07cff", tag: "#ff7ab6", intro: "#8d96a7", outro: "#8d96a7", ending: "#8d96a7", scripture: "#3ecf8e", media: "#8d96a7", text: "#e8ebf1" };
const colorFor = (s) => SECTION_COLORS[(s.section || s.kind || "").toLowerCase().replace(/\s*\d+.*$/, "")] || SECTION_COLORS[s.kind] || "#4f8cff";

export function songItem(song) {
  return { key: `song:${song.id}`, type: "song", songId: song.id, title: song.title, sub: song.author || "", slides: songSlides(song, { maxLines: Number(S.settings.maxLines) || 4 }) };
}
function mediaItem(m) {
  return { key: `media:${m.id}`, type: "media", mediaId: m.id, title: m.name, sub: m.type, slides: [{ kind: "media", label: m.name, text: "", media: m }] };
}
function scriptureItem(r) {
  return { key: `scr:${r.reference}:${r.translation}`, type: "scripture", ref: r.reference, translation: r.translation, title: `${r.reference}`, sub: r.translation, slides: r.slides };
}
function textItem(t) {
  return { key: `text:${t.id}`, type: "text", textId: t.id, title: t.title, sub: "Text slides", slides: t.slides.map((s) => ({ kind: s.kind || "text", label: s.label || (s.kind === "scripture" ? s.reference : ""), text: s.text, reference: s.reference || "" })) };
}

/** A service item → a presentable item (or null if its song/media was deleted). */
export function itemFromShowItem(si) {
  if (si.type === "song") { const s = S.songs.find((x) => x.id === si.songId); return s ? { ...songItem(s), showItemId: si.id } : null; }
  if (si.type === "media") { const m = S.media.find((x) => x.id === si.mediaId); return m ? { ...mediaItem(m), showItemId: si.id } : null; }
  if (si.type === "scripture") return { ...scriptureItem(si), showItemId: si.id };
  if (si.type === "text") return { ...textItem(si), showItemId: si.id };
  return null;
}

const currentShow = () => S.shows.find((s) => s.id === S.showId) || null;

// ── Data loading ──────────────────────────────────────────────────────────────────────────────
async function loadAll() {
  [S.songs, S.shows, S.media, S.settings] = await Promise.all([scc.lib.get("songs"), scc.lib.get("shows"), scc.lib.get("media"), scc.lib.get("settings")]);
  S.songs.sort((a, b) => a.title.localeCompare(b.title));
  S.shows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!S.shows.length) S.shows = [await scc.lib.upsert("shows", { id: newId(), title: defaultShowTitle(), date: new Date().toISOString().slice(0, 10), items: [] })];
  if (!S.showId || !S.shows.some((s) => s.id === S.showId)) S.showId = S.settings.lastShowId && S.shows.some((s) => s.id === S.settings.lastShowId) ? S.settings.lastShowId : S.shows[0].id;
}
export async function reload(what = ["songs", "shows", "media"]) {
  for (const w of what) S[w] = await scc.lib.get(w);
  S.songs.sort((a, b) => a.title.localeCompare(b.title));
  S.shows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  renderAll();
}
function defaultShowTitle() {
  const d = new Date();
  return `${d.toLocaleDateString(undefined, { weekday: "long" })} service · ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

// ── Live ──────────────────────────────────────────────────────────────────────────────────────
const slideOut = (s) => s && ({ text: s.text || "", label: s.label || "", reference: s.reference || "", kind: s.kind });

function backgroundFor(item, slide) {
  if (slide?.kind === "media" && slide.media && slide.media.type !== "audio") return { type: slide.media.type, src: slide.media.id, loop: slide.media.type === "image" ? true : !!S.settings.loopVideos, muted: false };
  if (String(S.settings.backgroundId || "").startsWith("motion:")) return { type: "motion", preset: S.settings.backgroundId.slice(7) };
  const bg = S.settings.backgroundId && S.media.find((m) => m.id === S.settings.backgroundId);
  if (bg) return { type: bg.type, src: bg.id, loop: true, muted: true };
  return { type: "theme" };
}

export async function goLive(item, index, { fromRemote = false } = {}) {
  if (!item || !item.slides.length) return;
  index = Math.max(0, Math.min(index, item.slides.length - 1));
  const slide = item.slides[index];
  S.liveItem = item; S.liveIndex = index; S.liveShowItem = item.showItemId || null;
  const patch = {
    slide: slide.kind === "media" ? { text: "", label: slide.label, kind: "media" } : slideOut(slide),
    next: slideOut(item.slides[index + 1] || nextItemFirstSlide()),
    item: { title: item.title, index, count: item.slides.length },
    background: backgroundFor(item, slide),
    blackout: false, clear: false, logo: false,
  };
  if (slide.kind === "media" && slide.media?.type === "audio") { patch.audio = { src: slide.media.id, startedAt: Date.now(), paused: false, volume: S.live.audio?.volume ?? 1, name: slide.media.name }; delete patch.background; }
  if (slide.kind === "media" && slide.media?.type === "video") patch.videoCmd = { action: "restart", at: Date.now() };
  // Make sure the output is showing the first time someone goes live.
  if (!S.screens.output && !S.autoOpened && S.screens.displays.length > 1) { S.autoOpened = true; scc.screens.open("output", S.settings.outputDisplay).catch(() => {}); }
  S.live = { ...S.live, ...patch };
  renderLiveMarks(); renderPreviews(); syncRemote();
  await scc.live.set(patch);
  if (!fromRemote) scrollToLive();
}

function nextItemFirstSlide() {
  const n = neighbourShowItem(1);
  return n?.slides[0] ? { ...n.slides[0], label: `${n.title} · ${n.slides[0].label || ""}` } : null;
}
function neighbourShowItem(dir) {
  const show = currentShow(); if (!show || !S.liveShowItem) return null;
  const items = show.items.filter((i) => i.type !== "header");
  let i = items.findIndex((x) => x.id === S.liveShowItem);
  if (i < 0) return null;
  for (i += dir; i >= 0 && i < items.length; i += dir) { const it = itemFromShowItem(items[i]); if (it?.slides.length) return it; }
  return null;
}

export function step(dir) {
  const item = S.liveItem || S.selected;
  if (!item) return;
  if (!S.liveItem) return goLive(item, dir > 0 ? 0 : item.slides.length - 1);
  const next = S.liveIndex + dir;
  if (next >= 0 && next < item.slides.length) return goLive(item, next);
  const n = neighbourShowItem(dir);                    // roll into the next/previous service item
  if (n) { select(n, { scroll: false }); return goLive(n, dir > 0 ? 0 : n.slides.length - 1); }
}

export function toggle(key) {
  const v = !S.live[key];
  S.live[key] = v;
  scc.live.set({ [key]: v });
  renderQuick(); renderPreviews(); syncRemote();
}
export function clearAll() {
  S.liveItem = null; S.liveIndex = -1; S.liveShowItem = null;
  const patch = { slide: null, next: null, item: { title: "", index: -1, count: 0 }, background: backgroundFor(null, null), audio: null, blackout: false, clear: false, logo: false };
  S.live = { ...S.live, ...patch };
  scc.live.set(patch);
  renderLiveMarks(); renderPreviews(); renderQuick(); syncRemote();
}

function syncRemote() {
  const item = S.liveItem || S.selected;
  scc.remote.setView({ title: item?.title || "", index: S.liveItem ? S.liveIndex : -1, slides: (item?.slides || []).map((s) => ({ label: s.label, text: s.text || (s.kind === "media" ? `[${s.media?.type}] ${s.label}` : "") })) }).catch(() => {});
}

// ── Selection & slide grid ────────────────────────────────────────────────────────────────────
export function select(item, { scroll = true, showItemId = null } = {}) {
  S.selected = item; S.selectedShowItem = showItemId || item?.showItemId || null; S.cursor = -1;
  renderCenter(); renderServiceMarks(); renderLibraryMarks(); syncRemote();
  if (scroll) $("slides").scrollTop = 0;
}

const thumbViews = new Set();
function thumbState(slide) {
  const bg = backgroundFor(null, slide);
  return { slide: slide.kind === "media" ? null : slideOut(slide), themeId: S.live.themeId || S.settings.themeId, themes: S.settings.customThemes || [], background: bg };
}
// Slides are drawn only when they scroll into view, so long songs and big services stay fast on older laptops.
const lazy = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { lazy.unobserve(e.target); const s = e.target._slide; delete e.target._slide; if (s) renderThumb(e.target, s); }
}, { rootMargin: "300px" }) : null;
function lazyThumb(el, slide) { if (!lazy) return requestAnimationFrame(() => renderThumb(el, slide)); el._slide = slide; lazy.observe(el); }
export function renderThumb(host, slide) {
  const v = createView(host, { mediaUrl, muted: true, calm: true });
  v.update(thumbState(slide));
  thumbViews.add(v);
  return v;
}

function renderCenter() {
  for (const v of thumbViews) v.destroy();
  thumbViews.clear();
  const head = $("centerHead"), grid = $("slides");
  const item = S.selected;
  head.replaceChildren();
  grid.replaceChildren();
  if (!item) {
    head.append(h("h1", "Welcome"));
    grid.append(h("div.placeholder", h("div",
      h("h3", "Pick something to show"),
      h("div", "Choose a song, Bible passage, picture or video on the left. Click a slide to put it on screen."),
      h("div.row",
        h("button.btn.primary", { onclick: () => newSong() }, icon("plus"), "New song"),
        h("button.btn", { onclick: () => importSongs() }, icon("download"), "Import songs"),
        h("button.btn", { onclick: () => toggleScreen("output") }, icon("monitor"), "Show output")))));
    return;
  }
  head.append(...[
    h("h1", item.title, item.sub ? h("span.sub", item.sub) : null),
    h("div.zoom", { title: "Slide size" }, icon("image"), h("input", { type: "range", min: 150, max: 380, value: S.settings.thumb || 220, oninput: (e) => { grid.style.setProperty("--thumb", `${e.target.value}px`); }, onchange: (e) => scc.lib.setSettings({ thumb: Number(e.target.value) }).then((s) => { S.settings = s; }) })),
    item.type === "song" ? h("button.btn.small", { onclick: () => editSong(item.songId) }, icon("edit"), "Edit") : null,
    item.type === "text" && item.showItemId ? h("button.btn.small", { onclick: () => editTextItem(item.showItemId) }, icon("edit"), "Edit") : null,
    !item.showItemId ? h("button.btn.small.primary", { onclick: () => addToShow(item) }, icon("plus"), "Add to service") : null,
  ].filter(Boolean));
  grid.style.setProperty("--thumb", `${S.settings.thumb || 220}px`);
  item.slides.forEach((slide, i) => {
    const thumb = h("div.thumb");
    const card = h("button.slide", { type: "button", dataset: { i }, title: slide.kind === "media" ? slide.label : slide.text,
      onclick: () => goLive(item, i) },
      thumb,
      h("div.meta", h("i", { style: { background: colorFor(slide) } }), h("span.lbl", slide.label || `Slide ${i + 1}`), h("span.n", String(i + 1))));
    grid.append(card);
    if (slide.kind === "media" && slide.media) {
      const m = slide.media;
      thumb.append(m.type === "image" ? h("img", { src: mediaUrl(m.id), alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } })
        : m.type === "video" ? h("video", { src: mediaUrl(m.id) + "#t=1", muted: true, preload: "metadata", style: { width: "100%", height: "100%", objectFit: "cover" } })
          : h("div", { style: { display: "grid", placeItems: "center", height: "100%", color: "#8d96a7" } }, icon("volume"), h("span", { style: { marginTop: "6px" } }, "Audio — click to play")));
    } else lazyThumb(thumb, slide);
  });
  renderLiveMarks();
}

function renderLiveMarks() {
  const sameItem = S.liveItem && S.selected && S.liveItem.key === S.selected.key && (S.liveItem.showItemId || null) === (S.selected.showItemId || null);
  for (const el of document.querySelectorAll("#slides .slide")) {
    el.classList.toggle("live", !!sameItem && Number(el.dataset.i) === S.liveIndex);
    el.classList.toggle("cursor", Number(el.dataset.i) === S.cursor);
  }
  renderServiceMarks();
}
function scrollToLive() { document.querySelector("#slides .slide.live")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }

// ── Previews ──────────────────────────────────────────────────────────────────────────────────
let liveView, nextView;
function renderPreviews() {
  liveView ||= createView($("livePreview"), { mediaUrl, muted: true, animate: true });
  nextView ||= createView($("nextPreview"), { mediaUrl, muted: true, calm: true });
  const base = { themeId: S.live.themeId || S.settings.themeId, themes: S.settings.customThemes || [], logoSrc: S.settings.logoSrc };
  liveView.update({ ...S.live, ...base });
  nextView.update({ ...base, slide: S.live.next, background: S.live.background });
  $("liveLabel").textContent = S.live.blackout ? "Black screen" : S.live.logo ? "Logo" : S.liveItem ? `${S.liveItem.title} · ${S.live.slide?.label || ""}` : "Nothing showing";
  $("nextLabel").textContent = S.live.next?.label || "";
  renderMediaControls();
}

function renderMediaControls() {
  const box = $("mediaControls");
  const vid = S.live.background?.type === "video" && S.live.background.muted === false;
  const aud = S.live.audio?.src;
  box.hidden = !vid && !aud;
  box.replaceChildren();
  const cmd = (action) => scc.live.set({ videoCmd: { action, at: Date.now() } });
  if (vid) box.append(icon("play"), h("span.grow", S.liveItem?.title || "Video"),
    h("button.icon-btn", { title: "Play", onclick: () => cmd("play") }, icon("play")),
    h("button.icon-btn", { title: "Pause", onclick: () => cmd("pause") }, icon("pause")),
    h("button.icon-btn", { title: "From the start", onclick: () => cmd("restart") }, icon("restart")));
  if (aud) {
    const a = S.live.audio;
    const set = (p) => { S.live.audio = { ...a, ...p }; scc.live.set({ audio: S.live.audio }); renderMediaControls(); };
    box.append(icon("volume"), h("span.grow", a.name || "Audio"),
      h("button.icon-btn", { title: a.paused ? "Play" : "Pause", onclick: () => set({ paused: !a.paused }) }, icon(a.paused ? "play" : "pause")),
      h("input", { type: "range", min: 0, max: 1, step: 0.05, value: a.volume ?? 1, title: "Volume", oninput: debounce((e) => set({ volume: Number(e.target.value) }), 60) }),
      h("button.icon-btn", { title: "Stop", onclick: () => { S.live.audio = null; scc.live.set({ audio: null }); renderMediaControls(); } }, icon("stop")));
  }
}

function renderQuick() {
  $("btnBlack").classList.toggle("on", !!S.live.blackout);
  $("btnClear").classList.toggle("on", !!S.live.clear);
  $("btnLogo").classList.toggle("on", !!S.live.logo);
  $("btnOutput").classList.toggle("on", S.screens.output);
  $("btnStage").classList.toggle("on", S.screens.stage);
}

function renderLook() {
  const ts = $("themeSelect");
  ts.replaceChildren(...[...(S.settings.customThemes || []), ...THEMES].map((t) => h("option", { value: t.id }, t.name)));
  ts.value = S.live.themeId || S.settings.themeId || "classic";
  const bs = $("bgSelect");
  const mine = S.media.filter((m) => m.type !== "audio");
  bs.replaceChildren(h("option", { value: "" }, "From the look"),
    h("optgroup", { label: "Moving backgrounds" }, ...Object.entries(MOTION).map(([k, m]) => h("option", { value: `motion:${k}` }, m.name))),
    mine.length ? h("optgroup", { label: "Your pictures & videos" }, ...mine.map((m) => h("option", { value: m.id }, `${m.type === "video" ? "▶ " : ""}${m.name}`))) : h("optgroup", { label: "Add pictures in Media" }));
  bs.value = S.settings.backgroundId || "";
}

// ── Service (show) panel ─────────────────────────────────────────────────────────────────────
function renderShowSelect() {
  const sel = $("showSelect");
  sel.replaceChildren(...S.shows.map((s) => h("option", { value: s.id }, `${s.shared ? "⇄ " : ""}${s.title}`)));
  sel.value = S.showId;
}
function renderService() {
  const show = currentShow(), list = $("serviceList");
  list.replaceChildren();
  if (!show?.items.length) {
    list.append(h("li.empty", h("div", h("b", "Your service is empty."), h("br"), "Drag songs, scriptures or media here, or use “Add to service”.")));
    return;
  }
  show.items.forEach((si, idx) => {
    const kindIcon = { song: "music", scripture: "book", media: "image", text: "text", header: "list" }[si.type] || "list";
    const it = si.type === "header" ? null : itemFromShowItem(si);
    const title = si.type === "header" ? si.title : it?.title || (si.type === "song" ? "Missing song" : "Missing media");
    const li = h(`li${si.type === "header" ? ".header" : ""}`, { draggable: true, dataset: { id: si.id, idx } },
      h("span.k", icon(kindIcon)), h("span.t", title),
      h("button.icon-btn.x", { title: "Remove from service", onclick: (e) => { e.stopPropagation(); removeShowItem(si.id); } }, icon("x")));
    if (it) {
      li.addEventListener("click", () => select(it));
      li.addEventListener("dblclick", () => goLive(it, 0));
    } else if (si.type === "header") li.addEventListener("dblclick", async () => { const t = await askText("Rename section", { value: si.title }); if (t) { si.title = t; saveShow(show); } });
    li.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/scc-move", si.id); e.dataTransfer.effectAllowed = "move"; });
    list.append(li);
  });
  renderServiceMarks();
}
function renderServiceMarks() {
  for (const li of document.querySelectorAll("#serviceList li[data-id]")) {
    li.classList.toggle("sel", li.dataset.id === S.selectedShowItem);
    li.classList.toggle("live", li.dataset.id === S.liveShowItem && !!S.liveItem);
  }
}

async function saveShow(show) {
  show.updatedAt = Date.now();
  await scc.lib.upsert("shows", show);
  renderService(); renderShowSelect();
}
export async function addToShow(item, atIndex = null) {
  const show = currentShow(); if (!show) return;
  let si;
  if (item.type === "song") si = { id: newId(), type: "song", songId: item.songId };
  else if (item.type === "media") si = { id: newId(), type: "media", mediaId: item.mediaId };
  else if (item.type === "scripture") si = { id: newId(), type: "scripture", reference: item.ref, translation: item.translation, slides: item.slides };
  else if (item.type === "text") si = { id: newId(), type: "text", title: item.title, slides: item.slides };
  else if (item.type === "header") si = { id: newId(), type: "header", title: item.title };
  if (!si) return;
  if (atIndex == null || atIndex < 0) show.items.push(si); else show.items.splice(atIndex, 0, si);
  await saveShow(show);
  if (si.type !== "header") { const it = itemFromShowItem(si); if (it && S.selected?.key === it.key && !S.selected.showItemId) select(it, { scroll: false }); }
  toast(`Added “${item.title}” to the service`, "ok", 1800);
}
async function removeShowItem(id) {
  const show = currentShow();
  show.items = show.items.filter((x) => x.id !== id);
  if (S.selectedShowItem === id) { S.selected = null; renderCenter(); }
  await saveShow(show);
}

function wireServiceDnD() {
  const list = $("serviceList");
  const targetIdx = (e) => { const li = e.target.closest("li[data-idx]"); return li ? Number(li.dataset.idx) : currentShow().items.length; };
  list.addEventListener("dragover", (e) => {
    if (![...e.dataTransfer.types].some((t) => t === "text/scc-move" || t === "text/scc-item")) return;
    e.preventDefault(); list.classList.add("drop");
    for (const li of list.querySelectorAll(".drag-over")) li.classList.remove("drag-over");
    e.target.closest("li[data-idx]")?.classList.add("drag-over");
  });
  list.addEventListener("dragleave", (e) => { if (!list.contains(e.relatedTarget)) { list.classList.remove("drop"); for (const li of list.querySelectorAll(".drag-over")) li.classList.remove("drag-over"); } });
  list.addEventListener("drop", async (e) => {
    list.classList.remove("drop");
    const to = targetIdx(e);
    const moveId = e.dataTransfer.getData("text/scc-move");
    const show = currentShow();
    if (moveId) {
      e.preventDefault();
      const from = show.items.findIndex((x) => x.id === moveId);
      if (from < 0) return;
      const [it] = show.items.splice(from, 1);
      show.items.splice(from < to ? to - 1 : to, 0, it);
      return saveShow(show);
    }
    const raw = e.dataTransfer.getData("text/scc-item");
    if (raw) { e.preventDefault(); const item = dragItems.get(raw); if (item) addToShow(item, to); }
  });
}
const dragItems = new Map();
function draggable(el, item) {
  el.draggable = true;
  el.addEventListener("dragstart", (e) => { const k = newId(); dragItems.set(k, item); e.dataTransfer.setData("text/scc-item", k); e.dataTransfer.effectAllowed = "copy"; });
}

// ── Library ──────────────────────────────────────────────────────────────────────────────────
function renderLibrary() {
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === S.tab);
  const body = $("libBody");
  body.replaceChildren();
  ({ songs: renderSongs, bible: renderBible, media: renderMedia, text: renderTextTab })[S.tab](body);
}
function searchBox(placeholder, onInput) {
  const input = h("input.input", { type: "search", placeholder, value: S.query, oninput: debounce((e) => { S.query = e.target.value; onInput(); }, 120) });
  return h("label.search", icon("search"), input);
}

function renderSongs(body) {
  const list = h("ul.lib-list");
  const draw = () => {
    const q = S.query.trim().toLowerCase();
    const songs = q ? S.songs.filter((s) => s.title.toLowerCase().includes(q) || (s.author || "").toLowerCase().includes(q) || s.sections.some((x) => x.text.toLowerCase().includes(q))) : S.songs;
    list.replaceChildren(...songs.map((s) => {
      const li = h("li", { dataset: { key: `song:${s.id}` }, title: s.author || "" },
        icon("music"), h("span.t", s.title), h("span.s", s.ccli ? `CCLI ${s.ccli}` : ""),
        h("span.acts",
          h("button.icon-btn", { title: "Add to service", onclick: (e) => { e.stopPropagation(); addToShow(songItem(s)); } }, icon("plus")),
          h("button.icon-btn", { title: "Edit", onclick: (e) => { e.stopPropagation(); editSong(s.id); } }, icon("edit")),
          h("button.icon-btn.danger", { title: "Delete", onclick: (e) => { e.stopPropagation(); deleteSong(s); } }, icon("trash"))));
      li.addEventListener("click", () => select(songItem(s)));
      li.addEventListener("dblclick", () => editSong(s.id));
      draggable(li, songItem(s));
      return li;
    }));
    if (!songs.length) list.append(h("li.lib-empty", q ? "No songs match." : h("div", "No songs yet.", h("br"), "Create one, or import from FreeShow, OpenLP / OpenLyrics or text files.")));
    renderLibraryMarks();
  };
  body.append(h("div.lib-tools", searchBox("Search songs and lyrics", draw),
    h("button.icon-btn", { title: "New song (Ctrl+N)", onclick: () => newSong() }, icon("plus")),
    h("button.icon-btn", { title: "Import songs (Ctrl+I)", onclick: () => importSongs() }, icon("download"))), list);
  draw();
}

function renderBible(body) {
  const ref = h("input.input", { placeholder: "e.g. John 3:16-18 or Ps 23", value: S.bibleQuery || "", autofocus: true });
  const tr = h("select", { "aria-label": "Translation", style: { width: "92px" } }, ...S.translations.map((t) => h("option", { value: t.id, title: t.name }, t.id.toUpperCase())));
  tr.value = S.settings.translation || "kjv";
  const go = h("button.btn.primary", { type: "submit" }, "Show");
  const form = h("form.lib-section", { onsubmit: async (e) => {
    e.preventDefault();
    const q = ref.value.trim(); if (!q) return;
    S.bibleQuery = q;
    go.classList.add("busy"); go.disabled = true;
    try {
      const r = await scc.bible.lookup(q, tr.value);
      const slides = scriptureSlides(r.ref, r.verses, { translation: r.translation });
      const item = scriptureItem({ reference: r.reference, translation: r.translation, slides });
      select(item);
      remember(r.reference);
      if (tr.value !== S.settings.translation) S.settings = await scc.lib.setSettings({ translation: tr.value });
    } catch (err) { toast(err.message, "error"); }
    finally { go.classList.remove("busy"); go.disabled = false; }
  } }, h("h4", "Find a passage"), h("div", { style: { display: "flex", gap: "6px" } }, ref, tr), go);
  const recent = (S.settings.recentRefs || []).slice(0, 8);
  const topic = h("input.input", { placeholder: "A topic, e.g. hope in hard times" });
  const topicBtn = h("button.btn", { type: "submit" }, icon("spark"), "Suggest verses");
  const results = h("div.results");
  const topicForm = h("form.lib-section", { onsubmit: async (e) => {
    e.preventDefault(); if (!topic.value.trim()) return;
    topicBtn.classList.add("busy");
    try {
      const r = await scc.ai.scriptures(topic.value);
      results.replaceChildren(...r.items.map((x) => h("button.result", { type: "button", onclick: () => { ref.value = x.ref; form.requestSubmit(); } }, h("div.t", h("b", x.ref), h("span", x.why)), icon("chev"))));
      if (!r.ai) results.append(h("div.hint", "Built-in suggestions. Add an AI key in Settings for smarter results."));
    } catch (err) { toast(err.message, "error"); }
    finally { topicBtn.classList.remove("busy"); }
  } }, h("h4", "By topic"), topic, topicBtn, results);
  body.append(...[form,
    recent.length ? h("div.lib-section", h("h4", "Recent"), h("div.chips", ...recent.map((r) => h("button.chip", { type: "button", onclick: () => { ref.value = r; form.requestSubmit(); } }, r)))) : null,
    topicForm,
    h("div.lib-section", h("div.hint", "Public-domain translations (KJV, WEB, ASV, BBE, YLT). Passages you've opened work offline."))].filter(Boolean));
}

function renderMedia(body) {
  const grid = h("div.media-grid");
  const draw = () => {
    const q = S.query.trim().toLowerCase();
    const items = q ? S.media.filter((m) => m.name.toLowerCase().includes(q)) : S.media;
    grid.replaceChildren(...items.map((m) => {
      const tile = h(`div.media-tile${m.type === "audio" ? ".audio" : ""}`, { dataset: { key: `media:${m.id}` }, title: `${m.name} — click to preview, double-click to show` },
        m.type === "image" ? h("img", { src: mediaUrl(m.id), alt: "", loading: "lazy" })
          : m.type === "video" ? h("video", { src: mediaUrl(m.id) + "#t=1", muted: true, preload: "metadata" })
            : icon("volume"),
        h("span.badge", m.type), h("span.cap", m.name));
      tile.addEventListener("click", () => select(mediaItem(m)));
      tile.addEventListener("dblclick", () => goLive(mediaItem(m), 0));
      tile.addEventListener("contextmenu", (e) => { e.preventDefault(); mediaMenu(m); });
      draggable(tile, mediaItem(m));
      return tile;
    }));
    if (!items.length) grid.append(h("div.lib-empty", { style: { gridColumn: "1/-1" } }, q ? "Nothing matches." : h("div", "Add pictures, videos and audio — or drag files onto the window.", h("br"), "Right-click a picture to use it as the background or logo.")));
    renderLibraryMarks();
  };
  body.append(h("div.lib-tools", searchBox("Search media", draw), h("button.icon-btn", { title: "Add media", onclick: addMedia }, icon("plus"))), grid);
  draw();
}
function mediaMenu(m) {
  const close = () => mm.close();
  const mm = modal({ title: m.name, width: 380, body: h("div", { style: { display: "grid", gap: "8px" } },
    m.type !== "audio" ? h("button.btn", { onclick: async () => { S.settings = await scc.lib.setSettings({ backgroundId: m.id }); renderLook(); refreshBackground(); close(); toast("Background set", "ok"); } }, "Use as background behind words") : null,
    m.type === "image" ? h("button.btn", { onclick: async () => { S.settings = await scc.lib.setSettings({ logoSrc: m.id }); renderPreviews(); close(); toast("Logo set — press L to show it", "ok"); } }, "Use as church logo") : null,
    h("button.btn", { onclick: () => { addToShow(mediaItem(m)); close(); } }, "Add to service"),
    h("button.btn", { onclick: () => { scc.media.reveal(m.id); close(); } }, "Show file on computer"),
    h("button.btn.danger", { onclick: async () => { close(); if (await confirmBox(`Remove “${m.name}” from the library?`, { detail: "The file stays on your computer." })) { await scc.lib.remove("media", m.id); await reload(["media"]); renderLook(); } } }, "Remove from library")) });
}
async function addMedia(paths) {
  const added = await scc.media.add(Array.isArray(paths) ? paths : undefined);
  if (added.length) { await reload(["media"]); renderLook(); toast(`Added ${plural(added.length, "file")}`, "ok"); }
}

function renderTextTab(body) {
  body.append(h("div.lib-section",
    h("h4", "Words on screen"),
    h("button.btn.primary", { onclick: () => newTextItem() }, icon("text"), "New text slides"),
    h("div.hint", "Announcements, sermon points, quotes or a welcome message. Each paragraph becomes a slide."),
    h("h4", "Sermon notes"),
    h("button.btn", { onclick: () => newTextItem({ sermon: true }) }, icon("spark"), "Turn sermon notes into slides"),
    h("div.hint", "Paste your notes. Points become slides and Bible references become scripture slides."),
    h("h4", "Service sections"),
    h("div.chips", ...["Pre-service", "Worship", "Announcements", "Offering", "Word", "Ministry", "Closing"].map((t) => h("button.chip", { onclick: () => addToShow({ type: "header", title: t }) }, `+ ${t}`)))));
}

function renderLibraryMarks() {
  const key = S.selected && !S.selected.showItemId ? S.selected.key : null;
  for (const el of document.querySelectorAll("#libBody [data-key]")) el.classList.toggle("sel", el.dataset.key === key);
}

// ── Songs ─────────────────────────────────────────────────────────────────────────────────────
export async function newSong(prefill) {
  const song = await openSongEditor(prefill || null);
  if (song) { await reload(["songs"]); select(songItem(S.songs.find((s) => s.id === song.id) || song)); }
}
async function editSong(id) {
  const song = S.songs.find((s) => s.id === id); if (!song) return;
  const saved = await openSongEditor(song);
  if (saved) {
    await reload(["songs"]);
    const fresh = S.songs.find((s) => s.id === id);
    if (fresh && S.selected?.songId === id) select({ ...songItem(fresh), showItemId: S.selected.showItemId }, { scroll: false });
    if (fresh && S.liveItem?.songId === id) S.liveItem = { ...songItem(fresh), showItemId: S.liveItem.showItemId };
  }
}
async function deleteSong(s) {
  if (!(await confirmBox(`Delete “${s.title}”?`, { detail: "It will also be removed from any service that uses it." }))) return;
  await scc.lib.remove("songs", s.id);
  for (const show of S.shows) if (show.items.some((i) => i.songId === s.id)) { show.items = show.items.filter((i) => i.songId !== s.id); await scc.lib.upsert("shows", show); }
  if (S.selected?.songId === s.id) { S.selected = null; }
  await reload(["songs", "shows"]);
}

export async function importSongFiles(files) {
  let n = 0; const errors = [];
  for (const f of files) {
    try {
      let song;
      if (f.ext === ".show" || (f.ext === ".json" && /"slides"/.test(f.text))) song = importFreeShow(f.text);
      else if (f.ext === ".xml" || /<song[\s>]/.test(f.text)) song = importOpenLyrics(f.text);
      else if (f.ext === ".sccshow") { await importShowText(f.text); continue; }
      else song = importPlainText(f.text, f.name.replace(/\.[^.]+$/, ""));
      if (!song.sections.length) throw new Error("no lyrics found");
      await scc.lib.upsert("songs", song); n++;
    } catch (err) { errors.push(`${f.name}: ${err.message}`); }
  }
  await reload(["songs"]);
  if (n) toast(`Imported ${plural(n, "song")}`, "ok");
  if (errors.length) toast(`Couldn't import ${errors.length}: ${errors.slice(0, 2).join("; ")}`, "error", 6000);
}
export async function importSongs() { openImport(); }

// ── Text items ────────────────────────────────────────────────────────────────────────────────
async function newTextItem(opts = {}) {
  const t = await openTextEditor(null, opts);
  if (!t) return;
  const item = textItem({ ...t, id: newId() });
  await addToShow(item);
  const show = currentShow();
  const si = show.items.at(-1);
  select(itemFromShowItem(si));
}
async function editTextItem(showItemId) {
  const show = currentShow();
  const si = show.items.find((x) => x.id === showItemId);
  const t = await openTextEditor(si);
  if (!t) return;
  si.title = t.title; si.slides = t.slides;
  await saveShow(show);
  select(itemFromShowItem(si), { scroll: false });
}

// ── Shows ─────────────────────────────────────────────────────────────────────────────────────
async function switchShow(id) {
  S.showId = id;
  S.settings = await scc.lib.setSettings({ lastShowId: id });
  renderService();
}
async function newShow() {
  const title = await askText("New service", { value: defaultShowTitle(), ok: "Create" });
  if (!title) return;
  const show = await scc.lib.upsert("shows", { id: newId(), title, date: new Date().toISOString().slice(0, 10), items: [] });
  await reload(["shows"]);
  await switchShow(show.id); renderShowSelect();
}
function showMenu() {
  const show = currentShow();
  const m = modal({ title: show.title, width: 420, body: h("div", { style: { display: "grid", gap: "8px" } },
    h("button.btn", { onclick: async () => { m.close(); const t = await askText("Rename service", { value: show.title }); if (t) { show.title = t; saveShow(show); } } }, icon("edit"), "Rename"),
    h("button.btn", { onclick: async () => { m.close(); const r = await scc.shows.exportFile(show.id); if (r) toast(r.skipped ? `Saved. ${plural(r.skipped, "large video")} left out — share those separately.` : "Saved. Send the .sccshow file to anyone with SCC Presenter.", "ok", 5000); } }, icon("upload"), "Save as a file to share"),
    h("label.check.callout", h("input", { type: "checkbox", checked: !!show.shared, onchange: async (e) => { show.shared = e.target.checked; await saveShow(show); toast(show.shared ? "Shared on your network. Others can receive it with your address and PIN (see Connect)." : "No longer shared", "ok", 4500); } }), h("span", h("b", "Share on this network"), h("br"), h("span.muted", "Other computers running SCC Presenter can download it."))),
    h("button.btn", { onclick: async () => { m.close(); const copy = await scc.lib.upsert("shows", { ...structuredClone(show), id: newId(), title: `${show.title} (copy)`, shared: false }); await reload(["shows"]); switchShow(copy.id); renderShowSelect(); } }, "Duplicate"),
    h("button.btn.danger", { onclick: async () => { m.close(); if (S.shows.length < 2) return toast("Keep at least one service.", "error"); if (await confirmBox(`Delete “${show.title}”?`, { detail: "Songs and media stay in your library." })) { await scc.lib.remove("shows", show.id); S.showId = null; await reload(["shows"]); await switchShow(S.shows[0].id); renderShowSelect(); } } }, icon("trash"), "Delete service")) });
}
export async function importShowText(text) {
  try {
    const r = await scc.shows.importText(text);
    await reload(["songs", "shows", "media"]);
    await switchShow(r.show.id); renderShowSelect(); renderLook();
    toast(`Opened “${r.show.title}”${r.skipped ? ` (${plural(r.skipped, "file")} not included)` : ""}`, "ok");
  } catch (err) { toast(err.message, "error"); }
}

// ── Screens ───────────────────────────────────────────────────────────────────────────────────
export async function toggleScreen(kind) {
  const on = kind === "output" ? S.screens.output : S.screens.stage;
  if (on) return scc.screens.close(kind);
  const r = await scc.screens.open(kind);
  if (!r?.count) return toast(kind === "stage" ? "No stage screen is set up. Add one in Settings → Screens." : "All outputs are switched off. Turn one on in Settings → Screens.", "info", 5000);
  if (r?.windowed) toast(`${kind === "output" ? "Output" : "Stage screen"} opened in a window. Plug in a projector or TV and it goes full screen there.`, "info", 5200);
}

function refreshBackground() {
  const bg = backgroundFor(S.liveItem, S.liveItem?.slides[S.liveIndex]);
  S.live.background = bg; scc.live.set({ background: bg }); renderPreviews();
  renderCenter();
}

// ── Stage tools ──────────────────────────────────────────────────────────────────────────────
function wireStageTools() {
  const sendMsg = () => { const v = $("stageMsg").value.trim(); scc.live.set({ stageMessage: v }); $("btnMsg").textContent = v ? "Clear" : "Send"; if (!v) $("stageMsg").value = ""; };
  $("btnMsg").addEventListener("click", () => { if (S.live.stageMessage) { $("stageMsg").value = ""; scc.live.set({ stageMessage: "" }); S.live.stageMessage = ""; $("btnMsg").textContent = "Send"; } else { sendMsg(); S.live.stageMessage = $("stageMsg").value.trim(); } });
  $("stageMsg").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendMsg(); S.live.stageMessage = $("stageMsg").value.trim(); } });
  $("btnTimer").addEventListener("click", () => {
    const t = S.live.timer;
    if (t && !t.paused) { const timer = { ...t, paused: true, left: t.endsAt - Date.now() }; S.live.timer = timer; scc.live.set({ timer }); }
    else if (t?.paused) { const timer = { ...t, paused: false, endsAt: Date.now() + t.left }; S.live.timer = timer; scc.live.set({ timer }); }
    else { const mins = Math.max(1, Number($("timerMin").value) || 30); const timer = { endsAt: Date.now() + mins * 60000, paused: false }; S.live.timer = timer; scc.live.set({ timer }); }
    tickTimer();
  });
  $("btnTimerReset").addEventListener("click", () => { S.live.timer = null; scc.live.set({ timer: null }); tickTimer(); });
  setInterval(tickTimer, 500);
}
function tickTimer() {
  const t = S.live.timer, out = $("timerOut");
  $("btnTimer").textContent = !t ? "Start" : t.paused ? "Resume" : "Pause";
  if (!t) { out.textContent = ""; return; }
  const ms = t.paused ? t.left : t.endsAt - Date.now();
  const s = Math.abs(Math.round(ms / 1000));
  out.textContent = `${ms < 0 ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  out.classList.toggle("over", ms < 0);
}

// ── Keyboard ──────────────────────────────────────────────────────────────────────────────────
function wireKeys() {
  document.addEventListener("keydown", (e) => {
    if (modalOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) { if (e.key === "Escape") document.activeElement.blur(); return; }
    const k = e.key;
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(k)) { e.preventDefault(); step(1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(k)) { e.preventDefault(); step(-1); }
    else if (k === "Home" && (S.liveItem || S.selected)) { e.preventDefault(); goLive(S.liveItem || S.selected, 0); }
    else if (k === "End" && (S.liveItem || S.selected)) { e.preventDefault(); const it = S.liveItem || S.selected; goLive(it, it.slides.length - 1); }
    else if (k === "b" || k === "B" || k === ".") toggle("blackout");
    else if (k === "c" || k === "C") toggle("clear");
    else if (k === "l" || k === "L") toggle("logo");
    else if (k === "Escape") clearAll();
    else if (/^[1-9]$/.test(k) && S.selected) { const i = Number(k) - 1; if (S.selected.slides[i]) goLive(S.selected, i); }
    else if (k === "Enter" && S.selected) goLive(S.selected, Math.max(0, S.cursor));
    else if (k === "?") openShortcuts();
  });
}

// ── Drag & drop files onto the window ─────────────────────────────────────────────────────────
function wireFileDrop() {
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  addEventListener("dragenter", (e) => { if (hasFiles(e)) { depth++; document.body.classList.add("dragging"); } });
  addEventListener("dragleave", (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; document.body.classList.remove("dragging"); } });
  addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; document.body.classList.remove("dragging");
    const files = [...e.dataTransfer.files];
    const mediaPaths = [], songFiles = [];
    for (const f of files) {
      const ext = (f.name.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
      if (/^\.(png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov|m4v|mkv|mp3|wav|ogg|m4a|aac|flac)$/.test(ext)) { const p = scc.media.pathFor(f); if (p) mediaPaths.push(p); }
      else if (ext === ".sccshow") await importShowText(await f.text());
      else if ([".show", ".xml", ".txt", ".json"].includes(ext)) songFiles.push({ name: f.name, ext, text: await f.text() });
    }
    if (mediaPaths.length) { await addMedia(mediaPaths); if (S.tab !== "media") { S.tab = "media"; renderLibrary(); } }
    if (songFiles.length) importSongFiles(songFiles);
  });
}

// ── Updates ───────────────────────────────────────────────────────────────────────────────────
function renderUpdate(u) {
  const bar = $("updateBar");
  const show = u && (u.status === "ready" || u.status === "available");
  bar.hidden = !show; document.body.classList.toggle("has-update", !!show);
  if (!show) return;
  bar.replaceChildren(icon("download"), h("span.grow", u.message),
    h("button.btn.small.primary", { onclick: () => scc.updates.install() }, u.status === "ready" ? "Restart now" : "Download"),
    h("button.icon-btn", { title: "Later", onclick: () => { bar.hidden = true; document.body.classList.remove("has-update"); } }, icon("x")));
}

// ── Remote commands from the phone ────────────────────────────────────────────────────────────
function onRemote(cmd) {
  if (cmd.action === "next") step(1);
  else if (cmd.action === "prev") step(-1);
  else if (cmd.action === "go") { const it = S.liveItem || S.selected; if (it) goLive(it, Number(cmd.index) || 0, { fromRemote: true }); }
  else if (cmd.action === "black") toggle("blackout");
  else if (cmd.action === "clear") toggle("clear");
  else if (cmd.action === "logo") toggle("logo");
}

// ── Menu commands ─────────────────────────────────────────────────────────────────────────────
function onMenu(cmd) {
  if (modalOpen() && !["settings", "shortcuts"].includes(cmd)) return;
  ({
    "new-song": () => newSong(), "new-show": newShow, "import-songs": importSongs,
    "import-show": async () => { const f = await scc.files.open("show"); for (const x of f) await importShowText(x.text); },
    "receive-lan": () => openReceive(), settings: () => openSettings(), shortcuts: openShortcuts,
    updates: () => openSettings("updates"), "toggle-output": () => toggleScreen("output"), "toggle-stage": () => toggleScreen("stage"), "clear-all": clearAll,
  })[cmd]?.();
}

function renderAll() {
  renderShowSelect(); renderService(); renderLibrary(); renderLook(); renderQuick(); renderPreviews();
  if (S.selected?.type === "song") { const s = S.songs.find((x) => x.id === S.selected.songId); if (!s) S.selected = null; }
}


// ── Sound & music panel ─────────────────────────────────────────────────────────────────────
let speakers = [];
export async function listDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const name = (d, i, what) => d.label || `${what} ${i + 1}`;
    const outs = all.filter((d) => d.kind === "audiooutput"), ins = all.filter((d) => d.kind === "audioinput"), cams = all.filter((d) => d.kind === "videoinput");
    return { outputs: outs.map((d, i) => ({ id: d.deviceId, label: name(d, i, "Speaker") })), inputs: ins.map((d, i) => ({ id: d.deviceId, label: name(d, i, "Microphone") })), cameras: cams.map((d, i) => ({ id: d.deviceId, label: name(d, i, "Camera") })) };
  } catch { return { outputs: [], inputs: [], cameras: [] }; }
}
async function refreshDevices() {
  const d = await listDevices();
  speakers = d.outputs;
  const st = $("setupChip");
  const nOut = d.outputs.filter((o) => o.id !== "default" && o.id !== "communications").length || d.outputs.length;
  const nScr = S.screens.displays.length;
  if (st) { st.querySelector("span").textContent = `${nScr} ${nScr === 1 ? "screen" : "screens"}`; st.title = `${nScr} screens · ${nOut} speakers — screens, speakers and this computer`; }
  renderSound();
}
function renderSound() {
  const box = $("soundPanel"); if (!box) return;
  const pad = S.live.pad || null;
  const sp = $("speakerSelect");
  if (sp && document.activeElement !== sp) {
    sp.replaceChildren(...(speakers.length ? speakers : [{ id: "", label: "Default speaker" }]).map((o) => h("option", { value: o.id === "default" ? "" : o.id }, o.label)));
    sp.value = S.live.audioSink || "";
  }
  const ps = $("presetSelect"); if (ps && !ps.options.length) ps.replaceChildren(...Object.entries(SOUND_PRESETS).map(([k, v]) => h("option", { value: k }, v.name)));
  if (ps) ps.value = S.live.soundPreset || "natural";
  const ks = $("padKey"); if (ks && !ks.options.length) ks.replaceChildren(...KEYS.map((k) => h("option", { value: k }, `Key of ${k}`)));
  if (ks && pad?.key) ks.value = pad.key;
  const pb = $("btnPad"); if (pb) { pb.classList.toggle("on", !!pad?.key); pb.replaceChildren(icon(pad?.key ? "stop" : "play"), h("span", pad?.key ? "Stop pad" : "Play pad")); }
  const pv = $("padVol"); if (pv && document.activeElement !== pv) pv.value = pad?.volume ?? S.settings.padVolume ?? 0.6;
}
function wireSound() {
  const setLive = (patch) => { Object.assign(S.live, patch); scc.live.set(patch); renderSound(); };
  $("speakerSelect").addEventListener("change", async (e) => { setLive({ audioSink: e.target.value }); S.settings = await scc.lib.setSettings({ audioSink: e.target.value }); });
  $("presetSelect").addEventListener("change", async (e) => { setLive({ soundPreset: e.target.value }); S.settings = await scc.lib.setSettings({ soundPreset: e.target.value }); });
  $("btnPad").addEventListener("click", () => {
    const on = S.live.pad?.key;
    setLive({ pad: on ? null : { key: $("padKey").value, volume: Number($("padVol").value), bright: $("padBright").checked } });
  });
  const upd = () => { if (S.live.pad?.key) setLive({ pad: { key: $("padKey").value, volume: Number($("padVol").value), bright: $("padBright").checked } }); };
  $("padKey").addEventListener("change", upd);
  $("padBright").addEventListener("change", upd);
  $("padVol").addEventListener("input", debounce(() => { upd(); scc.lib.setSettings({ padVolume: Number($("padVol").value) }).then((x) => { S.settings = x; }); }, 80));
  navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
}

// ── Easy mode, light mode, beta ─────────────────────────────────────────────────────────────
export async function applyModes() {
  document.body.classList.toggle("easy", !!S.settings.easy);
  let light = S.settings.performance === "light";
  if (!S.settings.performance || S.settings.performance === "auto") {
    const sys = S.system || {};
    light = (sys.cores && sys.cores <= 4) || (sys.memoryGB && sys.memoryGB <= 4.5);
  }
  document.body.classList.toggle("light", !!light);
  // Look & feel: church colours (white with soft baby blue, lilac and pink, black and gold like the logo) or dark.
  document.body.dataset.appearance = S.settings.appearance === "dark" ? "dark" : "church";
  document.body.dataset.accent = ["gold", "lilac", "blue", "pink"].includes(S.settings.accent) ? S.settings.accent : "gold";
  document.documentElement.style.zoom = String((Number(S.settings.uiScale) || 100) / 100);
  if (!!S.live.calm !== !!light) { S.live.calm = !!light; scc.live.set({ calm: !!light }); }
}
export const BETA_END = new Date("2099-01-01T00:00:00+02:00");   // the beta opens 1 Feb 2027; no end date set yet
function renderBeta() {
  const chip = $("btnFeedback"); if (!chip) return;
  const ended = Date.now() >= BETA_END.getTime();
  chip.title = ended ? "Thank you for testing!" : "Tell us what works and what doesn't";
}

// ── Start ─────────────────────────────────────────────────────────────────────────────────────
async function start() {
  const info = await scc.app.info();
  if (info.platform === "darwin") document.body.classList.add("mac");
  await loadAll();
  S.translations = await scc.bible.translations().catch(() => []);
  S.live = await scc.live.get();
  S.screens = await scc.screens.get();
  S.system = await scc.app.system?.().catch(() => null) || {};
  if (S.settings.audioSink || S.settings.soundPreset) { const p = { audioSink: S.settings.audioSink || "", soundPreset: S.settings.soundPreset || "natural" }; Object.assign(S.live, p); scc.live.set(p); }
  await applyModes();

  $("btnOutput").addEventListener("click", () => toggleScreen("output"));
  $("btnStage").addEventListener("click", () => toggleScreen("stage"));
  $("btnBlack").addEventListener("click", () => toggle("blackout"));
  $("btnClear").addEventListener("click", () => toggle("clear"));
  $("btnLogo").addEventListener("click", () => { if (!S.settings.logoSrc) toast("Choose a logo first: Media → right-click a picture → Use as church logo.", "info", 5000); toggle("logo"); });
  $("btnNext").addEventListener("click", () => step(1));
  $("btnPrev").addEventListener("click", () => step(-1));
  $("btnSettings").addEventListener("click", () => openSettings());
  $("setupChip").addEventListener("click", () => openSetup());
  $("btnLive").addEventListener("click", () => scc.desk.open());
  $("importChip").addEventListener("click", () => openImport());
  scc.importer.onProgress((p) => onImportProgress(p));
  scc.importer.get().then((p) => onImportProgress(p)).catch(() => {});
  scc.desk.onChange((open) => $("btnLive").classList.toggle("on", !!open));
  scc.atem.onState?.((a) => $("btnLive").classList.toggle("live", a?.streaming?.state === "streaming"));
  $("btnFeedback").addEventListener("click", () => openFeedback());
  $("btnConnect").addEventListener("click", () => openConnect());
  $("btnAI").addEventListener("click", () => openAI());
  $("btnNewShow").addEventListener("click", newShow);
  $("btnShowMenu").addEventListener("click", showMenu);
  $("showSelect").addEventListener("change", (e) => switchShow(e.target.value));
  $("themeSelect").addEventListener("change", async (e) => { S.live.themeId = e.target.value; scc.live.set({ themeId: e.target.value }); S.settings = await scc.lib.setSettings({ themeId: e.target.value }); renderPreviews(); renderCenter(); });
  $("bgSelect").addEventListener("change", async (e) => { S.settings = await scc.lib.setSettings({ backgroundId: e.target.value || null }); refreshBackground(); });
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => { S.tab = b.dataset.tab; S.query = ""; renderLibrary(); });

  scc.live.onState((st) => { S.live = st; renderQuick(); renderPreviews(); syncSound(st, mediaUrl); renderSound(); });
  scc.screens.onChange((s) => { S.screens = s; renderQuick(); });
  scc.remote.onCommand(onRemote);
  scc.updates.onStatus(renderUpdate);
  scc.onMenu(onMenu);
  scc.updates.get().then(renderUpdate).catch(() => {});

  wireServiceDnD(); wireKeys(); wireFileDrop(); wireStageTools(); wireSound(); refreshDevices(); renderBeta();
  scc.screens.onChange(() => refreshDevices());
  renderAll(); renderCenter(); tickTimer();
  document.body.classList.remove("booting");
  if (!S.settings.welcomed) { S.settings = await scc.lib.setSettings({ welcomed: true }); openGuide(); }
}

export function remember(ref) {
  const list = [ref, ...(S.settings.recentRefs || []).filter((r) => r !== ref)].slice(0, 10);
  scc.lib.setSettings({ recentRefs: list }).then((s) => { S.settings = s; });
}

start().catch((err) => {
  document.body.classList.remove("booting");
  document.body.append(h("div.callout", { style: { position: "fixed", inset: "40% 20% auto", zIndex: 200 } }, h("b", "SCC Presenter couldn't start."), h("br"), String(err?.message || err)));
});

export { renderLook, renderCenter, renderPreviews, scriptureItem, textItem, parseReference, formatReference };
