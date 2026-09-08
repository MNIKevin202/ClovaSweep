#!/usr/bin/env node
/**
 * Generates every icon resource ClovaSweep needs from the single source
 * artwork (assets/ClovaSweep_Icon.png). Nothing here redesigns the icon.
 *
 * Two steps:
 *  1. `tauri icon` derives the full desktop icon set (icon.icns, icon.ico,
 *     32x32.png, 128x128.png, 128x128@2x.png, icon.png) into src-tauri/icons/.
 *     Run this manually if you ever replace the source artwork:
 *       npx tauri icon assets/ClovaSweep_Icon.png -o src-tauri/icons
 *     (then delete the unused src-tauri/icons/android and /ios folders it
 *     also produces, and the Windows Store Square*Logo.png / StoreLogo.png).
 *
 *  2. This script additionally renders the macOS menu-bar template icon
 *     (a monochrome broom glyph, since macOS needs a template image that
 *     auto-inverts for light/dark menu bars — not just a scaled-down copy of
 *     the full-colour app icon) using a tiny built-in rasterizer, so no
 *     external image toolchain (ImageMagick / rsvg) is required.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let _crcTable = null
const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const iconsDir = path.join(root, 'src-tauri', 'icons')
mkdirSync(iconsDir, { recursive: true })

for (const [size, name] of [
  [16, 'trayTemplate.png'],
  [32, 'trayTemplate@2x.png'],
  [48, 'trayTemplate@3x.png'],
  [32, 'tray-win.png'] // Windows tray: small full-colour icon (no template inversion there)
]) {
  const isColor = name === 'tray-win.png'
  writeFileSync(path.join(iconsDir, name), encodePng(drawBroom(size, isColor)))
}

console.log('[icons] wrote tray icons to src-tauri/icons/:')
console.log('  trayTemplate.png / @2x / @3x (macOS menu bar, monochrome template)')
console.log('  tray-win.png (Windows tray, colour)')
console.log('')
console.log('[icons] Reminder: the main app icon set (icon.icns/.ico/*.png) is generated')
console.log('  by `npx tauri icon assets/ClovaSweep_Icon.png -o src-tauri/icons` — only')
console.log('  re-run that if the source artwork changes.')

// ---------------------------------------------------------------------------
// Tiny rasterizer + PNG encoder (RGBA, 8-bit). For the mac template, pixels
// are black with an alpha mask so macOS treats it as a template image
// (automatic light/dark inversion). For the coloured Windows variant, pixels
// use the brand coral.
// ---------------------------------------------------------------------------

function drawBroom(size, color) {
  const px = new Uint8ClampedArray(size * size * 4)
  const S = size
  const P = (x, y) => [x * S, y * S]

  const [hx0, hy0] = P(0.34, 0.70)
  const [hx1, hy1] = P(0.82, 0.20)
  const handleR = 0.052 * S

  const apex = P(0.4, 0.58)
  const left = P(0.12, 0.9)
  const right = P(0.46, 0.86)
  const [bx0, by0] = P(0.3, 0.66)
  const [bx1, by1] = P(0.46, 0.6)
  const bandR = 0.055 * S

  const [r, g, b] = color ? [255, 94, 108] : [0, 0, 0] // brand coral for Windows, black (template) for mac

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
        px[i] = r
        px[i + 1] = g
        px[i + 2] = b
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
  const area = edge(a[0], a[1], b, c)
  const s = area < 0 ? -1 : 1
  const w0 = edge(px, py, b, c) * s
  const w1 = edge(px, py, c, a) * s
  const w2 = edge(px, py, a, b) * s
  const m = Math.min(w0, w1, w2)
  return Math.max(0, Math.min(1, m + 0.5))
}

function encodePng({ width, height, data }) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

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
