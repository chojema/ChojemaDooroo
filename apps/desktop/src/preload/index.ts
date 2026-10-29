import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CHANNEL, STATE_CHANNEL } from '../shared/contracts'
import type { AppState } from '../shared/contracts'

contextBridge.exposeInMainWorld('chojema', {
  command: (action: string, value?: unknown) => ipcRenderer.invoke(CHANNEL, action, value),
  onState: (handler: (state: AppState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState) => handler(state)
    ipcRenderer.on(STATE_CHANNEL, listener)
    return () => ipcRenderer.removeListener(STATE_CHANNEL, listener)
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),
})
