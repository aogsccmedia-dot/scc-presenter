// Dialogs: song editor, text/sermon slides, settings, connect, AI, receive, shortcuts.
import { createView } from "../shared/render.js";
import { THEMES } from "../shared/themes.js";
import { parseLyrics, dedupeSections, songSlides, songToText } from "../shared/lyrics.js";
import { parseReference, formatReference, scriptureSlides } from "../shared/scripture.js";
import { newId } from "../shared/importers.js";
import { OUTPUT_MODES } from "../shared/modes.js";
import { h, icon, toast, modal, debounce, plural } from "./ui.js";
import { S, scc, mediaUrl, reload, renderLook, renderCenter, renderPreviews, newSong, toggleScreen, importShowText, listDevices, applyModes, BETA_END } from "./control.js";

function previewList(host, slides) {
  host.replaceChildren();
  const base = { themeId: S.live.themeId || S.settings.themeId, themes: S.settings.customThemes || [] };
  slides.slice(0, 40).forEach((s, i) => {
    const thumb = h("div.thumb");
    host.append(h("div.slide", thumb, h("div.meta", h("span.lbl", s.label || `Slide ${i + 1}`), h("span.n", String(i + 1)))));
    requestAnimationFrame(() => createView(thumb, { mediaUrl }).update({ ...base, slide: s }));
  });
  if (slides.length > 40) host.append(h("div.hint", `…and ${slides.length - 40} more`));
  if (!slides.length) host.append(h("div.hint", "Slides appear here as you type."));
}

/** "[Chorus]" on its own repeats the last chorus. */
export function expandRepeats(text) {
  const blocks = String(text).replace(/\r\n?/g, "\n").split(/\n(?=\s*\[[^\]]+\]\s*$)/m);
  const seen = new Map();
  return blocks.map((b) => {
    const m = /^\s*\[([^\]]+)\]\s*\n?([\s\S]*)$/.exec(b);
    if (!m) return b;
    const label = m[1].trim().toLowerCase(), body = m[2].trim();
    if (body) { seen.set(label, body); return b; }
    return seen.has(label) ? `[${m[1].trim()}]\n${seen.get(label)}` : b;
  }).join("\n");
}
export function songFromText(text) { return dedupeSections(parseLyrics(expandRepeats(text))); }

// ── Song editor ──────────────────────────────────────────────────────────────────────────────
export function openSongEditor(song, prefillText) {
  return new Promise((resolve) => {
    let saved = null;
    const title = h("input.input", { value: song?.title || "", placeholder: "Song title", autofocus: true });
    const author = h("input.input", { value: song?.author || "", placeholder: "Writer / artist" });
    const ccli = h("input.input", { value: song?.ccli || "", placeholder: "CCLI #" });
    const text = h("textarea", { spellcheck: true, placeholder: "[Verse 1]\nAmazing grace, how sweet the sound\n…\n\n[Chorus]\n…\n\nTip: type [Chorus] on its own line to repeat it." });
    text.value = prefillText ?? (song ? arrangedText(song) : "[Verse 1]\n\n\n[Chorus]\n\n");
    const preview = h("div.editor-preview");
    const count = h("span.hint");
    const draw = debounce(() => {
      const { sections, arrangement } = songFromText(text.value);
      const slides = songSlides({ sections, arrangement }, { maxLines: Number(S.settings.maxLines) || 4 });
      previewList(preview, slides);
      count.textContent = `${plural(sections.length, "section")} · ${plural(slides.length, "slide")}`;
    }, 220);
    text.addEventListener("input", draw);
    const tidy = h("button.btn.small", { type: "button", onclick: async () => {
      if (!text.value.trim()) return toast("Paste the lyrics first.", "info");
      tidy.classList.add("busy"); tidy.disabled = true;
      try { const r = await scc.ai.tidy(text.value); text.value = r.text; draw(); toast(r.ai ? "Tidied with AI — check the words." : "Tidied with built-in rules. Add an AI key in Settings for smarter results.", "ok", 4200); }
      catch (e) { toast(e.message, "error"); }
      finally { tidy.classList.remove("busy"); tidy.disabled = false; }
    } }, icon("spark"), "Tidy lyrics");
    modal({
      title: song ? "Edit song" : "New song", width: 1000, className: "song-editor",
      body: h("div", { style: { display: "grid", gap: "12px" } },
        h("div.grid3", title, author, ccli),
        h("div.editor",
          h("div", { style: { display: "grid", gap: "8px" } }, text, h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, tidy, h("span.hint", "Removes chords and repeat marks and adds [Verse]/[Chorus] labels."))),
          h("div", { style: { display: "grid", gap: "6px", alignContent: "start" } }, count, preview))),
      actions: [{ label: "Cancel" }, { label: "Save song", kind: "primary", onClick: async () => {
        const t = title.value.trim();
        if (!t) { title.focus(); toast("Give the song a title.", "error"); return false; }
        const { sections, arrangement } = songFromText(text.value);
        if (!sections.length) { text.focus(); toast("Add some lyrics.", "error"); return false; }
        saved = await scc.lib.upsert("songs", { ...(song || {}), id: song?.id || newId(), title: t, author: author.value.trim(), ccli: ccli.value.trim(), sections, arrangement });
        toast("Song saved", "ok", 1500);
      } }],
      onClose: () => resolve(saved),
    });
    draw();
  });
}
/** Song back to text in arrangement order, writing repeats as "[Chorus]" so the editor round-trips. */
function arrangedText(song) {
  const order = song.arrangement?.length ? song.arrangement : song.sections.map((_, i) => i);
  const used = new Set();
  return order.map((i) => { const s = song.sections[i]; if (!s) return ""; if (used.has(i)) return `[${s.label}]`; used.add(i); return `[${s.label}]\n${s.text}`; }).filter(Boolean).join("\n\n") || songToText(song);
}

