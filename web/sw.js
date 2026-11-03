/* 智选股 PWA Service Worker
 * 策略：
 *   - 静态资源（html/css/js/icons/manifest）：Cache First + 版本号更新
 *   - API 请求（/api/*）：Network Only（行情数据必须实时，绝不走缓存）
 *   - 导航请求（document）：Network First，失败回退到 offline.html
 */

const VERSION = 'zxg-v1';
const STATIC = VERSION + '-static';
const FALLBACK = VERSION + '-fallback';

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // 可能没有的离线兜底页面，下面判断
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC).then(cache =>
      Promise.all(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(() => { /* 单个加载失败不阻塞 install */ })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !k.startsWith('zxg-')).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // 只处理本域请求
  if (url.origin !== self.location.origin) return;

  // API 接口：网络优先 + 失败兜底
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then(resp => resp)
        .catch(() => {
          return new Response(
            JSON.stringify({ error: '网络离线，行情数据暂不可用，请检查连接后重试', code: 'offline' }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // 导航请求（浏览器地址栏访问）：网络优先
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(resp => {
          const copy = resp.clone();
          caches.open(FALLBACK).then(c => c.put(req, copy));
          return resp;
        })
        .catch(() =>
          caches.match(req).then(r => r || caches.match('./index.html'))
        )
    );
    return;
  }

  // 静态资源：Cache First
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        // 后台更新
        fetch(req).then(resp => {
          if (resp && resp.status === 200) {
            caches.open(STATIC).then(c => c.put(req, resp));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(STATIC).then(c => c.put(req, copy));
        }
        return resp;
      });
    })
  );
});
