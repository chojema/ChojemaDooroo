/** Standard-folder policy, old-cache rejection, notice UI, SVG and font-name round trips.
 * Run after npm run build: node tools/smoke-fonts.mjs. Uses an isolated profile. */
import { _electron as electron } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

const work = resolve('output/playwright/font-policy', String(Date.now()))
mkdirSync(work, { recursive: true })
const env = { ...process.env, CHOJEMA_DOOROO_USER_DATA: join(work, 'profile'), CHOJEMA_DOOROO_SMOKE: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: [resolve('apps/desktop')], env, timeout: 45_000 })
const errors = []
app.context().on('page', page => page.on('pageerror', error => errors.push(error.message)))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function file(path) {
  for (let i = 0; i < 120; i++) {
    if (existsSync(path) && readFileSync(path).length) return readFileSync(path)
    await pause(250)
  }
  throw Error(`File did not arrive: ${path}`)
}
async function editorAfter(before) {
  for (let i = 0; i < 160; i++) {
    const page = app.context().pages().find(page => page.url().includes('://hwp') && !before.has(page))
    if (page) { await page.locator('.hwp-app[data-phase="ready"]').waitFor({ timeout: 60_000 }); return page }
    await pause(250)
  }
  throw Error('Editor did not open')
}
async function saveAs(page, path) {
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, path)
  await page.evaluate(() => window.hwpApi.requestFileCommand('saveAs'))
  return file(path)
}
async function namesOf(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const xml = await zip.file('Contents/header.xml').async('string')
  return [...xml.matchAll(/\bface="([^"]*)"/g)].map(match => match[1])
}
try {
  const home = await app.firstWindow()
  const first = await editorAfter(new Set())
  const snapshot = await first.evaluate(() => window.hwpApi.hostFonts())
  assert.match(snapshot.revision, /^system-/)
  assert.ok(snapshot.faces.length > 0, 'Standard-folder fonts were found on this machine')
  const base = join(work, 'base.hwpx')
  const zip = await JSZip.loadAsync(await saveAs(first, base))
  const header = await zip.file('Contents/header.xml').async('string')
  let serial = 0
  const names = []
  zip.file('Contents/header.xml', header.replace(/\bface="([^"]*)"/g, () => {
    const name = `DoorooOutside_${++serial}`
    names.push(name)
    return `face="${name}"`
  }))
  assert.ok(names.length >= 4, 'Fixture exercises a complete list, not a short sample')
  const input = join(work, 'outside-fonts.hwpx')
  writeFileSync(input, await zip.generateAsync({ type: 'nodebuffer' }))
  await app.context().addInitScript(({ names }) => {
    globalThis.__fontEnumerationCalls = 0
    Object.defineProperty(globalThis, 'queryLocalFonts', { configurable: true, value: async () => {
      globalThis.__fontEnumerationCalls++
      throw Error('Unfiltered browser font enumeration must not be used')
    } })
    try {
      localStorage.setItem('rhwp-local-fonts', JSON.stringify({ version: 3, detectedAt: new Date().toISOString(),
        source: 'local-font-access', families: names, fontRecords: names.map(name => ({ family: name,
          fullName: name, postscriptName: name, displayName: name, style: 'Regular', aliases: [name] })) }))
    } catch {}
  }, { names })
  const before = new Set(app.context().pages())
  await home.evaluate(path => window.chojema.command('open-path', path), input)
  const page = await editorAfter(before)
  const button = page.getByRole('button', { name: /대체 글꼴 안내/ })
  await button.waitFor({ timeout: 60_000 })
  await button.click()
  const details = page.getByRole('dialog')
  await details.waitFor()
  assert.deepEqual((await details.locator('li').allTextContents()).sort(), [...new Set(names)].sort())
  assert.match(await details.innerText(), /사용권/)
  await page.screenshot({ path: join(work, 'font-details.png') })
  await details.getByRole('button', { name: '닫기', exact: true }).click()
  await details.waitFor({ state: 'detached' })
  const frame = page.frames().find(frame => frame.url().includes('/studio/'))
  assert.ok(frame)
  const drawing = await frame.evaluate(() => {
    const context = document.createElement('canvas').getContext('2d')
    context.font = '20px "DoorooOutside_1", serif'
    return { font: context.font, calls: globalThis.__fontEnumerationCalls, state: window.rhwpStudio.fonts.getState() }
  })
  assert.doesNotMatch(drawing.font, /DoorooOutside/)
  assert.equal(drawing.calls, 0, 'Old snapshots and the Find action cannot enumerate arbitrary font sources')
  assert.ok(drawing.state.count > 0)
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL)
    URL.createObjectURL = blob => {
      if (blob.type === 'image/svg+xml') globalThis.__previewSvg = blob.text()
      return create(blob)
    }
  })
  await page.evaluate(() => window.hwpApi.requestFileCommand('preview'))
  const preview = page.locator('.hwp-preview')
  const image = preview.locator('.hwp-preview-sheet img').first()
  await image.waitFor({ timeout: 20_000 })
  const svg = await page.evaluate(() => globalThis.__previewSvg)
  assert.equal(typeof svg, 'string')
  assert.doesNotMatch(svg, /font-family=["'][^"']*DoorooOutside/)
  await preview.getByRole('button', { name: /닫기|Close/ }).first().click()
  const output = join(work, 'preserved.hwpx')
  assert.deepEqual(await namesOf(await saveAs(page, output)), names, 'HWPX save preserves original names')
  const hwp = join(work, 'preserved.hwp')
  await saveAs(page, hwp)
  const hwpTab = home.getByRole('tab', { name: /preserved\.hwp/ })
  await hwpTab.waitFor()
  await home.getByRole('button', { name: 'preserved.hwp 닫기', exact: true }).click()
  const beforeHwp = new Set(app.context().pages())
  await home.evaluate(path => window.chojema.command('open-path', path), hwp)
  const reopened = await editorAfter(beforeHwp)
  const back = join(work, 'hwp-roundtrip.hwpx')
  assert.deepEqual(await namesOf(await saveAs(reopened, back)), names, 'HWP save/reopen preserves original names')
  assert.deepEqual(errors, [])
  const result = { passed: true, standardFaces: snapshot.faces.length, preservedNames: names,
    nativeEnumerationCalls: drawing.calls, input, output, hwp, back, errors }
  writeFileSync(join(work, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`Font policy evidence: ${work}`)
  for (const page of app.windows()) await page.screenshot({ path: join(work, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
}
