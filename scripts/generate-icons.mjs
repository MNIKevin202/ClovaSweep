#!/usr/bin/env node
/**
 * Generates every platform icon resource from the single source artwork
 * (assets/ClovaSweep_Icon.png). Nothing here redesigns the icon — it only
 * derives the formats each platform needs:
 *
 *   build/icon.icns          macOS app icon (electron-builder)
 *   build/icon.ico           Windows app icon (electron-builder)
 *   resources/icon.png       512px app icon (window / Linux / tray fallback)
 *   resources/icon.ico       Windows tray + window icon (colour)
 *   resources/trayTemplate.png (+@2x) macOS menu-bar template (monochrome broom)
 *
 * The macOS template is drawn by a tiny built-in rasterizer so no external
 * image toolchain (ImageMagick / rsvg) is required — only Node + sips.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import png2icons from 'png2icons'

let _crcTable = null
const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = path.join(root, 'assets', 'ClovaSweep_Icon.png')
const buildDir = path.join(root, 'build')
const resDir = path.join(root, 'resources')
const tmpDir = path.join(root, 'resources', 'icon-cache')

if (!existsSync(SRC)) {
  console.error(`[icons] source not found: ${SRC}`)
  process.exit(1)
}
mkdirSync(buildDir, { recursive: true })
mkdirSync(resDir, { recursive: true })
mkdirSync(tmpDir, { recursive: true })

const hasSips = process.platform === 'darwin'

function sipsResize(srcPng, size, outPng) {
  execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), srcPng, '--out', outPng], {
    stdio: 'ignore'
  })
}

// 1. Upscale the 500px source to 1024 for crisp icns/ico (sips on mac; else use source as-is).
const base1024 = path.join(tmpDir, 'base-1024.png')
if (hasSips) {
  sipsResize(SRC, 1024, base1024)
} else {
  writeFileSync(base1024, readFileSync(SRC))
}
const baseBuf = readFileSync(base1024)

// 2. App icons via png2icons (works everywhere, pure JS).
const icns = png2icons.createICNS(baseBuf, png2icons.BILINEAR, 0)
if (icns) writeFileSync(path.join(buildDir, 'icon.icns'), icns)
const ico = png2icons.createICO(baseBuf, png2icons.BILINEAR, 0, true)
if (ico) {
  writeFileSync(path.join(buildDir, 'icon.ico'), ico)
  writeFileSync(path.join(resDir, 'icon.ico'), ico)
}

// 3. 512px PNG for window / Linux / tray fallback.
if (hasSips) {
  sipsResize(SRC, 512, path.join(resDir, 'icon.png'))
} else {
  writeFileSync(path.join(resDir, 'icon.png'), readFileSync(SRC))
}

// 4. macOS menu-bar template (monochrome broom), drawn to a raw buffer + PNG-encoded.
for (const [size, name] of [
  [16, 'trayTemplate.png'],
  [32, 'trayTemplate@2x.png'],
  [48, 'trayTemplate@3x.png']
]) {
  writeFileSync(path.join(resDir, name), encodePng(drawBroomTemplate(size)))
}

console.log('[icons] generated:')
for (const f of ['build/icon.icns', 'build/icon.ico', 'resources/icon.png', 'resources/icon.ico', 'resources/trayTemplate.png']) {
  console.log('  ✓', f, existsSync(path.join(root, f)) ? '' : '(MISSING)')
}

// keep the cache dir out of git but leave it for reuse
try {
  rmSync(base1024, { force: true })
} catch {
  /* ignore */
}

// ---------------------------------------------------------------------------
// Tiny rasterizer + PNG encoder (RGBA, 8-bit). Black pixels with an alpha mask
// so macOS treats it as a template image (auto light/dark inversion).
// ---------------------------------------------------------------------------

/** Draw the broom glyph into an RGBA Uint8ClampedArray of size*size. */
function drawBroomTemplate(size) {
  const px = new Uint8ClampedArray(size * size * 4)
  const S = size
  const P = (x, y) => [x * S, y * S]

  // Handle: a rounded capsule from the bristle head up to the top-right.
  const [hx0, hy0] = P(0.34, 0.70)
  const [hx1, hy1] = P(0.82, 0.20)
  const handleR = 0.052 * S

  // Bristle head: a triangle fanning down-left.
  const apex = P(0.4, 0.58)
  const left = P(0.12, 0.9)
  const right = P(0.46, 0.86)
  // Binding band near the apex.
  const [bx0, by0] = P(0.3, 0.66)
  const [bx1, by1] = P(0.46, 0.6)
  const bandR = 0.055 * S

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = x + 0.5
      const cy = y + 0.5
      let cov = 0
      cov = Math.max(cov, capsuleCoverage(cx, cy, hx0, hy0, hx1, hy1, handleR))
      cov = Math.max(cov, capsuleCoverage(cx, cy, bx0, by0, bx1, by1, bandR))
      cov = Math.max(cov, triangleCoverage(cx, cy, apex, left, right))
      if (cov > 0) {
        const i = (y * S + x) * 4
        px[i] = 0
        px[i + 1] = 0
        px[i + 2] = 0
        px[i + 3] = Math.round(cov * 255)
      }
    }
  }
  return { width: S, height: S, data: px }
}

function capsuleCoverage(px, py, ax, ay, bx, by, r) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * dx
  const qy = ay + t * dy
  const dist = Math.hypot(px - qx, py - qy)
  return Math.max(0, Math.min(1, r - dist + 0.5))
}

function edge(px, py, a, b) {
  return (px - a[0]) * (b[1] - a[1]) - (py - a[1]) * (b[0] - a[0])
}

function triangleCoverage(px, py, a, b, c) {
  // Ensure consistent winding.
  const area = edge(a[0], a[1], b, c)
  const s = area < 0 ? -1 : 1
  const w0 = edge(px, py, b, c) * s
  const w1 = edge(px, py, c, a) * s
  const w2 = edge(px, py, a, b) * s
  const m = Math.min(w0, w1, w2)
  // Simple 1px anti-aliased edge.
  return Math.max(0, Math.min(1, m + 0.5))
}

function encodePng({ width, height, data }) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Raw scanlines with filter byte 0.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < width * 4; x++) {
      raw[rowStart + 1 + x] = data[y * width * 4 + x]
    }
  }
  const idat = deflateSync(raw, { level: 9 })

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

function chunk(type, body) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(body.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])) >>> 0, 0)
  return Buffer.concat([len, typeBuf, body, crc])
}

function crcTable() {
  if (_crcTable) return _crcTable
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  _crcTable = t
  return t
}

function crc32(buf) {
  const table = crcTable()
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
