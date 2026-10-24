'use strict';
// 离线可用 + 永不被旧缓存钉住。
//
// 两条实测换来的口径：
//   1) 一律 **网络优先**，命中网络才回填缓存。手工 VERSION + cache-first 的组合，
//      发出去的 HTML 会配上上一版的 js/css，出一个"新界面配旧逻辑"的鬼状态，
//      而且玩家自己无法恢复（只能等缓存过期）。
//   2) 缓存名带版本号（activate 时清掉非本版的名字）。改版**不需要**同步 bump：
//      同名文件重绘之后，网络优先这一条保证客户端下一次联网就拿到新字节。
const VERSION = 'pour-cos-v1';
const CACHE = `${VERSION}-shell`;
// 图标现在是真的 PNG 文件（icons/ 下那八张），所以缓存清单也得把它们算进来：
// 装到桌面/主屏时断网也要拿得到那张图，否则图标是一次 404。
const PRECACHE = ['index.html', 'manifest.webmanifest',
  'icons/favicon-16.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-maskable-192.png',
  'icons/icon-512.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', (ev) => {
  // 首屏那几件先抓下来：断网时至少能打开界面，而不是浏览器的错误页。
  ev.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  ev.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        // 导航请求（地址栏/刷新/桌面图标）离线时回落到缓存的那份壳，不白屏。
        if (req.mode === 'navigate') {
          const shell = await caches.match('index.html');
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
