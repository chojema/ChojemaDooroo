export const DOCUMENT_EXPORT_FORMATS = ['md', 'docx', 'html'] as const
export type DocumentExportFormat = (typeof DOCUMENT_EXPORT_FORMATS)[number]
export type DocumentImportFormat = DocumentExportFormat | 'doc'

export function documentImportFormat(path: string): DocumentImportFormat | null {
  const extension = /\.([^.\\/]+)$/.exec(path)?.[1].toLowerCase()
  if (extension === 'markdown') return 'md'
  if (extension === 'htm') return 'html'
  return extension === 'md' || extension === 'docx' || extension === 'doc' || extension === 'html' ? extension : null
}
