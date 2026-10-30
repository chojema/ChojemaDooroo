import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { hwpToText } from './hwp'

export type ParsedFileKind = 'text' | 'image' | 'unsupported'

export interface ParsedFile {
  ok: boolean
  text?: string
  kind: ParsedFileKind
  mime?: string
  error?: string
}

const IMAGE_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

const TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'log',
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'java',
  'c',
  'h',
  'cpp',
  'go',
  'rs',
  'rb',
  'sh',
  'sql',
  'css',
])

const FATAL_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const WINDOWS_1252_DECODER = new TextDecoder('windows-1252')

function decodeTextBytes(bytes: Buffer): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    if (bytes[2] === 0 && bytes[3] === 0) return null // UTF-32LE BOM
    return bytes.toString('utf16le', 2)
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const payload = bom ? bytes.subarray(3) : bytes
  try {
    return FATAL_UTF8_DECODER.decode(payload)
  } catch {
    return WINDOWS_1252_DECODER.decode(payload)
  }
}

type BinaryKind = 'zip' | 'ole2' | 'hwp3' | 'unknown'

const HWP3_SIGNATURE = Buffer.from('HWP Document File')

function sniffBinary(bytes: Buffer): BinaryKind {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'zip'
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  )
    return 'ole2'
  if (bytes.subarray(0, HWP3_SIGNATURE.length).equals(HWP3_SIGNATURE)) return 'hwp3'
  return 'unknown'
}

export interface ParseFileOptions {
  maxChars?: number
}

/** parse an attachment into plain text (or flag it as image / unsupported) */
export async function parseFileToText(
  filePath: string,
  _opts: ParseFileOptions = {},
): Promise<ParsedFile> {
  const ext = extname(filePath).slice(1).toLowerCase()
  const imageMime = IMAGE_MIMES[ext]
  if (imageMime) return { ok: true, kind: 'image', mime: imageMime }
  try {
    if (TEXT_EXTS.has(ext)) {
      const text = decodeTextBytes(await readFile(filePath))
      if (text === null) {
        return {
          ok: false,
          kind: 'text',
          error:
            'Unsupported text encoding: BOM-declared UTF-32 cannot be decoded (UTF-8 and UTF-16 are supported)',
        }
      }
      return { ok: true, kind: 'text', text }
    }
    if (ext === 'hwp' || ext === 'hwpx') {
      const bytes = await readFile(filePath)
      const sniffed = sniffBinary(bytes)
      if (
        (ext === 'hwpx' && sniffed !== 'zip') ||
        (ext === 'hwp' && sniffed !== 'ole2' && sniffed !== 'hwp3' && sniffed !== 'zip')
      ) {
        return {
          ok: false,
          kind: 'text',
          error: `Content mismatch: .${ext} file has ${sniffed} magic bytes`,
        }
      }
      return { ok: true, kind: 'text', text: await hwpToText(bytes) }
    }
  } catch (e) {
    return { ok: false, kind: 'text', error: e instanceof Error ? e.message : String(e) }
  }
  return { ok: false, kind: 'unsupported', error: `Unsupported file type: .${ext || 'unknown'}` }
}
