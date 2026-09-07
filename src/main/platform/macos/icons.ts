/**
 * macOS icon provider.
 *
 * Renders each app's Finder icon to a small PNG data URL via the AppKit bridge
 * and caches by stable id. The first request for an app spawns one osascript;
 * every later request is served from memory.
 */
import type { IconProvider } from '../types'
import { runJxa, safeJsonForSource } from '../util'

const SIZE = 64

function script(pathOrBundle: { path?: string; bundleId?: string }): string {
  return `
ObjC.import('AppKit');
(function () {
  const info = ${safeJsonForSource(pathOrBundle)};
  const ws = $.NSWorkspace.sharedWorkspace;
  let p = info.path;
  if ((!p || p.length === 0) && info.bundleId) {
    const url = ws.URLForApplicationWithBundleIdentifier(info.bundleId);
    if (url && !url.isNil()) p = ObjC.unwrap(url.path);
  }
  if (!p || p.length === 0) return '';
  const img = ws.iconForFile(p);
  if (!img || img.isNil()) return '';
  const out = $.NSImage.alloc.initWithSize($.NSMakeSize(${SIZE}, ${SIZE}));
  out.lockFocus;
  img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, ${SIZE}, ${SIZE}), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1.0);
  out.unlockFocus;
  const tiff = out.TIFFRepresentation;
  if (!tiff || tiff.isNil()) return '';
  const rep = $.NSBitmapImageRep.imageRepWithData(tiff);
  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
  return ObjC.unwrap(png.base64EncodedStringWithOptions(0));
})();
`
}

export class MacIcons implements IconProvider {
  private cache = new Map<string, string | null>()

  async getIcon(app: { id: string; path?: string; bundleId?: string }): Promise<string | null> {
    if (this.cache.has(app.id)) return this.cache.get(app.id) ?? null
    if (!app.path && !app.bundleId) {
      this.cache.set(app.id, null)
      return null
    }
    try {
      const b64 = await runJxa(script({ path: app.path, bundleId: app.bundleId }), { timeoutMs: 6000 })
      const value = b64 ? `data:image/png;base64,${b64}` : null
      this.cache.set(app.id, value)
      return value
    } catch {
      this.cache.set(app.id, null)
      return null
    }
  }
}
