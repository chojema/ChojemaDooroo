import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { app, ipcMain } from 'electron'
import { writeJsonAtomic } from '@genoffice/electron-utils'

// ---------------------------------------------------------------------------
// 1. External MCP Host Registration (registering Chojema Dooroo as an MCP server)
// ---------------------------------------------------------------------------

export type ExternalMcpClientId = 'claude-desktop' | 'claude-code' | 'cursor' | 'windsurf' | 'antigravity'

export interface ExternalMcpClientMeta {
  id: ExternalMcpClientId
  label: string
  configPath: string
}

export interface ExternalMcpHostStatus {
  id: ExternalMcpClientId
  label: string
  configPath: string
  configExists: boolean
  registered: boolean
  roots: string[]
  readOnly: boolean
}

export interface RegisterExternalMcpOptions {
  clients?: ExternalMcpClientId[]
  roots?: string[]
  readOnly?: boolean
  /** Override paths for unit tests */
  envOverride?: {
    platform?: NodeJS.Platform
    home?: string
    appData?: string
    isPackaged?: boolean
    execPath?: string
    resourcesPath?: string
    repoRoot?: string
    nodePath?: string
    defaultDocumentsDir?: string
  }
}

export interface RegisterExternalMcpResult {
  ok: boolean
  runnerPath: string
  appExecutable: string | null
  roots: string[]
  readOnly: boolean
  updated: Array<{
    client: ExternalMcpClientId
    label: string
    configPath: string
  }>
  errors?: string[]
}

export function resolveExternalClientPaths(opts?: RegisterExternalMcpOptions['envOverride']): ExternalMcpClientMeta[] {
  const platform = opts?.platform ?? process.platform
  const home = opts?.home ?? homedir()
  const appData = opts?.appData ?? (platform === 'win32'
    ? (process.env.APPDATA || join(home, 'AppData', 'Roaming'))
    : platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : join(home, '.config'))

  const claudeDesktopPath = platform === 'darwin'
    ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : platform === 'win32'
      ? join(appData, 'Claude', 'claude_desktop_config.json')
      : join(home, '.config', 'Claude', 'claude_desktop_config.json')

  return [
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      configPath: claudeDesktopPath,
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      configPath: join(home, '.claude.json'),
    },
    {
      id: 'cursor',
      label: 'Cursor',
      configPath: join(home, '.cursor', 'mcp.json'),
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      configPath: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    },
    {
      id: 'antigravity',
      label: 'Antigravity',
      configPath: join(home, '.gemini', 'antigravity', 'mcp_config.json'),
    },
  ]
}

function findNodeBinary(override?: string): string {
  if (override) return override
  const candidates = process.platform === 'win32'
    ? [
        process.env.NVM_SYMLINK ? join(process.env.NVM_SYMLINK, 'node.exe') : '',
        'C:\\Program Files\\nodejs\\node.exe',
      ]
    : [
        '/opt/homebrew/bin/node',
        '/usr/local/bin/node',
        '/usr/bin/node',
      ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return 'node'
}

export function resolveDoorooMcpLaunchSpec(
  roots: string[],
  readOnly: boolean,
  envOverride?: RegisterExternalMcpOptions['envOverride'],
): {
  command: string
  args: string[]
  runnerPath: string
  appExecutable: string | null
  normalizedRoots: string[]
} {
  const isPackaged = envOverride?.isPackaged ?? app.isPackaged
  const execPath = envOverride?.execPath ?? process.execPath
  const resourcesPath = envOverride?.resourcesPath ?? process.resourcesPath
  const repoRoot = envOverride?.repoRoot ?? resolve(__dirname, '../../../..')
  const defaultDocs = envOverride?.defaultDocumentsDir ?? (() => {
    try { return app.getPath('documents') } catch { return join(homedir(), 'Documents') }
  })()

  const rawRoots = roots.length > 0 ? roots : [defaultDocs]
  const normalizedRoots: string[] = []
  for (const r of rawRoots) {
    const trimmed = String(r).trim()
    if (!trimmed) continue
    const expanded = trimmed === '~'
      ? (envOverride?.home ?? homedir())
      : (trimmed.startsWith('~/') || trimmed.startsWith('~\\'))
        ? join(envOverride?.home ?? homedir(), trimmed.slice(2))
        : resolve(trimmed)
    if (!isAbsolute(expanded)) throw new Error(`절대 경로를 지정해 주세요: ${trimmed}`)
    if (!existsSync(expanded) || !statSync(expanded).isDirectory()) {
      throw new Error(`존재하는 문서 폴더를 지정해 주세요: ${expanded}`)
    }
    if (!normalizedRoots.includes(expanded)) normalizedRoots.push(expanded)
  }
  if (normalizedRoots.length === 0) {
    throw new Error('접근을 허용할 문서 폴더를 최소 1개 이상 지정해 주세요.')
  }

  let runnerPath: string
  let appExecutable: string | null = null
  if (isPackaged) {
    const bundled = join(resourcesPath, 'mcp.mjs')
    runnerPath = existsSync(bundled) ? bundled : join(repoRoot, 'tools', 'mcp.mjs')
    appExecutable = execPath
  } else {
    runnerPath = join(repoRoot, 'tools', 'mcp.mjs')
    appExecutable = null
  }

  const args: string[] = [runnerPath]
  if (appExecutable) {
    args.push('--app', appExecutable)
  }
  for (const root of normalizedRoots) {
    args.push('--mcp-root', root)
  }
  if (readOnly) {
    args.push('--mcp-read-only')
  }

  return {
    command: findNodeBinary(envOverride?.nodePath),
    args,
    runnerPath,
    appExecutable,
    normalizedRoots,
  }
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    }
  } catch {
    /* unreadable or missing config: start fresh object */
  }
  return {}
}

