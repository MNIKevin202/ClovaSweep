/**
 * macOS application discovery.
 *
 * Uses the AppKit ObjC bridge via JXA to enumerate `NSWorkspace`'s running
 * applications, keeping only those with a *regular* activation policy — i.e.
 * genuine user-facing apps. Menu-bar agents, daemons and UI helpers use the
 * accessory/prohibited policies and are never returned, so system components
 * are excluded at the source rather than by a denylist.
 */
import type { ApplicationDiscovery } from '../types'
import type { RawApp } from '../../core/identity'
import { runJxa } from '../util'
import { parseMacApps } from './parseApps'

const DISCOVERY_SCRIPT = `
ObjC.import('AppKit');
(function () {
  const ws = $.NSWorkspace.sharedWorkspace;
  const apps = ws.runningApplications;
  const out = [];
  for (let i = 0; i < apps.count; i++) {
    const a = apps.objectAtIndex(i);
    // NSApplicationActivationPolicyRegular === 0 (user-facing).
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
`

export class MacDiscovery implements ApplicationDiscovery {
  async list(): Promise<RawApp[]> {
    try {
      const json = await runJxa(DISCOVERY_SCRIPT, { timeoutMs: 10000 })
      return parseMacApps(json)
    } catch {
      return []
    }
  }
}
