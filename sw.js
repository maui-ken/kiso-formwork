/* 基礎型枠 PWA  Service Worker — オフライン対応 */
const CACHE = "kiso-formwork-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./engine.js",
  "./sync.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
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

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;
  // オフラインでも使えるよう、Firebase SDK と QR ライブラリの静的スクリプトはキャッシュ対象。
  const cacheableCDN =
    url.origin === "https://www.gstatic.com" && url.pathname.indexOf("/firebasejs/") === 0 ||
    url.origin === "https://cdnjs.cloudflare.com" && url.pathname.indexOf("/ajax/libs/qrcode-generator/") === 0;
  // Firestore/Auth などのリアルタイムAPI通信はSWを通さない（同期を壊さないため）。
  if (!sameOrigin && !cacheableCDN) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => {
      // オフライン時のフォールバックは「ページ遷移」だけ index.html を返す。
      // CSS/JS などへ index.html を返すとスタイルが壊れる（＝辞書のような無地表示）ため返さない。
      if (e.request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    }))
  );
});
