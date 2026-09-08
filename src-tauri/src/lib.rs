//! ClovaSweep — Tauri backend entry point.
//!
//! Boots the tray/menu-bar controller, the dashboard window (declared in
//! tauri.conf.json, created hidden) and the command surface. ClovaSweep is a
//! tray-first utility: closing the window hides it, and the app keeps
//! running until the user explicitly quits.

pub mod commands;
pub mod core;
pub mod platform;
pub mod services;
pub mod tray;
pub mod types;

use services::app_services::{AppServices, AppServicesOptions};
use services::store::Store;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_notification::NotificationExt;
use types::{Platform, SweepResult};

static IS_QUITTING: AtomicBool = AtomicBool::new(false);

const APP_BUNDLE_ID: &str = "com.clova.clovasweep";

/// Show the dashboard window, optionally navigating to a section first.
pub fn show_dashboard(app: &AppHandle, section: Option<&str>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        sync_dock(app, true);
        if let Some(section) = section {
            let _ = win.emit("clova://navigate", section);
        }
    }
}

fn sync_dock(app: &AppHandle, visible: bool) {
    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;
        let _ = app.set_activation_policy(if visible { ActivationPolicy::Regular } else { ActivationPolicy::Accessory });
    }
    let _ = (app, visible);
}

fn notification_body(result: &SweepResult) -> String {
    let closed = result.record.closed_count;
    if closed == 0 {
        return "Nothing to sweep — your workspace is already clear.".to_string();
    }
    let base = format!("Closed {closed} app{}", if closed == 1 { "" } else { "s" });
    if result.protected_skipped > 0 {
        format!("{base} · kept {} protected", result.protected_skipped)
    } else {
        base
    }
}

fn flash_tray_tooltip(app: &AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(text));
        let app = app.clone();
        let reset = "ClovaSweep — click to sweep".to_string();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(4));
            if let Some(tray) = app.tray_by_id("main-tray") {
                let _ = tray.set_tooltip(Some(reset.as_str()));
            }
        });
    }
}

/// Run a sweep, then notify (tray tooltip flash + OS notification) and emit
/// the events the dashboard listens for. Used by both the tray/menu path and
/// the `sweep` command (for a real, non-dry-run sweep).
pub fn run_sweep_and_notify(app: &AppHandle) -> SweepResult {
    let services = app.state::<AppServices>();
    let settings = services.get_settings();
    let result = services.sweep(false);

    flash_tray_tooltip(app, &format!("ClovaSweep — closed {} app{}", result.record.closed_count, if result.record.closed_count == 1 { "" } else { "s" }));

    if settings.show_notification_after_sweep {
        let _ = app.notification().builder().title("ClovaSweep").body(notification_body(&result)).show();
    }
    let _ = app.emit("clova://sweep-complete", &result);
    let _ = app.emit("clova://data-changed", ());
    result
}

/// Entry point for tray/menu-triggered sweeps: honours "confirm before
/// sweep" with a native dialog (the in-app Sweep button already gets its own
/// confirmation from the React UI, so `commands::sweep` skips this).
pub fn perform_sweep(app: &AppHandle, confirm: bool) {
    let services = app.state::<AppServices>();
    let settings = services.get_settings();
    if confirm && settings.confirm_before_sweep {
        let app = app.clone();
        app.dialog()
            .message("ClovaSweep will gracefully close your running apps, except the ones you have protected.")
            .title("Sweep now?")
            .buttons(MessageDialogButtons::OkCancelCustom("Sweep Now".into(), "Cancel".into()))
            .show(move |confirmed| {
                if confirmed {
                    run_sweep_and_notify(&app);
                }
            });
    } else {
        run_sweep_and_notify(app);
    }
}

pub fn quit(app: &AppHandle) {
    IS_QUITTING.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn build_app_services(app: &AppHandle) -> AppServices {
    let data_dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    let store = Store::new(data_dir.join("clovasweep-state.json"));
    let platform_services = platform::current();
    let opts = AppServicesOptions {
        self_bundle_id: Some(APP_BUNDLE_ID.to_string()),
        self_name: Some("ClovaSweep".to_string()),
        own_pids: HashSet::from([std::process::id()]),
        platform: Platform::current(),
    };
    AppServices::new(store, platform_services, opts)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_dashboard(app, Some("overview"));
        }))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_version,
            commands::get_platform,
            commands::list_running_apps,
            commands::get_sweep_preview,
            commands::sweep,
            commands::get_overview,
            commands::get_protected_apps,
            commands::protect_app,
            commands::unprotect_app,
            commands::get_app_icon,
            commands::get_settings,
            commands::update_settings,
            commands::get_analytics,
            commands::reset_analytics,
            commands::scan_cleanup,
            commands::list_cleanup_items,
            commands::run_smart_cleanup,
            commands::run_cleanup,
            commands::empty_trash,
            commands::set_smart_category,
            commands::open_dashboard,
            commands::quit_app,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let services = build_app_services(&handle);
            let settings = services.get_settings();

            commands::apply_theme(&handle, match settings.theme {
                types::ThemePreference::Light => "light",
                types::ThemePreference::Dark => "dark",
                types::ThemePreference::System => "system",
            });

            // Reconcile the login item only when it actually differs, so we
            // don't make an unnecessary (and sometimes permission-denied) OS
            // call on every launch.
            if services::startup::is_enabled(&handle) != settings.launch_at_login {
                services::startup::set_enabled(&handle, settings.launch_at_login);
            }

            app.manage(services);

            tray::init(&handle)?;

            let start_hidden = settings.start_minimized && !cfg!(debug_assertions);
            if start_hidden {
                sync_dock(&handle, false);
            } else {
                show_dashboard(&handle, None);
            }

            // Keep ClovaSweep alive in the tray: hide instead of closing.
            if let Some(win) = app.get_webview_window("main") {
                let handle2 = handle.clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        if !IS_QUITTING.load(Ordering::SeqCst) {
                            api.prevent_close();
                            if let Some(w) = handle2.get_webview_window("main") {
                                let _ = w.hide();
                            }
                            sync_dock(&handle2, false);
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ClovaSweep");
}