// ── Text & sermon slides ─────────────────────────────────────────────────────────────────────
export function openTextEditor(existing, { sermon = false } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const title = h("input.input", { value: existing?.title || (sermon ? "Sermon" : "Announcements"), autofocus: true });
    const text = h("textarea", { placeholder: sermon ? "Paste your sermon notes here, then press “Make slides”." : "Welcome to church!\n\nYouth service — Friday 18:30\n\n> John 3:16\n\n(A blank line starts a new slide. Start a line with > to add a Bible passage.)" });
    text.value = existing?.source ?? (existing ? existing.slides.map((s) => s.kind === "scripture" ? `> ${s.reference.replace(/\s+[A-Z]{2,4}$/, "")}` : s.text).filter((v, i, a) => !(v.startsWith(">") && a[i - 1] === v)).join("\n\n") : "");
    const preview = h("div.editor-preview");
    const draw = debounce(() => previewList(preview, quickSlides(text.value)), 220);
    text.addEventListener("input", draw);
    const make = h("button.btn.small", { type: "button", onclick: async () => {
      if (!text.value.trim()) return toast("Paste your notes first.", "info");
      make.classList.add("busy"); make.disabled = true;
      try {
        const r = await scc.ai.sermon(text.value);
        text.value = r.slides.map((s) => s.kind === "scripture" && s.ref ? `> ${s.ref}` : s.text).join("\n\n");
        draw();
        toast(r.ai ? "Slides made with AI — edit anything you like." : "Slides made with built-in rules. Add an AI key in Settings for smarter results.", "ok", 4200);
      } catch (e) { toast(e.message, "error"); }
      finally { make.classList.remove("busy"); make.disabled = false; }
    } }, icon("spark"), "Make slides from notes");
    modal({
      title: existing ? "Edit text slides" : sermon ? "Sermon notes to slides" : "New text slides", width: 1000,
      body: h("div", { style: { display: "grid", gap: "12px" } }, title,
        h("div.editor", h("div", { style: { display: "grid", gap: "8px" } }, text, h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, make, h("span.hint", "Blank line = new slide. “> Romans 8:28” = Bible passage."))), preview)),
      actions: [{ label: "Cancel" }, { label: existing ? "Save" : "Add to service", kind: "primary", onClick: async () => {
        if (!text.value.trim()) { toast("Add some words first.", "error"); return false; }
        const slides = await fullSlides(text.value);
        result = { title: title.value.trim() || "Text", slides, source: text.value };
      } }],
      onClose: () => resolve(result),
    });
    draw();
  });
}
const paragraphs = (t) => String(t).replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const labelOf = (t) => t.split(/\s+/).slice(0, 4).join(" ") + (t.split(/\s+/).length > 4 ? "…" : "");
function quickSlides(t) {
  return paragraphs(t).map((p) => {
    const m = /^>\s*(.+)$/.exec(p);
    const ref = m && parseReference(m[1]);
    return ref ? { kind: "scripture", label: formatReference(ref), text: `${formatReference(ref)}`, reference: "Bible passage (loads when saved)" } : { kind: "text", label: labelOf(p), text: p };
  });
}
async function fullSlides(t) {
  const out = [];
  for (const p of paragraphs(t)) {
    const m = /^>\s*(.+)$/.exec(p);
    const ref = m && parseReference(m[1]);
    if (ref) {
      try {
        const r = await scc.bible.lookup(formatReference(ref), S.settings.translation || "kjv");
        for (const s of scriptureSlides(r.ref, r.verses, { translation: r.translation })) out.push(s);
      } catch (e) { toast(e.message, "error", 5000); out.push({ kind: "text", label: formatReference(ref), text: formatReference(ref) }); }
    } else out.push({ kind: "text", label: labelOf(p), text: p });
  }
  return out;
}

