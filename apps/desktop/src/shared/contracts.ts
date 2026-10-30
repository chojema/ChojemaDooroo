export type EditorKind = 'hwp'
export interface TabInfo {
  id: string
  kind: EditorKind
  title: string
  path?: string
  active: boolean
  secondary: boolean
}
export interface AppState {
  tabs: TabInfo[]
  recent: string[]
  version: string
  theme: 'light' | 'dark' | 'system'
  terminology: 'word' | 'hwp'
  update: string
  page: 'home' | 'settings' | 'editor'
}
export const CHANNEL = 'chojema:command'
export const STATE_CHANNEL = 'chojema:state'
export const RELEASES = 'https://github.com/chojema/ChojemaDooroo/releases'
export function editorForPath(path: string): EditorKind | undefined {
  if (/\.hwpx?$/i.test(path)) return 'hwp'
  return undefined
}
/** A PDF opens as a new HWPX document made from its text, not as itself. */
export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path)
}
/** What the app opens: an HWP document, or a PDF to bring in. */
export function isOpenablePath(path: string): boolean {
  return Boolean(editorForPath(path)) || isPdfPath(path)
}
export function paneBounds(width: number, height: number, split: boolean) {
  const top = 36
  const available = Math.max(0, height - top)
  const left = split ? Math.floor((width - 6) / 2) : width
  return {
    primary: { x: 0, y: top, width: Math.max(0, left), height: available },
    secondary: { x: left + 6, y: top, width: Math.max(0, width - left - 6), height: available },
  }
}
