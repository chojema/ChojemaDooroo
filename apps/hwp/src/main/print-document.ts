import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, NativeImage } from 'electron'
import { IMAGE_FORMATS, MAX_PRINT_CHARS, MAX_PRINT_PAGES } from '../shared/ipc'
import type { ImageFormat, PrintJob, PrintPage } from '../shared/ipc'

/**
 * Printing a document: the pages as the editor draws them for print (SVG), one after
 * another in one HTML page sized page by page, which a hidden window with scripts off
 * turns into a PDF or hands to the system print dialog. Exported as pictures, each page
 * is drawn alone in an offscreen window and captured.
 */

/** Paper sides in mm: ISO A3–A5, JIS B4–B5, US Letter, Legal and Tabloid. */
const PAPER_SIDES_MM = [148, 182, 210, 215.9, 257, 279.4, 297, 355.6, 364, 420, 431.8]
/**
 * A side within this of a paper side is that side. The file keeps lengths in whole
 * HWPUNIT and the editor gives pages to a tenth of a pixel, so an A4 page comes out
 * 296.99 mm; printed so, a printer takes it for a paper it does not have.
 */
const PAPER_SNAP_MM = 0.05

/** A page side in CSS pixels as mm, on the paper side it is meant to be when it is one. */
export function sideMm(px: number): number {
  const mm = (px * 25.4) / 96
  const paper = PAPER_SIDES_MM.find((side) => Math.abs(side - mm) <= PAPER_SNAP_MM)
  return paper ?? Math.round(mm * 1000) / 1000
}

/**
 * The page's ids made its own: every page names its clip paths from the same counter, so
 * pages put in one HTML would clip with each other's. References go with them.
 */
export function ownIds(svg: string, prefix: string): string {
  return svg
    .replace(/\bid="([^"]+)"/g, (_, id: string) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)\s]+)\)/g, (_, id: string) => `url(#${prefix}${id})`)
    .replace(/\bhref="#([^"]+)"/g, (_, id: string) => `href="#${prefix}${id}"`)
}

/** The picture types written out as files; any other picture stays in the page. */
const IMAGE_FILE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]*)$/

/** The file a picture of the job is written to, or null when it stays a data URL. */
export function imageFile(dataUrl: string, index: number): { name: string; bytes: Buffer } | null {
  const match = DATA_URL.exec(dataUrl)
  const ext = match ? IMAGE_FILE_EXT[match[1]] : undefined
  if (!match || !ext) return null
  return { name: `image-${index}.${ext}`, bytes: Buffer.from(match[2], 'base64') }
}

/** Why a job from the renderer is not printed, or null when it may be. */
export function badJob(job: unknown): string | null {
  if (!job || typeof job !== 'object') return 'not a print job'
  const { mode, pages, images, numbers } = job as Partial<PrintJob>
  if (mode !== 'pdf' && mode !== 'print' && !IMAGE_FORMATS.includes(mode as ImageFormat)) {
    return 'unknown print mode'
  }
  if (!Array.isArray(pages) || pages.length === 0) return 'no pages'
  if (pages.length > MAX_PRINT_PAGES) return 'too many pages'
  if (!Array.isArray(images) || images.some((image) => typeof image !== 'string')) {
    return 'bad pictures'
  }
  if (
    numbers !== undefined &&
    (!Array.isArray(numbers) ||
      numbers.length !== pages.length ||
      numbers.some((number) => !Number.isInteger(number) || number < 1))
  ) {
    return 'bad page numbers'
  }
  let chars = images.reduce((sum, image) => sum + image.length, 0)
  for (const page of pages as unknown[]) {
    const { svg, width, height } = (page ?? {}) as Partial<PrintPage>
    if (typeof svg !== 'string' || !svg.trimStart().startsWith('<svg')) return 'bad page'
    if (!isSide(width) || !isSide(height)) return 'bad page size'
    chars += svg.length
  }
  if (chars > MAX_PRINT_CHARS) return 'too large'
  return null
}

const isSide = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100_000

/** Pages and pictures load from the job's own folder; nothing else is fetched or run. */
const PRINT_CSP =
  "default-src 'none'; img-src file: data:; style-src 'unsafe-inline'; font-src file: data:; " +
  "base-uri 'none'; form-action 'none'"

const mm = (value: number) => `${value}mm`

/** The page's SVG with its pictures pointing at `picture(i)`, and ids of its own. */
function pageSvg(page: PrintPage, index: number, picture: (index: number) => string): string {
  return ownIds(page.svg, `p${index}-`).replace(
    /\bhref="ieum-image:(\d+)"/g,
    (_, n: string) => `href="${picture(Number(n))}"`,
  )
}