function parseRegisteredDoorooEntry(entry: unknown): { registered: boolean; roots: string[]; readOnly: boolean } {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { registered: false, roots: [], readOnly: false }
  }
  const raw = entry as Record<string, unknown>
  if (typeof raw.command !== 'string' || !Array.isArray(raw.args)) {
    return { registered: false, roots: [], readOnly: false }
  }
  const args = raw.args.map((a) => String(a))
  const roots: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mcp-root' && typeof args[i + 1] === 'string') {
      roots.push(args[++i]!)
    } else if (args[i]!.startsWith('--mcp-root=')) {
      roots.push(args[i]!.slice('--mcp-root='.length))
    }
  }
  const readOnly = args.includes('--mcp-read-only')
  return { registered: true, roots, readOnly }
}

export function getExternalMcpHostStatuses(
  envOverride?: RegisterExternalMcpOptions['envOverride'],
): ExternalMcpHostStatus[] {
  const metas = resolveExternalClientPaths(envOverride)
  return metas.map((meta) => {
    const configExists = existsSync(meta.configPath)
    const json = configExists ? readJsonObject(meta.configPath) : {}
    const servers = (json.mcpServers && typeof json.mcpServers === 'object' && !Array.isArray(json.mcpServers))
      ? (json.mcpServers as Record<string, unknown>)
      : {}
    const parsed = parseRegisteredDoorooEntry(servers['chojema-dooroo'])
    return {
      id: meta.id,
      label: meta.label,
      configPath: meta.configPath,
      configExists,
      registered: parsed.registered,
      roots: parsed.roots,
      readOnly: parsed.readOnly,
    }
  })
}

