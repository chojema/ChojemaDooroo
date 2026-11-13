import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { loadRhwpEngine } from '@genoffice/file-parse/hwp'
import { hwpToText } from '@genoffice/file-parse'
import { documentToHwpx, exportDocument, importDocumentAsHwpx, safeDocumentHtml } from '../src/main/document-convert'

const folders: string[] = []
afterAll(async () => { await Promise.all(folders.map((path) => rm(path, { recursive: true, force: true }))) })

describe('MD, Word and HTML conversion', () => {
  it('round-trips Korean text, formatted runs, links and table cells through each format', async () => {
    const source = await documentToHwpx(Buffer.from('<h1>한글 제목</h1><p>본문 <strong>굵게</strong> <a href="https://example.com">링크</a></p><table><tr><th>항목</th><th>값</th></tr><tr><td>사과</td><td>세 개</td></tr></table>'), 'html')
    for (const format of ['html', 'md', 'docx'] as const) {
      const bytes = await exportDocument(source, format)
      if (format === 'md') expect(bytes.toString()).toContain('**굵게**')
      if (format === 'docx') {
        const zip = await JSZip.loadAsync(bytes)
        expect(await zip.file('word/document.xml')!.async('string')).toContain('한글 제목')
      }
      const roundTrip = await documentToHwpx(bytes, format)
      const text = await hwpToText(roundTrip)
      for (const word of ['한글 제목', '본문', '굵게', '링크', '항목', '사과', '세 개']) expect(text, `${format}: ${word}`).toContain(word)
    }
  })

  it('parses Markdown rather than inserting Markdown syntax as text', async () => {
    const bytes = await documentToHwpx(Buffer.from('# 제목\n\n**강조**와 [링크](https://example.com)\n\n- 첫째\n- 둘째\n\n```js\nconst x = 1\n```'), 'md')
    const html = (await exportDocument(bytes, 'html')).toString('utf8')
    expect(html).toContain('제목')
    expect(html).not.toContain('**강조**')
    expect(html).toContain('https://example.com')
    expect(html).toContain('const x = 1')
    expect(html).toContain('24.0pt')
  })

  it('removes active content, remote resources and unsafe links', () => {
    const html = safeDocumentHtml('<script>alert(1)</script><iframe src="file:///etc/passwd"></iframe><p onclick="bad()">안전</p><img src="https://example.com/tracker.png"><a href="javascript:bad()">링크</a>')
    expect(html).toContain('안전')
    expect(html).not.toMatch(/script|iframe|onclick|https:\/\/example.com|javascript:/i)
  })

  it('imports a source as a temporary HWPX without modifying the original', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'dooroo-convert-test-')); folders.push(folder)
    const path = join(folder, '한글.MD')
    await writeFile(path, '# 원본\n\n내용')
    const made = await importDocumentAsHwpx(path); folders.push(dirname(made))
    expect(made).toMatch(/한글\.hwpx$/)
    expect(await hwpToText(await readFile(made))).toContain('원본')
    expect(await readFile(path, 'utf8')).toBe('# 원본\n\n내용')
  })

  it('keeps embedded and relative pictures, but refuses images outside the source folder', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'dooroo-convert-image-')); folders.push(folder)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA3sAAAAASUVORK5CYII=', 'base64')
    await writeFile(join(folder, 'pixel.png'), png)
    const html = '<p>그림</p><img src="pixel.png" alt="작은 그림">'
    const bytes = await documentToHwpx(Buffer.from(html), 'html', folder)
    for (const format of ['html', 'md', 'docx'] as const) {
      const exported = await exportDocument(bytes, format)
      if (format === 'docx') {
        const zip = await JSZip.loadAsync(exported)
        expect(Object.keys(zip.files).some((name) => /^word\/media\/.+\.png$/.test(name))).toBe(true)
      } else expect(exported.toString()).toContain('data:image/png;base64,')
    }
    const outside = safeDocumentHtml('<img src="../secret.png" alt="제외됨">', folder)
    expect(outside).not.toContain('<img')
    expect(outside).toContain('제외됨')
  })

  it('imports an actual binary Word document as body text', async () => {
    const input = await readFile(new URL('./fixtures/import-word.doc', import.meta.url))
    expect(input.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1')
    const text = await hwpToText(await documentToHwpx(input, 'doc'))
    expect(text).toContain('Word import test')
    expect(text).toContain('한글 본문')
  })

  it('rejects malformed Word documents and oversized expanded DOCX archives', async () => {
    await expect(documentToHwpx(Buffer.from('not word'), 'docx')).rejects.toThrow()
    await expect(documentToHwpx(Buffer.from('not word'), 'doc')).rejects.toThrow()
    const zip = new JSZip()
    zip.file('word/document.xml', 'x'.repeat(17 * 1024 * 1024))
    await expect(documentToHwpx(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), 'docx')).rejects.toThrow(/zip/i)
  })

  it('exports a document with empty paragraphs', async () => {
    const engine = await loadRhwpEngine()
    const doc = engine.HwpDocument.createEmpty()
    try {
      doc.createBlankDocument()
      expect((await exportDocument(doc.exportHwpx(), 'html')).toString()).toContain('<body>')
    } finally { doc.free() }
  })
})
