import { defineConfig } from 'electron-vite'

// Bundle workspace TypeScript into main; the installer ships no node_modules.
export default defineConfig({
  main: { build: { rollupOptions: { external: ['node:sqlite'] } } },
  preload: {},
  renderer: {},
})
