import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { licenseText, licenseFiles } from './license-text.mjs'

// Conservative inventory includes installed build dependencies as well as runtime libraries.
const entries = []
function scan(dir) {
  if (!existsSync(dir)) return
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue
    const folder = join(dir, item.name)
    if (item.name.startsWith('@')) { scan(folder); continue }
    if (!item.isDirectory() || !existsSync(join(folder, 'package.json'))) continue
    const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))
    if (!pkg.name?.startsWith('@genoffice/') && !pkg.name?.startsWith('@chojema/')) {
      const text = licenseText(pkg.name, folder)
      entries.push({ key: `${pkg.name}@${pkg.version}`, text: `${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? 'See package source')}\nSource: ${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? `https://www.npmjs.com/package/${pkg.name}`}\n\n${text ?? `License and copyright terms: https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`}` })
    }
    scan(join(folder, 'node_modules'))
  }
}
scan('node_modules')
for (const app of ['hwp', 'desktop']) scan(`apps/${app}/node_modules`)
const unique = new Map(entries.map((entry) => [entry.key, entry.text]))
let result = 'Chojema Dooroo — Third-Party Software Notices\n\n'
result += readFileSync('NOTICE', 'utf8') + '\n\n'
result += 'The following inventory conservatively includes build dependencies. Their authors are authors of the original components, not contributors to Chojema Dooroo.\nElectron and Chromium notices also ship in LICENSES.chromium.html.\n\n'
result += [...unique].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('\n\n' + '='.repeat(72) + '\n\n')
for (const dir of ['vendor/rhwp-core', 'packages/ui/template-fonts']) {
  result += `\n\n${'='.repeat(72)}\n${dir}\n\n`
  for (const filename of licenseFiles(dir)) result += readFileSync(join(dir, filename), 'utf8') + '\n\n'
  for (const filename of readdirSync(dir).filter((name) => /-OFL\.txt$/.test(name))) result += readFileSync(join(dir, filename), 'utf8') + '\n\n'
  for (const filename of ['README.md', 'THIRD_PARTY_LICENSES.md']) if (existsSync(join(dir, filename))) result += readFileSync(join(dir, filename), 'utf8') + '\n\n'
}
mkdirSync('apps/desktop/build', { recursive: true })
writeFileSync('apps/desktop/build/THIRD-PARTY-NOTICES.txt', result)
console.log(`Notices generated for ${unique.size} installed packages and bundled fonts/rhwp.`)
