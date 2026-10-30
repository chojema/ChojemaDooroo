import { _electron as electron } from '@playwright/test'
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

const work = mkdtempSync(join(tmpdir(), 'chojema-dooroo-smoke-'))
const env = { ...process.env, CHOJEMA_DOOROO_USER_DATA: join(work, 'profile'), CHOJEMA_DOOROO_SMOKE: '1' }
delete env.ELECTRON_RUN_AS_NODE
const launchOptions = {
  ...(process.env.CHOJEMA_DOOROO_EXE ? { executablePath: process.env.CHOJEMA_DOOROO_EXE, args: [] } : { args: [resolve('apps/desktop')] }),
  env, timeout: 45_000,
}
let app = await electron.launch(launchOptions)
const errors = []
const platformWarnings = []
function watchErrors(application) {
  application.process().stderr.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      // Chromium's scheduling-policy call can be rejected by macOS 27. Keep the
      // diagnostic in the report, separate from app/IPC failures checked below.
      if (process.platform === 'darwin' && /ERROR:base\/process\/process_mac\.cc:\d+\] task_policy_set TASK_(CATEGORY|SUPPRESSION)_POLICY: \(os\/kern\) invalid argument \(4\)$/.test(line)) platformWarnings.push(line)
      else if (/Error|ERR_|Unhandled/i.test(line)) errors.push(line)
    }
  })
  const watchPage = (page) => page.on('pageerror', (error) => errors.push(error.message))
  application.context().on('page', watchPage)
  for (const page of application.context().pages()) watchPage(page)
}
watchErrors(app)
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFile(path) {
  for (let i = 0; i < 150 && !existsSync(path); i++) await pause(200)
  assert.ok(existsSync(path), `Saved document exists: ${path}`)
  return readFileSync(path)
}
try {
  const home = await app.firstWindow()
  await home.getByRole('tab', { name: /새 문서\.hwpx/ }).waitFor({ timeout: 30_000 })
  assert.equal(await home.title(), 'Chojema Dooroo')
  assert.equal(await home.locator('[data-action="new-docs"]').count(), 0)
  await home.screenshot({ path: join(work, 'home.png') })
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
  // A second page, then each page as a picture and the document as a PDF that is
  // brought back in later.
  await paper.click({ position: { x: 140, y: 150 } })
  await hwp.keyboard.press('End')
  await hwp.keyboard.press('Control+Enter')
  await hwp.keyboard.type('Second page')
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {} })
  const pagePng = join(work, 'pages-01.png')
  const pageJpg = join(work, 'pages-02.jpg')
  const exportedPdf = join(work, 'smoke-pdf.pdf')
  // each export is waited for to its last file: one asked for while another runs is ignored
  for (const [command, picked, path] of [['png', 'pages.png', join(work, 'pages-02.png')], ['jpg', 'pages.jpg', pageJpg], ['pdf', 'smoke-pdf.pdf', exportedPdf]]) {
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, join(work, picked))
    await hwp.evaluate((command) => window.hwpApi.requestFileCommand(command), command)
    await waitFile(path)
  }
  assert.ok(existsSync(pagePng) && existsSync(join(work, 'pages-01.jpg')), 'One picture file for each page')
  assert.deepEqual([...readFileSync(pagePng).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  assert.deepEqual([...readFileSync(pageJpg).subarray(0, 2)], [0xff, 0xd8])
  const picture = await app.evaluate(({ nativeImage }, path) => {
    const image = nativeImage.createFromPath(path)
    const bitmap = image.toBitmap()
    let ink = 0
    for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i] < 128 && bitmap[i + 1] < 128 && bitmap[i + 2] < 128) ink++
    return { ...image.getSize(), ink }
  }, pagePng)
  assert.ok(picture.width > 1500 && picture.height > 2100, `A4 page drawn at twice its size: ${JSON.stringify(picture)}`)
  assert.ok(picture.ink > 200, `The typed text is drawn on the page picture: ${JSON.stringify(picture)}`)
  // the app has no toolbar or window menu: its commands come from the editor's menus
  await hwp.evaluate(() => window.hwpApi.requestFileCommand('new'))
  for (let i = 0; i < 120; i++) {
    if (await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((wc) => wc.getURL().includes('://hwp')).length) === 2) break
    await pause(250)
  }
  await hwp.evaluate(() => window.hwpApi.requestFileCommand('split'))
  const idsBefore = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((wc) => wc.getURL().includes('://hwp')).map((wc) => wc.id).sort((a,b) => a-b))
  assert.equal(idsBefore.length, 2)
  await home.screenshot({ path: join(work, 'split.png') })
  await home.getByRole('tab', { name: /smoke.hwpx/ }).click()
  const newWindow = app.waitForEvent('window')
  await hwp.evaluate(() => window.hwpApi.requestFileCommand('detach'))
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
  await reopened.evaluate(() => window.hwpApi.requestFileCommand('settings'))
  await detached.getByRole('heading', { name: '설정', exact: true }).waitFor()
  await detached.getByLabel('화면 테마').selectOption('dark')
  assert.equal(await detached.locator('html').getAttribute('data-theme'), 'dark')
  assert.equal(await detached.getByLabel('인터페이스 용어').inputValue(), 'word')
  await detached.getByLabel('인터페이스 용어').selectOption('hwp')
  for (const editor of app.context().pages().filter((p) => p.url().includes('://hwp'))) {
    await editor.frameLocator('iframe').locator('[data-i18n="menu.page"]').filter({ hasText: /^쪽$/ }).waitFor()
  }
  assert.equal(JSON.parse(readFileSync(join(env.CHOJEMA_DOOROO_USER_DATA, 'chojema-settings.json'), 'utf8')).terminology, 'hwp')
  // Restart the real app with the same isolated profile to verify persistence.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
  app = await electron.launch(launchOptions)
  watchErrors(app)
  const restarted = await app.firstWindow()
  await restarted.getByRole('tab', { name: /새 문서\.hwpx/ }).waitFor({ timeout: 30_000 })
  await restarted.evaluate(() => window.chojema.command('settings'))
  assert.equal(await restarted.getByLabel('인터페이스 용어').inputValue(), 'hwp')
  await restarted.getByLabel('인터페이스 용어').selectOption('word')
  await restarted.screenshot({ path: join(work, 'terminology-settings.png') })
  // The exported PDF comes back in as a new, untitled HWPX document holding its text.
  await restarted.evaluate((path) => window.chojema.command('open-path', path), exportedPdf)
  await restarted.getByRole('tab', { name: /smoke-pdf\.hwpx/ }).waitFor({ timeout: 30_000 })
  let imported
  for (let i = 0; i < 120 && !imported; i++) {
    const editors = app.context().pages().filter((p) => p.url().includes('://hwp'))
    if (editors.length >= 2) imported = editors[editors.length - 1]
    else await pause(250)
  }
  assert.ok(imported, 'The PDF opens in an editor of its own')
  await imported.frameLocator('iframe').first().locator('canvas').first().waitFor({ timeout: 60_000 })
  const importedHwpx = join(work, 'imported.hwpx')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.__chojemaImportDefault = options?.defaultPath
      return { canceled: false, filePath: path }
    }
  }, importedHwpx)
  for (let i = 0; i < 40 && !existsSync(importedHwpx); i++) {
    await imported.evaluate(() => window.hwpApi.requestFileCommand('save'))
    await pause(500)
  }
  const importedZip = await JSZip.loadAsync(await waitFile(importedHwpx))
  const importedXml = (await Promise.all(Object.keys(importedZip.files).filter((p) => /section\d+\.xml$/.test(p)).map((p) => importedZip.file(p).async('string')))).join('\n')
  assert.match(importedXml, /Chojema HWP smoke test/, 'The text of a PDF comes in as document text')
  assert.match(await app.evaluate(() => globalThis.__chojemaImportDefault ?? ''), /smoke-pdf\.hwpx$/, 'A brought-in PDF saves as a new document under its own name')
  assert.deepEqual(errors, [], 'No app or optional-bridge handler errors')
  const result = { passed: true, hwpx, hwpFile, roundtrip, pagePng, pageJpg, importedHwpx, editorProcessesPreserved: true, screenshots: work, errors, platformWarnings }
  writeFileSync(join(work, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error)
  console.error(`Smoke evidence: ${work}\n${errors.join('\n')}`)
  for (const page of app.windows()) await page.screenshot({ path: join(work, `failure-${Date.now()}.png`) }).catch(() => {})
  throw error
} finally {
  // Test-only process exit: macOS keeps the app alive after its last window closes.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
}
