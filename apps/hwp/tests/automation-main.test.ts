import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
const { ipc } = vi.hoisted(() => ({ ipc: new (require('node:events').EventEmitter)() }))
vi.mock('electron', () => ({ ipcMain: ipc }))
import { invokeHwpAutomation, waitHwpReady } from '../src/main/automation'
import { AUTOMATION_REPLY, AUTOMATION_REQUEST, type AutomationRequest } from '../src/shared/automation'

function contents() {
  const wc = Object.assign(new EventEmitter(), { id: 42, isDestroyed: () => false, send: vi.fn() })
  return wc
}
afterEach(() => { vi.useRealTimers(); ipc.removeAllListeners() })
describe('document automation IPC', () => {
  it('retries readiness probes and ignores replies from a different view or request', async () => {
    vi.useFakeTimers()
    const wc = contents()
    const ready = waitHwpReady(wc as never)
    const request = wc.send.mock.calls[0][1] as AutomationRequest
    expect(wc.send.mock.calls[0][0]).toBe(AUTOMATION_REQUEST)
    ipc.emit(AUTOMATION_REPLY, { sender: { id: 99 } }, { id: request.id, ok: true, value: 'ready' })
    ipc.emit(AUTOMATION_REPLY, { sender: wc }, { id: 'wrong', ok: true, value: 'ready' })
    await vi.advanceTimersByTimeAsync(250)
    expect(wc.send).toHaveBeenCalledTimes(2)
    ipc.emit(AUTOMATION_REPLY, { sender: wc }, { id: request.id, ok: true, value: 'ready' })
    await ready
    expect(ipc.listenerCount(AUTOMATION_REPLY)).toBe(0)
  })
  it('never repeats a mutation after a timeout', async () => {
    vi.useFakeTimers()
    const wc = contents()
    wc.send.mockImplementation((_channel: string, request: AutomationRequest) => {
      if (request.method === 'ready') ipc.emit(AUTOMATION_REPLY, { sender: wc }, { id: request.id, ok: true, value: 'ready' })
    })
    const operation = invokeHwpAutomation(wc as never, 'replaceText', ['old', 'new'])
    const rejected = expect(operation).rejects.toThrow(/자동 재시도/)
    await vi.advanceTimersByTimeAsync(60_000)
    await rejected
    expect(wc.send.mock.calls.filter(([, request]) => request.method === 'replaceText')).toHaveLength(1)
    expect(ipc.listenerCount(AUTOMATION_REPLY)).toBe(0)
  })
  it('rejects promptly and removes listeners when a document closes', async () => {
    const wc = contents()
    const ready = waitHwpReady(wc as never)
    wc.emit('destroyed')
    await expect(ready).rejects.toThrow(/닫혔/)
    expect(ipc.listenerCount(AUTOMATION_REPLY)).toBe(0)
    expect(wc.listenerCount('destroyed')).toBe(0)
  })
})
