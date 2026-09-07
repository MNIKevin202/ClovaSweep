#!/usr/bin/env node
/**
 * Repairs the local Electron install on hardened macOS setups.
 *
 * On some Macs (aggressive XProtect / endpoint security), the Electron binary
 * that npm extracts is flagged as damaged/malware and removed, because the
 * default extraction can mangle the app bundle's symlinks and code signature.
 *
 * This re-extracts the cached Electron zip with `ditto` (which preserves macOS
 * metadata + symlinks), clears the quarantine attribute, and ad-hoc re-signs
 * the bundle so Gatekeeper accepts it for local runs. It is a no-op on CI /
 * non-macOS and only runs when the binary is actually missing/broken.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

if (process.platform !== 'darwin') {
  console.log('[fix-electron] not macOS — nothing to do')
  process.exit(0)
}

const electronDir = join(process.cwd(), 'node_modules', 'electron')
if (!existsSync(electronDir)) {
  console.error('[fix-electron] node_modules/electron not found — run npm install first')
  process.exit(0)
}

const version = readFileSync(join(electronDir, 'package.json'), 'utf8')
const ver = JSON.parse(version).version
const distDir = join(electronDir, 'dist')
const binary = join(distDir, 'Electron.app', 'Contents', 'MacOS', 'Electron')
const frameworks = join(distDir, 'Electron.app', 'Contents', 'Frameworks')

function distLooksHealthy() {
  return existsSync(binary) && existsSync(frameworks) && readdirSync(frameworks).length > 0
}

if (distLooksHealthy()) {
  // Ensure signature is valid; if it is, we're done.
  try {
    execFileSync('codesign', ['--verify', join(distDir, 'Electron.app')], { stdio: 'ignore' })
    console.log('[fix-electron] Electron dist looks healthy — nothing to do')
    process.exit(0)
  } catch {
    console.log('[fix-electron] signature invalid — repairing')
  }
} else {
  console.log('[fix-electron] Electron dist missing/incomplete — repairing')
}

const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const zip = join(os.homedir(), 'Library', 'Caches', 'electron', `electron-v${ver}-darwin-${arch}.zip`)
if (!existsSync(zip)) {
  console.error(`[fix-electron] cached zip not found at ${zip}`)
  console.error('[fix-electron] run: npm rebuild electron   (to download it), then re-run this script')
  process.exit(1)
}

rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })
console.log('[fix-electron] extracting with ditto…')
execFileSync('ditto', ['-x', '-k', zip, distDir], { stdio: 'inherit' })
const appPath = join(distDir, 'Electron.app')
console.log('[fix-electron] clearing extended attributes…')
try { execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' }) } catch {}
console.log('[fix-electron] ad-hoc re-signing…')
execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
writeFileSync(join(electronDir, 'path.txt'), 'Electron.app/Contents/MacOS/Electron')
execFileSync('codesign', ['--verify', '--verbose', appPath], { stdio: 'inherit' })
console.log('[fix-electron] done — Electron is ready')
