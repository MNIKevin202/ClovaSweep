//! macOS icon provider.
//!
//! Renders each app's Finder icon to a small PNG data URL via the AppKit
//! bridge and caches by stable id. The first request for an app spawns one
//! osascript; every later request is served from memory.

use super::run_jxa;
use crate::platform::IconProvider;
use std::collections::HashMap;
use std::sync::Mutex;

const SIZE: u32 = 64;

fn script(path: Option<&str>, bundle_id: Option<&str>) -> String {
    let info = serde_json::json!({ "path": path, "bundleId": bundle_id });
    format!(
        r#"
ObjC.import('AppKit');
(function () {{
  const info = {info};
  const ws = $.NSWorkspace.sharedWorkspace;
  let p = info.path;
  if ((!p || p.length === 0) && info.bundleId) {{
    const url = ws.URLForApplicationWithBundleIdentifier(info.bundleId);
    if (url && !url.isNil()) p = ObjC.unwrap(url.path);
  }}
  if (!p || p.length === 0) return '';
  const img = ws.iconForFile(p);
  if (!img || img.isNil()) return '';
  const out = $.NSImage.alloc.initWithSize($.NSMakeSize({SIZE}, {SIZE}));
  out.lockFocus;
  img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, {SIZE}, {SIZE}), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1.0);
  out.unlockFocus;
  const tiff = out.TIFFRepresentation;
  if (!tiff || tiff.isNil()) return '';
  const rep = $.NSBitmapImageRep.imageRepWithData(tiff);
  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
  return ObjC.unwrap(png.base64EncodedStringWithOptions(0));
}})();
"#
    )
}

pub struct MacIcons {
    cache: Mutex<HashMap<String, Option<String>>>,
}

impl Default for MacIcons {
    fn default() -> Self {
        Self::new()
    }
}

impl MacIcons {
    pub fn new() -> Self {
        MacIcons { cache: Mutex::new(HashMap::new()) }
    }
}

impl IconProvider for MacIcons {
    fn get_icon(&self, path: Option<&str>, bundle_id: Option<&str>) -> Option<String> {
        let key = format!("{}|{}", path.unwrap_or(""), bundle_id.unwrap_or(""));
        if let Some(cached) = self.cache.lock().unwrap().get(&key) {
            return cached.clone();
        }
        if path.is_none() && bundle_id.is_none() {
            self.cache.lock().unwrap().insert(key, None);
            return None;
        }
        let value = match run_jxa(&script(path, bundle_id)) {
            Ok(b64) if !b64.is_empty() => Some(format!("data:image/png;base64,{b64}")),
            _ => None,
        };
        self.cache.lock().unwrap().insert(key, value.clone());
        value
    }
}
