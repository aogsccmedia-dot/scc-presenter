const $ = (id) => document.getElementById(id);
let pin = sessionStorageGet("scc-pin");
let busy = false;

function sessionStorageGet(k) { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } }

async function load() {
  const r = await fetch(`/api/remote?pin=${encodeURIComponent(pin)}`);
  if (r.status === 401) return showLogin("Wrong PIN, or too many tries — wait a minute and try again.");
  if (!r.ok) return;
  render(await r.json());
}
async function send(body) {
  if (busy) return; busy = true;
  try {
    const r = await fetch("/api/remote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, pin }) });
    if (r.status === 401) return showLogin("Wrong PIN.");
    if (r.ok) render(await r.json());
  } finally { busy = false; }
}
function showLogin(msg) { $("app").hidden = true; $("login").hidden = false; $("err").textContent = msg || ""; }

function render(v) {
  $("login").hidden = true; $("app").hidden = false;
  $("title").textContent = v.title || "Nothing selected";
  $("pos").textContent = v.slides?.length ? `${v.index + 1} / ${v.slides.length}` : "";
  const ol = $("slides");
  ol.replaceChildren(...(v.slides || []).map((s, i) => {
    const li = document.createElement("li");
    li.className = i === v.index ? "live" : "";
    const small = document.createElement("small"); small.textContent = s.label || `Slide ${i + 1}`;
    li.append(small, document.createTextNode(s.text || ""));
    li.addEventListener("click", () => send({ action: "go", index: i }));
    return li;
  }));
  ol.querySelector(".live")?.scrollIntoView({ block: "center", behavior: "smooth" });
  for (const b of document.querySelectorAll(".tog")) b.classList.toggle("on", !!v[b.dataset.act === "black" ? "blackout" : b.dataset.act]);
}

$("login").addEventListener("submit", (e) => { e.preventDefault(); pin = $("pin").value.trim(); sessionStorageSet("scc-pin", pin); load(); });
for (const b of document.querySelectorAll("nav button")) b.addEventListener("click", () => send({ action: b.dataset.act }));

if (pin) load(); else showLogin();
// Refresh when the presenter changes slides.
const es = new EventSource("/events");
let t; es.onmessage = () => { clearTimeout(t); if (pin && !$("app").hidden) t = setTimeout(load, 120); };
