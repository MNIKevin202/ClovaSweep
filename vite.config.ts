import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },

  // Tauri expects a fixed, predictable port; fail instead of trying another.
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Don't watch the Rust crate — `tauri dev` handles that rebuild.
      ignored: ['**/src-tauri/**']
    }
  },

  // Tauri needs ES2021+ (Chromium/WebKit-current) and doesn't need minified
  // sourcemaps unless building for debug.
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG
  }
})
