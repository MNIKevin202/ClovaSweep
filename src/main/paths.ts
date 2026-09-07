/** Resolve bundled resource paths in both dev and packaged builds. */
import { app } from 'electron'
import path from 'node:path'

export function resourcePath(...segments: string[]): string {
  if (app.isPackaged) {
    // electron-builder copies `resources/` into the app's resources dir.
    return path.join(process.resourcesPath, 'resources', ...segments)
  }
  return path.join(app.getAppPath(), 'resources', ...segments)
}
