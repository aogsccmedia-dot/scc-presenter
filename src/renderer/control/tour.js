// First-run tour: a spotlight moves over each part of the screen with a small card saying what it does.
// Afterwards, tiny hints pop up over buttons (hover or long-press) so nobody has to read a manual.
import { h } from "./ui.js";

const STEPS = [
  [".library .tabs", "Pick what to show", "Songs, Bible, pictures and videos, and text slides live here."],
  ['.tabs [data-tab="bible"]', "Bible in three taps", "Tap a book, a chapter, then the verses. Or just type John 3:16."],
  ["#slides", "Click a slide to show it", "The slide with the red border is on screen."],
  ["#btnNext", "Next", "Moves to the next slide. The → key or Space does the same."],
  ["#btnOutput", "Projector screen", "Opens the screen for the projector or TV. Put it on that screen and make it full screen."],
  [".quick", "Black, Clear, Logo", "One tap to hide everything, hide just the words, or show your logo."],
  [".service", "Your service order", "Add songs and verses here with “Add to service”. Next runs through the whole service."],
  ["#btnLive", "Live studio", "Cameras, ATEM, lower thirds, timers and streaming."],
  ["#btnHelp", "Help any time", "Tap here to see this tour again."],
];

let active = null;
export function startTour(onDone) {
  if (active) return;
  const steps = STEPS.filter(([sel]) => { const el = document.querySelector(sel); return el && el.offsetParent !== null; });
  if (!steps.length) return;
  let i = 0;
  const hole = h("div.tour-hole"), card = h("div.tour-card", { role: "dialog", "aria-live": "polite" });
  const root = h("div.tour", hole, card);
  document.body.append(root);
  const end = () => { root.remove(); removeEventListener("keydown", keys, true); removeEventListener("resize", place); active = null; onDone?.(); };
  const keys = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); end(); }
    if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") { e.preventDefault(); next(); }
    if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
  };
  const next = () => { if (i < steps.length - 1) { i++; place(); } else end(); };
  const back = () => { if (i > 0) { i--; place(); } };
  function place() {
    const [sel, title, text] = steps[i], el = document.querySelector(sel);
    if (!el) return next();
    el.scrollIntoView?.({ block: "nearest" });
    const r = el.getBoundingClientRect(), pad = 6;
    Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    card.replaceChildren(
      h("div.tour-step", `${i + 1} of ${steps.length}`), h("b", title), h("p", text),
      h("div.tour-acts", h("button.tour-skip", { type: "button", onclick: end }, "Skip"),
        i ? h("button.btn.small", { type: "button", onclick: back }, "Back") : null,
        h("button.btn.small.primary", { type: "button", onclick: next }, i === steps.length - 1 ? "Start" : "Next")));
    const cw = Math.min(300, innerWidth - 24), below = r.bottom + 14 + 170 < innerHeight;
    let left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), innerWidth - cw - 12);
    let top = below ? r.bottom + 14 : r.top - 14 - card.offsetHeight;
    if (top < 12) { top = Math.min(innerHeight - card.offsetHeight - 12, Math.max(12, r.top)); left = r.right + 14 + cw < innerWidth ? r.right + 14 : Math.max(12, r.left - cw - 14); }
    Object.assign(card.style, { width: `${cw}px`, left: `${left}px`, top: `${top}px` });
    card.querySelector(".btn.primary")?.focus();
  }
  addEventListener("keydown", keys, true); addEventListener("resize", place);
  active = root;
  requestAnimationFrame(place); setTimeout(place, 60);
}

// ---- Tiny hints: what a button does, shown on hover (desktop) or long-press (touch).
export function initHints(root = document) {
  const tip = h("div.hint-tip", { role: "tooltip" }); document.body.append(tip);
  let timer = 0, cur = null;
  const hide = () => { clearTimeout(timer); tip.classList.remove("in"); cur = null; };
  const show = (el) => {
    const text = el.dataset.tip; if (!text) return;
    tip.textContent = text; tip.classList.add("in");
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, hgt = tip.offsetHeight;
    const top = r.bottom + 8 + hgt < innerHeight ? r.bottom + 8 : r.top - hgt - 8;
    tip.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)}px`; tip.style.top = `${top}px`;
  };
  // Move native titles into quick hints (the browser's own tooltips are slow and don't work on touch).
  const adopt = () => root.querySelectorAll("button[title], select[title], label[title], [data-tab]").forEach((el) => {
    if (el.title) { el.dataset.tip = el.title; el.setAttribute("aria-label", el.getAttribute("aria-label") || el.title); el.removeAttribute("title"); }
  });
  adopt(); new MutationObserver(adopt).observe(root.body || root, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
  addEventListener("pointerover", (e) => {
    const el = e.target.closest?.("[data-tip]"); if (el === cur) return; hide(); if (!el || e.pointerType === "touch") return;
    cur = el; timer = setTimeout(() => show(el), 350);
  });
  addEventListener("pointerdown", (e) => { hide(); const el = e.target.closest?.("[data-tip]"); if (el && e.pointerType === "touch") { cur = el; timer = setTimeout(() => show(el), 450); } });
  addEventListener("pointerup", () => { if (cur) setTimeout(hide, 1600); clearTimeout(timer); });
  addEventListener("scroll", hide, true); addEventListener("keydown", hide);
}
