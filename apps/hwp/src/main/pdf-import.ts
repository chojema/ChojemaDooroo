/// <reference path="./pdfjs-worker.d.ts" />
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { loadRhwpEngine } from '@genoffice/file-parse/hwp'

/**
 * A PDF brought in as an HWPX document to edit: its text, read by pdf.js with where it
 * sits and how large it is, laid back out as paragraphs (lines joined, a paragraph where
 * the gaps, indents and sizes say one starts), a page of the document for each page of
 * the PDF on paper of the PDF's size, and written by the rhwp engine. Pictures, tables
 * and drawings are not brought in; a PDF of scanned pages has no text to bring.
 */

/** Largest PDF taken in; a bigger one is refused before it is read. */
export const MAX_PDF_IMPORT_BYTES = 200 * 1024 * 1024
/** Most pages brought in: past it the import is refused rather than run out of memory. */
export const MAX_PDF_IMPORT_PAGES = 2000

export type PdfImportFailure = 'encrypted' | 'no-text' | 'unreadable' | 'too-large'

/** Why a PDF could not be brought in, as one of a few reasons the app words for the user. */
export class PdfImportError extends Error {
  constructor(
    readonly reason: PdfImportFailure,
    message: string,
  ) {
    super(message)
    this.name = 'PdfImportError'
  }
}

/** A run of text on a PDF page: top-down CSS-like coordinates in points. */
export interface PdfTextItem {
  text: string
  /** left edge */
  x: number
  /** baseline, from the top of the page */
  y: number
  /** advance width */
  width: number
  /** font size */
  size: number
}

export interface PdfPageText {
  width: number
  height: number
  items: PdfTextItem[]
}

export interface ImportedParagraph {
  text: string
  /** the size most of its characters have, in points (half-point steps) */
  size: number
}

export interface ImportedPage {
  paragraphs: ImportedParagraph[]
  /** where the page's text sits, or null for a page without text */
  box: { left: number; top: number; right: number; bottom: number } | null
}

interface Line {
  text: string
  left: number
  right: number
  y: number
  size: number
  /** characters by size, to find the size most of a paragraph has */
  sizes: Map<number, number>
}

/** Control characters and the like pdf.js passes through from a PDF's text. */
const JUNK = /[\u0000-\u0008\u000b-\u001f\u007f￾￿]/g
/** Chinese and Japanese characters: lines of them join with no space between. */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/

const halfPoint = (size: number) => Math.max(1, Math.round(size * 2) / 2)

/** The lines of a page: runs on one baseline joined left to right, top to bottom. */
export function pageLines(items: PdfTextItem[]): Line[] {
  const runs = items
    .map((item) => ({ ...item, text: item.text.replace(JUNK, '').replace(/ /g, ' ') }))
    .filter((item) => item.text.length > 0 && item.size > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: PdfTextItem[][] = []
  for (const run of runs) {
    const row = rows[rows.length - 1]
    const head = row?.[0]
    // a baseline within half a letter of the row's is the same line (superscripts and
    // jitter included); runs come sorted by baseline, so only the last row can take it
    if (row && head && Math.abs(run.y - head.y) <= 0.5 * Math.max(run.size, head.size)) row.push(run)
    else rows.push([run])
  }
  const lines: Line[] = []
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
    let text = ''
    let right = -Infinity
    const sizes = new Map<number, number>()
    for (const run of row) {
      const gap = run.x - right
      // runs set apart by more than a sliver are separate words, unless a space is there
      if (text && gap > 0.15 * run.size && !/\s$/.test(text) && !/^\s/.test(run.text)) text += ' '
      text += run.text
      right = Math.max(right, run.x + run.width)
      const size = halfPoint(run.size)
      sizes.set(size, (sizes.get(size) ?? 0) + run.text.length)
    }
    text = text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const size = mostOf(sizes)
    lines.push({ text, left: row[0]!.x, right, y: row[0]!.y, size, sizes })
  }
  return lines
}

function mostOf(sizes: Map<number, number>): number {
  let best = 0
  let count = -1
  for (const [size, n] of sizes) {
    if (n > count || (n === count && size < best)) {
      best = size
      count = n
    }
  }
  return best
}

