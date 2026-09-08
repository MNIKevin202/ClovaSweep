//! Tray / menu-bar controller — the primary ClovaSweep experience.
//!
//! A normal (left) click performs a Sweep immediately (or opens the
//! dashboard if the user prefers). A right click (and, on Windows, a left
//! click too — Windows convention) opens a compact, native context menu. The
//! macOS menu bar uses a monochrome template image that adapts to
//! light/dark; Windows uses the full-colour icon.

use crate::{perform_sweep, show_dashboard, quit};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let sweep_now = MenuItem::with_id(app, "sweep_now", "Sweep Now", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open_dashboard", "Open ClovaSweep", true, None::<&str>)?;
    let protected = MenuItem::with_id(app, "protected_apps", "Protected Apps", true, None::<&str>)?;
    let cleanup = MenuItem::with_id(app, "cleanup", "Cleanup", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit ClovaSweep", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;

    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&sweep_now, &sep, &open, &protected, &cleanup, &settings, &sep2, &quit_item])?;

    // Embedded at compile time — no runtime resource-path resolution needed
    // (dev vs. packaged paths differ; a few hundred bytes each isn't worth it).
    // Embedded at compile time — no runtime resource-path resolution needed
    // (dev vs. packaged paths differ; a few hundred bytes each isn't worth it).
    #[cfg(target_os = "macos")]
    let tray_icon_bytes: &[u8] = include_bytes!("../icons/trayTemplate.png");
    #[cfg(not(target_os = "macos"))]
    let tray_icon_bytes: &[u8] = include_bytes!("../icons/tray-win.png");
    let icon = tauri::image::Image::from_bytes(tray_icon_bytes).ok().or_else(|| app.default_window_icon().cloned());

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("ClovaSweep — click to sweep")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "sweep_now" => perform_sweep(app, true),
            "open_dashboard" => show_dashboard(app, Some("overview")),
            "protected_apps" => show_dashboard(app, Some("protected")),
            "cleanup" => show_dashboard(app, Some("cleanup")),
            "settings" => show_dashboard(app, Some("settings")),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                let click_opens_dashboard = app
                    .try_state::<crate::services::app_services::AppServices>()
                    .map(|s| s.get_settings().click_opens_dashboard)
                    .unwrap_or(false);
                if click_opens_dashboard {
                    show_dashboard(app, Some("overview"));
                } else {
                    perform_sweep(app, true);
                }
            }
        });

    if let Some(icon) = icon {
        builder = builder.icon(icon);
        if cfg!(target_os = "macos") {
            builder = builder.icon_as_template(true);
        }
    }

    builder.build(app)?;
    Ok(())
}
