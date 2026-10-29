import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?$/.test(version ?? '')) throw new Error('Usage: npm run version:set -- 0.1.0-beta.2')
for (const path of ['package.json', 'apps/desktop/package.json']) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  data.version = version
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
}
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit', shell: process.platform === 'win32' })
console.log(`Version set to ${version}. Update CHANGELOG.md, validate, commit, then tag v${version}.`)