/** Two lines of one paragraph as one text: a word broken at a hyphen is put back together. */
function joinLines(head: string, tail: string): string {
  if (/[A-Za-z]-$/.test(head) && /^[a-z]/.test(tail)) return head.slice(0, -1) + tail
  if (CJK.test(head.slice(-1)) && CJK.test(tail[0] ?? '')) return head + tail
  return `${head} ${tail}`
}

/**
 * A page's text as paragraphs. A new paragraph starts where the gap to the line above is
 * clearly wider than a line's, where the size changes, where the line above stops well
 * short of the text's right edge, or where a line is indented under a full one.
 */
export function pageParagraphs(page: PdfPageText): ImportedPage {
  const lines = pageLines(page.items)
  if (lines.length === 0) return { paragraphs: [], box: null }
  const left = Math.min(...lines.map((line) => line.left))
  const right = Math.max(...lines.map((line) => line.right))
  const top = Math.min(...lines.map((line) => line.y - line.size))
  const bottom = Math.max(...lines.map((line) => line.y + line.size * 0.25))
  const paragraphs: { text: string; sizes: Map<number, number> }[] = []
  let previous: Line | undefined
  for (const line of lines) {
    const current = paragraphs[paragraphs.length - 1]
    let starts = !previous || !current
    if (previous && current) {
      const size = Math.max(line.size, previous.size)
      const gap = line.y - previous.y
      const resized = Math.abs(line.size - previous.size) > 0.15 * size
      const short = previous.right < right - 3 * size
      const indented = line.left > left + size && previous.left <= left + size / 2 && !short
      starts = gap > 1.75 * size || gap < 0 || resized || short || indented
    }
    if (starts || !current) {
      paragraphs.push({ text: line.text, sizes: new Map(line.sizes) })
    } else {
      current.text = joinLines(current.text, line.text)
      for (const [size, n] of line.sizes) current.sizes.set(size, (current.sizes.get(size) ?? 0) + n)
    }
    previous = line
  }
  return {
    paragraphs: paragraphs.map(({ text, sizes }) => ({ text, size: mostOf(sizes) })),
    box: { left, top, right, bottom },
  }
}

/** HWPUNIT in a point: 7200 to the inch. */
const HWPUNIT_PER_PT = 100
/** The narrowest margin the document gets, 5 mm, and the widest, 30 mm. */
const MIN_MARGIN = 1417
const MAX_MARGIN = 8504

const margin = (points: number) =>
  Math.min(MAX_MARGIN, Math.max(MIN_MARGIN, Math.round(points * HWPUNIT_PER_PT)))

type Engine = Awaited<ReturnType<typeof loadRhwpEngine>>

function expectOk(result: string, what: string): Record<string, unknown> {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(result) as Record<string, unknown>
  } catch {
    throw new Error(`hwp: could not ${what}: ${result}`)
  }
  if (parsed.ok === false) throw new Error(`hwp: could not ${what}: ${String(parsed.error ?? result)}`)
  return parsed
}

/**
 * The HWPX bytes of the pages: paper of the first page's size with margins around where
 * its text sits, the paragraphs in order at their sizes, and a page break after each page
 * but the last, so the document has the PDF's pages.
 */
