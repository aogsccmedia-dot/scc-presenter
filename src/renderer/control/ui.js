// Small UI helpers: element builder, toasts, dialogs. No framework, so the app starts instantly.

/** h("button.primary", { onclick }, "Save") */
export function h(sel, attrs = {}, ...kids) {
  const [tag, ...classes] = sel.split(".");
  const el = document.createElement(tag || "div");
  if (classes.length) el.className = classes.join(" ");
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = {}; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className += (el.className ? " " : "") + v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

export const icon = (name, cls = "") => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `ic ${cls}`); svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`); svg.appendChild(use);
  return svg;
};

let toastHost;
export function toast(message, kind = "info", ms = 3200) {
  toastHost ||= document.body.appendChild(h("div.toasts", { role: "status", "aria-live": "polite" }));
  const t = h(`div.toast.${kind}`, message);
  toastHost.appendChild(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 250); }, ms);
}

const openModals = [];
export const modalOpen = () => openModals.length > 0;

/** modal({ title, body, actions:[{label, kind, onClick}], width }) → { close, el }. onClick returning false keeps it open. */
export function modal({ title, body, actions = [], width = 560, onClose, className = "" }) {
  const prev = document.activeElement;
  const box = h(`div.modal ${className}`, { role: "dialog", "aria-modal": "true", "aria-label": title, style: { width: `min(${width}px, calc(100vw - 32px))` } });
  const veil = h("div.veil", box);
  const close = () => {
    if (!veil.isConnected) return;
    veil.classList.remove("in");
    setTimeout(() => veil.remove(), 160);
    openModals.splice(openModals.indexOf(close), 1);
    document.removeEventListener("keydown", onKey, true);
    onClose?.(); prev?.focus?.();
  };
  const onKey = (e) => { if (e.key === "Escape" && openModals.at(-1) === close) { e.stopPropagation(); e.preventDefault(); close(); } };
  const foot = h("footer");
  for (const a of actions) {
    const b = h(`button.btn${a.kind ? `.${a.kind}` : ""}`, { type: "button" }, a.label);
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      b.disabled = true; b.classList.add("busy");
      try { const r = await a.onClick?.(); if (r !== false) close(); }
      catch (err) { toast(err.message || String(err), "error"); }
      finally { b.disabled = false; b.classList.remove("busy"); }
    });
    foot.appendChild(b);
  }
  box.append(h("header", h("h2", title), h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: close }, icon("x"))), h("div.modal-body", body), ...(actions.length ? [foot] : []));
  veil.addEventListener("mousedown", (e) => { if (e.target === veil) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(veil);
  openModals.push(close);
  requestAnimationFrame(() => { veil.classList.add("in"); (box.querySelector("[autofocus]") || box.querySelector("input,textarea,select") || box.querySelector("footer .primary"))?.focus(); });
  return { close, el: box };
}

export function confirmBox(message, { ok = "Delete", kind = "danger", detail = "" } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title: message, width: 420, body: detail ? h("p.muted", detail) : h("span"),
      actions: [{ label: "Cancel" }, { label: ok, kind, onClick: () => { answered = true; resolve(true); } }],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/** Ask for one line of text. Resolves to the text or null. */
export function askText(title, { value = "", placeholder = "", ok = "Save" } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = h("input.input", { value, placeholder, autofocus: true });
    const m = modal({
      title, width: 440, body: input,
      actions: [{ label: "Cancel" }, { label: ok, kind: "primary", onClick: () => { const v = input.value.trim(); if (!v) { input.focus(); return false; } done = true; resolve(v); } }],
      onClose: () => { if (!done) resolve(null); },
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") m.el.querySelector("footer .primary").click(); });
  });
}

export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
