const { existsSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

module.exports = {
  // Kept from the former name Chojema Docs so updates replace existing installs.
  appId: 'io.github.chojema.docs',
  productName: 'Chojema Dooroo',
  electronVersion: require('../../node_modules/electron/package.json').version,
  electronDist: join(__dirname, '../../node_modules/electron/dist'),
  executableName: 'ChojemaDooroo',
  artifactName: 'ChojemaDooroo-${version}-${arch}.${ext}',
  copyright: 'Copyright © 2026 Chojema. Third-party copyrights are retained in NOTICE.',
  directories: { output: 'release', buildResources: 'build' },
  files: ['out/**', 'package.json'],
  extraMetadata: { name: 'chojema-dooroo', author: { name: 'Chojema' }, contributors: ['Chojema'] },
  npmRebuild: false,
  asar: true,
  extraResources: [
    { from: '../hwp/out/renderer', to: 'modules/hwp/renderer' },
    { from: '../hwp/out/preload', to: 'modules/hwp/preload' },
    { from: '../../vendor/rhwp-core/rhwp_bg.wasm', to: 'wasm/rhwp_bg.wasm' },
    { from: '../../LICENSE', to: 'LICENSE.txt' },
    { from: '../../NOTICE', to: 'NOTICE.txt' },
    { from: 'build/THIRD-PARTY-NOTICES.txt', to: 'THIRD-PARTY-NOTICES.txt' },
    { from: '../../node_modules/electron/dist/LICENSES.chromium.html', to: 'LICENSES.chromium.html' },
  ],
  fileAssociations: [
    { ext: 'hwp', name: 'HWP Document', role: 'Editor' },
    { ext: 'hwpx', name: 'HWPX Document', role: 'Editor' },
  ],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'build/icon.ico', signAndEditExecutable: true },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, deleteAppDataOnUninstall: false, artifactName: 'ChojemaDooroo-Setup-${version}-${arch}.${ext}' },
  mac: { icon: 'build/icon.icns', target: ['dmg', 'zip'], category: 'public.app-category.productivity', identity: '-' },
  dmg: { sign: false },
  publish: [{ provider: 'github', owner: 'chojema', repo: 'ChojemaDooroo', releaseType: require('./package.json').version.includes('-') ? 'prerelease' : 'release' }],
  beforePack: () => {
    for (const path of ['../hwp/out/renderer/studio/index.html', 'build/THIRD-PARTY-NOTICES.txt']) {
      if (!existsSync(join(__dirname, path))) throw new Error(`Required resource missing: ${path}`)
    }
    const rel = join(__dirname, 'release')
    if (existsSync(rel)) {
      for (const name of readdirSync(rel)) {
        if (/\.(?:exe|blockmap|dmg|zip)$/i.test(name)) rmSync(join(rel, name), { force: true })
      }
    }
  },
}
