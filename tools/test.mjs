import { spawnSync } from 'node:child_process'
// Node 25+ exposes an unconfigured localStorage. Keep jsdom's own Storage in tests.
for (const cwd of ['apps/hwp', 'packages/doc-rules', 'packages/file-parse', 'packages/electron-utils']) {
  const result = spawnSync(process.execPath, ['--no-experimental-webstorage', '../../node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.ts'], { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1
    break
  }
}
