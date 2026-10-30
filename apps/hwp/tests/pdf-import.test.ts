/**
 * Bringing a PDF in as an HWPX document: the text runs of each page become lines, the
 * lines paragraphs, and the engine writes them on the PDF's paper, a page for a page.
 * The PDFs here are made in the test: a font that is not embedded, with a ToUnicode map
 * so pdf.js reads its text (Korean included) the way it reads a real document's.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import {
  AffineMatrix,
  PdfImportError,
  pageLines,
  pageParagraphs,
  pdfToHwpx,
  type PdfTextItem,
} from '../src/main/pdf-import'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

interface Run {
  text: string
  /** from the left edge, in points */
  x: number
  /** baseline from the top of the page, in points */
  y: number
  size: number
}

/**
 * An A4 PDF of these pages. Every character is one CID (its code point) of a Type0 font
 * that is 1 em wide, so a run of n characters is n × size points long.
 */
function makePdf(pages: Run[][]): Uint8Array {
  const objects: string[] = []
  const add = (body: string) => objects.push(body)
  const toUnicode =
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Identity-UCS def ' +
    '1 begincodespacerange <0000> <FFFF> endcodespacerange ' +
    '1 beginbfrange <0000> <FFFF> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end'
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('') // the page tree, written once the pages are numbered
  add('<< /Type /Font /Subtype /Type0 /BaseFont /TestFont /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>')
  add('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TestFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 1000 /CIDToGIDMap /Identity >>')
  add('<< /Type /FontDescriptor /FontName /TestFont /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>')
  add(`<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`)
  const kids: number[] = []
  for (const runs of pages) {
    const content = runs
      .map((run) => {
        const hex = [...run.text].map((c) => c.codePointAt(0)!.toString(16).padStart(4, '0')).join('')
        return `BT /F1 ${run.size} Tf 1 0 0 1 ${run.x} ${842 - run.y} Tm <${hex}> Tj ET`
      })
      .join('\n')
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length} 0 R >>`)
    kids.push(objects.length)
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  let pdf = '%PDF-1.7\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}

const item = (text: string, x: number, y: number, size = 10): PdfTextItem => ({
  text,
  x,
  y,
  size,
  width: text.length * size * 0.5,
})

describe('the lines of a page', () => {
  it('joins the runs of a baseline left to right, a space where they stand apart', () => {
    const lines = pageLines([
      item('world', 60, 100.4),
      item('Hello', 20, 100),
      item('next', 20, 115),
      item('line', 40, 115.2),
    ])
    expect(lines.map((line) => line.text)).toEqual(['Hello world', 'nextline'])
  })

  it('drops control characters and empty runs', () => {
    expect(pageLines([item('\u0000ab\u0007', 0, 10), item('', 30, 10)]).map((l) => l.text)).toEqual(['ab'])
  })
})

describe('the paragraphs of a page', () => {
  const page = (items: PdfTextItem[]) => ({ width: 595, height: 842, items })

  it('joins full lines, and starts a paragraph after a short line or a wide gap', () => {
    const { paragraphs } = pageParagraphs(
      page([
        item('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 50, 100),
        item('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 50, 114),
        item('cc', 50, 128),
        item('dddddddddddddddddddddddddddddddddddddddd', 50, 142),
        item('eeee', 50, 180),
      ]),
    )
    expect(paragraphs.map((p) => p.text)).toEqual([
      `${'a'.repeat(40)} ${'b'.repeat(40)} cc`,
      'd'.repeat(40),
      'eeee',
    ])
  })

  it('starts a paragraph where the size changes and keeps the size most of it has', () => {
    const { paragraphs } = pageParagraphs(
      page([item('Title', 50, 80, 22), item('Body text', 50, 110, 11)]),
    )
    expect(paragraphs).toEqual([
      { text: 'Title', size: 22 },
      { text: 'Body text', size: 11 },
    ])
  })

  it('mends a word broken at a hyphen, and joins Chinese and Japanese lines without a space', () => {
    const { paragraphs } = pageParagraphs(
      page([
        item('a long line that ends in the middle of a docu-', 50, 100),
        item('ment and goes on', 50, 114),
      ]),
    )
    expect(paragraphs[0]!.text).toBe('a long line that ends in the middle of a document and goes on')
    const cjk = pageParagraphs(page([item('日本語の文章が長く続いてここで', 50, 100, 10), item('改行される', 50, 114, 10)]))
    expect(cjk.paragraphs[0]!.text).toBe('日本語の文章が長く続いてここで改行される')
  })

  it('says where the text sits, and has no box for a page without text', () => {
    expect(pageParagraphs(page([item('x', 70, 100, 10)])).box).toEqual({
      left: 70,
      top: 90,
      right: 75,
      bottom: 102.5,
    })
    expect(pageParagraphs(page([]))).toEqual({ paragraphs: [], box: null })
  })
})

describe('a PDF brought in', () => {
  it('becomes an HWPX document of its paragraphs, sizes and pages on its paper', async () => {
    const pdf = makePdf([
      [
        { text: '가져오기 시험 문서', x: 57, y: 80, size: 22 },
        { text: '첫째 문단의 첫 줄입니다 이 줄은 충분히 길게 이어집니다 끝까지', x: 57, y: 120, size: 11 },
        { text: '같은 문단의 둘째 줄입니다', x: 57, y: 136, size: 11 },
        { text: '둘째 문단입니다', x: 57, y: 170, size: 11 },
      ],
      [{ text: '둘째 쪽 본문', x: 57, y: 80, size: 11 }],
    ])
    const doc = new HwpDocument(await pdfToHwpx(pdf))
    try {
      expect(doc.pageCount()).toBe(2)
      const texts: string[] = []
      for (let para = 0; para < doc.getParagraphCount(0); para++) {
        const length = doc.getParagraphLength(0, para)
        texts.push(length > 0 ? doc.getTextRange(0, para, 0, length) : '')
      }
      expect(texts.filter(Boolean)).toEqual([
        '가져오기 시험 문서',
        '첫째 문단의 첫 줄입니다 이 줄은 충분히 길게 이어집니다 끝까지 같은 문단의 둘째 줄입니다',
        '둘째 문단입니다',
        '둘째 쪽 본문',
      ])
      const sizeAt = (para: number) =>
        (JSON.parse(doc.getCharPropertiesAt(0, para, 0)) as { fontSize: number }).fontSize
      expect(sizeAt(0)).toBe(2200)
      expect(sizeAt(1)).toBe(1100)
      const paper = JSON.parse(doc.getPageDef(0)) as { width: number; height: number; marginLeft: number }
      expect(paper.width).toBe(59500)
      expect(paper.height).toBe(84200)
      expect(paper.marginLeft).toBe(5700)
    } finally {
      doc.free()
    }
  })

  it('is refused when it has no text, and when it is not a PDF', async () => {
    await expect(pdfToHwpx(makePdf([[]]))).rejects.toMatchObject({ reason: 'no-text' })
    const notPdf = pdfToHwpx(new TextEncoder().encode('not a pdf at all'))
    await expect(notPdf).rejects.toBeInstanceOf(PdfImportError)
    await expect(notPdf).rejects.toMatchObject({ reason: 'unreadable' })
  })
})

describe('the matrix pdf.js is given where there is no DOMMatrix', () => {
  it('multiplies, translates, scales and inverts as a 2D DOMMatrix does', () => {
    const m = new AffineMatrix().translateSelf(10, 20).scaleSelf(2, 3)
    expect([m.a, m.b, m.c, m.d, m.e, m.f]).toEqual([2, 0, 0, 3, 10, 20])
    const back = m.multiply(m.inverse())
    expect([back.a, back.b, back.c, back.d, back.e, back.f].map((n) => Math.round(n * 1e9) / 1e9)).toEqual([1, 0, 0, 1, 0, 0])
    expect(new AffineMatrix([1, 2, 3, 4, 5, 6]).isIdentity).toBe(false)
    expect(new AffineMatrix().isIdentity).toBe(true)
  })
})
