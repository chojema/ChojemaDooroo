import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, safeStorage, shell, webContents } from 'electron'
import type { WebContents, WebContentsView, MenuItemConstructorOptions } from 'electron'
import type { AppCommand } from '../../../hwp/src/shared/ipc'
import { basename, dirname, join, resolve, isAbsolute } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { configureAssistant, registerAiIpc, registerProjectIpc, assistantSetup, saveAssistantSetup } from '../services/main/assistant'
import {
  configureHwpRuntime, createHwpView, requestHwpClose,
  requestHwpSave, requestHwpPrint, setHwpFileSavedHook,
} from '../../../hwp/src/main/hwp-main'
import { importPdfAsHwpx, PdfImportError } from '../../../hwp/src/main/pdf-import'
import {
  registerRendererScheme, installRendererProtocol, installNavigationGuard,
  installContextMenu, contextMenuLabels, DROP_OPEN_CHANNEL,
} from '@genoffice/electron-utils'
import { initSubscriptionChildTracking, shutdownSubscriptionChildren } from '@genoffice/ai-provider/subscription'
import { setAiSecretCodec } from '@genoffice/ai-provider'
import { safeStorageCodec, sealingKeyOnDisk, sealStoredAiSettings } from './ai-secrets'
import { setUiLang, getUiLang } from '@genoffice/i18n'
import { DEFAULT_AI_PANEL_PREFS, normalizeAiPanelPrefs } from '@genoffice/ui/ai-panel-prefs'
import { OUTBOUND_CHANNELS, confirmRequestOf } from '@genoffice/electron-utils/outbound-channels'
import { autoUpdater } from 'electron-updater'
import { CHANNEL, STATE_CHANNEL, RELEASES, editorForPath, isOpenablePath, isPdfPath, paneBounds } from '../shared/contracts'
import type { AppState, EditorKind } from '../shared/contracts'

// Chojema Dooroo host. Editor engines and their save protections stay upstream-owned.
app.setName('Chojema Dooroo')
app.setPath('userData', process.env.CHOJEMA_DOOROO_USER_DATA ?? join(app.getPath('appData'), app.isPackaged ? 'ChojemaDocs' : 'ChojemaDocs-Dev'))
if (process.platform === 'win32') app.setAppUserModelId('io.github.chojema.docs')
registerRendererScheme()
installNavigationGuard(app)
installContextMenu(app, () => contextMenuLabels(getUiLang()))

interface Settings {
  terminology: 'word' | 'hwp'
  theme: 'system' | 'light' | 'dark'
  recent: string[]
  aiPrefs: typeof DEFAULT_AI_PANEL_PREFS
}
const settingsPath = join(app.getPath('userData'), 'chojema-settings.json')
let settings: Settings = { terminology: 'word', theme: 'system', recent: [], aiPrefs: { ...DEFAULT_AI_PANEL_PREFS, openInNewDocs: false } }
try {
  const saved = JSON.parse(readFileSync(settingsPath, 'utf8'))
  settings = {
    terminology: saved.terminology === 'hwp' ? 'hwp' : 'word',
    theme: ['system', 'light', 'dark'].includes(saved.theme) ? saved.theme : 'system',
    recent: Array.isArray(saved.recent) ? saved.recent.filter((p: unknown) => typeof p === 'string' && editorForPath(p)).slice(0, 15) : [],
    aiPrefs: normalizeAiPanelPrefs(saved.aiPrefs ?? settings.aiPrefs),
  }
} catch { /* first launch or unreadable settings */ }
nativeTheme.themeSource = settings.theme
function persist() {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsPath + '.tmp', JSON.stringify(settings, null, 2), 'utf8')
  renameSync(settingsPath + '.tmp', settingsPath)
}

