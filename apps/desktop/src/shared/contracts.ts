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
  update: string
  page: 'home' | 'settings' | 'editor'
}
export const CHANNEL = 'chojema:command'
export const STATE_CHANNEL = 'chojema:state'
export const RELEASES = 'https://github.com/chojema/ChojemaDocs/releases'
export function editorForPath(path: string): EditorKind | undefined {
  if (/\.hwpx?$/i.test(path)) return 'hwp'
  return undefined
}
export function paneBounds(width: number, height: number, split: boolean) {
  const top = 76
  const available = Math.max(0, height - top)
  const left = split ? Math.floor((width - 6) / 2) : width
  return {
    primary: { x: 0, y: top, width: Math.max(0, left), height: available },
    secondary: { x: left + 6, y: top, width: Math.max(0, width - left - 6), height: available },
  }
}
