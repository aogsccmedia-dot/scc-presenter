// Draws a slide on a fixed 1920×1080 canvas that is scaled to fit its box.
// The same code draws thumbnails, the live preview, the projector output, OBS and the stage screen,
// so what you see in the app is exactly what goes on screen.
import { themeById } from "./themes.js";

export const W = 1920, H = 1080;

const CSS = `
.scc-frame{position:relative;width:100%;height:100%;overflow:hidden;contain:strict}
.scc-canvas{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;overflow:hidden}
.scc-layer{position:absolute;inset:0}
.scc-bg>img,.scc-bg>video{width:100%;height:100%;object-fit:cover;display:block}
.scc-text{display:flex;flex-direction:column;padding:90px 140px;box-sizing:border-box;transition:opacity .35s ease}
.scc-text.v-top{justify-content:flex-start}.scc-text.v-middle{justify-content:center}.scc-text.v-bottom{justify-content:flex-end;padding-bottom:70px}
.scc-lines{white-space:pre-wrap;line-height:1.18;overflow-wrap:break-word;max-height:100%}
.scc-band .scc-box{background:rgba(0,0,0,.62);padding:28px 48px;border-radius:14px}
.scc-ref{margin-top:28px;font-size:44px;font-weight:600;letter-spacing:.02em;opacity:.9}
.scc-logo{display:flex;align-items:center;justify-content:center;background:#000;transition:opacity .4s ease}
.scc-logo img{max-width:46%;max-height:46%;object-fit:contain}
.scc-black{background:#000;transition:opacity .4s ease}
.scc-hide{opacity:0;pointer-events:none}
.scc-motion{position:absolute;inset:0;overflow:hidden}
.scc-motion i{position:absolute;display:block;border-radius:50%;will-change:transform}
.scc-calm .scc-motion i,.scc-calm .scc-motion{animation-play-state:paused!important}
@keyframes scc-drift{0%{transform:translate(-8%,-6%) scale(1)}50%{transform:translate(8%,6%) scale(1.15)}100%{transform:translate(-8%,-6%) scale(1)}}
@keyframes scc-rise{from{transform:translateY(0)}to{transform:translateY(-1300px)}}
@keyframes scc-spin{to{transform:rotate(360deg)}}
@keyframes scc-slide{from{transform:translateX(0)}to{transform:translateX(-50%)}}
`;
function injectCss(doc) {
  if (doc.getElementById("scc-render-css")) return;
  const s = doc.createElement("style"); s.id = "scc-render-css"; s.textContent = CSS; doc.head.appendChild(s);
}

