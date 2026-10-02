// make-icons.mjs: renders Glyphs' own app icons with Glyphs' own engine (engine.js), so the icon is made the way the app makes icons.
//   node tools/make-icons.mjs            (needs playwright-core and a Chromium; set CHROME_PATH if it is not found)
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let chromium
try { ({ chromium } = require('playwright-core')) } catch { ({ chromium } = require(process.env.PLAYWRIGHT_CORE || '/opt/node-tools/node_modules/playwright-core')) }

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
const server = createServer(async (req, res) => {
  try { const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); res.setHeader('content-type', types[extname(p)] || 'application/octet-stream'); res.end(await readFile(p)) }
  catch { res.statusCode = 404; res.end('not found') }
}).listen(0)
const port = server.address().port

// The mark: an open ring with a dot on the ring. Drawn thick enough that "solid" at half the tile gives the set's 2.2% line.
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <path d="M459.1 364 A230 230 0 1 1 459.1 148" fill="none" stroke="#000" stroke-width="22" stroke-linecap="round"/>
  <circle cx="486" cy="256" r="24"/></svg>`

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined })
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${port}/`)
await page.waitForFunction(() => window.Glyph)
const out = await page.evaluate(async (svg) => {
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode()
  const sh = Glyph.shape(img, { read: 'alpha', threshold: 50, smooth: 8, simplify: 0, invert: false, detail: 50 }, 1024)
  const make = (size, { scale, radius, bg = '#1c1c1c', fg = '#e5e5e5' }) => {
    const st = { layout: { scale, x: 0, y: 0, rotate: 0, flipH: false, flipV: false }, color: { fg, fgOpacity: 100, bgOn: true, bg, bgOpacity: 100, knockout: false, radius } }
    const stroke = Glyph.stroke(sh, { mode: 'solid', width: 0.022, position: 'center' }, scale / Math.max(sh.bbox[2], sh.bbox[3]))
    const c = Glyph.makeCanvas(size, size); Glyph.paint(c.getContext('2d'), size, sh, stroke, st)
    return c.toDataURL('image/png')
  }
  return {
    'icon-192.png': make(192, { scale: 0.5, radius: 22.37 }),
    'icon-512.png': make(512, { scale: 0.5, radius: 22.37 }),
    'icon-maskable-192.png': make(192, { scale: 0.46, radius: 0 }),   // full bleed; the mark stays inside the 80% safe circle
    'icon-maskable-512.png': make(512, { scale: 0.46, radius: 0 }),
    'apple-touch-icon-180.png': make(180, { scale: 0.5, radius: 0 }), // opaque; iOS rounds it
  }
}, MARK)
await mkdir(join(root, 'icons'), { recursive: true })
for (const [name, url] of Object.entries(out)) { await writeFile(join(root, 'icons', name), Buffer.from(url.split(',')[1], 'base64')); console.log('icons/' + name) }
await browser.close(); server.close()
