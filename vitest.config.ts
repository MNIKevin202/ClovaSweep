import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// The bulk of ClovaSweep's logic lives in the Rust backend now (src-tauri,
// tested with `cargo test`). This config covers the remaining frontend-only
// TypeScript utilities shared with the UI (src/shared/format.ts etc).
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