// ── Settings ─────────────────────────────────────────────────────────────────────────────────
export async function openSettings(startPane = "general") {
  const [info, aiStatus, server, upd] = await Promise.all([scc.app.info(), scc.ai.status().catch(() => ({})), scc.server.info().catch(() => ({})), scc.updates.get().catch(() => ({}))]);
  const set = async (patch) => { S.settings = await scc.lib.setSettings(patch); };
  const panes = {
    general: () => h("div.pane",
      checkbox("Easy mode — bigger text and buttons", !!S.settings.easy, async (v) => { await set({ easy: v }); applyModes(); }),
      h("label.field", h("span", "Performance"), sel([["auto", "Automatic (recommended)"], ["light", "Light — for older computers (no animations)"], ["full", "Full — all animations"]], S.settings.performance || "auto", async (v) => { await set({ performance: v }); applyModes(); }),
        h("small", "Light mode keeps slides and video smooth on older laptops.")),
      h("label.field", h("span", "Lines per slide for songs"), sel([2, 3, 4, 5, 6, 8].map((n) => [n, `${n} lines`]), S.settings.maxLines || 4, async (v) => { await set({ maxLines: Number(v) }); renderCenter(); })),
      h("label.field", h("span", "Bible translation"), sel(S.translations.map((t) => [t.id, t.name]), S.settings.translation || "kjv", (v) => set({ translation: v }))),
      checkbox("Loop videos when shown as a slide", !!S.settings.loopVideos, (v) => set({ loopVideos: v })),
      checkbox("Check for updates automatically", S.settings.autoUpdate !== false, (v) => set({ autoUpdate: v })),
      h("div.field", h("span", "Your library"), h("div", { style: { display: "flex", gap: "8px" } }, h("button.btn.small", { onclick: () => scc.app.openData() }, "Open library folder")), h("small", "Songs, services and settings are stored on this computer. Back up this folder to keep them safe."))),
    screens: () => outputsEditor(),
    looks: () => themeEditor(set),
    ai: () => {
      const key = h("input.input", { type: "password", placeholder: aiStatus.hasKey ? "•••••••• (saved)" : "sk-ant-…", autocomplete: "off" });
      return h("div.pane",
        h("div.callout.gold", h("b", "AI helpers"), h("br"), "Tidy pasted lyrics, suggest Bible verses for a topic and turn sermon notes into slides. Everything works without a key using built-in rules; with your church's own Claude API key, results are smarter."),
        h("label.field", h("span", "Claude API key"), key, h("small", aiStatus.secure === false ? "This computer can't store keys securely, so AI keys are turned off here." : "Stored encrypted on this computer only. Get a key at console.anthropic.com.")),
        h("div", { style: { display: "flex", gap: "8px" } },
          h("button.btn.small.primary", { onclick: async () => { if (!key.value.trim()) return; try { await scc.ai.setKey(key.value.trim()); key.value = ""; key.placeholder = "•••••••• (saved)"; toast("AI key saved", "ok"); } catch (e) { toast(e.message, "error"); } } }, "Save key"),
          aiStatus.hasKey ? h("button.btn.small.danger", { onclick: async () => { await scc.ai.setKey(""); key.placeholder = "sk-ant-…"; toast("AI key removed", "ok"); } }, "Remove key") : null));
    },
    network: () => h("div.pane",
      h("div.callout", server.ok ? `Running on port ${server.port}. Phones, OBS and other screens on the same network can connect (see Connect).` : `Not running: ${server.error || "unknown"}.`),
      checkbox("Allow phones, OBS and other computers to connect", S.settings.serverEnabled !== false, (v) => { set({ serverEnabled: v }); toast("Restart SCC Presenter to apply.", "info"); }),
      h("label.field", h("span", "Port"), h("input.input", { type: "number", min: 1024, max: 65535, value: S.settings.port || 4747, onchange: (e) => { set({ port: Number(e.target.value) || 4747 }); toast("Restart SCC Presenter to apply.", "info"); } }))),
    updates: () => {
      const status = h("div.callout", upd.message || `You're on version ${info.version}.`);
      const btn = h("button.btn.small.primary", { onclick: async () => { btn.classList.add("busy"); const u = await scc.updates.check().catch(() => null); btn.classList.remove("busy"); status.textContent = u?.message || "Couldn't check right now."; if (u && (u.status === "available" || u.status === "ready")) act.hidden = false; } }, "Check for updates");
      const act = h("button.btn.small", { hidden: !(upd.status === "available" || upd.status === "ready"), onclick: () => scc.updates.install() }, upd.status === "ready" ? "Restart and install" : "Download update");
      return h("div.pane", h("div", h("b", `SCC Presenter ${info.version}`)), status, h("div", { style: { display: "flex", gap: "8px" } }, btn, act),
        h("small.hint", info.platform === "win32" ? "Windows updates download in the background and install when you restart." : "On Mac, new versions download from the release page. Open the .dmg and drag SCC Presenter into Applications to replace the old one."));
    },
    about: () => h("div.pane",
      h("div", { style: { display: "flex", gap: "12px", alignItems: "center" } }, h("span.mark", { style: { fontSize: "20px", padding: "8px 14px" } }, "SCC"), h("div", h("b", { style: { fontSize: "18px" } }, "SCC Presenter"), h("br"), h("span.muted", `Version ${info.version}`))),
      h("p", "Free, open-source presentation software for churches: songs, scripture, media, stage screens, phone remote, OBS output and file sharing."),
      h("p.muted", "Created by AOG Sandton City Church. Released under the MIT License — free to use, share and improve."),
      h("button.btn.small", { onclick: () => scc.app.open("https://github.com/aogsccmedia-dot/scc-presenter") }, "Source code")),
  };
  panes.beta = () => {
    const key = h("input.input", { value: S.settings.betaKey || "", placeholder: "SCC-XXXX-XXXX", autocomplete: "off" });
    return h("div.pane",
      h("div.callout.gold", h("b", "Beta tester"), h("br"), `Thank you for testing SCC Presenter! The beta runs until 31 December 2026. The full release arrives on 31 January 2027.`),
      h("label.field", h("span", "Your beta key"), key, h("small", "Shown on the download page after you joined the beta. It lets your feedback reach the team.")),
      h("div", { style: { display: "flex", gap: "8px" } },
        h("button.btn.small.primary", { onclick: async () => { await set({ betaKey: key.value.trim().toUpperCase() }); toast("Beta key saved", "ok"); } }, "Save key"),
        h("button.btn.small", { onclick: () => openFeedback() }, "Send feedback")));
  };
  const names = { general: "General", beta: "Beta", screens: "Screens", looks: "Looks", ai: "AI", network: "Network", updates: "Updates", about: "About" };
  const pane = h("div");
  const nav = h("nav", ...Object.entries(names).map(([k, label]) => h("button", { dataset: { k }, onclick: () => show(k) }, label)));
  const show = (k) => { for (const b of nav.children) b.classList.toggle("on", b.dataset.k === k); pane.replaceChildren(panes[k]()); };
  modal({ title: "Settings", width: 760, body: h("div.settings", nav, pane), actions: [{ label: "Done", kind: "primary" }] });
  show(panes[startPane] ? startPane : "general");
}
function sel(options, value, onChange) {
  const s = h("select", ...options.map(([v, l]) => h("option", { value: String(v) }, l)));
  s.value = String(value ?? "");
  s.addEventListener("change", () => onChange(s.value));
  return s;
}
function checkbox(label, checked, onChange) {
  const c = h("input", { type: "checkbox", checked });
  c.addEventListener("change", () => onChange(c.checked));
  return h("label.check", c, h("span", label));
}