export function registerDoorooInExternalHosts(options: RegisterExternalMcpOptions = {}): RegisterExternalMcpResult {
  const spec = resolveDoorooMcpLaunchSpec(
    options.roots ?? [],
    options.readOnly === true,
    options.envOverride,
  )
  const allMetas = resolveExternalClientPaths(options.envOverride)
  const targetMetas = options.clients && options.clients.length > 0
    ? allMetas.filter((m) => options.clients!.includes(m.id))
    : allMetas.filter((m) => existsSync(m.configPath) || existsSync(dirname(m.configPath)) || m.id === 'claude-desktop' || m.id === 'claude-code')

  const updated: RegisterExternalMcpResult['updated'] = []
  const errors: string[] = []

  for (const meta of targetMetas) {
    try {
      mkdirSync(dirname(meta.configPath), { recursive: true })
      const config = readJsonObject(meta.configPath)
      const mcpServers = (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers))
        ? { ...(config.mcpServers as Record<string, unknown>) }
        : {}
      mcpServers['chojema-dooroo'] = {
        command: spec.command,
        args: spec.args,
      }
      config.mcpServers = mcpServers
      writeJsonAtomic(meta.configPath, config)
      updated.push({
        client: meta.id,
        label: meta.label,
        configPath: meta.configPath,
      })
    } catch (err) {
      errors.push(`${meta.label}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return {
    ok: updated.length > 0 && errors.length === 0,
    runnerPath: spec.runnerPath,
    appExecutable: spec.appExecutable,
    roots: spec.normalizedRoots,
    readOnly: options.readOnly === true,
    updated,
    ...(errors.length > 0 ? { errors } : {}),
  }
}

export function unregisterDoorooFromExternalHosts(
  clients?: ExternalMcpClientId[],
  envOverride?: RegisterExternalMcpOptions['envOverride'],
): { ok: boolean; removed: ExternalMcpClientId[] } {
  const allMetas = resolveExternalClientPaths(envOverride)
  const targetMetas = clients && clients.length > 0
    ? allMetas.filter((m) => clients.includes(m.id))
    : allMetas
  const removed: ExternalMcpClientId[] = []
  for (const meta of targetMetas) {
    if (!existsSync(meta.configPath)) continue
    try {
      const config = readJsonObject(meta.configPath)
      if (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)) {
        const servers = { ...(config.mcpServers as Record<string, unknown>) }
        if ('chojema-dooroo' in servers) {
          delete servers['chojema-dooroo']
          config.mcpServers = servers
          writeJsonAtomic(meta.configPath, config)
          removed.push(meta.id)
        }
      }
    } catch {
      /* ignore */
    }
  }
  return { ok: true, removed }
}

// ---------------------------------------------------------------------------
// 2. In-App External MCP Server Registry & Dynamic Client Manager
// ---------------------------------------------------------------------------

export interface ConfiguredMcpServer {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean
}

export interface ConnectedMcpTool {
  server: string
  toolName: string
  qualifiedName: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpServerStatus {
  name: string
  command: string
  args: string[]
  enabled: boolean
  connected: boolean
  toolCount: number
  tools: string[]
  error?: string
}

interface ActiveMcpConnection {
  server: ConfiguredMcpServer
  client: Client
  transport: StdioClientTransport
  tools: ConnectedMcpTool[]
  error?: string
}

const MAX_SERVER_NAME_LEN = 64
const MAX_SERVERS = 32
const ALLOWED_COMMANDS = new Set([
  'npx', 'node', 'uvx', 'uv', 'python', 'python3', 'docker', 'deno', 'bun', 'bunx',
])

function validMcpCommand(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > 1024) return false
  if (/[;&|`$<>]/.test(trimmed)) return false
  const base = basename(trimmed).replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase()
  if (ALLOWED_COMMANDS.has(base)) return true
  if (isAbsolute(trimmed) && existsSync(trimmed) && statSync(trimmed).isFile()) return true
  return false
}

export function sanitizeMcpServerConfig(raw: unknown): ConfiguredMcpServer {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('올바른 MCP 서버 설정 객체가 아닙니다.')
  }
  const obj = raw as Record<string, unknown>
  const name = String(obj.name ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_SERVER_NAME_LEN)
  if (!name) throw new Error('MCP 서버 이름(영문·숫자·하이픈)을 지정해 주세요.')

  const command = String(obj.command ?? '').trim()
  if (!validMcpCommand(command)) {
    throw new Error(`허용되지 않거나 찾을 수 없는 실행 명령입니다: ${command} (npx, node, uvx, python, docker 또는 실제 실행 파일 절대 경로를 사용하세요)`)
  }

  const args = Array.isArray(obj.args)
    ? obj.args.map((a) => String(a)).slice(0, 64)
    : []

  let env: Record<string, string> | undefined
  if (obj.env && typeof obj.env === 'object' && !Array.isArray(obj.env)) {
    env = {}
    for (const [k, v] of Object.entries(obj.env as Record<string, unknown>)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === 'string' && v.length <= 4096) {
        env[k] = v
      }
    }
    if (Object.keys(env).length === 0) env = undefined
  }

  const enabled = obj.enabled !== false
  return { name, command, args, ...(env ? { env } : {}), enabled }
}

export class InAppMcpRegistry {
  private readonly storePath: () => string
  private readonly connections = new Map<string, ActiveMcpConnection>()

  constructor(storePath?: () => string) {
    this.storePath = storePath ?? (() => join(app.getPath('userData'), 'mcp-servers.json'))
  }