export const MOTION = {
  aurora: { name: "Aurora", base: "#06121f", colors: ["#1fb6a6", "#3b5bdb", "#8e44ad"] },
  sunrise: { name: "Golden glow", base: "#1a0e02", colors: ["#f5b942", "#e8590c", "#c2255c"] },
  bokeh: { name: "Soft lights", base: "#0b0b14", colors: ["#ffd27a", "#9ec5ff", "#ffffff"] },
  rays: { name: "Light rays", base: "#0a0f1c", colors: ["#ffffff", "#9ec5ff"] },
  embers: { name: "Embers", base: "#120604", colors: ["#ff922b", "#ffd43b"] },
  waves: { name: "Ocean waves", base: "#04121c", colors: ["#1c7ed6", "#22b8cf", "#0b7285"] },
};
// Animated backgrounds made only of gradients moved with transform: smooth on any graphics chip, nothing to download.
export function motionLayer(doc, preset) {
  const p = MOTION[preset] || MOTION.aurora;
  const root = doc.createElement("div"); root.className = "scc-motion"; root.style.background = p.base;
  const rnd = mulberry(preset.length * 7919);
  const add = (style) => { const i = doc.createElement("i"); Object.assign(i.style, style); root.appendChild(i); return i; };
  if (preset === "rays") {
    add({ inset: "-60%", borderRadius: "0", background: `repeating-conic-gradient(from 0deg at 50% 0%, ${p.colors[0]}14 0deg 6deg, transparent 6deg 18deg)`, animation: "scc-spin 120s linear infinite" });
    add({ inset: "0", borderRadius: "0", background: `radial-gradient(ellipse at 50% -10%, ${p.colors[1]}55, transparent 60%)` });
  } else if (preset === "waves") {
    for (let k = 0; k < 3; k++) add({ left: "0", width: "200%", height: "60%", bottom: `${-10 + k * 8}%`, borderRadius: "0", opacity: String(0.35 + k * 0.15),
      background: `radial-gradient(60% 40% at 25% 100%, ${p.colors[k]} 0, transparent 70%), radial-gradient(60% 40% at 75% 100%, ${p.colors[k]} 0, transparent 70%)`, animation: `scc-slide ${40 - k * 9}s linear infinite` });
  } else if (preset === "bokeh" || preset === "embers") {
    const n = preset === "bokeh" ? 18 : 40;
    for (let k = 0; k < n; k++) {
      const size = preset === "bokeh" ? 60 + rnd() * 180 : 4 + rnd() * 8, c = p.colors[k % p.colors.length];
      add({ width: `${size}px`, height: `${size}px`, left: `${rnd() * 100}%`, top: `${100 + rnd() * 30}%`, opacity: String(preset === "bokeh" ? 0.12 + rnd() * 0.2 : 0.5 + rnd() * 0.5),
        background: `radial-gradient(circle, ${c} 0, ${c}00 70%)`, animation: `scc-rise ${preset === "bokeh" ? 40 + rnd() * 40 : 14 + rnd() * 16}s linear ${-rnd() * 60}s infinite` });
    }
  } else {
    p.colors.forEach((c, k) => add({ width: "90%", height: "90%", left: `${[-10, 30, 10][k]}%`, top: `${[-20, 10, 35][k]}%`, opacity: "0.55",
      background: `radial-gradient(circle, ${c} 0, ${c}00 65%)`, animation: `scc-drift ${26 + k * 9}s ease-in-out ${-k * 7}s infinite` }));
  }
  return root;
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Scales the canvas to fit its frame (letterboxed). */
function fit(frame, canvas) {
  const r = frame.getBoundingClientRect();
  const k = Math.min(r.width / W, r.height / H) || 0.0001;
  canvas.style.transform = `translate(${(r.width - W * k) / 2}px,${(r.height - H * k) / 2}px) scale(${k})`;
}

/** Largest font size (px) at which the text fits its box. */
export function autoFit(el, box, max = 96, min = 24) {
  let lo = min, hi = max, best = min;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    el.style.fontSize = mid + "px";
    if (el.scrollHeight <= box.h && el.scrollWidth <= box.w) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  el.style.fontSize = best + "px";
  return best;
}

function bgCss(theme, background) {
  if (background?.type === "color" && background.value) return background.value;
  return theme.bg;
}

/**
 * Creates a slide view inside `host`. Returns { update(state), destroy() }.
 * state: { slide:{text, reference}, themeId, themes, background:{type:'color'|'image'|'video', value|src}, blackout, clear, logo, logoSrc, transparent }
 * opts: { mediaUrl(src) → url, animate: bool, muted: bool }
 */
export function createView(host, opts = {}) {
  const doc = host.ownerDocument; injectCss(doc);
  const frame = doc.createElement("div"); frame.className = "scc-frame";
  const canvas = doc.createElement("div"); canvas.className = "scc-canvas";
  const bg = doc.createElement("div"); bg.className = "scc-layer scc-bg";
  const textWrap = doc.createElement("div"); textWrap.className = "scc-layer";
  const logo = doc.createElement("div"); logo.className = "scc-layer scc-logo scc-hide";
  const black = doc.createElement("div"); black.className = "scc-layer scc-black scc-hide";
  canvas.append(bg, textWrap, logo, black); frame.appendChild(canvas); host.appendChild(frame);
  const mediaUrl = opts.mediaUrl || ((s) => s);
  let bgKey = "", textKey = "", logoKey = "";
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => fit(frame, canvas)) : null;
  ro?.observe(frame); fit(frame, canvas);

  function setBackground(state, theme) {
    const b = state.background || {};
    const key = state.transparent ? "transparent" : b.type === "image" || b.type === "video" ? `${b.type}:${b.src}` : b.type === "motion" ? `motion:${b.preset}` : `css:${bgCss(theme, b)}`;
    if (key === bgKey) return; bgKey = key;
    bg.innerHTML = ""; bg.style.background = "";
    if (state.transparent) { bg.style.background = "transparent"; return; }
    if (b.type === "image" && b.src) { const i = doc.createElement("img"); i.src = mediaUrl(b.src); i.alt = ""; bg.appendChild(i); }
    else if (b.type === "video" && b.src) {
      const v = doc.createElement("video"); v.src = mediaUrl(b.src); v.autoplay = true; v.loop = b.loop !== false; v.muted = opts.muted !== false || b.muted !== false; v.playsInline = true;
      bg.appendChild(v); v.play?.().catch(() => {});
    } else if (b.type === "motion") bg.appendChild(motionLayer(doc, b.preset));
    else bg.style.background = bgCss(theme, b);
  }

  function setText(state, theme) {
    const s = state.slide || {};
    const text = state.clear ? "" : s.text || "";
    const ref = state.clear ? "" : s.reference || "";
    const key = `${theme.id}|${JSON.stringify(theme)}|${text}|${ref}|${state.transparent ? 1 : 0}`;
    if (key === textKey) return; textKey = key;
    const layer = doc.createElement("div");
    layer.className = `scc-layer scc-text v-${theme.valign || "middle"}${theme.band || state.transparent ? " scc-band" : ""}`;
    layer.style.textAlign = theme.align || "center";
    layer.style.alignItems = theme.align === "left" ? "flex-start" : theme.align === "right" ? "flex-end" : "center";
    const box = doc.createElement("div"); box.className = "scc-box";
    const lines = doc.createElement("div"); lines.className = "scc-lines";
    lines.textContent = theme.upper ? text.toUpperCase() : text;
    Object.assign(lines.style, { fontFamily: theme.font, fontWeight: String(theme.weight || 700), color: theme.color, textShadow: theme.shadow ? "0 4px 18px rgba(0,0,0,.65), 0 2px 4px rgba(0,0,0,.6)" : "none" });
    box.appendChild(lines);
    if (ref) { const r = doc.createElement("div"); r.className = "scc-ref"; r.textContent = ref; r.style.color = theme.refColor || theme.color; r.style.fontFamily = theme.font; box.appendChild(r); }
    layer.appendChild(box);
    if (!text && !ref) box.style.display = "none";
    textWrap.appendChild(layer);
    if (text) {
      const maxH = (theme.valign === "bottom" ? H * 0.38 : H - 180) - (ref ? 100 : 0);
      autoFit(lines, { w: W - 280 - (theme.band ? 96 : 0), h: maxH }, theme.maxSize || 96, 28);
    }
    const old = [...textWrap.children].filter((c) => c !== layer);
    if (opts.animate) {
      layer.style.opacity = "0";
      requestAnimationFrame(() => { layer.style.opacity = "1"; old.forEach((o) => { o.style.opacity = "0"; setTimeout(() => o.remove(), 400); }); });
    } else old.forEach((o) => o.remove());
  }

  function update(state = {}) {
    const theme = themeById(state.themeId, state.themes || []);
    setBackground(state, theme);
    setText(state, theme);
    const lk = state.logoSrc || "";
    if (lk !== logoKey) { logoKey = lk; logo.innerHTML = ""; if (lk) { const i = doc.createElement("img"); i.src = mediaUrl(lk); i.alt = ""; logo.appendChild(i); } }
    logo.classList.toggle("scc-hide", !state.logo);
    black.classList.toggle("scc-hide", !state.blackout);
    frame.classList.toggle("scc-calm", !!state.calm || !!opts.calm);
    fit(frame, canvas);
  }
  return { update, frame, destroy() { ro?.disconnect(); frame.remove(); } };
}
