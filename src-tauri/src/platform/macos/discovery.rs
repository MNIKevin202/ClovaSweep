//! macOS application discovery.
//!
//! Uses the AppKit ObjC bridge via JXA to enumerate `NSWorkspace`'s running
//! applications, keeping only those with a *regular* activation policy — i.e.
//! genuine user-facing apps. Menu-bar agents, daemons and UI helpers use the
//! accessory/prohibited policies and are never returned, so system
//! components are excluded at the source rather than by a denylist.

use super::{parse_apps::parse_mac_apps, run_jxa};
use crate::platform::{ApplicationDiscovery, PResult};
use crate::types::RawApp;

const DISCOVERY_SCRIPT: &str = r#"
ObjC.import('AppKit');
(function () {
  const ws = $.NSWorkspace.sharedWorkspace;
  const apps = ws.runningApplications;
  const out = [];
  for (let i = 0; i < apps.count; i++) {
    const a = apps.objectAtIndex(i);
    if (Number(a.activationPolicy) !== 0) continue;
    if (a.isTerminated) continue;
    out.push({
      name: a.localizedName ? ObjC.unwrap(a.localizedName) : null,
      bundleId: a.bundleIdentifier ? ObjC.unwrap(a.bundleIdentifier) : null,
      pid: Number(a.processIdentifier),
      path: a.bundleURL ? ObjC.unwrap(a.bundleURL.path) : null
    });
  }
  return JSON.stringify(out);
})();
"#;

pub struct MacDiscovery;

impl ApplicationDiscovery for MacDiscovery {
    fn list(&self) -> PResult<Vec<RawApp>> {
        match run_jxa(DISCOVERY_SCRIPT) {
            Ok(json) => Ok(parse_mac_apps(&json)),
            Err(_) => Ok(Vec::new()),
        }
    }
}