export function buildHwpx(engine: Engine, size: { width: number; height: number }, pages: ImportedPage[]): Uint8Array {
  const doc = engine.HwpDocument.createEmpty()
  try {
    doc.createBlankDocument()
    const boxes = pages.flatMap((page) => (page.box ? [page.box] : []))
    const pageDef = JSON.parse(doc.getPageDef(0)) as Record<string, number | boolean>
    const width = Math.round(size.width * HWPUNIT_PER_PT)
    const height = Math.round(size.height * HWPUNIT_PER_PT)
    expectOk(
      doc.setPageDef(
        0,
        JSON.stringify({
          ...pageDef,
          width,
          height,
          landscape: false,
          marginHeader: 0,
          marginFooter: 0,
          marginGutter: 0,
          ...(boxes.length
            ? {
                marginLeft: margin(Math.min(...boxes.map((box) => box.left))),
                marginRight: margin(size.width - Math.max(...boxes.map((box) => box.right))),
                marginTop: margin(Math.min(...boxes.map((box) => box.top))),
                marginBottom: margin(size.height - Math.max(...boxes.map((box) => box.bottom))),
              }
            : {}),
        }),
      ),
      'set the paper',
    )
    doc.beginBatch()
    // `para` is the paragraph being written; `empty` while it holds nothing yet (the
    // blank document's one paragraph, or the one a page break leaves after itself)
    let para = 0
    let empty = true
    pages.forEach((page, index) => {
      for (const paragraph of page.paragraphs) {
        if (!empty) {
          const split = expectOk(doc.splitParagraph(0, para, doc.getParagraphLength(0, para)), 'add a paragraph')
          para = Number(split.paraIdx ?? para + 1)
        }
        expectOk(doc.insertText(0, para, 0, paragraph.text), 'insert text')
        expectOk(
          doc.applyCharFormat(
            0,
            para,
            0,
            doc.getParagraphLength(0, para),
            JSON.stringify({ fontSize: Math.round(paragraph.size * 100) }),
          ),
          'size the text',
        )
        empty = false
      }
      if (index < pages.length - 1) {
        const broken = expectOk(
          doc.insertPageBreak(0, para, doc.getParagraphLength(0, para)),
          'break the page',
        )
        para = Number(broken.paraIdx ?? para + 1)
        empty = true
      }
    })
    doc.endBatch()
    return doc.exportHwpx()
  } finally {
    doc.free()
  }
}

/**
 * Where pdf.js finds its character maps and standard font data: next to the module in a
 * dev checkout and the tests, under Resources/pdfjs in the packaged app
 * (apps/desktop/electron-builder.cjs).
 */
function pdfjsDataDir(name: 'cmaps' | 'standard_fonts'): string | undefined {
  try {
    const dir = join(dirname(createRequire(__filename).resolve('pdfjs-dist/package.json')), name)
    if (existsSync(dir)) return `${dir}/`
  } catch {
    /* fall through */
  }
  const resources = (process as { resourcesPath?: string }).resourcesPath
  const dir = resources ? join(resources, 'pdfjs', name) : undefined
  return dir && existsSync(dir) ? `${dir}/` : undefined
}

/**
 * The 2D DOMMatrix pdf.js makes one of as it loads. Node has none, and pdf.js borrows
 * one from a native canvas module the packaged app does not ship; reading text never
 * draws, so a plain affine matrix is all it needs.
 */
export class AffineMatrix {
  a = 1
  b = 0
  c = 0
  d = 1
  e = 0
  f = 0
  constructor(init?: ArrayLike<number>) {
    if (init && init.length >= 6) {
      ;[this.a, this.b, this.c, this.d, this.e, this.f] = Array.from(init).slice(0, 6) as [number, number, number, number, number, number]
    }
  }
  get is2D(): boolean {
    return true
  }
  get isIdentity(): boolean {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0
  }
  multiplySelf(other: { a: number; b: number; c: number; d: number; e: number; f: number }): this {
    const { a, b, c, d, e, f } = this
    this.a = a * other.a + c * other.b
    this.b = b * other.a + d * other.b
    this.c = a * other.c + c * other.d
    this.d = b * other.c + d * other.d
    this.e = a * other.e + c * other.f + e
    this.f = b * other.e + d * other.f + f
    return this
  }
  preMultiplySelf(other: { a: number; b: number; c: number; d: number; e: number; f: number }): this {
    const product = new AffineMatrix([other.a, other.b, other.c, other.d, other.e, other.f]).multiplySelf(this)
    ;({ a: this.a, b: this.b, c: this.c, d: this.d, e: this.e, f: this.f } = product)
    return this
  }
  translateSelf(x = 0, y = 0): this {
    return this.multiplySelf(new AffineMatrix([1, 0, 0, 1, x, y]))
  }
  scaleSelf(x = 1, y = x): this {
    return this.multiplySelf(new AffineMatrix([x, 0, 0, y, 0, 0]))
  }
  invertSelf(): this {
    const { a, b, c, d, e, f } = this
    const det = a * d - b * c
    if (!det) {
      this.a = this.b = this.c = this.d = this.e = this.f = Number.NaN
      return this
    }
    this.a = d / det
    this.b = -b / det
    this.c = -c / det
    this.d = a / det
    this.e = (c * f - d * e) / det
    this.f = (b * e - a * f) / det
    return this
  }
  multiply(other: { a: number; b: number; c: number; d: number; e: number; f: number }): AffineMatrix {
    return new AffineMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(other)
  }
  inverse(): AffineMatrix {
    return new AffineMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).invertSelf()
  }
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjs: Promise<PdfJs> | null = null

