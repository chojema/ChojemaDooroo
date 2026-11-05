import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getExternalMcpHostStatuses,
  InAppMcpRegistry,
  registerDoorooInExternalHosts,
  sanitizeMcpServerConfig,
  unregisterDoorooFromExternalHosts,
} from '../src/services/main/mcp-setup'

const temporary: string[] = []
afterEach(async () => {
  for (const dir of temporary.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function createTempHome() {
  const dir = await mkdtemp(join(tmpdir(), 'dooroo-mcp-setup-test-'))
  temporary.push(dir)
  const home = join(dir, 'home')
  const docs = join(home, 'Documents')
  const resources = join(dir, 'resources')
  await mkdir(docs, { recursive: true })
  await mkdir(resources, { recursive: true })
  await writeFile(join(resources, 'mcp.mjs'), '// bundled mcp runner\n', 'utf8')
  return { dir, home, docs, resources }
}

describe('External MCP Host auto-registration', () => {
  it('registers and unregisters Chojema Dooroo in Claude Desktop, Claude Code, Cursor, Windsurf, and Antigravity', async () => {
    const { home, docs, resources } = await createTempHome()
    const envOverride = {
      platform: 'darwin' as const,
      home,
      isPackaged: true,
      execPath: '/Applications/ChojemaDooroo.app/Contents/MacOS/ChojemaDooroo',
      resourcesPath: resources,
      nodePath: '/usr/local/bin/node',
      defaultDocumentsDir: docs,
    }

    const result = registerDoorooInExternalHosts({
      clients: ['claude-desktop', 'claude-code', 'cursor', 'antigravity'],
      envOverride,
    })

    expect(result.ok).toBe(true)
    expect(result.updated).toHaveLength(4)
    expect(result.roots).toEqual([docs])

    const statuses = getExternalMcpHostStatuses(envOverride)
    const claudeDesktop = statuses.find((s) => s.id === 'claude-desktop')!
    expect(claudeDesktop.registered).toBe(true)
    expect(claudeDesktop.roots).toEqual([docs])
    expect(claudeDesktop.readOnly).toBe(false)

    const rawConfig = JSON.parse(await readFile(claudeDesktop.configPath, 'utf8'))
    expect(rawConfig.mcpServers['chojema-dooroo']).toEqual({
      command: '/usr/local/bin/node',
      args: [
        join(resources, 'mcp.mjs'),
        '--app',
        '/Applications/ChojemaDooroo.app/Contents/MacOS/ChojemaDooroo',
        '--mcp-root',
        docs,
      ],
    })

    const removed = unregisterDoorooFromExternalHosts(['claude-desktop'], envOverride)
    expect(removed.removed).toEqual(['claude-desktop'])
    const afterStatuses = getExternalMcpHostStatuses(envOverride)
    expect(afterStatuses.find((s) => s.id === 'claude-desktop')!.registered).toBe(false)
    expect(afterStatuses.find((s) => s.id === 'cursor')!.registered).toBe(true)
  })

  it('preserves existing mcpServers entries when registering', async () => {
    const { home, docs, resources } = await createTempHome()
    const cursorDir = join(home, '.cursor')
    await mkdir(cursorDir, { recursive: true })
    await writeFile(
      join(cursorDir, 'mcp.json'),
      JSON.stringify({ mcpServers: { existing: { command: 'npx', args: ['some-mcp'] } } }),
      'utf8',
    )

    const envOverride = {
      platform: 'darwin' as const,
      home,
      isPackaged: true,
      execPath: '/Applications/ChojemaDooroo.app/Contents/MacOS/ChojemaDooroo',
      resourcesPath: resources,
      nodePath: 'node',
      defaultDocumentsDir: docs,
    }

    registerDoorooInExternalHosts({ clients: ['cursor'], readOnly: true, envOverride })
    const parsed = JSON.parse(await readFile(join(cursorDir, 'mcp.json'), 'utf8'))
    expect(parsed.mcpServers.existing).toEqual({ command: 'npx', args: ['some-mcp'] })
    expect(parsed.mcpServers['chojema-dooroo'].args).toContain('--mcp-read-only')
  })
})

describe('In-App External MCP Server Registry', () => {
  it('validates and sanitizes MCP server configurations', () => {
    const cfg = sanitizeMcpServerConfig({
      name: 'my filesystem!',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { API_KEY: 'secret', 'BAD-KEY': 'ignored' },
    })
    expect(cfg).toEqual({
      name: 'my-filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { API_KEY: 'secret' },
      enabled: true,
    })

    expect(() => sanitizeMcpServerConfig({ name: 'bad', command: 'rm -rf /' })).toThrow()
    expect(() => sanitizeMcpServerConfig({ name: '', command: 'npx' })).toThrow()
  })

  it('connects to a live stdio MCP server and calls its tools', async () => {
    const { dir } = await createTempHome()
    const repoRoot = resolve(__dirname, '../../..')
    const dummyServerScript = join(dir, 'dummy-mcp-server.mjs')
    const serverUrl = pathToFileURL(join(repoRoot, 'node_modules/@modelcontextprotocol/server/dist/index.mjs')).href
    const stdioUrl = pathToFileURL(join(repoRoot, 'node_modules/@modelcontextprotocol/server/dist/stdio.mjs')).href
    const zodUrl = pathToFileURL(join(repoRoot, 'node_modules/zod/v4/index.js')).href
    await writeFile(
      dummyServerScript,
      `import { McpServer } from ${JSON.stringify(serverUrl)};
import { StdioServerTransport } from ${JSON.stringify(stdioUrl)};
import * as z from ${JSON.stringify(zodUrl)};

const server = new McpServer({ name: 'echo-mcp', version: '1.0.0' });
server.registerTool('echo_message', {
  description: 'Echoes back a message',
  inputSchema: z.object({ text: z.string() }),
}, async ({ text }) => ({
  content: [{ type: 'text', text: 'ECHO:' + text }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
`,
      'utf8',
    )

    const storeFile = join(dir, 'mcp-servers.json')
    const registry = new InAppMcpRegistry(() => storeFile)
    try {
      const status = await registry.addOrUpdateServer({
        name: 'echo-srv',
        command: process.execPath,
        args: [dummyServerScript],
      })
      expect(status.connected).toBe(true)
      expect(status.tools).toEqual(['echo_message'])

      const tools = registry.getConnectedTools()
      expect(tools).toHaveLength(1)
      expect(tools[0]!.qualifiedName).toBe('mcp__echo_srv__echo_message')

      const callRes = await registry.callTool('mcp__echo_srv__echo_message', { text: '안녕하세요' })
      expect(callRes.ok).toBe(true)
      expect(callRes.output).toBe('ECHO:안녕하세요')

      const removed = await registry.removeServer('echo-srv')
      expect(removed.removed).toBe(true)
      expect(registry.getConnectedTools()).toHaveLength(0)
    } finally {
      await registry.disconnectAll()
    }
  })
})
