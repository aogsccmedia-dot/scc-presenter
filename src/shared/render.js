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
`;
function injectCss(doc) {
  if (doc.getElementById("scc-render-css")) return;
  const s = doc.createElement("style"); s.id = "scc-render-css"; s.textContent = CSS; doc.head.appendChild(s);
}

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
    const key = state.transparent ? "transparent" : b.type === "image" || b.type === "video" ? `${b.type}:${b.src}` : `css:${bgCss(theme, b)}`;
    if (key === bgKey) return; bgKey = key;
    bg.innerHTML = ""; bg.style.background = "";
    if (state.transparent) { bg.style.background = "transparent"; return; }
    if (b.type === "image" && b.src) { const i = doc.createElement("img"); i.src = mediaUrl(b.src); i.alt = ""; bg.appendChild(i); }
    else if (b.type === "video" && b.src) {
      const v = doc.createElement("video"); v.src = mediaUrl(b.src); v.autoplay = true; v.loop = b.loop !== false; v.muted = opts.muted !== false || b.muted !== false; v.playsInline = true;
      bg.appendChild(v); v.play?.().catch(() => {});
    } else bg.style.background = bgCss(theme, b);
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
    fit(frame, canvas);
  }
  return { update, frame, destroy() { ro?.disconnect(); frame.remove(); } };
}
