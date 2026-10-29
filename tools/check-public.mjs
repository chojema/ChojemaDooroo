import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const allowed = /^(?:apps\/(?:desktop|hwp)\/|packages\/|vendor\/|tools\/|docs\/|\.github\/|(?:README\.md|LICENSE|NOTICE|LICENSE-UNICODE\.txt|package(?:-lock)?\.json|tsconfig\.base\.json|CHANGELOG\.md|SECURITY\.md|\.gitignore|\.gitattributes|\.nvmrc)$)/
const forbidden = /(?:^|\/)(?:\.mesh|\.work|\.agents|\.codex|\.aws|node_modules|out|dist|release|target|coverage)(?:\/|$)|(?:^|\/)(?:AGENTS|CLAUDE|GEMINI)\.md$|(?:^|\/)\.env(?:\.|$)|\.(?:pfx|pem|key)$/i
const errors = []
for (const file of files) {
  if (!allowed.test(file) || forbidden.test(file)) errors.push(`Excluded path: ${file}`)
  if (/\.(?:ts|tsx|js|mjs|cjs|json|yml|yaml|md|txt|html|css|sh|ps1)$/.test(file)) {
    const text = readFileSync(file, 'utf8')
    for (const pattern of [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{32,}\b/, /\bgithub_pat_[A-Za-z0-9_]{40,}\b/, /\bAKIA[0-9A-Z]{16}\b/]) {
      if (pattern.test(text)) errors.push(`Possible credential: ${file}`)
    }
  }
}
for (const path of ['package.json', 'apps/desktop/package.json']) {
  const pkg = JSON.parse(readFileSync(path, 'utf8'))
  if (pkg.author !== 'Chojema' || (pkg.contributors && JSON.stringify(pkg.contributors) !== '["Chojema"]')) errors.push(`Invalid product authorship: ${path}`)
}
if (errors.length) throw new Error(errors.join('\n'))
console.log(`Public allowlist and credential-pattern check passed (${files.length} tracked files).`)