/** pdf.js with its worker run in this process: there is no page to give it a worker. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    const scope = globalThis as { DOMMatrix?: unknown }
    scope.DOMMatrix ??= AffineMatrix
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker
    // as it loads, pdf.js says it found no native canvas to draw with (it never draws
    // here); those notices are dropped (getDocument's verbosity quiets it afterwards)
    const warn = console.warn
    console.warn = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('Warning: Cannot ')) return
      warn(...args)
    }
    try {
      return await import('pdfjs-dist/legacy/build/pdf.mjs')
    } finally {
      console.warn = warn
    }
  })()
  return pdfjs
}

/** The text of every page of a PDF, with where it sits. */
export async function readPdfText(bytes: Uint8Array): Promise<PdfPageText[]> {
  const lib = await loadPdfJs()
  const cMapUrl = pdfjsDataDir('cmaps')
  const standardFontDataUrl = pdfjsDataDir('standard_fonts')
  const task = lib.getDocument({
    // pdf.js takes the buffer it is given (it is detached afterwards): it gets a copy
    data: bytes.slice(),
    ...(cMapUrl ? { cMapUrl, cMapPacked: true } : {}),
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: lib.VerbosityLevel.ERRORS,
  })
  let doc: Awaited<typeof task.promise>
  try {
    doc = await task.promise
  } catch (error) {
    await task.destroy()
    if ((error as { name?: string })?.name === 'PasswordException') {
      throw new PdfImportError('encrypted', 'the PDF is password-protected')
    }
    throw new PdfImportError('unreadable', `not a readable PDF: ${(error as Error)?.message ?? error}`)
  }
  try {
    if (doc.numPages > MAX_PDF_IMPORT_PAGES) throw new PdfImportError('too-large', 'too many pages')
    const pages: PdfPageText[] = []
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items: PdfTextItem[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue
        // the run's text matrix taken to the page as shown (top-down, rotation applied)
        const [a, b, c, d, e, f] = lib.Util.transform(viewport.transform, item.transform) as number[]
        const size = Math.hypot(c!, d!)
        // a run set at an angle (a vertical label, a rotated stamp) is not body text
        if (Math.abs(b!) > Math.abs(a!) * 0.1) continue
        items.push({ text: item.str, x: e!, y: f!, width: item.width * viewport.scale, size })
      }
      pages.push({ width: viewport.width, height: viewport.height, items })
      page.cleanup()
    }
    return pages
  } finally {
    await doc.destroy()
  }
}

/** The HWPX bytes of a PDF's text, laid out as the PDF's pages. */
export async function pdfToHwpx(bytes: Uint8Array): Promise<Uint8Array> {
  const pages = await readPdfText(bytes)
  const laidOut = pages.map(pageParagraphs)
  if (!laidOut.some((page) => page.paragraphs.length > 0)) {
    throw new PdfImportError('no-text', 'the PDF has no text (scanned pages?)')
  }
  const first = pages[0]!
  return buildHwpx(await loadRhwpEngine(), { width: first.width, height: first.height }, laidOut)
}

/**
 * The PDF at `path` as an HWPX file of the same name in a folder of its own under the
 * system temp folder, to open as a new, untitled document. The caller removes the folder.
 */
export async function importPdfAsHwpx(path: string): Promise<string> {
  const info = await stat(path)
  if (info.size > MAX_PDF_IMPORT_BYTES) throw new PdfImportError('too-large', 'the PDF is too large')
  const hwpx = await pdfToHwpx(new Uint8Array(await readFile(path)))
  const dir = await mkdtemp(join(tmpdir(), 'chojema-dooroo-pdf-'))
  const target = join(dir, `${basename(path).replace(/\.pdf$/i, '') || 'document'}.hwpx`)
  await writeFile(target, hwpx)
  return target
}