/**
 * The HTML of the pages: each page on a paper of its own size with no margin, the page's
 * pictures pointing at `picture(i)` (a file name next to the HTML, or the data URL).
 */
export function printableHtml(pages: PrintPage[], picture: (index: number) => string): string {
  const rules: string[] = []
  const body: string[] = []
  pages.forEach((page, index) => {
    const width = mm(sideMm(page.width))
    const height = mm(sideMm(page.height))
    rules.push(`@page p${index} { size: ${width} ${height}; margin: 0; }`)
    rules.push(`.p${index} { page: p${index}; width: ${width}; height: ${height}; }`)
    body.push(`<div class="page p${index}">${pageSvg(page, index, picture)}</div>`)
  })
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">`,
    // what is printed is the document: the same in either app theme
    '<style>',
    '* { margin: 0; padding: 0; }',
    'body { background: #fff; }',
    '.page { overflow: hidden; break-after: page; }',
    '.page:last-child { break-after: auto; }',
    '.page > svg { display: block; width: 100%; height: 100%; }',
    ...rules,
    '</style>',
    '</head>',
    `<body>${body.join('')}</body>`,
    '</html>',
  ].join('\n')
}

/** CSS pixels of an exported picture for each CSS pixel of the page: 192 dpi. */
export const IMAGE_SCALE = 2
const JPEG_QUALITY = 90

/**
 * A row of this color under the page, cut off the picture. The page is one paint with it, so
 * a frame showing the row is one of the page and not the white of a window yet to draw it.
 */
const DRAWN_MARK = '#f0f'
const DRAWN_MARK_ROWS = 1

/** The HTML of one page as a picture: the page fills the window above the drawn mark, on white. */
export function pageImageHtml(page: PrintPage, picture: (index: number) => string): string {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">`,
    '<style>',
    '* { margin: 0; padding: 0; }',
    'html, body { width: 100%; height: 100%; overflow: hidden; background: #fff; }',
    `svg { display: block; width: 100%; height: calc(100% - ${DRAWN_MARK_ROWS}px); }`,
    `.drawn { height: ${DRAWN_MARK_ROWS}px; background: ${DRAWN_MARK}; }`,
    '</style>',
    '</head>',
    `<body>${pageSvg(page, 0, picture)}<div class="drawn"></div></body>`,
    '</html>',
  ].join('\n')
}

/**
 * The files the pages of a picture export are written to, from the name the user picked:
 * that name for a single page, otherwise numbered by page (`report-01.png`…; from 1 without
 * `numbers`), zero-padded so the files sort in page order.
 */
export function pagePicturePaths(
  picked: string,
  format: ImageFormat,
  count: number,
  numbers?: readonly number[],
): string[] {
  const base = picked.replace(/\.(png|jpe?g)$/i, '')
  if (count === 1) return [`${base}.${format}`]
  const pages = numbers ?? Array.from({ length: count }, (_, index) => index + 1)
  const digits = Math.max(2, String(Math.max(...pages)).length)
  return pages.map((page) => `${base}-${String(page).padStart(digits, '0')}.${format}`)
}

export type PrintWindow = Pick<BrowserWindow, 'loadFile' | 'destroy'> & {
  webContents: Pick<BrowserWindow['webContents'], 'printToPDF' | 'print'>
}

export type ImageWindow = Pick<BrowserWindow, 'loadFile' | 'destroy' | 'setContentSize'> & {
  webContents: Pick<BrowserWindow['webContents'], 'on' | 'off' | 'invalidate'>
}

/** How long a page may take to be drawn before the export gives up on it. */
const FRAME_TIMEOUT_MS = 10_000
const FRAME_POLL_MS = 30

/** Whether the frame shows the drawn mark under a page `height` tall (either byte order). */
function showsDrawnMark(image: NativeImage, width: number, height: number): boolean {
  const [a, g, b] = image
    .crop({ x: Math.floor(width / 2), y: height, width: 1, height: 1 })
    .toBitmap()
  return a !== undefined && b !== undefined && g !== undefined && a > 200 && b > 200 && g < 60
}

/**
 * The page of the offscreen window, `width` by `height` without its drawn mark, or null when
 * none comes. A hidden window paints only when asked (invalidate), and capturePage on one
 * never settles once it has loaded a second page, so the frames are taken from its 'paint'
 * events. A frame counts once it shows the mark and the next one shows the same: a picture
 * in the page may still be decoding in the first.
 */
