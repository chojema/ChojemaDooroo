/// <reference path="./document-convert-libs.d.ts" />
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import mammoth from 'mammoth'
import htmlToDocx from '@turbodocx/html-to-docx'
import { marked } from 'marked'
// The ESM entry leaves a dynamic domino require outside the packaged bundle.
import TurndownService from 'turndown/lib/turndown.cjs.js'
import { gfm } from 'turndown-plugin-gfm'
import WordExtractor from 'word-extractor'
import sanitizeHtml from 'sanitize-html'
import { loadRhwpEngine } from '@genoffice/file-parse/hwp'
import { assertZipInflatesWithinLimits } from '@genoffice/zip-gate'
import { ieumSelectionHtml } from '../../studio-plugin/clipboard-html.mjs'
import { documentImportFormat, type DocumentExportFormat, type DocumentImportFormat } from '../shared/document-formats'

export const MAX_DOCUMENT_IMPORT_BYTES = 50 * 1024 * 1024
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ZIP_LIMITS = { maxParts: 5000, maxPartBytes: 16 * 1024 * 1024, maxTotalBytes: 100 * 1024 * 1024 }
const RASTER = /^data:image\/(png|jpe?g|gif|bmp);base64,[a-z\d+/=\s]+$/i
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Documents never execute HTML or fetch remote content. Relative raster images stay inside the source folder. */
export function safeDocumentHtml(html: string, sourceFolder?: string): string {
  let imageBytes = 0
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 's', 'del', 'strike'],
    allowedAttributes: { '*': ['style'], a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    allowedStyles: { '*': {
      color: [/^(#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i],
      'background-color': [/^(#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i],
      'font-size': [/^\d+(\.\d+)?(pt|px|em|%)$/],
      'font-family': [/^[\w\s,"'가-힣-]+$/],
      'font-weight': [/^(bold|normal|[1-9]00)$/],
      'font-style': [/^(italic|normal)$/],
      'text-decoration': [/^(underline|line-through|none)$/],
      'text-align': [/^(left|right|center|justify)$/],
      'white-space': [/^(pre|pre-wrap)$/],
      width: [/^\d+(\.\d+)?(pt|px|%)$/], height: [/^\d+(\.\d+)?(pt|px|%)$/],
      border: [/^[\d.]+(pt|px) solid #[\da-f]{3,8}$/i],
      'border-collapse': [/^collapse$/],
    } },
    transformTags: {
      strong: (_tag, attrs) => ({ tagName: 'span', attribs: { ...attrs, style: `${attrs.style ?? ''};font-weight:bold` } }),
      b: (_tag, attrs) => ({ tagName: 'span', attribs: { ...attrs, style: `${attrs.style ?? ''};font-weight:bold` } }),
      em: (_tag, attrs) => ({ tagName: 'span', attribs: { ...attrs, style: `${attrs.style ?? ''};font-style:italic` } }),
      img: (_tag, attrs) => {
        let src = attrs.src ?? ''
        if (!RASTER.test(src) && sourceFolder && src && !/^[a-z][\w+.-]*:|^[\\/]/i.test(src)) {
          try {
            const root = realpathSync(sourceFolder)
            const path = realpathSync(resolve(root, decodeURIComponent(src)))
            const rel = relative(root, path)
            const extension = extname(path).slice(1).toLowerCase()
            const size = statSync(path).size
            if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && /^(png|jpe?g|gif|bmp)$/.test(extension) && size <= MAX_IMAGE_BYTES) {
              src = `data:image/${extension === 'jpg' ? 'jpeg' : extension};base64,${readFileSync(path).toString('base64')}`
            }
          } catch { /* a missing or inaccessible image is represented by its alt text */ }
        }
        const size = Math.ceil(src.length * 3 / 4)
        if (!RASTER.test(src) || size > MAX_IMAGE_BYTES || imageBytes + size > MAX_DOCUMENT_IMPORT_BYTES) {
          return { tagName: 'span', attribs: {}, text: attrs.alt ?? '' }
        }
        imageBytes += size
        return { tagName: 'img', attribs: { ...attrs, src } }
      },
    },
  })
}

/** The common import path keeps the engine's HTML paste support for runs, tables and pictures. */
export async function documentToHwpx(bytes: Buffer, format: DocumentImportFormat, sourceFolder?: string): Promise<Uint8Array> {
  if (!bytes.length || bytes.length > MAX_DOCUMENT_IMPORT_BYTES) throw new Error('가져올 문서가 비어 있거나 너무 큽니다. 최대 50 MB입니다.')
  let html: string
  if (format === 'docx') {
    await assertZipInflatesWithinLimits(bytes, ZIP_LIMITS)
    html = (await mammoth.convertToHtml({ buffer: bytes }, { externalFileAccess: false, includeEmbeddedStyleMap: false })).value
  } else if (format === 'doc') {
    const text = (await new WordExtractor().extract(bytes)).getBody()
    html = text.split(/\r\n|\r|\n/).map((line) => `<p>${escape(line)}</p>`).join('')
  } else {
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '')
    html = format === 'md' ? marked.parse(text, { async: false, gfm: true }) : text
  }
  html = safeDocumentHtml(html, sourceFolder)
  // HTML paste reads character properties from spans, rather than heading defaults.
  html = html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, content: string) => `<p><span style="font-size:${[24, 20, 16, 14, 12, 11][Number(level) - 1]}pt;font-weight:bold">${content}</span></p>`)
  // The paste parser starts its first run at the first styled span; mark leading plain text explicitly.
  html = html.replace(/(<(?:p|li|td|th)\b[^>]*>)([^<]+)/gi, '$1<span style="font-weight:normal;font-style:normal">$2</span>')
  // shortcut: the engine's HTML paste drops hyperlink fields; retain their addresses until it supports them.
  html = html.replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => `${label} (${href})`)
  if (Buffer.byteLength(html) > MAX_DOCUMENT_IMPORT_BYTES) throw new Error('변환한 문서가 너무 큽니다.')
  const engine = await loadRhwpEngine()
  const doc = engine.HwpDocument.createEmpty()
  try {
    doc.createBlankDocument()
    if (html.trim()) {
      const result = JSON.parse(doc.pasteHtml(0, 0, 0, html))
      if (result.ok === false) throw new Error(String(result.error ?? '문서를 가져오지 못했습니다.'))
    }
    return doc.exportHwpx()
  } finally { doc.free() }
}

