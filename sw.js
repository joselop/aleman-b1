// Service worker: permite usar la web sin conexión (por ejemplo, en el avión).
// - La web (HTML, JS, CSS y el contenido empaquetado) se guarda al instalar y se actualiza cuando hay red.
// - Los audios se guardan cuando se descargan desde Ajustes → «Usar sin conexión», o al reproducirlos.
const SHELL = "dsfs-shell-v1";
const AUDIO = "dsfs-audio-v1";
const SHELL_FILES = ["./", "index.html", "assets/app.js", "assets/style.css", "assets/content-bundle.js", "audio/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("dsfs-") && k !== SHELL && k !== AUDIO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Audios: primero la caché; si no está, red (y se guarda para la próxima vez).
  if (url.origin === location.origin && /\/audio\/[0-9a-f]{8}\.mp3$/.test(url.pathname)) {
    e.respondWith(
      caches.open(AUDIO).then(async (c) => {
        const hit = await c.match(url.pathname);
        if (hit) return hit;
        const r = await fetch(req);
        if (r.ok) c.put(url.pathname, r.clone());
        return r;
      }),
    );
    return;
  }

  // Resto de la web (y las fuentes de Google): red primero; sin red, lo guardado.
  const sameOrigin = url.origin === location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !fonts) return;
  e.respondWith(
    fetch(req)
      .then((r) => {
        if (r.ok || r.type === "opaque") {
          const copy = r.clone();
          caches.open(SHELL).then((c) => c.put(req, copy));
        }
        return r;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? caches.match("index.html") : Response.error())),
  );
});