async function drawnFrame(win: ImageWindow, width: number, height: number): Promise<NativeImage | null> {
  const frame: { image: NativeImage | null } = { image: null }
  const onPaint = (_event: unknown, _dirty: unknown, image: NativeImage) => {
    if (!image.isEmpty()) frame.image = image
  }
  win.webContents.on('paint', onPaint)
  try {
    const seen: { image?: NativeImage; bitmap?: Buffer } = {}
    for (let waited = 0; waited < FRAME_TIMEOUT_MS; waited += FRAME_POLL_MS) {
      win.webContents.invalidate()
      await new Promise((resolve) => setTimeout(resolve, FRAME_POLL_MS))
      const image = frame.image
      const size = image?.getSize()
      if (!image || image === seen.image) continue
      if (size?.width !== width || size.height !== height + DRAWN_MARK_ROWS) continue
      if (!showsDrawnMark(image, width, height)) continue
      const bitmap = image.toBitmap()
      if (seen.bitmap?.equals(bitmap)) return image.crop({ x: 0, y: 0, width, height })
      seen.image = image
      seen.bitmap = bitmap
    }
    return null
  } finally {
    win.webContents.off('paint', onPaint)
  }
}

/**
 * Put the job's pictures in a folder of its own and run `use` with the folder and what a
 * page's picture `i` points at there. The folder is gone afterwards, whatever happened.
 */
async function withJobFolder<T>(
  job: PrintJob,
  use: (dir: string, picture: (index: number) => string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'ieum-hwp-print-'))
  try {
    const names = await Promise.all(
      job.images.map(async (dataUrl, index) => {
        const file = imageFile(dataUrl, index)
        if (!file) return dataUrl
        await writeFile(join(dir, file.name), file.bytes)
        return file.name
      }),
    )
    return await use(dir, (index) => names[index] ?? '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Put the job in a folder of its own (the HTML and its pictures), load it in the window
 * `createWindow` makes (hidden, scripts off) and run `use` on it. The window and the
 * folder are gone afterwards, whatever happened.
 */
function withPrintWindow<T>(
  job: PrintJob,
  createWindow: () => PrintWindow,
  use: (win: PrintWindow) => Promise<T>,
): Promise<T> {
  return withJobFolder(job, async (dir, picture) => {
    const htmlPath = join(dir, 'print.html')
    await writeFile(htmlPath, printableHtml(job.pages, picture), 'utf8')
    const win = createWindow()
    try {
      await win.loadFile(htmlPath)
      return await use(win)
    } finally {
      win.destroy()
    }
  })
}

/**
 * Each page as a picture file: drawn alone at IMAGE_SCALE in the offscreen window
 * `createWindow` makes (scripts off), taken from its frames, and handed to `save` with its
 * index as PNG or JPEG bytes. Pages go one at a time, so a long document is never held whole.
 */
export function printJobToImages(
  job: PrintJob,
  format: ImageFormat,
  createWindow: () => ImageWindow,
  save: (index: number, bytes: Buffer) => Promise<void>,
): Promise<void> {
  return withJobFolder(job, async (dir, picture) => {
    const win = createWindow()
    try {
      for (const [index, page] of job.pages.entries()) {
        const width = Math.max(1, Math.round(page.width * IMAGE_SCALE))
        const height = Math.max(1, Math.round(page.height * IMAGE_SCALE))
        win.setContentSize(width, height + DRAWN_MARK_ROWS)
        const htmlPath = join(dir, `page-${index}.html`)
        await writeFile(htmlPath, pageImageHtml(page, picture), 'utf8')
        await win.loadFile(htmlPath)
        const image = await drawnFrame(win, width, height)
        if (!image) throw new Error(`page ${index + 1} could not be drawn`)
        await save(index, format === 'png' ? image.toPNG() : image.toJPEG(JPEG_QUALITY))
      }
    } finally {
      win.destroy()
    }
  })
}

/** The pages as PDF bytes, each page on its own paper. */
export function printJobToPdf(job: PrintJob, createWindow: () => PrintWindow): Promise<Buffer> {
  return withPrintWindow(job, createWindow, (win) =>
    win.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    }),
  )
}

/**
 * The pages to the system print dialog. Resolves when the dialog is done: true when they
 * were sent to a printer, false when the user canceled.
 */
export function printJobToPrinter(
  job: PrintJob,
  createWindow: () => PrintWindow,
): Promise<boolean> {
  return withPrintWindow(
    job,
    createWindow,
    (win) =>
      new Promise<boolean>((resolve, reject) => {
        win.webContents.print(
          { silent: false, printBackground: true, margins: { marginType: 'none' } },
          (sent, reason) => {
            if (sent || /cancel/i.test(reason)) resolve(sent)
            else reject(new Error(reason || 'print failed'))
          },
        )
      }),
  )
}
