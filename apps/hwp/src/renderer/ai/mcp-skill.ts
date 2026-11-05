import type { AgentSkill, AgentToolDef } from '@genoffice/agent-core'
import type { McpConnectedToolInfo } from '../../shared/ipc'

const MCP_SYSTEM_PROMPT = `## MCP (Model Context Protocol) Registration & Server Management
You can automatically configure and manage MCP connections directly through conversation when the user asks:
1. **Registering Chojema Dooroo into external AI clients** (\`register_dooroo_mcp\`, \`unregister_dooroo_mcp\`, \`list_mcp_status\`):
   - When the user says "MCP 연결해 줘", "초제마 두루 MCP 등록해 줘", or asks to connect this app to Claude Desktop, Claude Code, Cursor, Windsurf, or Antigravity, call \`register_dooroo_mcp\`.
   - If the user does not specify a document folder (\`roots\`), omit \`roots\` so the user's default Documents folder is registered automatically.
2. **Registering & connecting external MCP servers inside Chojema Dooroo** (\`register_mcp_server\`, \`remove_mcp_server\`, \`list_mcp_status\`, \`call_mcp_tool\`):
   - When the user asks to install, add, or connect an external MCP server (e.g. filesystem, fetch, memory, github, brave-search, sqlite, or a custom command), call \`register_mcp_server\` with its \`name\`, \`command\` (such as \`npx\`, \`uvx\`, \`node\`, \`python\`), and \`args\` (such as \`["-y", "@modelcontextprotocol/server-filesystem", "/path"]\`).
   - Once connected, its tools are immediately available both as direct tools (\`mcp__<server>__<tool>\`) and through \`call_mcp_tool\`.`

const STATIC_TOOLS: AgentToolDef[] = [
  {
    name: 'list_mcp_status',
    description:
      'Check the current MCP registration status of Chojema Dooroo in external AI clients (Claude Desktop, Claude Code, Cursor, Windsurf, Antigravity) and list external MCP servers connected inside Chojema Dooroo.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'register_dooroo_mcp',
    description:
      'Automatically register Chojema Dooroo as an MCP server into external AI clients (Claude Desktop, Claude Code, Cursor, Windsurf, Antigravity) so those AI agents can open, read, edit, and save HWP/HWPX documents.',
    inputSchema: {
      type: 'object',
      properties: {
        clients: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['claude-desktop', 'claude-code', 'cursor', 'windsurf', 'antigravity'],
          },
          description:
            'Target AI clients to register into. Omit to automatically register into all installed/detected AI clients.',
        },
        roots: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Allowed document folder paths (--mcp-root). Omit to use the user default Documents folder.',
        },
        readOnly: {
          type: 'boolean',
          description: 'If true, register with --mcp-read-only so external clients can only read documents.',
        },
      },
    },
  },
  {
    name: 'unregister_dooroo_mcp',
    description:
      'Remove Chojema Dooroo MCP server registration from external AI clients.',
    inputSchema: {
      type: 'object',
      properties: {
        clients: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['claude-desktop', 'claude-code', 'cursor', 'windsurf', 'antigravity'],
          },
          description: 'Target AI clients to unregister from. Omit to remove from all clients.',
        },
      },
    },
  },
  {
    name: 'register_mcp_server',
    description:
      'Register and immediately connect an external MCP server inside Chojema Dooroo so the in-app AI assistant can use its tools in conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Unique server identifier (letters, digits, hyphens, e.g. "filesystem", "memory", "github")',
        },
        command: {
          type: 'string',
          description: 'Executable command (npx, node, uvx, uv, python, python3, docker, or an absolute executable path)',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command arguments (e.g. ["-y", "@modelcontextprotocol/server-memory"])',
        },
        env: {
          type: 'object',
          description: 'Optional environment variables (e.g. API keys or tokens required by the server)',
        },
      },
      required: ['name', 'command'],
    },
  },
  {
    name: 'remove_mcp_server',
    description:
      'Disconnect and remove a registered external MCP server from Chojema Dooroo.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the registered MCP server to remove',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'call_mcp_tool',
    description:
      'Call a tool provided by a connected external MCP server.',
    inputSchema: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'Name of the connected MCP server',
        },
        tool: {
          type: 'string',
          description: 'Name of the tool on that MCP server',
        },
        arguments: {
          type: 'object',
          description: 'Arguments object to pass to the MCP tool',
        },
      },
      required: ['server', 'tool'],
    },
  },
]

export interface McpSkill {
  skill: AgentSkill
  refreshTools(): Promise<void>
}

