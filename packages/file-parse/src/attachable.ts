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

/** the largest file read as an attachment */
export const ATTACHABLE_MAX_BYTES = 50 * 1024 * 1024
/** the largest picture sent to the model with a message */
export const ATTACHABLE_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** whether a file with this extension (with or without a leading dot) may be attached */
export function isAttachableExt(ext: string): boolean {
  return ATTACHABLE_EXTS.has(ext.replace(/^\./, '').toLowerCase())
}
