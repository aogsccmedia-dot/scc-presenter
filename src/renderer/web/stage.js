import { subscribe } from "./live.js";

const $ = (id) => document.getElementById(id);
let state = {};
const fmt = (ms) => { const neg = ms < 0; const s = Math.abs(Math.round(ms / 1000)); return `${neg ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

function fitText(el, maxVh) {
  let size = maxVh;
  el.style.fontSize = size + "vh";
  while (size > 2 && el.scrollHeight > el.clientHeight + 2) { size -= 0.4; el.style.fontSize = size + "vh"; }
}

function render() {
  const s = state;
  $("title").textContent = s.item?.title ? `${s.item.title}${s.item.count ? ` · ${s.item.index + 1}/${s.item.count}` : ""}` : "";
  $("nowLabel").textContent = s.blackout ? "Black screen" : s.clear ? "Text cleared" : s.slide?.label || "Now";
  $("now").textContent = s.slide?.text || (s.slide?.reference ? s.slide.reference : "");
  $("nextLabel").textContent = s.next ? `Next · ${s.next.label || ""}` : "Next";
  $("next").textContent = s.next?.text || "";
  const msg = $("message"); msg.hidden = !s.stageMessage; msg.textContent = s.stageMessage || "";
  fitText($("now"), 7); fitText($("next"), 4.6);
}
function tick() {
  $("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const t = state.timer, el = $("timer");
  if (t?.endsAt) { const left = t.paused ? t.left : t.endsAt - Date.now(); el.textContent = fmt(left); el.classList.toggle("over", left < 0); }
  else el.textContent = "";
}
subscribe((s) => { state = s; render(); tick(); });
setInterval(tick, 500);
addEventListener("resize", render);
