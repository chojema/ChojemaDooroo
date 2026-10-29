import { spawnSync } from 'node:child_process'
// Node 25+ exposes an unconfigured localStorage. Keep jsdom's own Storage in tests.
const result = spawnSync(process.execPath, ['--no-experimental-webstorage', '../../node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.ts'], { cwd: 'apps/hwp', stdio: 'inherit' })
process.exitCode = result.status ?? 1
