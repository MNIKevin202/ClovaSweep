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
- **Native feel** — inset traffic lights on macOS, native title bar on Windows, light/dark/system theming.

## Tech stack

**Tauri 2** (Rust backend, native WebView — no bundled Chromium/Node) + **React** frontend, **Vite** for the dev server/bundler, **Vitest** for the small frontend utility tests, **`cargo test`** for the Rust logic.

## Architecture

Platform-specific behavior is isolated behind clean interfaces; all decision logic is pure and unit-tested.

```
src/                    React frontend (Vite)
  lib/clovaBridge.ts      Implements window.clova via Tauri invoke/listen
  pages/, components/     Overview, Protected Apps, Cleanup, Analytics, Settings
  shared/                 Types + formatting shared with the Rust side (by shape)

src-tauri/              Rust backend
  src/core/                Pure, OS-independent logic (fully unit-tested, `cargo test`)
    identity.rs              Stable app identity + de-duplication
    safety.rs                System-critical / file-manager classification
    filter.rs                "What would a sweep do" — the single source of truth
    analytics.rs             Sweep-history aggregation
    cleanup_safety.rs         Deletion guards (no root wipes, no ".." escapes)
    migrations.rs             Store schema + validation/migration
  src/platform/            ApplicationDiscovery / Terminator / StorageProvider / IconProvider
    macos/                    JXA + AppKit bridge (NSWorkspace / NSRunningApplication) via osascript
    windows/                  PowerShell (Get-Process, CloseMainWindow, Shell.Application)
  src/services/            Store (atomic JSON), sweep executor, AppServices facade, startup
  src/commands.rs          Tauri command surface (invoke handlers)
  src/tray.rs, src/lib.rs  Tray/menu-bar controller, window + plugin wiring
```

## Development

```bash
npm install              # install frontend dependencies
npm run icons             # regenerate tray icons from assets/ClovaSweep_Icon.png
                           # (the main app icon set is generated separately, see below)
npm run dev               # run the app with hot reload (tauri dev)
npm test                  # run the frontend unit tests
npm run test:rust         # run the Rust unit tests (cargo test)
npm run typecheck         # type-check the frontend
npm run lint               # lint the frontend
npm run lint:rust          # clippy, warnings as errors
```

To regenerate the **main app icon set** (icon.icns/.ico/*.png) if the source artwork ever changes:

```bash
npx tauri icon assets/ClovaSweep_Icon.png -o src-tauri/icons
# then delete the unused .../icons/android, .../icons/ios, and Windows Store
# Square*Logo.png / StoreLogo.png files it also generates.
```

## Building installers

```bash
npm run build             # → src-tauri/target/release/bundle/
                           #   macOS: dmg/ (.dmg), macos/ (.app.tar.gz)
                           #   Windows: nsis/ (Setup .exe), msi/ (.msi)
```

CI (GitHub Actions) builds, tests, lints, and packages both platforms on every push.

### Code signing

Builds are **unsigned** unless signing credentials are supplied via the standard
Tauri/electron-builder-style environment variables (see the
[Tauri code-signing docs](https://tauri.app/distribute/sign/)):

- **macOS**: set up a signing identity + notarization credentials for `tauri build` to sign & notarize.
- **Windows**: set up an Authenticode certificate for signing the NSIS/MSI installer.

Everything else builds and runs without them.

### Downloads / public releases

Public downloads (`.dmg` / `.exe`) are mirrored to a separate, public,
downloads-only repo so this source repo can stay private:
**[MNIKevin202/ClovaSweep-releases](https://github.com/MNIKevin202/ClovaSweep-releases)**.

Pushing a `v*` tag here builds installers on both platforms and (once
configured) mirrors them there automatically. To enable the mirror:

1. Create a fine-grained GitHub PAT scoped to just the `ClovaSweep-releases`
   repo with **Contents: Read and write** permission (Settings → Developer
   settings → Fine-grained tokens).
2. Add it as a repo secret here named `RELEASES_REPO_TOKEN`
   (Settings → Secrets and variables → Actions → New repository secret).

Until that secret exists, the "Publish to public releases repo" CI step is a
no-op — everything else in CI is unaffected. Without it, mirror a release
manually:

```bash
gh release create vX.Y.Z --repo MNIKevin202/ClovaSweep-releases \
  src-tauri/target/release/bundle/dmg/*.dmg \
  src-tauri/target/release/bundle/nsis/*.exe
```

## License

MIT © Clova Suite
