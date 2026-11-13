export const CLIPBOARD_HTML_MODULE: '@ieum/clipboard-html'
export function ieumPictureHtml(bytes: Uint8Array, extension: string, width: number, height: number): string | null
export function pictureSize(bytes: Uint8Array): { w: number; h: number } | null
export function ieumPasteHtmlInCell(wasm: {
  pasteHtmlInCellByPath(sec: number, para: number, path: string, offset: number, html: string): string
  pasteInternalInCellByPath(sec: number, para: number, path: string, offset: number): string
  insertPicture(sec: number, para: number, offset: number, path: string, data: Uint8Array, w: number, h: number, nw: number, nh: number, ext: string, description?: string): { ok: boolean; paraIdx: number; controlIdx: number }
  copyControl(sec: number, para: number, ci: number, path?: string): string
  deletePictureControl(sec: number, para: number, ci: number): unknown
  copySelection(sec: number, sp: number, so: number, ep: number, eo: number): string
  setPictureProperties(sec: number, para: number, ci: number, props: Record<string, unknown>): unknown
  splitParagraph(sec: number, para: number, offset: number): string
  mergeParagraph(sec: number, para: number): string
  textToLogicalOffset(sec: number, para: number, offset: number): number
  getParagraphCount(sec: number): number
  getParagraphLength(sec: number, para: number): number
  getControlTextPositions(sec: number, para: number): number[]
}, caret: {
  sectionIndex: number; parentParaIndex: number; charOffset: number
  controlIndex?: number; cellIndex?: number; cellParaIndex?: number
  cellPath?: { controlIndex: number; cellIndex: number; cellParaIndex: number }[]
}, html: string, paste: (html: string) => string): string
export function ieumSelectionHtml(wasm: {
  exportSelectionHtml(sec: number, sp: number, so: number, ep: number, eo: number): string
  exportControlHtml(sec: number, para: number, ci: number, path?: string): string
  exportSelectionInCellHtmlByPath(sec: number, para: number, path: string, sp: number, so: number, ep: number, eo: number): string
  getCellParagraphCountByPath(sec: number, para: number, path: string): number
  getCellParagraphLengthByPath(sec: number, para: number, path: string): number
  getControlTextPositions(sec: number, para: number): number[]
  getParagraphLength(sec: number, para: number): number
}, sec: number, sp: number, so: number, ep: number, eo: number): string
