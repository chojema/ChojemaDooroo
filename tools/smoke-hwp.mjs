import { _electron as electron } from '@playwright/test'
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

const work = mkdtempSync(join(tmpdir(), 'chojema-dooroo-smoke-'))
const env = { ...process.env, CHOJEMA_DOOROO_USER_DATA: join(work, 'profile'), CHOJEMA_DOOROO_SMOKE: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  ...(process.env.CHOJEMA_DOOROO_EXE ? { executablePath: process.env.CHOJEMA_DOOROO_EXE, args: [] } : { args: [resolve('apps/desktop')] }),
  env, timeout: 45_000,
})
const errors = []
app.process().stderr.on('data', (chunk) => { const text = chunk.toString(); if (/Error|ERR_|Unhandled/i.test(text)) errors.push(text) })
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFile(path) {
  for (let i = 0; i < 150 && !existsSync(path); i++) await pause(200)
  assert.ok(existsSync(path), `Saved document exists: ${path}`)
  return readFileSync(path)
}
try {
  const home = await app.firstWindow()
  await home.getByRole('heading', { name: '문서에 집중하는 작업 공간' }).waitFor({ timeout: 30_000 })
  assert.equal(await home.title(), 'Chojema Dooroo')
  assert.equal(await home.locator('[data-action="new-docs"]').count(), 0)
  await home.screenshot({ path: join(work, 'home.png') })
  await home.locator('header [data-action="new-hwp"]').click()
  let hwp
  for (let i = 0; i < 120; i++) {
    hwp = app.context().pages().find((p) => p.url().includes('://hwp'))
    if (hwp) break
    await pause(250)
  }
  assert.ok(hwp, `HWP renderer exists: ${app.context().pages().map((p) => p.url()).join(', ')}`)
  await hwp.locator('iframe').waitFor({ timeout: 45_000 })
  const studio = hwp.frameLocator('iframe').first()
  await studio.locator('canvas').first().waitFor({ timeout: 60_000 })
  await pause(1500)
  const canvases = await studio.locator('canvas').all()
  let paper = canvases[0]
  let largest = 0
  for (const canvas of canvases) {
    const box = await canvas.boundingBox()
    if (box && box.width * box.height > largest) { paper = canvas; largest = box.width * box.height }
  }
  await paper.click({ position: { x: 140, y: 150 } })
  await hwp.keyboard.type('Chojema HWP smoke test')
  await hwp.screenshot({ path: join(work, 'hwp.png') })
  // Use the actual save flow with a deterministic native dialog selection.
  const hwpx = join(work, 'smoke.hwpx')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.__chojemaSaveFilters = options?.filters
      return { canceled: false, filePath: path }
    }
  }, hwpx)
  await hwp.evaluate(() => window.hwpApi.requestFileCommand('saveAs'))
  const bytes = await waitFile(hwpx)
  assert.equal(bytes.subarray(0, 2).toString(), 'PK')
  const zip = await JSZip.loadAsync(bytes)
  const xml = (await Promise.all(Object.keys(zip.files).filter((p) => /section\d+\.xml$/.test(p)).map((p) => zip.file(p).async('string')))).join('\n')
  assert.match(xml, /Chojema HWP smoke test/, 'Typed content survives HWPX serialization')
  const filters = await app.evaluate(() => globalThis.__chojemaSaveFilters)
  assert.deepEqual(filters[0].extensions, ['hwpx'])
  await home.getByRole('tab', { name: /smoke.hwpx/ }).waitFor()
  await home.locator('header [data-action="new-hwp"]').click()
  for (let i = 0; i < 120; i++) {
    if (await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((wc) => wc.getURL().includes('://hwp')).length) === 2) break
    await pause(250)
  }
  await home.locator('header [data-action="split"]').click()
  const idsBefore = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((wc) => wc.getURL().includes('://hwp')).map((wc) => wc.id).sort((a,b) => a-b))
  assert.equal(idsBefore.length, 2)
  await home.screenshot({ path: join(work, 'split.png') })
  await home.getByRole('tab', { name: /smoke.hwpx/ }).click()
  const newWindow = app.waitForEvent('window')
  await home.locator('header [data-action="detach"]').click()
  const detached = await newWindow
  await detached.locator('[role="tab"]').waitFor()
  const idsAfter = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((wc) => wc.getURL().includes('://hwp')).map((wc) => wc.id).sort((a,b) => a-b))
  assert.deepEqual(idsAfter, idsBefore, 'The same editor processes survive detachment')
  await detached.screenshot({ path: join(work, 'detached.png') })
  const hwpFile = join(work, 'roundtrip.hwp')
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, hwpFile)
  await hwp.evaluate(() => window.hwpApi.requestFileCommand('saveAs'))
  assert.equal((await waitFile(hwpFile)).subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1')
  await detached.getByRole('tab', { name: /roundtrip.hwp/ }).waitFor()
  await detached.locator('.tab .close').click()
  await detached.getByRole('heading', { name: '문서에 집중하는 작업 공간' }).waitFor()
  const beforeReopen = new Set(app.context().pages())
  await detached.evaluate((path) => window.chojema.command('open-path', path), hwpFile)
  let reopened
  for (let i = 0; i < 120; i++) {
    reopened = app.context().pages().find((p) => !beforeReopen.has(p) && p.url().includes('://hwp'))
    if (reopened) break
    await pause(250)
  }
  assert.ok(reopened, 'HWP file reopens in a new editor')
  await reopened.frameLocator('iframe').locator('canvas').first().waitFor({ timeout: 60_000 })
  await pause(1000)
  const roundtrip = join(work, 'roundtrip.hwpx')
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, roundtrip)
  await reopened.evaluate(() => window.hwpApi.requestFileCommand('saveAs'))
  const back = await JSZip.loadAsync(await waitFile(roundtrip))
  const backXml = (await Promise.all(Object.keys(back.files).filter((p) => /section\d+\.xml$/.test(p)).map((p) => back.file(p).async('string')))).join('\n')
  assert.match(backXml, /Chojema HWP smoke test/, 'Text survives HWPX to HWP, reopen, and HWPX conversion')
  await home.locator('header [data-action="settings"]').click()
  await home.getByRole('heading', { name: '설정', exact: true }).waitFor()
  await home.getByLabel('화면 테마').selectOption('dark')
  assert.equal(await home.locator('html').getAttribute('data-theme'), 'dark')
  assert.deepEqual(errors, [], 'No app or optional-bridge handler errors')
  const result = { passed: true, hwpx, hwpFile, roundtrip, editorProcessesPreserved: true, screenshots: work, errors }
  writeFileSync(join(work, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`Smoke evidence: ${work}\n${errors.join('\n')}`)
  for (const page of app.windows()) await page.screenshot({ path: join(work, `failure-${Date.now()}.png`) }).catch(() => {})
  throw error
} finally {
  // Test-only discard response; production close guards are never bypassed.
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) }).catch(() => {})
  await app.close().catch(() => {})
}
