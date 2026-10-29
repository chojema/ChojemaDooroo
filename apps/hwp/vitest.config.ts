import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Chojema Docs: deterministic browser globals on supported Node versions.
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
})
