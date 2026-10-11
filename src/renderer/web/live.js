// Live state feed: inside the app it comes over IPC; in a browser / OBS it comes from the local server.
export function subscribe(cb) {
  if (window.scc?.live) {
    window.scc.live.get().then(cb).catch(() => {});
    return window.scc.live.onState(cb);
  }
  let es;
  const connect = () => {
    es = new EventSource("/events");
    es.onmessage = (e) => { try { cb(JSON.parse(e.data)); } catch { /* ignore */ } };
    es.onerror = () => { document.documentElement.dataset.offline = "1"; };
    es.onopen = () => { delete document.documentElement.dataset.offline; };
  };
  connect();
  return () => es?.close();
}
export const mediaUrl = (id) => `/media/${encodeURIComponent(id)}`;
