/** plain-text extensions read as UTF-8 */
const TEXT_EXTS = [
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
]

/** image extensions sent to the model as pictures, not extracted as text */
export const ATTACHABLE_IMAGE_EXTS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
])

/** HWP/HWPX and plain-text formats get text extracted via `parseFileToText`; images skip extraction and go multimodal */
export const ATTACHABLE_EXTS: ReadonlySet<string> = new Set([
  ...TEXT_EXTS,
  'hwp',
  'hwpx',
  ...ATTACHABLE_IMAGE_EXTS,
])

/** the largest file read whole as an attachment (formats in `SIZE_FREE_EXTS` excepted) */
export const ATTACHABLE_MAX_BYTES = 50 * 1024 * 1024
/** the largest picture sent to the model with a message */
export const ATTACHABLE_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/**
 * Formats read at any size. Their size is pictures, not words: a zip-based
 * document past `WHOLE_ZIP_READ_MAX_BYTES` is read for its text parts only, and
 * a PDF's text is read without decoding its images.
 */
const SIZE_FREE_EXTS = new Set([
  'docx',
  'pptx',
  'xlsx',
  'xlsm',
  'hwpx',
  'odt',
  'epub',
  'xmind',
  'pdf',
])

/**
 * The largest file with this extension that is read for the AI: a picture's
 * cap, no cap (`Infinity`) for the formats read at any size, else
 * `ATTACHABLE_MAX_BYTES`.
 */
export function attachableMaxBytes(ext: string): number {
  const clean = ext.replace(/^\./, '').toLowerCase()
  if (ATTACHABLE_IMAGE_EXTS.has(clean)) return ATTACHABLE_IMAGE_MAX_BYTES
  if (SIZE_FREE_EXTS.has(clean)) return Number.POSITIVE_INFINITY
  return ATTACHABLE_MAX_BYTES
}

/** whether a file with this extension (with or without a leading dot) may be attached */
export function isAttachableExt(ext: string): boolean {
  return ATTACHABLE_EXTS.has(ext.replace(/^\./, '').toLowerCase())
}