  loadServers(): ConfiguredMcpServer[] {
    try {
      const path = this.storePath()
      if (!existsSync(path)) return []
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (!Array.isArray(parsed)) return []
      const list: ConfiguredMcpServer[] = []
      for (const item of parsed.slice(0, MAX_SERVERS)) {
        try {
          list.push(sanitizeMcpServerConfig(item))
        } catch {
          /* skip invalid entry */
        }
      }
      return list
    } catch {
      return []
    }
  }

  private saveServers(servers: ConfiguredMcpServer[]): void {
    const path = this.storePath()
    mkdirSync(dirname(path), { recursive: true })
    writeJsonAtomic(path, servers.slice(0, MAX_SERVERS))
  }

  async connectServer(config: ConfiguredMcpServer): Promise<McpServerStatus> {
    await this.disconnectServer(config.name)
    if (!config.enabled) {
      return {
        name: config.name,
        command: config.command,
        args: config.args,
        enabled: false,
        connected: false,
        toolCount: 0,
        tools: [],
      }
    }

    const cleanEnv: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string' && k !== 'ELECTRON_RUN_AS_NODE') cleanEnv[k] = v
    }
    if (config.env) {
      for (const [k, v] of Object.entries(config.env)) cleanEnv[k] = v
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: cleanEnv,
      cwd: tmpdir(),
      stderr: 'pipe',
    })
    const client = new Client({ name: 'chojema-dooroo-host', version: '1.0.0' })
    try {
      await client.connect(transport)
      const listed = await client.listTools()
      const tools: ConnectedMcpTool[] = (listed.tools ?? []).map((t) => ({
        server: config.name,
        toolName: t.name,
        qualifiedName: `mcp__${config.name.replace(/[^a-zA-Z0-9_]/g, '_')}__${t.name.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        description: t.description ?? `MCP tool ${t.name} from ${config.name}`,
        inputSchema: (t.inputSchema && typeof t.inputSchema === 'object'
          ? (t.inputSchema as Record<string, unknown>)
          : { type: 'object', properties: {} }),
      }))
      this.connections.set(config.name, { server: config, client, transport, tools })
      return {
        name: config.name,
        command: config.command,
        args: config.args,
        enabled: true,
        connected: true,
        toolCount: tools.length,
        tools: tools.map((t) => t.toolName),
      }
    } catch (err) {
      try { await client.close() } catch { /* ignore */ }
      const message = err instanceof Error ? err.message : String(err)
      return {
        name: config.name,
        command: config.command,
        args: config.args,
        enabled: true,
        connected: false,
        toolCount: 0,
        tools: [],
        error: message,
      }
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const existing = this.connections.get(name)
    if (!existing) return
    this.connections.delete(name)
    try {
      await existing.client.close()
    } catch {
      /* ignore close errors */
    }
  }

  async disconnectAll(): Promise<void> {
    for (const name of [...this.connections.keys()]) {
      await this.disconnectServer(name)
    }
  }

  async addOrUpdateServer(raw: unknown): Promise<McpServerStatus> {
    const config = sanitizeMcpServerConfig(raw)
    const servers = this.loadServers().filter((s) => s.name !== config.name)
    servers.push(config)
    this.saveServers(servers)
    return this.connectServer(config)
  }

  async removeServer(name: string): Promise<{ ok: boolean; removed: boolean }> {
    const trimmed = String(name ?? '').trim()
    await this.disconnectServer(trimmed)
    const before = this.loadServers()
    const after = before.filter((s) => s.name !== trimmed)
    this.saveServers(after)
    return { ok: true, removed: after.length !== before.length }
  }

  async getStatuses(): Promise<McpServerStatus[]> {
    const servers = this.loadServers()
    return servers.map((s) => {
      const conn = this.connections.get(s.name)
      return {
        name: s.name,
        command: s.command,
        args: s.args,
        enabled: s.enabled,
        connected: !!conn,
        toolCount: conn?.tools.length ?? 0,
        tools: conn?.tools.map((t) => t.toolName) ?? [],
        ...(conn?.error ? { error: conn.error } : {}),
      }
    })
  }

  getConnectedTools(): ConnectedMcpTool[] {
    const all: ConnectedMcpTool[] = []
    for (const conn of this.connections.values()) {
      all.push(...conn.tools)
    }
    return all
  }

  async callTool(qualifiedOrServer: string, toolInput: Record<string, unknown>, explicitToolName?: string): Promise<{
    ok: boolean
    output: string
    isError?: boolean
  }> {
    let conn: ActiveMcpConnection | undefined
    let targetToolName: string | undefined

    if (explicitToolName) {
      conn = this.connections.get(qualifiedOrServer)
      targetToolName = explicitToolName
    } else {
      for (const c of this.connections.values()) {
        const found = c.tools.find((t) => t.qualifiedName === qualifiedOrServer)
        if (found) {
          conn = c
          targetToolName = found.toolName
          break
        }
      }
    }

    if (!conn || !targetToolName) {
      // Lazy reconnect attempt if configured
      const configured = this.loadServers().find((s) =>
        explicitToolName ? s.name === qualifiedOrServer : qualifiedOrServer.startsWith(`mcp__${s.name.replace(/[^a-zA-Z0-9_]/g, '_')}__`),
      )
      if (configured && configured.enabled) {
        await this.connectServer(configured)
        const reconnected = this.connections.get(configured.name)
        if (reconnected) {
          conn = reconnected
          targetToolName = explicitToolName ?? reconnected.tools.find((t) => t.qualifiedName === qualifiedOrServer)?.toolName
        }
      }
    }

    if (!conn || !targetToolName) {
      return { ok: false, output: `연결된 MCP 도구를 찾을 수 없습니다: ${explicitToolName ?? qualifiedOrServer}`, isError: true }
    }

    try {
      const result = await conn.client.callTool(
        { name: targetToolName, arguments: toolInput },
        { timeout: 60_000 },
      )
      const contents = Array.isArray(result.content) ? result.content : []
      const text = contents
        .map((c: { type?: string; text?: string }) => (c.type === 'text' && typeof c.text === 'string' ? c.text : JSON.stringify(c)))
        .join('\n')
      return {
        ok: result.isError !== true,
        output: text || JSON.stringify(result),
        ...(result.isError === true ? { isError: true } : {}),
      }
    } catch (err) {
      return {
        ok: false,
        output: err instanceof Error ? err.message : String(err),
        isError: true,
      }
    }
  }
}

export const sharedMcpRegistry = new InAppMcpRegistry()

let mcpManageIpcRegistered = false

export function registerMcpManageIpc(): void {
  if (mcpManageIpcRegistered) return
  mcpManageIpcRegistered = true

  app.once('will-quit', () => {
    void sharedMcpRegistry.disconnectAll()
  })

  ipcMain.handle('mcp:host-status', () => ({
    hosts: getExternalMcpHostStatuses(),
  }))

  ipcMain.handle('mcp:host-register', (_event, raw: unknown) => {
    const opts = (raw && typeof raw === 'object' ? raw : {}) as RegisterExternalMcpOptions
    return registerDoorooInExternalHosts(opts)
  })

  ipcMain.handle('mcp:host-unregister', (_event, raw: unknown) => {
    const opts = (raw && typeof raw === 'object' ? raw : {}) as { clients?: ExternalMcpClientId[] }
    return unregisterDoorooFromExternalHosts(opts.clients)
  })

  ipcMain.handle('mcp:servers-list', async () => ({
    servers: await sharedMcpRegistry.getStatuses(),
    tools: sharedMcpRegistry.getConnectedTools(),
  }))

  ipcMain.handle('mcp:server-register', async (_event, raw: unknown) => {
    return sharedMcpRegistry.addOrUpdateServer(raw)
  })

  ipcMain.handle('mcp:server-remove', async (_event, name: unknown) => {
    return sharedMcpRegistry.removeServer(String(name ?? ''))
  })

  ipcMain.handle('mcp:tool-call', async (_event, args: unknown) => {
    const raw = (args && typeof args === 'object' ? args : {}) as {
      qualifiedName?: string
      server?: string
      tool?: string
      input?: Record<string, unknown>
    }
    const input = (raw.input && typeof raw.input === 'object' && !Array.isArray(raw.input)) ? raw.input : {}
    if (raw.server && raw.tool) {
      return sharedMcpRegistry.callTool(String(raw.server), input, String(raw.tool))
    }
    return sharedMcpRegistry.callTool(String(raw.qualifiedName ?? ''), input)
  })
}
