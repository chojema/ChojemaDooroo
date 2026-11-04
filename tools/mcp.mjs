// Windows Electron can report stdin EOF while its pipe is open. Node owns stdio;
// the app receives the same bytes over a private, randomly named local socket.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const appAt = args.indexOf('--app')
const executable = appAt >= 0 ? args.splice(appAt, 2)[1] : undefined
if (appAt >= 0 && !executable) throw new Error('--app 뒤에 앱 실행 파일 경로를 지정하세요.')
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const socketDir = process.platform === 'win32' ? undefined : mkdtempSync(join(tmpdir(), 'dooroo-mcp-'))
const endpoint = socketDir ? join(socketDir, 'stdio.sock') : `\\\\.\\pipe\\dooroo-mcp-${randomUUID()}`
const env = { ...process.env, CHOJEMA_DOOROO_MCP_PIPE: endpoint }
delete env.ELECTRON_RUN_AS_NODE
let child
let socket
let connected = false
const server = createServer((connection) => {
  if (connected) { connection.destroy(); return }
  connected = true
  socket = connection
  clearTimeout(timer)
  server.close()
  socket.on('error', (error) => console.error(error.message))
  process.stdin.pipe(socket)
  socket.pipe(process.stdout, { end: false })
})
const cleanup = () => { server.close(); socket?.destroy(); if (socketDir) rmSync(socketDir, { recursive: true, force: true }) }
process.on('exit', cleanup)
process.stdout.on('error', () => socket?.end())
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  if (socket) socket.end()
  else child?.kill()
})
const timer = setTimeout(() => { console.error('MCP 앱 연결 제한 시간을 초과했습니다.'); child?.kill(); cleanup(); process.exitCode = 1 }, 60_000)
server.on('error', (error) => { console.error(error.message); clearTimeout(timer); child?.kill(); cleanup(); process.exitCode = 1 })
server.listen(endpoint, () => {
  child = spawn(executable ?? require('electron'), [
    ...(!executable ? [fileURLToPath(new URL('../apps/desktop', import.meta.url))] : []), '--mcp', ...args,
  ], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.pipe(process.stderr, { end: false })
  child.stderr.pipe(process.stderr, { end: false })
  child.on('error', (error) => { console.error(error.message); clearTimeout(timer); cleanup(); process.exitCode = 1 })
  child.on('exit', (code, signal) => {
    clearTimeout(timer); cleanup(); process.stdin.pause()
    if (code !== 0) console.error(`Chojema Dooroo MCP exited (${code ?? signal}).`)
    process.exitCode = code ?? 1
  })
})
