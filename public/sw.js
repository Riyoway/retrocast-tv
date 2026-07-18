const CACHE = 'retrocast-shell-v7'
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.ico',
  './favicon-16x16.png',
  './favicon-32x32.png',
  './favicon-48x48.png',
  './apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './og-image.png',
  './frames/modern.webp',
  './frames/crt.webp',
  './frames/mono.webp',
  './frames/vhs.webp',
  './frames/lcd.webp',
  './frames/portable.webp',
  './frames/custom.webp',
  './remote/remote.webp',
]

const cacheRequest = async (cache, url) => {
  try {
    await cache.add(new Request(url, { cache: 'reload' }))
  } catch {
    // A single optional asset should not break installation.
  }
}

const cacheBuildAssets = async (cache) => {
  try {
    const response = await fetch('./index.html', { cache: 'reload' })
    const html = await response.clone().text()
    await cache.put('./index.html', response.clone())
    await cache.put('./', new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    const assets = Array.from(html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g), ([, url]) => url)
    await Promise.allSettled(assets.map((url) => cacheRequest(cache, url)))
  } catch {
    // Dev previews and first-run network hiccups still get the fixed shell cache.
  }
}

self.addEventListener('install', (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE)
  await Promise.allSettled(PRECACHE.map((url) => cacheRequest(cache, url)))
  await cacheBuildAssets(cache)
  await self.skipWaiting()
})()))

self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const keys = await caches.keys()
  await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
  await self.clients.claim()
})()))

const cachedFirst = async (request) => {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  const cache = await caches.open(CACHE)
  cache.put(request, response.clone())
  return response
}

const networkFirstPage = async (request) => {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    cache.put('./index.html', response.clone())
    cache.put('./', response.clone())
    return response
  } catch {
    return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstPage(event.request))
    return
  }
  const cacheableAsset = ['image', 'script', 'style', 'font', 'manifest', 'audio', 'video'].includes(event.request.destination)
    || url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/frames/')
    || url.pathname.startsWith('/remote/')
    || url.pathname.startsWith('/icons/')
    || url.pathname.endsWith('.ico')
  if (cacheableAsset) event.respondWith(cachedFirst(event.request))
})