const FONTS = [["Inter, 'Segoe UI', Helvetica, Arial, sans-serif", "Clean sans"], ["Georgia, 'Times New Roman', serif", "Classic serif"], ["Impact, 'Arial Black', sans-serif", "Bold display"], ["'Trebuchet MS', 'Segoe UI', sans-serif", "Friendly"], ["'Palatino Linotype', Palatino, serif", "Elegant serif"], ["'Courier New', monospace", "Typewriter"]];
function themeEditor(set) {
  const custom = S.settings.customThemes || [];
  const t = { id: `custom-${newId()}`, name: "My look", font: FONTS[0][0], weight: 700, color: "#ffffff", bg: "#000000", align: "center", valign: "middle", shadow: true, upper: false, maxSize: 96, refColor: "#dddddd", band: false };
  const host = h("div.preview", { style: { aspectRatio: "16/9" } });
  let view;
  const draw = () => { view ||= createView(host, { mediaUrl }); view.update({ themeId: t.id, themes: [t], slide: { text: "How great is our God\nSing with me", reference: "" } }); };
  const field = (label, input) => h("label.field", h("span", label), input);
  const bind = (key, input, conv = (v) => v) => { input.addEventListener("input", () => { t[key] = conv(input.type === "checkbox" ? input.checked : input.value); draw(); }); return input; };
  const list = h("div.results", ...custom.map((c) => h("div.result", h("div.t", h("b", c.name)), h("button.icon-btn.danger", { title: "Delete", onclick: async (e) => { await set({ customThemes: (S.settings.customThemes || []).filter((x) => x.id !== c.id) }); e.target.closest(".result").remove(); renderLook(); } }, icon("trash")))));
  requestAnimationFrame(draw);
  return h("div.pane",
    h("div.hint", `Built-in looks: ${THEMES.map((x) => x.name).join(", ")}. Make your own below.`),
    host,
    h("div.grid2",
      field("Name", bind("name", h("input.input", { value: t.name }))),
      field("Font", bind("font", sel(FONTS, t.font, () => {}))),
      field("Text colour", bind("color", h("input.input", { type: "color", value: t.color }))),
      field("Background colour", bind("bg", h("input.input", { type: "color", value: t.bg }))),
      field("Largest text size", bind("maxSize", h("input", { type: "range", min: 40, max: 140, value: t.maxSize, style: { accentColor: "#f5b942" } }), Number)),
      field("Position", bind("valign", sel([["middle", "Middle"], ["top", "Top"], ["bottom", "Bottom (lower third)"]], t.valign, () => {}))),
      field("Alignment", bind("align", sel([["center", "Centre"], ["left", "Left"], ["right", "Right"]], t.align, () => {})))),
    h("div", { style: { display: "flex", gap: "14px", flexWrap: "wrap" } },
      h("label.check", bind("shadow", h("input", { type: "checkbox", checked: t.shadow })), "Text shadow"),
      h("label.check", bind("upper", h("input", { type: "checkbox", checked: t.upper })), "CAPITALS"),
      h("label.check", bind("band", h("input", { type: "checkbox", checked: t.band })), "Dark band behind text")),
    h("button.btn.small.primary", { onclick: async () => { await set({ customThemes: [...(S.settings.customThemes || []), { ...t }] }); renderLook(); toast(`Saved “${t.name}” — pick it under Look.`, "ok"); t.id = `custom-${newId()}`; } }, "Save look"),
    custom.length ? h("div.field", h("span", "Your looks"), list) : null);
}

// ── Connect ──────────────────────────────────────────────────────────────────────────────────
export async function openConnect() {
  const info = await scc.server.info();
  const pinEl = h("span.pin", info.pin || "----");
  const addr = (info.addresses?.[0] || "localhost") + `:${info.port || 4747}`;
  const row = (label, url, note) => h("div.field", h("span", label), h("div.url-row", h("code", url), h("button.btn.small", { onclick: () => navigator.clipboard.writeText(url).then(() => toast("Copied", "ok", 1200)) }, "Copy")), note ? h("small", note) : null);
  const body = info.ok ? h("div", { style: { display: "grid", gap: "12px" } },
    h("div.callout", "Devices must be on the same Wi-Fi or network as this computer."),
    h("div.grid2",
      h("div.field", h("span", "Remote PIN"), h("div", { style: { display: "flex", gap: "10px", alignItems: "center" } }, pinEl, h("button.btn.small", { onclick: async () => { pinEl.textContent = await scc.server.newPin(); toast("New PIN — reconnect phones with it", "ok"); } }, "New PIN"))),
      h("div.field", h("span", "This computer"), h("b", addr), (info.addresses || []).length > 1 ? h("small", `Also: ${info.addresses.slice(1).join(", ")}`) : null)),
    row("Phone remote", `http://${addr}/remote`, "Open on a phone's browser, then type the PIN."),
    row("Stage screen", `http://${addr}/stage`, "Any browser or smart TV for the band and speaker."),
    row("OBS Studio / vMix — full screen", `http://${addr}/output`, "OBS: Sources → + → Browser → paste this, width 1920, height 1080."),
    row("OBS Studio / vMix — transparent overlay", `http://${addr}/output?transparent=1`, "Words over your camera for the livestream."),
    h("div", { style: { display: "flex", gap: "8px" } }, h("button.btn.small", { onclick: () => openReceive() }, icon("download"), "Receive a show from another computer")))
    : h("div.callout", `Network connections are off: ${info.error || "unknown"}. Turn them on in Settings → Network.`);
  modal({ title: "Connect", width: 640, body, actions: [{ label: "Done", kind: "primary" }] });
}

