/* sw.js: offline app shell (the pattern from the style guide's PWA page). Bump VERSION on every deploy that changes a precached file. */
const VERSION = 'v1'
const SHELL = `shell-${VERSION}`
const RUNTIME = 'runtime'
const RUNTIME_MAX = 60
const PRECACHE = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './engine.js',
  './manifest.webmanifest',
  './styleguide/styleguide.min.css',
  './styleguide/icons.css',
  './styleguide/styleguide.min.js',
  './styleguide/fonts/archivo-latin-var.woff2',
  './icons/icon-192.png',
  './icons/apple-touch-icon-180.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL)
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))
    // No skipWaiting() here: the page offers the update and asks for it.
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('shell-') && key !== SHELL) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const shell = await caches.open(SHELL)
      return (await shell.match(req, { ignoreSearch: true })) || (await shell.match('./index.html')) || fetch(req)
    })())
    return
  }

  event.respondWith((async () => {
    const hit = await (await caches.open(SHELL)).match(req)
    if (hit) return hit
    const runtime = await caches.open(RUNTIME)
    const cached = await runtime.match(req)
    const network = fetch(req).then(async (res) => {
      if (res.ok && res.type === 'basic') {
        await runtime.put(req, res.clone())
        const keys = await runtime.keys()
        for (const k of keys.slice(0, Math.max(0, keys.length - RUNTIME_MAX))) await runtime.delete(k)
      }
      return res
    })
    if (cached) { event.waitUntil(network.catch(() => {})); return cached }
    return network
  })())
})
