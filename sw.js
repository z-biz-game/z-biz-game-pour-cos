'use strict';
// 离线壳：同源 GET 一律「网络优先、失败退缓存」，断网时回落到上次成功抓取的副本。
//
// 为什么不是 cache-first：手工 VERSION 号 + cache-first 会把 js/css 钉死在旧版 ——
// 出新 HTML 配旧 JS 的鬼状态在真机上无法自愈（本仓 js/main.js 与 index.html 的按钮 id
// 必须同代，一旦错开就是点什么都没反应）。缓存名仍带版本号，用于 activate 时整代换掉。
var VERSION = 'pour-v1';

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) {
      return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  ev.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      if (hit) return hit;
      // 导航请求兜回壳本体，离线打开不白屏；其余资源诚实地报错。
      return req.mode === 'navigate' ? caches.match('index.html') : Response.error();
    });
  }));
});
