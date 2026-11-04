import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { createDoorooMcpServer, createMcpPathPolicy, parseMcpOptions, type McpDocuments } from '../src/main/mcp'

const temporary: string[] = []
afterEach(async () => { for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'dooroo-mcp-test-')); temporary.push(dir)
  const root = join(dir, 'allowed'); await mkdir(root)
  return { dir, root }
}
describe('MCP file access', () => {
  it('requires explicit absolute roots', () => {
    expect(() => parseMcpOptions(['app', '--mcp'])).toThrow()
    expect(() => parseMcpOptions(['app', '--mcp', '--mcp-root', 'relative'])).toThrow()
    expect(parseMcpOptions(['app', '--mcp', '--mcp-root', tmpdir(), '--mcp-read-only'])).toEqual({ roots: [tmpdir()], readOnly: true })
  })
  it('denies traversal, sibling prefixes, wrong formats and missing parents', async () => {
    const { dir, root } = await fixture()
    const check = await createMcpPathPolicy([root])
    await writeFile(join(root, '원본.hwpx'), 'doc')
    expect(await check(join(root, '원본.hwpx'))).toMatch(/원본\.hwpx$/)
    expect(await check(join(root, '새 문서.hwpx'), true)).toMatch(/새 문서\.hwpx$/)
    await expect(check(join(root, '..', 'outside.hwpx'), true)).rejects.toThrow()
    await mkdir(join(dir, 'allowed-sibling'))
    await expect(check(join(dir, 'allowed-sibling', 'file.hwpx'), true)).rejects.toThrow()
    await expect(check(join(root, 'script.js'), true)).rejects.toThrow()
    await expect(check(join(root, 'missing', 'doc.hwpx'), true)).rejects.toThrow()
  })
  it('rejects junctions escaping the allowed folder', async () => {
    const { dir, root } = await fixture()
    const outside = join(dir, 'outside'); await mkdir(outside)
    await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    const check = await createMcpPathPolicy([root])
    await expect(check(join(root, 'link', 'escaped.hwpx'), true)).rejects.toThrow(/폴더 밖/)
  })
})
describe('MCP protocol and tools', () => {
  async function connect(readOnly = false) {
    const { root } = await fixture()
    const documents: McpDocuments = {
      list: () => [], create: vi.fn(async () => ({ id: 'doc-1', title: '새 문서' })),
      open: vi.fn(async (path) => ({ id: 'doc-1', title: '문서', path })),
      invoke: vi.fn(async (_id, method) => method === 'readText' ? '가😀나다' : { ok: false, reason: 'ambiguous' }),
      save: vi.fn(async () => ({ ok: true })),
    }
    const { server, ready } = createDoorooMcpServer(documents, { roots: [root], readOnly }, '0.6.0')
    await ready
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'test', version: '1.0.0' })
    await client.connect(clientTransport)
    return { client, documents, close: async () => { await client.close(); await server.close() } }
  }
  it('advertises tools, validates inputs, paginates Unicode and reports editor refusals', async () => {
    const { client, documents, close } = await connect()
    try {
      const list = await client.listTools()
      expect(list.tools).toHaveLength(12)
      const read = await client.callTool({ name: 'read_document', arguments: { documentId: 'doc-1', offset: 1, limit: 1 } })
      expect(read.content).toEqual([{ type: 'text', text: JSON.stringify({ text: '😀', offset: 1, total: 4, nextOffset: 2 }) }])
      const refused = await client.callTool({ name: 'replace_text', arguments: { documentId: 'doc-1', find: '가', replacement: '나' } })
      expect(refused.isError).toBe(true)
      const invalid = await client.callTool({ name: 'read_document', arguments: { documentId: 'doc-1', limit: -1 } })
      expect(invalid.isError).toBe(true)
      expect(documents.invoke).toHaveBeenCalledTimes(2)
      const anchor = await client.callTool({ name: 'insert_paragraphs', arguments: { documentId: 'doc-1', paragraphs: ['문단'], where: 'before' } })
      expect(anchor.isError).toBe(true)
      const escaped = await client.callTool({ name: 'save_document', arguments: { documentId: 'doc-1', path: join(tmpdir(), 'outside.hwpx') } })
      expect(escaped.isError).toBe(true)
      expect(documents.save).not.toHaveBeenCalled()
    } finally { await close() }
  })
  it('only exposes inspection tools in read-only mode', async () => {
    const { client, documents, close } = await connect(true)
    try {
      const list = await client.listTools()
      expect(list.tools.map((tool) => tool.name)).toEqual(['list_documents', 'open_document', 'read_document', 'find_text', 'list_tables', 'read_table'])
      await expect(client.callTool({ name: 'new_document', arguments: {} })).rejects.toThrow(/not found/)
      expect(documents.create).not.toHaveBeenCalled()
    } finally { await close() }
  })
  it('serializes concurrent calls so a read observes the preceding edit', async () => {
    const { client, documents, close } = await connect()
    const order: string[] = []
    documents.invoke = async (_id, method) => {
      order.push(method + ':start')
      await new Promise((resolve) => setTimeout(resolve, 10))
      order.push(method + ':end')
      return method === 'readText' ? '수정 후' : { ok: true }
    }
    try {
      await Promise.all([
        client.callTool({ name: 'replace_text', arguments: { documentId: 'doc-1', find: '전', replacement: '후' } }),
        client.callTool({ name: 'read_document', arguments: { documentId: 'doc-1' } }),
      ])
      expect(order).toEqual(['replaceText:start', 'replaceText:end', 'readText:start', 'readText:end'])
    } finally { await close() }
  })
})
