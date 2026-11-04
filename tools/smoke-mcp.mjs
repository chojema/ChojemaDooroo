import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

const work = await mkdtemp(join(tmpdir(), 'dooroo-mcp-smoke-'))
const env = Object.fromEntries(Object.entries({ ...process.env, CHOJEMA_DOOROO_USER_DATA: join(work, 'profile'), CHOJEMA_DOOROO_SMOKE: '1' }).filter(([, v]) => typeof v === 'string'))
delete env.ELECTRON_RUN_AS_NODE
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('tools/mcp.mjs'), ...(process.env.CHOJEMA_DOOROO_EXE ? ['--app', process.env.CHOJEMA_DOOROO_EXE] : []), '--mcp-root', work],
  env, cwd: process.cwd(), stderr: 'pipe',
})
const diagnostics = []
transport.stderr.on('data', (chunk) => diagnostics.push(chunk.toString()))
let client = new Client({ name: 'dooroo-mcp-smoke', version: '1.0.0' })
async function call(name, args = {}, error = false) {
  const result = await client.callTool({ name, arguments: args }, { timeout: 180_000 })
  assert.equal(result.isError === true, error, `${name}: ${JSON.stringify(result)}`)
  if (error) return result
  return JSON.parse(result.content[0].text)
}
try {
  await client.connect(transport)
  const tools = (await client.listTools()).tools.map((tool) => tool.name)
  assert.equal(tools.length, 12)
  assert.deepEqual((await call('list_documents')).documents, [])
  const doc = await call('new_document')
  const documentId = doc.id
  await call('insert_paragraphs', { documentId, paragraphs: ['MCP 한글 문서 검증 😀', '고유한 원문입니다.', '중복 문구', '중복 문구'] })
  const read = await call('read_document', { documentId })
  assert.match(read.text, /MCP 한글 문서 검증 😀/)
  await call('replace_text', { documentId, find: '중복 문구', replacement: '잘못된 교체' }, true)
  await call('replace_text', { documentId, find: '고유한 원문', replacement: '정확한 수정문' })
  const found = await call('find_text', { documentId, find: '정확한 수정문' })
  assert.equal(found.count, 1)
  await call('insert_table', { documentId, rows: [['항목', '값'], ['MCP', '연결']] })
  const tables = await call('list_tables', { documentId })
  assert.ok(JSON.stringify(tables).includes('2'))
  await call('read_table', { documentId, table: 1 })
  await call('fill_table_cells', { documentId, table: 1, cells: [{ row: 2, col: 2, text: '완료' }], overwrite: true })
  const path = join(work, 'MCP 한글 검증.hwpx')
  const saved = await call('save_document', { documentId, path })
  assert.equal(saved.ok, true)
  const bytes = await readFile(path)
  const zip = await JSZip.loadAsync(bytes)
  const section = await zip.file('Contents/section0.xml').async('string')
  assert.match(section, /정확한 수정문/)
  assert.match(section, /완료/)
  await call('save_document', { documentId, path }, true)
  await call('save_document', { documentId, path, overwrite: true })
  await call('read_document', { documentId: 'doc-does-not-exist' }, true)
  await call('save_document', { documentId, path: join(tmpdir(), 'outside-mcp.hwpx') }, true)
  // Reject changes made on disk since this document was read/saved, even without a sibling tab.
  await writeFile(path, Buffer.concat([bytes, Buffer.from('\nexternal-change')]))
  await call('save_document', { documentId, path, overwrite: true }, true)
  assert.equal((await readFile(path)).length, bytes.length + '\nexternal-change'.length)
  await writeFile(path, bytes)
  const reopened = await call('open_document', { path })
  assert.equal(reopened.id, documentId)
  const hwpPath = join(work, 'MCP 한글 검증.hwp')
  const hwp = await call('save_document', { documentId, path: hwpPath })
  assert.equal(hwp.ok, true)
  assert.equal((await readFile(hwpPath)).subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1')
  await client.close()
  const readOnlyTransport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('tools/mcp.mjs'), ...(process.env.CHOJEMA_DOOROO_EXE ? ['--app', process.env.CHOJEMA_DOOROO_EXE] : []), '--mcp-root', work, '--mcp-read-only'],
    env: { ...env, CHOJEMA_DOOROO_USER_DATA: join(work, 'profile-read-only') }, cwd: process.cwd(), stderr: 'pipe',
  })
  readOnlyTransport.stderr.on('data', (chunk) => diagnostics.push(chunk.toString()))
  client = new Client({ name: 'dooroo-mcp-reopen', version: '1.0.0' }, { supportedProtocolVersions: ['2025-11-25'] })
  await client.connect(readOnlyTransport)
  assert.equal(client.getNegotiatedProtocolVersion(), '2025-11-25')
  const readOnlyTools = (await client.listTools()).tools.map((tool) => tool.name)
  assert.deepEqual(readOnlyTools, ['list_documents', 'open_document', 'read_document', 'find_text', 'list_tables', 'read_table'])
  for (const savedPath of [path, hwpPath]) {
    const opened = await call('open_document', { path: savedPath })
    const persisted = await call('read_document', { documentId: opened.id })
    assert.match(persisted.text, /정확한 수정문/)
    assert.match(persisted.text, /완료/)
  }
  console.log(JSON.stringify({ work, tools, readOnlyTools, legacyProtocol: client.getNegotiatedProtocolVersion(), hwpxBytes: bytes.length, hwpPath, reopened: ['hwpx', 'hwp'], diagnostics }, null, 2))
} catch (error) {
  console.error(diagnostics.join(''))
  throw error
} finally { await client.close() }