export function openReceive() {
  const host = h("input.input", { placeholder: "e.g. 192.168.1.20:4747", autofocus: true });
  const pin = h("input.input", { placeholder: "PIN", inputmode: "numeric", style: { width: "110px" } });
  const results = h("div.results");
  const find = h("button.btn.primary", { type: "submit" }, "Find shows");
  const form = h("form", { style: { display: "grid", gap: "10px" }, onsubmit: async (e) => {
    e.preventDefault();
    find.classList.add("busy");
    try {
      const shows = await scc.shows.fetchLan(host.value, pin.value);
      results.replaceChildren(...(shows.length ? shows.map((s) => {
        const get = h("button.btn.small.primary", { type: "button", onclick: async () => {
          get.classList.add("busy");
          try { const r = await scc.shows.fetchLan(host.value, pin.value, s.id); await reload(["songs", "shows", "media"]); await importDone(r); m.close(); }
          catch (err) { toast(err.message, "error"); } finally { get.classList.remove("busy"); }
        } }, "Get");
        return h("div.result", h("div.t", h("b", s.title), h("span", `${plural(s.items, "item")}${s.date ? ` · ${s.date}` : ""}`)), get);
      }) : [h("div.hint", "Nothing shared yet. On the other computer: service options → Share on this network.")]));
    } catch (err) { toast(err.message, "error", 5000); }
    finally { find.classList.remove("busy"); }
  } }, h("div.hint", "On the other computer open Connect to see its address and PIN, and turn on “Share on this network” for the service."), h("div", { style: { display: "flex", gap: "8px" } }, host, pin), find, results);
  const m = modal({ title: "Receive a show", width: 520, body: form });
}
async function importDone(r) {
  const sel = document.getElementById("showSelect");
  S.showId = r.show.id;
  await reload(["shows"]);
  sel.value = r.show.id; sel.dispatchEvent(new Event("change"));
  renderLook();
  toast(`Received “${r.show.title}”${r.skipped ? ` (${plural(r.skipped, "big file")} not included)` : ""}`, "ok");
}