export function createMcpSkill(): McpSkill {
  let dynamicTools: McpConnectedToolInfo[] = []

  const refreshTools = async (): Promise<void> => {
    try {
      if (!window.hwpApi?.mcpServersList) return
      const res = await window.hwpApi.mcpServersList()
      dynamicTools = Array.isArray(res?.tools) ? res.tools : []
    } catch {
      dynamicTools = []
    }
  }

  const skill: AgentSkill = {
    id: 'mcp',
    systemPrompt: MCP_SYSTEM_PROMPT,
    get tools(): AgentToolDef[] {
      const staticNames = new Set(STATIC_TOOLS.map((t) => t.name))
      const extra: AgentToolDef[] = []
      for (const dt of dynamicTools) {
        if (staticNames.has(dt.qualifiedName)) continue
        staticNames.add(dt.qualifiedName)
        extra.push({
          name: dt.qualifiedName,
          description: `[MCP:${dt.server}] ${dt.description}`,
          inputSchema: dt.inputSchema,
        })
      }
      return [...STATIC_TOOLS, ...extra]
    },
    executeTool: async (call) => {
      const api = window.hwpApi
      if (call.name === 'list_mcp_status') {
        if (!api?.mcpHostStatus || !api?.mcpServersList) {
          return { output: 'MCP 관리 기능을 사용할 수 없습니다.', isError: true, summary: 'MCP 상태 확인' }
        }
        const [hostRes, serverRes] = await Promise.all([
          api.mcpHostStatus(),
          api.mcpServersList(),
        ])
        dynamicTools = Array.isArray(serverRes?.tools) ? serverRes.tools : []
        return {
          output: JSON.stringify({
            doorooHostRegistrations: hostRes.hosts,
            connectedExternalServers: serverRes.servers,
          }, null, 2),
          mutated: false,
          summary: 'MCP 연결 상태 확인',
        }
      }

      if (call.name === 'register_dooroo_mcp') {
        if (!api?.mcpHostRegister) {
          return { output: 'MCP 호스트 등록 기능을 사용할 수 없습니다.', isError: true, summary: 'MCP 자동 등록' }
        }
        try {
          const clients = Array.isArray(call.input.clients)
            ? call.input.clients.map((c) => String(c))
            : undefined
          const roots = Array.isArray(call.input.roots)
            ? call.input.roots.map((r) => String(r))
            : undefined
          const readOnly = call.input.readOnly === true
          const result = await api.mcpHostRegister({
            ...(clients ? { clients } : {}),
            ...(roots ? { roots } : {}),
            readOnly,
          })
          const labels = result.updated.map((u) => u.label).join(', ')
          return {
            output: JSON.stringify(result, null, 2),
            isError: !result.ok,
            mutated: false,
            summary: labels ? `MCP 등록 완료 (${labels})` : 'MCP 자동 등록',
          }
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
            isError: true,
            summary: 'MCP 자동 등록 실패',
          }
        }
      }

      if (call.name === 'unregister_dooroo_mcp') {
        if (!api?.mcpHostUnregister) {
          return { output: 'MCP 호스트 해제 기능을 사용할 수 없습니다.', isError: true, summary: 'MCP 등록 해제' }
        }
        const clients = Array.isArray(call.input.clients)
          ? call.input.clients.map((c) => String(c))
          : undefined
        const result = await api.mcpHostUnregister({ ...(clients ? { clients } : {}) })
        return {
          output: JSON.stringify(result, null, 2),
          mutated: false,
          summary: 'MCP 등록 해제',
        }
      }

      if (call.name === 'register_mcp_server') {
        if (!api?.mcpServerRegister) {
          return { output: '외부 MCP 서버 등록 기능을 사용할 수 없습니다.', isError: true, summary: '외부 MCP 서버 연결' }
        }
        try {
          const name = String(call.input.name ?? '').trim()
          const command = String(call.input.command ?? '').trim()
          const args = Array.isArray(call.input.args) ? call.input.args.map((a) => String(a)) : []
          const env = (call.input.env && typeof call.input.env === 'object' && !Array.isArray(call.input.env))
            ? Object.fromEntries(Object.entries(call.input.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
            : undefined
          const status = await api.mcpServerRegister({
            name,
            command,
            args,
            ...(env ? { env } : {}),
            enabled: true,
          })
          await refreshTools()
          return {
            output: JSON.stringify(status, null, 2),
            isError: !status.connected,
            mutated: false,
            summary: status.connected
              ? `MCP 서버 "${status.name}" 연결 (${status.toolCount}개 도구)`
              : `MCP 서버 "${name}" 연결 실패`,
          }
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
            isError: true,
            summary: '외부 MCP 서버 등록 실패',
          }
        }
      }

      if (call.name === 'remove_mcp_server') {
        if (!api?.mcpServerRemove) {
          return { output: '외부 MCP 서버 제거 기능을 사용할 수 없습니다.', isError: true, summary: '외부 MCP 서버 해제' }
        }
        const name = String(call.input.name ?? '').trim()
        const result = await api.mcpServerRemove(name)
        await refreshTools()
        return {
          output: JSON.stringify(result, null, 2),
          mutated: false,
          summary: `MCP 서버 "${name}" 연결 해제`,
        }
      }

      if (call.name === 'call_mcp_tool') {
        if (!api?.mcpToolCall) {
          return { output: '외부 MCP 도구 호출 기능을 사용할 수 없습니다.', isError: true, summary: 'MCP 도구 실행' }
        }
        const server = String(call.input.server ?? '').trim()
        const tool = String(call.input.tool ?? '').trim()
        const input = (call.input.arguments && typeof call.input.arguments === 'object' && !Array.isArray(call.input.arguments))
          ? (call.input.arguments as Record<string, unknown>)
          : {}
        const result = await api.mcpToolCall({ server, tool, input })
        return {
          output: result.output,
          ...(result.isError ? { isError: true } : {}),
          mutated: false,
          summary: `MCP ${server} · ${tool}`,
        }
      }

      if (call.name.startsWith('mcp__')) {
        if (!api?.mcpToolCall) {
          return { output: '외부 MCP 도구 호출 기능을 사용할 수 없습니다.', isError: true, summary: call.name }
        }
        const result = await api.mcpToolCall({
          qualifiedName: call.name,
          input: call.input,
        })
        return {
          output: result.output,
          ...(result.isError ? { isError: true } : {}),
          mutated: false,
          summary: call.name.replace(/^mcp__/, 'MCP ').replace(/__/g, ' · '),
        }
      }

      return { output: `unknown tool: ${call.name}`, isError: true, summary: call.name }
    },
  }

  return { skill, refreshTools }
}