export async function importDocumentAsHwpx(path: string): Promise<string> {
  const format = documentImportFormat(path)
  if (!format) throw new Error('지원하지 않는 문서 형식입니다.')
  if ((await stat(path)).size > MAX_DOCUMENT_IMPORT_BYTES) throw new Error('가져올 문서가 너무 큽니다. 최대 50 MB입니다.')
  const bytes = await documentToHwpx(await readFile(path), format, dirname(path))
  const folder = await mkdtemp(join(tmpdir(), 'dooroo-document-'))
  try {
    const target = join(folder, basename(path, extname(path)) + '.hwpx')
    await writeFile(target, bytes)
    return target
  } catch (error) {
    await rm(folder, { recursive: true, force: true })
    throw error
  }
}

/** A snapshot includes unsaved edits; exporting never changes the editor's save target or dirty state. */
export async function exportDocument(bytes: Uint8Array, format: DocumentExportFormat): Promise<Buffer> {
  const engine = await loadRhwpEngine()
  const doc = new engine.HwpDocument(bytes)
  let html = ''
  try {
    const wasm = {
      exportSelectionHtml: doc.exportSelectionHtml.bind(doc),
      exportControlHtml: (sec: number, para: number, ci: number) => doc.exportControlHtml(sec, para, '', ci),
      exportSelectionInCellHtmlByPath: doc.exportSelectionInCellHtmlByPath.bind(doc),
      getCellParagraphCountByPath: doc.getCellParagraphCountByPath.bind(doc),
      getCellParagraphLengthByPath: doc.getCellParagraphLengthByPath.bind(doc),
      getControlTextPositions: (sec: number, para: number) => JSON.parse(doc.getControlTextPositions(sec, para)) as number[],
      getParagraphLength: doc.getParagraphLength.bind(doc),
    }
    for (let sec = 0; sec < doc.getSectionCount(); sec++) {
      const last = doc.getParagraphCount(sec) - 1
      if (last < 0) continue
      const section = ieumSelectionHtml(wasm, sec, 0, 0, last, doc.getParagraphLength(sec, last))
      html += /<!--StartFragment-->\s*([\s\S]*?)\s*<!--EndFragment-->/.exec(section)?.[1] ?? section
    }
  } finally { doc.free() }
  html = safeDocumentHtml(html)
  if (format === 'md') {
    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).use(gfm)
    turndown.addRule('styledRuns', {
      filter: (node) => node.nodeName === 'SPAN' && /font-weight:(bold|[6-9]00)|font-style:italic|text-decoration:line-through/.test(node.getAttribute('style') ?? ''),
      replacement: (content, node) => {
        const style = (node as HTMLElement).getAttribute('style') ?? ''
        if (/font-weight:(bold|[6-9]00)/.test(style)) content = `**${content}**`
        if (/font-style:italic/.test(style)) content = `*${content}*`
        if (/text-decoration:line-through/.test(style)) content = `~~${content}~~`
        return content
      },
    })
    turndown.addRule('documentTables', {
      filter: 'table',
      replacement: (_content, node) => {
        const table = node as HTMLElement
        // shortcut: merged/nested tables stay as HTML; Markdown tables cannot represent their spans.
        if (table.querySelector('[colspan]:not([colspan="1"]), [rowspan]:not([rowspan="1"]), table')) return `\n\n${table.outerHTML}\n\n`
        const rows = Array.from(table.querySelectorAll('tr'), (row) => Array.from(row.children, (cell) => turndown.turndown(cell.innerHTML).replace(/\n+/g, '<br>').replace(/\|/g, '\\|')))
        const columns = Math.max(0, ...rows.map((row) => row.length))
        if (!columns) return ''
        const line = (row: string[]) => `| ${Array.from({ length: columns }, (_, i) => row[i] ?? '').join(' | ')} |`
        return `\n\n${[line(rows[0]), line(Array(columns).fill('---')), ...rows.slice(1).map(line)].join('\n')}\n\n`
      },
    })
    return Buffer.from(turndown.turndown(html) + '\n', 'utf8')
  }
  const document = `<!DOCTYPE html>\n<html lang="ko"><head><meta charset="utf-8"><title>문서</title></head><body>${html}</body></html>`
  if (format === 'html') return Buffer.from(document, 'utf8')
  const converted = await htmlToDocx(document, undefined, { title: '문서', decodeUnicode: true })
  return Buffer.from(converted as Buffer)
}
