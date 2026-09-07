<div align="center">

<img src="assets/ClovaSweep_Icon.png" width="120" alt="ClovaSweep" />

# ClovaSweep

**Instantly sweep away your running apps — while keeping the ones you protect.**

A small, fast, cross-platform desktop utility for macOS and Windows. A member of the Clova Suite.

</div>

---

ClovaSweep lives in your **menu bar (macOS)** or **system tray (Windows)**. A single click closes nearly everything you have open — gracefully — except the apps you have explicitly protected, ClovaSweep itself, and anything the OS needs to keep running. It also includes a safe, no-foot-guns storage **Cleanup**, local-only **Analytics**, and a polished dashboard.

## Features

- **One-click Sweep** — left-click the tray/menu-bar icon to gracefully close your running apps.
- **Protected Apps** — protect apps by *stable identity* (macOS bundle id / Windows executable path), so two apps that share a name (e.g. two "ChatGPT" builds) stay distinct and protection survives relaunches.
- **System-safe by design** — user-facing apps are discovered via native APIs (`NSWorkspace` on macOS, windowed processes on Windows); system daemons, the Finder/Explorer shell, and ClovaSweep itself are never terminated.
- **Graceful, then optional force** — apps get a proper quit request first; unresponsive apps are skipped (or force-quit only if you opt in).
- **Safe Cleanup** — real disk usage, Smart Cleanup for rebuildable caches/temp + the bin, and a *review-first* flow for Downloads/Desktop (selected items go to the Trash/Recycle Bin — reversible). Roots can never be recursively wiped.
- **Local Analytics** — sweeps, apps closed, most-closed apps, history. Never leaves your device.
- **Native feel** — inset traffic lights on macOS, a Windows 11 title-bar overlay on Windows, light/dark/system theming.

## Tech stack

Electron + TypeScript, React (via electron-vite) for the renderer, electron-builder for packaging, Vitest for tests.

## Architecture

Platform-specific behavior is isolated behind clean interfaces; all decision logic is pure and unit-tested.

```
src/
  shared/           Types shared across processes, formatting helpers, defaults
  main/
    core/           Pure, OS-independent logic (fully unit-tested)
      identity.ts     Stable app identity + de-duplication
      safety.ts       System-critical / file-manager classification
      filter.ts       "What would a sweep do" — the single source of truth
      analytics.ts    Sweep-history aggregation
      cleanupSafety.ts Deletion guards (no root wipes, no ".." escapes)
      migrations.ts   Store schema + validation/migration
    platform/       ApplicationDiscovery / Terminator / StorageProvider / IconProvider
      macos/          JXA + AppKit bridge (NSWorkspace / NSRunningApplication)
      windows/        PowerShell (Get-Process, CloseMainWindow, Shell.Application)
    services/       Store (atomic JSON), sweep executor, AppServices facade, startup
    tray.ts windows.ts ipc.ts index.ts
  preload/          contextBridge API exposed as window.clova
  renderer/         React dashboard (Overview, Protected Apps, Cleanup, Analytics, Settings)
```

## Development

```bash
npm install          # install dependencies
npm run icons        # regenerate icon resources from assets/ClovaSweep_Icon.png
npm run dev          # run the app with HMR
npm test             # run the unit-test suite
npm run typecheck    # type-check main + renderer
npm run lint         # lint
```

## Building installers

```bash
npm run build:mac    # → release/*.dmg, *.zip  (arm64 + x64)
npm run build:win    # → release/ClovaSweep-Setup-*.exe  (NSIS installer)
```

CI (GitHub Actions) builds and validates both platforms on every push.

### Code signing

Builds are **unsigned** unless signing credentials are supplied via the standard
electron-builder environment variables:

- **macOS**: set `CSC_LINK` / `CSC_KEY_PASSWORD` (and Apple notarization creds) to sign & notarize.
- **Windows**: set `CSC_LINK` / `CSC_KEY_PASSWORD` for Authenticode signing.

Everything else builds and runs without them.

## License

MIT © Clova Suite
