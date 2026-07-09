// EarthWISE 世界の国チャンピオン Service Worker
const CACHE = "world-champ-v4";
// ※ index.html は "/" にリダイレクトされるため、プリキャッシュには入れない（"./" を使う）
const ASSETS = [
  "./",
  "./countries.js",
  "./countries-110m.json",
  "./vendor/d3.min.js",
  "./vendor/topojson-client.min.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ナビゲーション（ページ遷移）は必ず「リダイレクトなしの応答」を返す。
// これをしないと、/index.html → / のリダイレクトを返した際に Chrome がページ表示を拒否する。
async function handleNavigate(request) {
  try {
    const res = await fetch(request);
    if (res.redirected) {
      // redirected フラグを消してクリーンな応答に作り直す
      const body = await res.blob();
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    return res;
  } catch (e) {
    // オフライン時はキャッシュしたトップページを返す
    const cached = await caches.match("./");
    return cached || Response.error();
  }
}

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return;      // ランキングAPIは常にネットワーク
  if (url.origin !== self.location.origin) return;   // 外部ドメインはそのまま

  if (e.request.mode === "navigate") {
    e.respondWith(handleNavigate(e.request));
    return;
  }

  // 静的ファイルは cache-first
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => undefined))
  );
});