interface Tab { id: string; kind: EditorKind; title: string; path?: string; view: WebContentsView }
interface Host { win: BrowserWindow; tabs: Tab[]; active?: string; secondary?: string; page: AppState['page']; closing: boolean; allowClose: boolean }
const hosts = new Set<Host>()
const closingTabs = new Set<string>()
let nextId = 1
let updateMessage = '업데이트를 확인할 수 있습니다.'
let updateReady = false
let updateTimer: ReturnType<typeof setInterval> | undefined
const pendingPaths: string[] = []
const moduleRoot = app.isPackaged ? join(process.resourcesPath, 'modules') : resolve(__dirname, '../../..')
const outFor = (kind: string) => app.isPackaged ? join(moduleRoot, kind) : join(moduleRoot, kind, 'out')
configureHwpRuntime({
  preloadPath: join(outFor('hwp'), 'preload/index.js'),
  rendererFile: join(outFor('hwp'), 'renderer/index.html'),
  openGeneratedPath: () => false,
  openFileDialog: () => { void openDialog(focusedHost()) },
  goHome: () => { const host = focusedHost(); host.page = 'home'; layout(host) },
  newDocument: () => { openTab(focusedHost(), 'hwp') },
  // The app shows no window menu: its own commands sit in the editor's menus instead.
  appMenu: [
    { command: 'new', label: '새 문서', menuId: 'file', position: 'top', shortcut: 'Alt+N' },
    { command: 'open', label: '열기…', menuId: 'file', position: 'top', shortcut: 'Ctrl+O' },
    { command: 'close', label: '문서 닫기', menuId: 'file', shortcut: 'Ctrl+W' },
    { command: 'home', label: '홈', menuId: 'view' },
    { command: 'split', label: '나란히 보기', menuId: 'view' },
    { command: 'detach', label: '창으로 분리', menuId: 'view' },
    { command: 'settings', label: 'Chojema Dooroo 설정', menuId: 'tool' },
    { command: 'check-update', label: '업데이트 확인', menuId: 'tool' },
    { command: 'about', label: 'Chojema Dooroo 정보', menuId: 'tool', replaces: 'file:about' },
  ],
  appCommand: (wc, command) => {
    const host = ownerFor(wc.id)
    if (host) void runAppCommand(host, command)
  },
})
function allTabs() { return [...hosts].flatMap((h) => h.tabs) }
function ownerFor(wcId: number) { return [...hosts].find((h) => h.win.webContents.id === wcId || h.tabs.some((t) => t.view.webContents.id === wcId)) }
function focusedHost(): Host {
  const focused = BrowserWindow.getFocusedWindow()
  return [...hosts].find((h) => h.win === focused) ?? [...hosts][0] ?? createHost()
}
function activeTab(host: Host) { return host.tabs.find((t) => t.id === host.active) }
function publish(host: Host) {
  if (host.win.isDestroyed()) return
  const state: AppState = {
    tabs: host.tabs.map(({ id, kind, title, path }) => ({ id, kind, title, path, active: host.active === id, secondary: host.secondary === id })),
    recent: settings.recent.filter(existsSync), version: app.getVersion(), theme: settings.theme,
    terminology: settings.terminology, update: updateMessage, page: host.page,
  }
  host.win.webContents.send(STATE_CHANNEL, state)
  return state
}
function publishAll() { for (const host of hosts) publish(host) }
function layout(host: Host) {
  const [width, height] = host.win.getContentSize()
  const split = host.page === 'editor' && !!host.secondary && host.secondary !== host.active
  const bounds = paneBounds(width, height, split)
  for (const tab of host.tabs) {
    const visible = host.page === 'editor' && (tab.id === host.active || (split && tab.id === host.secondary))
    tab.view.setVisible(visible)
    if (visible) tab.view.setBounds(tab.id === host.secondary ? bounds.secondary : bounds.primary)
    tab.view.webContents.send('app:split-role-changed', split ? (tab.id === host.active ? 'focus' : 'secondary') : null)
  }
  host.win.setTitle(activeTab(host) && host.page === 'editor' ? `${activeTab(host)!.title} — Chojema Dooroo` : 'Chojema Dooroo')
  publish(host)
}
function showPage(host: Host, page: AppState['page']) { host.page = page; layout(host) }
function toggleSplit(host: Host) {
  if (host.secondary) host.secondary = undefined
  else {
    if (host.tabs.length < 2) throw new Error('나란히 보려면 문서를 두 개 이상 열어 주세요.')
    host.secondary = host.tabs.find((t) => t.id !== host.active)?.id
  }
  layout(host)
}
async function runAppCommand(host: Host, command: AppCommand) {
  try {
    switch (command) {
      case 'new': openTab(host, 'hwp'); break
      case 'open': await openDialog(host); break
      case 'close': await closeTab(host); break
      case 'home': showPage(host, 'home'); break
      case 'settings': showPage(host, 'settings'); break
      case 'split': toggleSplit(host); break
      case 'detach': detach(host); break
      case 'check-update': showPage(host, 'settings'); await checkUpdate(); break
      case 'about': await about(host); break
    }
  } catch (error) {
    await dialog.showMessageBox(host.win, { type: 'info', message: error instanceof Error ? error.message : String(error) })
  }
}
function activate(host: Host, id: string) {
  if (!host.tabs.some((t) => t.id === id)) return
  if (host.secondary === id) host.secondary = host.active
  host.active = id
  host.page = 'editor'
  layout(host)
  activeTab(host)?.view.webContents.focus()
}
function remember(path: string) {
  settings.recent = [path, ...settings.recent.filter((p) => p !== path)].slice(0, 15)
  persist()
  publishAll()
}
function saved(wcId: number, path: string) {
  const host = ownerFor(wcId)
  const tab = host?.tabs.find((t) => t.view.webContents.id === wcId)
  if (tab) { tab.path = path; tab.title = basename(path) }
  remember(path)
  if (host) layout(host)
}
/** `copy`: a file to open as a new, untitled document (a PDF brought in) instead of `path`. */
function openTab(host: Host, kind: EditorKind, path?: string, copy?: string) {
  if (path) {
    const existing = allTabs().find((t) => t.path && resolve(t.path).toLowerCase() === resolve(path).toLowerCase())
    if (existing) {
      const own = [...hosts].find((h) => h.tabs.includes(existing))!
      own.win.show(); own.win.focus(); activate(own, existing.id)
      return existing
    }
  }
  const view = copy ? createHwpView(copy, { untitledCopy: true }) : createHwpView(path)
  const tab: Tab = { id: `doc-${nextId++}`, kind, title: path ? basename(path) : copy ? basename(copy) : '새 문서.hwpx', path, view }
  host.tabs.push(tab)
  host.win.contentView.addChildView(view)
  view.webContents.on('focus', () => {
    if (hostForTab(tab)?.secondary === tab.id) {
      const own = hostForTab(tab)!
      const oldActive = own.active; own.active = tab.id; own.secondary = oldActive
      // Keep the panes stationary when focus moves between the two editors.
      publish(own)
    }
  })
  view.webContents.on('render-process-gone', () => {
    void dialog.showMessageBox(hostForTab(tab)?.win ?? host.win, { type: 'error', message: '문서 편집기가 종료되었습니다.', detail: '문서를 닫고 다시 열어 주세요. 저장되지 않은 내용은 복구 사본에 남아 있을 수 있습니다.' })
  })
  activate(host, tab.id)
  if (path) remember(path)
  return tab
}
function hostForTab(tab: Tab) { return [...hosts].find((h) => h.tabs.includes(tab)) }
async function openPath(host: Host, path: unknown) {
  if (typeof path !== 'string' || !isAbsolute(path) || !existsSync(path)) throw new Error('문서 파일을 찾을 수 없습니다.')
  if (isPdfPath(path)) return importPdf(host, resolve(path))
  const kind = editorForPath(path)
  if (!kind) throw new Error('HWP, HWPX 또는 PDF 파일을 선택해 주세요.')
  openTab(host, kind, resolve(path))
}
const PDF_IMPORT_MESSAGES: Record<PdfImportError['reason'], string> = {
  encrypted: '암호가 걸린 PDF는 가져올 수 없습니다.',
  'no-text': 'PDF에서 가져올 텍스트를 찾지 못했습니다. 스캔한 그림으로 된 PDF는 가져올 수 없습니다.',
  'too-large': 'PDF가 너무 커서 가져올 수 없습니다.',
  unreadable: 'PDF 파일을 읽지 못했습니다.',
}
/**
 * A PDF opens as a new, untitled HWPX document made from its text; the made file's
 * folder goes when its tab does. A failure is told here, whichever way the PDF came.
 */
