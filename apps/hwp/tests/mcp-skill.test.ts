import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolCall } from '@genoffice/agent-core'
import { createMcpSkill } from '../src/renderer/ai/mcp-skill'

let mcpHostStatus: ReturnType<typeof vi.fn>
let mcpHostRegister: ReturnType<typeof vi.fn>
let mcpHostUnregister: ReturnType<typeof vi.fn>
let mcpServersList: ReturnType<typeof vi.fn>
let mcpServerRegister: ReturnType<typeof vi.fn>
let mcpServerRemove: ReturnType<typeof vi.fn>
let mcpToolCall: ReturnType<typeof vi.fn>

beforeEach(() => {
  mcpHostStatus = vi.fn(async () => ({
    hosts: [
      { id: 'claude-desktop', label: 'Claude Desktop', configPath: '/path/claude.json', configExists: true, registered: true, roots: ['/docs'], readOnly: false },
    ],
  }))
  mcpHostRegister = vi.fn(async () => ({
    ok: true,
    runnerPath: '/app/mcp.mjs',
    appExecutable: '/app/ChojemaDooroo',
    roots: ['/docs'],
    readOnly: false,
    updated: [{ client: 'claude-desktop', label: 'Claude Desktop', configPath: '/path/claude.json' }],
  }))
  mcpHostUnregister = vi.fn(async () => ({ ok: true, removed: ['claude-desktop'] }))
  mcpServersList = vi.fn(async () => ({
    servers: [
      { name: 'memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], enabled: true, connected: true, toolCount: 1, tools: ['store_memory'] },
    ],
    tools: [
      {
        server: 'memory',
        toolName: 'store_memory',
        qualifiedName: 'mcp__memory__store_memory',
        description: 'Store a memory item',
        inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
      },
    ],
  }))
  mcpServerRegister = vi.fn(async (cfg: { name: string; command: string; args?: string[] }) => ({
    name: cfg.name,
    command: cfg.command,
    args: cfg.args ?? [],
    enabled: true,
    connected: true,
    toolCount: 2,
    tools: ['read_file', 'write_file'],
  }))
  mcpServerRemove = vi.fn(async () => ({ ok: true, removed: true }))
  mcpToolCall = vi.fn(async () => ({ ok: true, output: 'tool-executed-ok' }))

  vi.stubGlobal('window', {
    hwpApi: {
      mcpHostStatus,
      mcpHostRegister,
      mcpHostUnregister,
      mcpServersList,
      mcpServerRegister,
      mcpServerRemove,
      mcpToolCall,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const callTool = (skill: ReturnType<typeof createMcpSkill>['skill'], name: string, input: Record<string, unknown> = {}) =>
  skill.executeTool({ id: 'call-1', name, input } satisfies AgentToolCall)

describe('MCP conversational registration skill', () => {
  it('registers Chojema Dooroo into external AI clients via register_dooroo_mcp', async () => {
    const { skill } = createMcpSkill()
    const res = await callTool(skill, 'register_dooroo_mcp', {
      clients: ['claude-desktop'],
      roots: ['/docs'],
    })
    expect(mcpHostRegister).toHaveBeenCalledWith({
      clients: ['claude-desktop'],
      roots: ['/docs'],
      readOnly: false,
    })
    expect(res.isError).toBeFalsy()
    expect(res.summary).toContain('Claude Desktop')
  })

  it('registers an external MCP server and dynamically exposes its tools', async () => {
    const { skill, refreshTools } = createMcpSkill()
    await refreshTools()
    expect(skill.tools.some((t) => t.name === 'mcp__memory__store_memory')).toBe(true)

    const regRes = await callTool(skill, 'register_mcp_server', {
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    })
    expect(mcpServerRegister).toHaveBeenCalledWith({
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      enabled: true,
    })
    expect(regRes.isError).toBeFalsy()
    expect(regRes.summary).toContain('filesystem')

    const execRes = await callTool(skill, 'mcp__memory__store_memory', { key: 'hello' })
    expect(mcpToolCall).toHaveBeenCalledWith({
      qualifiedName: 'mcp__memory__store_memory',
      input: { key: 'hello' },
    })
    expect(execRes.output).toBe('tool-executed-ok')
  })

  it('lists and removes MCP servers', async () => {
    const { skill } = createMcpSkill()
    const statusRes = await callTool(skill, 'list_mcp_status')
    expect(statusRes.isError).toBeFalsy()
    expect(statusRes.output).toContain('Claude Desktop')

    const remRes = await callTool(skill, 'remove_mcp_server', { name: 'memory' })
    expect(mcpServerRemove).toHaveBeenCalledWith('memory')
    expect(remRes.isError).toBeFalsy()
  })
})