// ── AI hub ───────────────────────────────────────────────────────────────────────────────────
export async function openAI() {
  const st = await scc.ai.status().catch(() => ({}));
  const card = (ic, title, text, btn, onClick) => h("div.result", { style: { alignItems: "flex-start" } }, icon(ic), h("div.t", h("b", title), h("span", text)), h("button.btn.small", { onclick: () => { m.close(); onClick(); } }, btn));
  const m = modal({ title: "AI helpers", width: 560, body: h("div", { style: { display: "grid", gap: "10px" } },
    h("div.callout" + (st.hasKey ? "" : ".gold"), st.hasKey ? "Using your Claude API key." : h("span", "Working with built-in rules. ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); m.close(); openSettings("ai"); } }, "Add a Claude API key"), " for smarter results.")),
    card("music", "Tidy song lyrics", "Paste lyrics from anywhere. Chords, repeat marks and clutter are removed and sections labelled.", "Open", () => newSongFromPaste()),
    card("book", "Verses for a topic", "Get Bible passages that fit your message.", "Open", () => { document.querySelector('.tabs [data-tab="bible"]').click(); }),
    card("text", "Sermon notes to slides", "Turn notes into clean points and scripture slides.", "Open", () => { document.querySelector('.tabs [data-tab="text"]').click(); document.querySelector("#libBody .btn:not(.primary)")?.click(); })) });
}
async function newSongFromPaste() {
  let text = "";
  try { text = await navigator.clipboard.readText(); } catch { /* no permission */ }
  const looksLikeLyrics = text && text.split("\n").length >= 4 && text.length < 20000;
  if (looksLikeLyrics) {
    const r = await scc.ai.tidy(text).catch(() => null);
    const song = await openSongEditor(null, r?.text || text);
    if (song) { await reload(["songs"]); toast("Song saved", "ok"); }
  } else newSong();
}

export function openShortcuts() {
  const rows = [["→  ↓  Space  Page Down", "Next slide (rolls into the next service item)"], ["←  ↑  Page Up", "Previous slide"], ["1 – 9", "Jump to slide"], ["Home / End", "First / last slide"], ["B or .", "Black screen"], ["C", "Clear words (keep background)"], ["L", "Show logo"], ["Esc", "Clear everything"], ["Ctrl/⌘ + N", "New song"], ["Ctrl/⌘ + I", "Import songs"], ["Ctrl/⌘ + O", "Open a shared show"], ["Ctrl/⌘ + Shift + O", "Output on/off"], ["Ctrl/⌘ + Shift + S", "Stage screen on/off"], ["?", "This list"]];
  modal({ title: "Keyboard shortcuts", width: 520, body: h("div.results", { style: { maxHeight: "none" } }, ...rows.map(([k, d]) => h("div.result", h("div.t", h("span", d)), h("kbd", { style: { fontSize: "12px", padding: "4px 7px" } }, k)))), actions: [{ label: "Done", kind: "primary" }] });
}

export { renderPreviews, importShowText };


// ── Setup: screens, sound devices and this computer ─────────────────────────────────────────
export async function openSetup() {
  const [screens, dev, sys] = await Promise.all([scc.screens.get(), listDevices(), scc.app.system?.().catch(() => ({})) || {}]);
  const ds = screens.displays || [];
  const quality = (d) => { const w = d.pixelsWide || d.width; return w >= 3800 ? "4K" : w >= 2500 ? "QHD" : w >= 1900 ? "Full HD" : w >= 1270 ? "HD" : "Low"; };
  const role = (d) => { const o = (screens.outputs || []).filter((x) => x.enabled !== false && x.displayLabel === (d.label || "Screen")).map((x) => x.name); return o.length ? o.join(", ") : d.primary ? "Control (this screen)" : "Not used"; };
  const screenCards = ds.map((d, i) => {
    const ratio = d.width / d.height;
    return h(`div.dev${d.primary ? ".main" : ""}`,
      h("div.screen-shape", { style: { aspectRatio: String(ratio) } }, String(i + 1)),
      h("b", d.label || `Screen ${i + 1}`),
      h("div", h("span.tag.ok", quality(d)), d.internal ? h("span.tag", "Built-in") : h("span.tag", "Connected"), d.primary ? h("span.tag.warn", "Main") : null),
      h("div.spec", `${d.pixelsWide || d.width} × ${d.pixelsHigh || d.height} pixels`, h("br"), `${d.hz ? `${d.hz} Hz · ` : ""}${d.scale ? `${Math.round(d.scale * 100)}% scale · ` : ""}${d.colorDepth || 24}-bit colour`, h("br"), `Use: ${role(d)}`));
  });
  const list = (items, empty) => items.length ? h("div.results", { style: { maxHeight: "none" } }, ...items.map((x) => h("div.result", h("div.t", h("b", x.label)), x.extra || null))) : h("div.hint", empty);
  const outs = dev.outputs.filter((o) => o.id !== "communications");
  const lowEnd = (sys.cores && sys.cores <= 4) || (sys.memoryGB && sys.memoryGB <= 4.5);
  const testTone = (id) => h("button.btn.small", { onclick: async () => {
    try { const ctx = new AudioContext(); if (id && ctx.setSinkId) await ctx.setSinkId(id === "default" ? "" : id); const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 523.25; g.gain.value = 0.08; o.connect(g).connect(ctx.destination); o.start(); g.gain.setTargetAtTime(0, ctx.currentTime + 0.6, 0.1); setTimeout(() => ctx.close(), 1200); } catch { toast("Couldn't play on that speaker.", "error"); }
  } }, "Test");
  modal({ title: "Setup", width: 820, body: h("div", { style: { display: "grid", gap: "12px" } },
    h("div.section-title", `Screens (${ds.length})`),
    h("div.dev-grid", ...screenCards),
    h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, h("button.btn.small", { onclick: () => scc.screens.identify() }, "Show numbers on screens"), h("button.btn.small", { onclick: () => openSettings("screens") }, "Choose output & stage screens")),
    h("div.section-title", `Speakers & sound outputs (${outs.length})`),
    list(outs.map((o) => ({ label: o.label, extra: testTone(o.id) })), "No speakers found."),
    h("div.section-title", `Microphones & inputs (${dev.inputs.length}) · Cameras (${dev.cameras.length})`),
    list([...dev.inputs.map((i) => ({ label: `🎙 ${i.label}` })), ...dev.cameras.map((c) => ({ label: `📷 ${c.label}` }))], "No microphones or cameras found."),
    h("div.section-title", "This computer"),
    h("div.callout", `${sys.os || ""} · ${sys.cpu || ""} (${sys.cores || "?"} cores) · ${sys.memoryGB || "?"} GB memory`, h("br"),
      `Graphics: ${(sys.gpu || []).find((g) => g.active)?.name || (sys.gpu?.length ? `${sys.gpu.length} graphics chip(s)` : "unknown")} · Video decoding: ${String(sys.videoDecode || "").startsWith("enabled") ? "hardware (smooth)" : "software"}`),
    lowEnd ? h("div.callout.gold", "This is a lighter computer. Light mode is on automatically so slides and video stay smooth. Change it in Settings → General.") : null) ,
    actions: [{ label: "Done", kind: "primary" }] });
}

// ── Feedback (beta testers) ────────────────────────────────────────────────────────────────
export function openFeedback() {
  const ended = Date.now() >= BETA_END.getTime();
  const stars = (name) => { let v = 0; const row = h("div.stars", { dataset: { name } }); for (let i = 1; i <= 5; i++) row.append(h("button", { type: "button", "aria-label": `${i} of 5`, onclick: () => { v = i; [...row.children].forEach((b, k) => b.classList.toggle("on", k < i)); row.dataset.value = i; } }, "★")); return row; };
  const overall = stars("overall"), ease = stars("ease");
  const FEATURES = ["Songs", "Bible", "Pictures & video", "Stage screen", "Phone remote", "OBS / livestream", "Sharing shows", "AI helpers", "Sound & pads", "Moving backgrounds"];
  const used = h("div.chips", ...FEATURES.map((f) => h("label.chip", h("input", { type: "checkbox", value: f, style: { marginRight: "5px" } }), f)));
  const ta = (ph) => h("textarea", { rows: 3, placeholder: ph });
  const good = ta("What worked well?"), bad = ta("What went wrong? Anything slow, confusing or broken? Steps help us fix it."), missing = ta("What's missing that you need on a Sunday?");
  const rec = sel([["", "Choose…"], ["yes", "Yes"], ["maybe", "Maybe"], ["no", "Not yet"]], "", () => {});
  const key = h("input.input", { value: S.settings.betaKey || "", placeholder: "Your beta key, e.g. SCC-AB12-CD34" });
  const sysBox = h("input", { type: "checkbox", checked: true });
  modal({ title: "Beta feedback", width: 640, body: ended ? h("div.callout", "The beta has ended. Thank you! The full release arrives on 31 January 2027.") : h("div", { style: { display: "grid", gap: "12px" } },
    h("div.hint", "Your answers go straight to the AOG Sandton City Church media team. Only beta testers can send feedback."),
    h("div.grid2", h("div.field", h("span", "Overall"), overall), h("div.field", h("span", "How easy is it to use?"), ease)),
    h("div.field", h("span", "What did you use?"), used),
    h("label.field", h("span", "Worked well"), good), h("label.field", h("span", "Problems"), bad), h("label.field", h("span", "Missing"), missing),
    h("div.grid2", h("label.field", h("span", "Would you recommend it to another church?"), rec), h("label.field", h("span", "Beta key"), key)),
    h("label.check", sysBox, h("span", "Include computer details (screens, memory, graphics) to help us fix problems"))),
    actions: ended ? [{ label: "Close", kind: "primary" }] : [{ label: "Cancel" }, { label: "Send feedback", kind: "primary", onClick: async () => {
      const k = key.value.trim().toUpperCase();
      if (!k) { toast("Add your beta key (from the download page).", "error"); key.focus(); return false; }
      if (!overall.dataset.value) { toast("Tap a star rating first.", "error"); return false; }
      const sys = sysBox.checked ? { ...(await scc.app.system?.().catch(() => ({})) || {}), screens: (S.screens.displays || []).map((d) => `${d.pixelsWide || d.width}x${d.pixelsHigh || d.height}${d.hz ? `@${d.hz}` : ""}`) } : null;
      await scc.beta.feedback({ key: k, overall: Number(overall.dataset.value), ease: Number(ease.dataset.value || 0), used: [...used.querySelectorAll("input:checked")].map((i) => i.value), good: good.value, problems: bad.value, missing: missing.value, recommend: rec.value, system: sys, source: "app" });
      if (k !== S.settings.betaKey) S.settings = await scc.lib.setSettings({ betaKey: k });
      toast("Thank you! Your feedback was sent.", "ok", 4000);
    } }] });
}

// ── First-run guide ────────────────────────────────────────────────────────────────────────
export function openGuide() {
  const steps = [
    ["monitor", "Welcome to SCC Presenter", "Show songs, Bible verses, pictures and videos on your projector or TV. This short guide takes 30 seconds."],
    ["music", "1. Pick something on the left", "Songs, Bible, Media and Text are in the tabs at the bottom left. Click a song to see its slides in the middle."],
    ["play", "2. Click a slide to show it", "The slide with the red border is on screen. Press → or Space for the next one. The big yellow Next button does the same."],
    ["monitor", "3. Turn on the projector screen", "Press Output at the top. If a projector or TV is plugged in, the slides go there. Black, Clear and Logo are always one tap away."],
    ["list", "4. Plan your service", "Press “Add to service” to build Sunday's order on the top left. Next then runs straight through the whole service."],
  ];
  let i = 0;
  const body = h("div.guide");
  const draw = () => {
    const [ic, t, p] = steps[i];
    body.replaceChildren(h("div.big-ic", icon(ic)), h("h3", t), h("p", p), h("div.dots", ...steps.map((_, k) => h(`i${k === i ? ".on" : ""}`))));
    nextBtn.textContent = i === steps.length - 1 ? "Start presenting" : "Next";
  };
  const m = modal({ title: "Getting started", width: 520, body, actions: [{ label: "Skip" }, { label: "Next", kind: "primary", onClick: () => { if (i < steps.length - 1) { i++; draw(); return false; } } }] });
  const nextBtn = m.el.querySelector("footer .primary");
  draw();
}


// ── Screens: as many outputs as you have screens, each showing what it should ───────────────
function outputsEditor() {
  let list = (S.screens.outputs || []).map((o) => ({ ...o }));
  const disp = S.screens.displays || [];
  const box = h("div", { style: { display: "grid", gap: "8px" } });
  const save = async () => { const r = await scc.outputs.set(list); S.screens = r; list = r.outputs.map((o) => ({ ...o })); draw(); };
  const debSave = debounce(save, 400);
  const draw = () => {
    box.replaceChildren(...list.map((o, i) => {
      const name = h("input.input", { value: o.name, maxlength: 40, oninput: (e) => { o.name = e.target.value; debSave(); } });
      const mode = sel(Object.entries(OUTPUT_MODES).map(([k, m]) => [k, m.name]), o.mode, (v) => { o.mode = v; save(); });
      const where = sel([["", "Automatic"], ...disp.map((d, k) => [String(d.id), `Screen ${k + 1}: ${d.label}${d.primary ? " (main)" : ""}`])], o.displayId ? String(o.displayId) : "", (v) => { o.displayId = v ? Number(v) : null; save(); });
      const on = h("input", { type: "checkbox", checked: o.enabled !== false, title: "On", onchange: (e) => { o.enabled = e.target.checked; save(); } });
      return h("div.out-row", name, mode, where, h("label.check.small", on, "On"),
        h("button.icon-btn.danger", { title: "Remove", disabled: list.length < 2, onclick: () => { list.splice(i, 1); save(); } }, icon("trash")),
        h("div.mode-hint", `${OUTPUT_MODES[o.mode]?.hint || ""}${o.displayLabel ? ` · now on: ${o.displayLabel}` : ""}`));
    }));
  };
  draw();
  return h("div.pane",
    h("div.hint", `${disp.length} ${disp.length === 1 ? "screen" : "screens"} connected. Each output can show something different — for example the projector shows everything, a side TV only the visuals, and the ATEM gets the words on black to key over the cameras.`),
    box,
    h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
      h("button.btn.small", { disabled: list.length >= 8, onclick: () => { list.push({ id: `out${Date.now().toString(36)}`, name: `Output ${list.length + 1}`, mode: "full", displayId: null, enabled: true }); save(); } }, icon("plus"), "Add output"),
      h("button.btn.small", { onclick: () => scc.screens.identify() }, "Show numbers on screens"),
      h("button.btn.small", { onclick: () => toggleScreen("output") }, S.screens.output ? "Close outputs" : "Open outputs")),
    h("small.hint", "For OBS, vMix or a smart TV you can also use the network links in Connect, e.g. /output?mode=words or ?mode=green."));
}

