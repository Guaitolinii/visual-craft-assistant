// Service worker do app web do Sintoniza (/app/).
// Só guarda o "shell" (página, manifest, ícones e bibliotecas) para abrir offline e mais rápido.
// NUNCA guarda: API do site (/api/), login (/auth/), banco (/rest/), outras origens (provedores,
// Supabase), requisições com Range (vídeo) nem qualquer coisa que não seja GET.
// BUILD_ID muda a cada build (hash do index.html): caches antigos são apagados ao ativar.
const BUILD_ID = "__BUILD_ID__";
const CACHE = "sintoniza-web-" + BUILD_ID;
const PREFIXO = "sintoniza-web-";
// Itens indispensáveis (se algum falhar, a instalação falha) e opcionais (bibliotecas).
const SHELL = __SHELL__;
const OPCIONAIS = __OPCIONAIS__;

self.addEventListener("install", (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await Promise.all(OPCIONAIS.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n.indexOf(PREFIXO) === 0 && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Rede primeiro (com limite de tempo) e cache como reserva: a página sempre é a mais nova quando há internet.
async function redePrimeiro(req, chaveReserva) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error("tempo")), 5000)),
    ]);
    if (resp && resp.ok && !resp.redirected) cache.put(chaveReserva || req, resp.clone());
    return resp;
  } catch (e) {
    const guardado = await cache.match(chaveReserva || req, { ignoreSearch: true });
    if (guardado) return guardado;
    throw e;
  }
}

// Cache primeiro: bibliotecas e ícones têm versão fixa.
async function cachePrimeiro(req) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(req);
  if (guardado) return guardado;
  const resp = await fetch(req);
  if (resp && resp.ok) cache.put(req, resp.clone());
  return resp;
}

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  if (req.headers.has("range")) return; // vídeo e downloads parciais: direto na rede
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // provedores, Supabase, imagens externas
  const p = url.pathname;
  if (p.indexOf("/api/") === 0 || p.indexOf("/auth/") === 0 || p.indexOf("/rest/") === 0) return;
  if (p.indexOf("/app/") !== 0) return;
  if (req.mode === "navigate" || p === "/app/" || p === "/app/index.html") {
    ev.respondWith(redePrimeiro(req, "/app/"));
    return;
  }
  if (p === "/app/manifest.webmanifest") {
    ev.respondWith(redePrimeiro(req));
    return;
  }
  if (p.indexOf("/app/vendor/") === 0 || p.indexOf("/app/icons/") === 0) {
    ev.respondWith(cachePrimeiro(req));
  }
});
