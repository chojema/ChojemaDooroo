import { randomUUID } from 'node:crypto'
import { ipcMain, type WebContents } from 'electron'
import { AUTOMATION_REQUEST, AUTOMATION_REPLY, type AutomationMethod, type AutomationReply } from '../shared/automation'

/** Correlate by both sender and nonce. Only readiness probes may be re-sent. */
function request(contents: WebContents, method: AutomationMethod | 'ready', args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (contents.isDestroyed()) { reject(new Error('문서가 닫혔습니다.')); return }
    const id = randomUUID()
    let retry: ReturnType<typeof setInterval> | undefined
    const finish = (error?: Error, value?: unknown) => {
      clearTimeout(timer)
      if (retry) clearInterval(retry)
      ipcMain.removeListener(AUTOMATION_REPLY, reply)
      contents.removeListener('destroyed', destroyed)
      error ? reject(error) : resolve(value)
    }
    const destroyed = () => finish(new Error('문서가 닫혔습니다.'))
    const reply = (event: Electron.IpcMainEvent, response: AutomationReply) => {
      if (event.sender.id !== contents.id || response?.id !== id) return
      if (!response.ok) finish(new Error(response.error ?? '문서 작업에 실패했습니다.'))
      else if (method !== 'ready' || response.value === 'ready') finish(undefined, response.value)
      else if (response.value === 'failed') finish(new Error('문서를 열지 못했습니다. 앱에서 오류를 확인하세요.'))
    }
    const send = () => { if (!contents.isDestroyed()) contents.send(AUTOMATION_REQUEST, { id, method, args }) }
    const timer = setTimeout(() => finish(new Error('문서 작업 제한 시간을 초과했습니다. 편집 요청은 자동 재시도하지 않습니다.')), 60_000)
    ipcMain.on(AUTOMATION_REPLY, reply)
    contents.once('destroyed', destroyed)
    if (method === 'ready') retry = setInterval(send, 250)
    send()
  })
}
export async function waitHwpReady(contents: WebContents): Promise<void> { await request(contents, 'ready', []) }
export async function invokeHwpAutomation(contents: WebContents, method: AutomationMethod, args: unknown[]): Promise<unknown> {
  await waitHwpReady(contents)
  return request(contents, method, args)
}