// ── Import assistant ─────────────────────────────────────────────────────────────────────────
let importView = null, lastImport = { status: "idle" };
export function onImportProgress(p) {
  const prev = lastImport; lastImport = p || { status: "idle" };
  const chip = document.getElementById("importChip");
  if (chip) {
    chip.hidden = p.status !== "running";
    if (p.status === "running") chip.querySelector("span:last-child").textContent = `Importing ${p.done} / ${p.total}`;
  }
  if (p.status === "running" && p.resumed && !prev.resumed && prev.status !== "running") toast(`Carrying on with your import (${p.done} of ${p.total}).`, "info", 5000);
  if (p.status === "done" && prev.status === "running") {
    reload(["songs", "shows"]);
    toast(`Import finished: ${plural(p.imported, "song")} added${p.skipped ? `, ${p.skipped} already in your library` : ""}${p.failed ? `, ${p.failed} couldn't be read` : ""}.`, p.failed ? "info" : "ok", 7000);
  } else if (p.status === "running" && p.done % 100 < 25 && p.done !== prev.done) reload(["songs"]);
  importView?.(p);
}

export async function openImport() {
  const fsInfo = await scc.importer.freeshow().catch(() => ({ folders: [], shows: 0 }));
  const body = h("div", { style: { display: "grid", gap: "12px" } });
  const start = async (opts) => {
    try { const v = await scc.importer.start(opts); onImportProgress(v); }
    catch (e) { toast(e.message, "error", 6000); }
  };
  const progressView = (p) => {
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return h("div", { style: { display: "grid", gap: "10px" } },
      h("div", h("b", p.status === "done" ? "Import finished" : p.status === "cancelled" ? "Import stopped" : `Importing ${p.label || ""}…`)),
      h("div.progress", h("i", { style: { width: `${pct}%` } })),
      h("div.hint", `${p.done} of ${p.total} files · ${p.imported} added · ${p.skipped} already in your library · ${p.failed} couldn't be read`),
      p.current && p.status === "running" ? h("div.hint", `Now: ${p.current}`) : null,
      p.status === "running" ? h("div.callout", "You can keep working — this carries on in the background. If SCC Presenter or the computer closes, it continues from where it stopped next time.") : null,
      p.failures?.length && p.status !== "running" ? h("details", h("summary.hint", "Files that couldn't be read"), h("div.hint", ...p.failures.map((f) => h("div", `${f.file}: ${f.error}`)))) : null,
      h("div", { style: { display: "flex", gap: "8px" } },
        p.status === "running" ? h("button.btn.small", { onclick: () => scc.importer.cancel() }, "Stop import") : h("button.btn.small", { onclick: () => draw({ status: "idle" }) }, "Import more")));
  };
  const chooser = () => h("div.imp-cards",
    h("button.imp-card", { disabled: !fsInfo.folders.length, onclick: () => start({ folders: fsInfo.folders.slice(0, 1), label: "from FreeShow" }) }, icon("download"),
      h("div", h("b", fsInfo.folders.length ? `Everything from FreeShow (${fsInfo.shows} songs found)` : "From FreeShow"), h("span", fsInfo.folders.length ? fsInfo.folders[0] : "FreeShow wasn't found on this computer. Use “A folder” and choose FreeShow's Shows folder."))),
    h("button.imp-card", { onclick: async () => { const f = await scc.importer.pickFolder(); if (f.length) start({ folders: f, label: "from your folder" }); } }, icon("list"),
      h("div", h("b", "A folder (and everything inside it)"), h("span", "FreeShow .show, OpenLP / OpenLyrics .xml, text .txt and shared .sccshow files"))),
    h("button.imp-card", { onclick: async () => { const f = await scc.importer.pickFiles(); if (f.length) start({ files: f, label: "your files" }); } }, icon("music"),
      h("div", h("b", "Some files"), h("span", "Pick one or many song files"))),
    h("div.hint", "OpenLP: File → Export → Song → OpenLyrics, then import that folder here. Songs already in your library are skipped, so it's safe to run again."));
  const draw = (p) => body.replaceChildren(p && p.status !== "idle" ? progressView(p) : chooser());
  importView = (p) => { if (body.isConnected) draw(p); };
  modal({ title: "Import songs", width: 600, body, actions: [{ label: "Close", kind: "primary" }], onClose: () => { importView = null; } });
  draw(lastImport.status === "running" ? lastImport : { status: "idle" });
}