async function importPdf(host: Host, path: string) {
  let made: string
  try {
    made = await importPdfAsHwpx(path)
  } catch (error) {
    console.warn('[pdf-import]', error)
    const message = error instanceof PdfImportError ? PDF_IMPORT_MESSAGES[error.reason] : PDF_IMPORT_MESSAGES.unreadable
    await dialog.showMessageBox(host.win, { type: 'info', message, detail: basename(path) })
    return
  }
  const tab = openTab(host, 'hwp', undefined, made)
  tab.view.webContents.once('destroyed', () => { void rm(dirname(made), { recursive: true, force: true }) })
}
async function openDialog(host: Host) {
  const result = await dialog.showOpenDialog(host.win, { properties: ['openFile', 'multiSelections'], filters: [{ name: '한글 문서 및 PDF', extensions: ['hwp', 'hwpx', 'pdf'] }, { name: '한글 문서', extensions: ['hwp', 'hwpx'] }, { name: 'PDF (텍스트를 새 문서로 가져오기)', extensions: ['pdf'] }] })
  for (const path of result.filePaths) await openPath(host, path)
}
async function mayClose(tab: Tab, host: Host) {
  return requestHwpClose(tab.view.webContents, host.win)
}
async function closeTab(host: Host, id?: string) {
  const tab = host.tabs.find((t) => t.id === (id ?? host.active))
  if (!tab || closingTabs.has(tab.id)) return
  closingTabs.add(tab.id)
  try {
    if (!(await mayClose(tab, host))) return
    host.win.contentView.removeChildView(tab.view)
    host.tabs = host.tabs.filter((t) => t !== tab)
    if (host.secondary === tab.id) host.secondary = undefined
    if (host.active === tab.id) host.active = host.tabs.at(-1)?.id
    if (!host.tabs.length) host.page = 'home'
    tab.view.webContents.close()
    layout(host)
  } finally { closingTabs.delete(tab.id) }
}
function detach(host: Host) {
  const tab = activeTab(host)
  if (!tab) return
  const target = createHost()
  host.win.contentView.removeChildView(tab.view)
  host.tabs = host.tabs.filter((t) => t !== tab)
  host.active = host.tabs.at(-1)?.id
  host.secondary = undefined
  if (!host.tabs.length) host.page = 'home'
  target.tabs.push(tab)
  target.win.contentView.addChildView(tab.view)
  // Reparent the same WebContentsView: document state and undo history survive.
  activate(target, tab.id)
  layout(host)
}
function createHost(): Host {
  const win = new BrowserWindow({ width: 1360, height: 940, minWidth: 950, minHeight: 650, backgroundColor: '#f7f8fa', show: false, autoHideMenuBar: false, webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  // No menu bar: the editor's menus carry the app's commands. The application menu stays
  // set, unseen, so its shortcuts (Ctrl+W, Ctrl+Tab, F11) keep working.
  win.setMenuBarVisibility(false)
  const host: Host = { win, tabs: [], page: 'home', closing: false, allowClose: false }
  hosts.add(host)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('did-finish-load', () => { publish(host); win.show() })
  void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('resize', () => layout(host))
  win.on('close', (event) => {
    if (host.allowClose) return
    event.preventDefault()
    if (host.closing) return
    host.closing = true
    void (async () => {
      for (const tab of host.tabs) {
        if (!(await mayClose(tab, host))) { host.closing = false; return }
      }
      for (const tab of host.tabs) { win.contentView.removeChildView(tab.view); tab.view.webContents.close() }
      host.tabs = []
      host.allowClose = true
      win.close()
    })().catch((error) => { host.closing = false; console.error(error) })
  })
  win.once('closed', () => hosts.delete(host))
  return host
}
function sendDocCommand(command: string) {
  const tab = activeTab(focusedHost())
  if (!tab) return
  if (command === 'save' || command === 'save-as') void requestHwpSave(tab.view.webContents, command === 'save' ? 'save' : 'saveAs')
  else if (command === 'print') requestHwpPrint(tab.view.webContents, 'print')
}
async function checkUpdate() {
  if (!app.isPackaged) { updateMessage = '개발 실행에서는 배포 페이지에서 버전을 확인하세요.'; publishAll(); return }
  updateMessage = '업데이트를 확인하고 있습니다.'; publishAll()
  try { await autoUpdater.checkForUpdates() } catch { updateMessage = '업데이트를 확인하지 못했습니다. 배포 페이지를 이용해 주세요.'; publishAll() }
}
async function about(host: Host) {
  await dialog.showMessageBox(host.win, { title: 'Chojema Dooroo 정보', message: `Chojema Dooroo ${app.getVersion()}`, detail: 'IeumOffice의 소스 중 HWP 편집기 및 공용 라이브러리를 바탕으로 만들었습니다. 해당 소스는 GenOffice에 기반하며 Apache-2.0 라이선스입니다. HWP/HWPX 엔진과 편집기는 rhwp의 MIT 라이선스 코드를 사용합니다.\n\n원저작권과 제삼자 라이선스는 LICENSE, NOTICE, THIRD-PARTY-NOTICES.txt에 보존합니다.\n\n본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.', buttons: ['닫기', '라이선스 폴더 열기'] }).then((result) => {
    if (result.response === 1) void shell.openPath(app.isPackaged ? process.resourcesPath : resolve(__dirname, '../../../../'))
  })
}
ipcMain.handle(CHANNEL, async (event, action: unknown, value: unknown) => {
  const host = [...hosts].find((h) => h.win.webContents.id === event.sender.id)
  if (!host) throw new Error('Invalid host')
  try {
    switch (action) {
      case 'state': return publish(host)
      case 'assistant-get': return assistantSetup()
      case 'assistant-save': return saveAssistantSetup(value)
      case 'new-hwp': openTab(host, 'hwp'); break
      case 'open': await openDialog(host); break
      case 'open-path': await openPath(host, value); break
      case 'activate': if (typeof value === 'string') activate(host, value); break
      case 'close': if (typeof value === 'string') await closeTab(host, value); break
      case 'home': showPage(host, 'home'); break
      case 'settings': showPage(host, 'settings'); break
      case 'terminology':
        if (value !== 'word' && value !== 'hwp') throw new Error('Invalid terminology')
        settings.terminology = value; persist()
        for (const wc of webContents.getAllWebContents()) wc.send('app:terminology-changed', value)
        publishAll(); break
      case 'theme':
        if (value !== 'light' && value !== 'dark' && value !== 'system') throw new Error('Invalid theme')
        settings.theme = value; nativeTheme.themeSource = value; persist()
        for (const wc of webContents.getAllWebContents()) wc.send('app:theme-changed', value)
        publishAll(); break
      case 'ai-toggle':
        settings.aiPrefs = { ...settings.aiPrefs, showAiSidebar: !settings.aiPrefs.showAiSidebar }; persist()
        for (const wc of webContents.getAllWebContents()) wc.send('app:ai-panel-prefs-changed', settings.aiPrefs)
        break
      case 'check-update': await checkUpdate(); break
      case 'install-update':
        if (!updateReady) throw new Error('다운로드한 업데이트가 없습니다.')
        for (const own of hosts) for (const tab of own.tabs) if (!(await mayClose(tab, own))) return
        for (const own of hosts) own.allowClose = true
        autoUpdater.quitAndInstall(false, true)
        break
      case 'releases': await shell.openExternal(RELEASES); break
      case 'about': await about(host); break
      default: throw new Error('Unsupported command')
    }
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
})

function registerSharedIpc() {
  const handlers: Record<string, () => unknown> = {
    'app:get-language': () => getUiLang(),
    'app:get-terminology': () => settings.terminology,
    'app:get-theme': () => settings.theme,
    'app:get-document-theme': () => 'follow',
    'app:get-auto-save-default': () => 'off',
    'app:get-author-name': () => 'Chojema Dooroo',
    'home:get-author-name': () => ({ value: '', fallback: 'Chojema Dooroo' }),
    'app:get-ai-panel-prefs': () => settings.aiPrefs,
    'skills:list': () => [],
    'skills:take-handoff': () => null,
    'drive:ai-enabled': () => false,
    'drive:connected': () => false,
    'doc:attach-available': () => false,
    'doc:attach-list': () => [],
  }
  for (const [channel, result] of Object.entries(handlers)) ipcMain.handle(channel, result)
  ipcMain.handle('app:get-split-role', (event) => {
    const host = ownerFor(event.sender.id)
    const tab = host?.tabs.find((t) => t.view.webContents.id === event.sender.id)
    return host?.secondary && tab ? (tab.id === host.active ? 'focus' : 'secondary') : null
  })
  ipcMain.handle('skills:open-settings', (event) => {
    const host = ownerFor(event.sender.id)
    if (host) { host.page = 'settings'; layout(host) }
  })
  ipcMain.handle('app:set-ai-panel-prefs', (_event, patch) => {
    settings.aiPrefs = normalizeAiPanelPrefs({ ...settings.aiPrefs, ...patch }); persist()
    for (const wc of webContents.getAllWebContents()) wc.send('app:ai-panel-prefs-changed', settings.aiPrefs)
    return settings.aiPrefs
  })
  ipcMain.handle('home:open-path', (event, path) => openPath(ownerFor(event.sender.id) ?? focusedHost(), path).then(() => ({ ok: true })))
  ipcMain.handle('ai:open-model-settings', (event) => { const host = ownerFor(event.sender.id) ?? focusedHost(); host.page = 'settings'; layout(host) })
  ipcMain.handle(OUTBOUND_CHANNELS.internetTools, () => {
    try { return JSON.parse(readFileSync(join(app.getPath('userData'), 'ai-settings.json'), 'utf8')).internetTools !== false } catch { return true }
  })
  ipcMain.handle(OUTBOUND_CHANNELS.confirmAddresses, async (event, raw) => {
    const request = confirmRequestOf(raw)
    const host = ownerFor(event.sender.id)
    if (!request || !host) return false
    const { response } = await dialog.showMessageBox(host.win, { type: 'question', message: '이 주소에 접속하도록 허용하시겠습니까?', detail: `${request.tool}\n\n${request.addresses.join('\n')}`, buttons: ['취소', '허용'], defaultId: 0, cancelId: 0 })
    return response === 1
  })
  ipcMain.on(DROP_OPEN_CHANNEL, (event, paths: unknown) => {
    const host = ownerFor(event.sender.id)
    if (host && Array.isArray(paths)) for (const path of paths.slice(0, 20)) void openPath(host, path).catch(() => {})
  })
  for (const channel of ['tabs:focus-pane', 'app:view-focused']) ipcMain.on(channel, (event) => {
    const host = ownerFor(event.sender.id)
    const tab = host?.tabs.find((t) => t.view.webContents.id === event.sender.id)
    if (host && tab && host.page === 'editor' && tab.id !== host.active) { const old = host.active; host.active = tab.id; if (host.secondary === tab.id) host.secondary = old; publish(host) }
  })
}

function installMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ label: 'Chojema Dooroo', submenu: [{ role: 'about' as const }, { role: 'quit' as const }] }] : []),
    { label: '파일', submenu: [
      { label: '새 문서', accelerator: 'CmdOrCtrl+N', click: () => openTab(focusedHost(), 'hwp') },
      { label: '열기…', accelerator: 'CmdOrCtrl+O', click: () => { void openDialog(focusedHost()) } },
      { type: 'separator' },
      { label: '저장', accelerator: 'CmdOrCtrl+S', click: () => sendDocCommand('save') },
      { label: '다른 이름으로 저장…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendDocCommand('save-as') },
      { label: '인쇄…', accelerator: 'CmdOrCtrl+P', click: () => sendDocCommand('print') },
      { label: '문서 닫기', accelerator: 'CmdOrCtrl+W', click: () => { void closeTab(focusedHost()) } },
      { type: 'separator' }, { role: 'quit', label: '종료' },
    ] },
    { label: '보기', submenu: [
      { label: '다음 문서', accelerator: 'Ctrl+Tab', click: () => { const host = focusedHost(); const index = host.tabs.findIndex((t) => t.id === host.active); const tab = host.tabs[(index + 1) % host.tabs.length]; if (tab) activate(host, tab.id) } },
      { label: '앱 설정', click: () => { const host = focusedHost(); host.page = 'settings'; layout(host) } },
      { role: 'togglefullscreen', label: '전체 화면' },
      ...(!app.isPackaged || process.env.CHOJEMA_DOOROO_SMOKE ? [{ role: 'toggleDevTools' as const }] : []),
    ] },
    { label: '도움말', submenu: [
      { label: '업데이트 확인', click: () => { void checkUpdate() } },
      { label: 'Chojema Dooroo 정보', click: () => { void about(focusedHost()) } },
    ] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

configureAssistant((wc) => ownerFor(wc.id)?.win, (wcId) => allTabs().find((t) => t.view.webContents.id === wcId)?.path ?? null)
setHwpFileSavedHook((wc, path) => saved(wc.id, path))

const locked = app.requestSingleInstanceLock()
if (!locked) app.quit()
else {
  app.on('open-file', (event, path) => { event.preventDefault(); if (!app.isReady()) pendingPaths.push(path); else void openPath(focusedHost(), path).catch(() => {}) })
  app.on('second-instance', (_event, argv) => { const host = focusedHost(); host.win.show(); host.win.focus(); for (const path of argv.filter((p) => isOpenablePath(p))) void openPath(host, path).catch(() => {}) })
  void app.whenReady().then(async () => {
    setUiLang('ko')
    setAiSecretCodec(safeStorageCodec(safeStorage, process.platform, () => sealingKeyOnDisk(join(app.getPath('userData'), 'Local State'))))
    sealStoredAiSettings(join(app.getPath('userData'), 'ai-settings.json'))
    installRendererProtocol({ hwp: join(outFor('hwp'), 'renderer') })
    registerAiIpc(); registerProjectIpc(); registerSharedIpc()
    await initSubscriptionChildTracking(app.getPath('userData')).catch(() => {})
    installMenu()
    const host = createHost()
    for (const path of [...pendingPaths, ...process.argv.filter((p) => isOpenablePath(p) && isAbsolute(p))]) await openPath(host, path).catch(() => {})
    if (!host.tabs.length) {
      if (host.win.webContents.isLoading()) host.win.webContents.once('did-finish-load', () => { if (!host.tabs.length) openTab(host, 'hwp') })
      else openTab(host, 'hwp')
    }
    autoUpdater.setFeedURL({ provider: 'github', owner: 'chojema', repo: 'ChojemaDooroo' })
    autoUpdater.allowPrerelease = app.getVersion().includes('-')
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('update-available', (info) => {
      updateMessage = `${info.version} 버전이 있습니다.`; publishAll()
      void dialog.showMessageBox(focusedHost().win, { type: 'info', message: updateMessage, detail: process.platform === 'darwin' ? '배포 페이지에서 새 버전을 받아 설치하세요.' : '다운로드한 뒤 설정에서 설치할 수 있습니다.', buttons: process.platform === 'darwin' ? ['닫기', '배포 페이지'] : ['나중에', '다운로드'], defaultId: 0, cancelId: 0 }).then(({ response }) => {
        if (response === 1) { if (process.platform === 'darwin') void shell.openExternal(RELEASES); else void autoUpdater.downloadUpdate().catch(() => { updateMessage = '다운로드하지 못했습니다.'; publishAll() }) }
      })
    })
    autoUpdater.on('update-not-available', () => { updateMessage = '현재 최신 버전입니다.'; publishAll() })
    autoUpdater.on('update-downloaded', () => { updateReady = true; updateMessage = '다운로드 완료. 작업을 저장한 뒤 업데이트를 설치하세요.'; publishAll() })
    autoUpdater.on('error', () => { updateMessage = '업데이트를 확인하지 못했습니다. 배포 페이지를 이용해 주세요.'; publishAll() })
    if (app.isPackaged && !process.env.CHOJEMA_DOOROO_SMOKE) {
      setTimeout(() => { void checkUpdate() }, 20_000)
      updateTimer = setInterval(() => { void checkUpdate() }, 4 * 60 * 60 * 1000)
    }
    app.on('activate', () => { if (!hosts.size) createHost() })
  })
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('will-quit', () => { if (updateTimer) clearInterval(updateTimer); shutdownSubscriptionChildren() })
process.on('exit', () => shutdownSubscriptionChildren())
