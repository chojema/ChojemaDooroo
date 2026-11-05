import { createHash } from 'node:crypto'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, posix, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { HostFontFaceInfo, HostFontSnapshotInfo } from '../shared/ipc'

/** Only standard OS font folders supply rendering resources. Application bundles,
 * document-embedded fonts, arbitrary registered paths and old browser snapshots do not.
 * Original document font names are never rewritten by this module. */

const FONT_FILE = /\.(ttf|otf|ttc|otc)$/i
const MAX_DEPTH = 8
const MAX_FILES = 4000
/** the editor refuses a face larger than this (host-font-provider.ts MAX_FONT_BYTES) */
export const MAX_HOST_FONT_BYTES = 64 * 1024 * 1024
const MAX_NAME_TABLE = 1024 * 1024
/** the editor keeps at most this many aliases per face */
const MAX_ALIASES = 32

export interface SystemFontFile {
  path: string
  size: number
  mtimeMs: number
}

export interface ParsedFace {
  faceIndex: number
  family: string
  fullName: string
  postscriptName: string
  style: string
  /** every family and full name the file gives, in all its languages */
  names: string[]
  /** family names only (name ids 1 and 16), the ones a document refers to */
  families: string[]
  weight: number
  slant: 'normal' | 'italic' | 'oblique'
  revision: number
}

export interface CatalogFace extends HostFontFaceInfo {
  path: string
  faceIndex: number
  size: number
  mtimeMs: number
}

export interface SystemFontCatalog {
  revision: string
  faces: CatalogFace[]
  roots: readonly string[]
}

/** A font name the way the editor compares them (its `normalizeFontAlias`). */
export function fontAlias(value: string): string {
  return value
    .replaceAll('\u0000', '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

// ---------------------------------------------------------------- SFNT reading

type ReadAt = (offset: number, length: number) => Promise<Uint8Array>

interface TableRecord {
  offset: number
  length: number
}

const tag = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!)

const u16 = (bytes: Uint8Array, at: number): number => (bytes[at]! << 8) | bytes[at + 1]!
const u32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!

const SFNT_VERSIONS = new Set(['\u0000\u0001\u0000\u0000', 'OTTO', 'true'])

async function tablesAt(read: ReadAt, at: number): Promise<Map<string, TableRecord> | null> {
  const head = await read(at, 12)
  if (head.length < 12 || !SFNT_VERSIONS.has(tag(head, 0))) return null
  const count = u16(head, 4)
  if (count === 0 || count > 512) return null
  const dir = await read(at + 12, count * 16)
  if (dir.length < count * 16) return null
  const tables = new Map<string, TableRecord>()
  for (let i = 0; i < count; i++) {
    const base = i * 16
    tables.set(tag(dir, base), { offset: u32(dir, base + 8), length: u32(dir, base + 12) })
  }
  return tables
}

const utf16 = new TextDecoder('utf-16be')
const eucKr = new TextDecoder('euc-kr')
const latin1 = new TextDecoder('latin1')

/** One name record's text, or null when its encoding is not one this reads. */
function decodeName(platform: number, encoding: number, bytes: Uint8Array): string | null {
  if (platform === 0) return utf16.decode(bytes)
  if (platform === 3) {
    if (encoding === 0 || encoding === 1 || encoding === 10) return utf16.decode(bytes)
    // Wansung: EUC-KR bytes in 16-bit cells, a one-byte character padded with a zero
    if (encoding === 5) return eucKr.decode(bytes.filter((b) => b !== 0))
    return null
  }
  if (platform === 1) {
    if (encoding === 0) return latin1.decode(bytes)
    if (encoding === 3) return eucKr.decode(bytes)
  }
  return null
}

interface NameEntry {
  id: number
  english: boolean
  text: string
}

const ENGLISH_LANGS = new Set([0x0409, 0])

function readNames(table: Uint8Array): NameEntry[] {
  if (table.length < 6) return []
  const count = u16(table, 2)
  const strings = u16(table, 4)
  const out: NameEntry[] = []
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12
    if (at + 12 > table.length) break
    const platform = u16(table, at)
    const encoding = u16(table, at + 2)
    const language = u16(table, at + 4)
    const id = u16(table, at + 6)
    if (![1, 2, 4, 6, 16, 17].includes(id)) continue
    const length = u16(table, at + 8)
    const start = strings + u16(table, at + 10)
    if (start + length > table.length) continue
    const text = decodeName(platform, encoding, table.subarray(start, start + length))
      ?.replaceAll('\u0000', '')
      .trim()
    if (!text) continue
    // Mac platform language 0 is English; Windows 0x0409
    const english = platform === 1 ? language === 0 : ENGLISH_LANGS.has(language) && platform !== 0
    out.push({ id, english: english || platform === 0, text })
  }
  return out
}

function pick(names: NameEntry[], ...ids: number[]): string {
  for (const id of ids) {
    const english = names.find((n) => n.id === id && n.english)
    if (english) return english.text
  }
  for (const id of ids) {
    const any = names.find((n) => n.id === id)
    if (any) return any.text
  }
  return ''
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = fontAlias(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

async function faceAt(read: ReadAt, at: number, faceIndex: number): Promise<ParsedFace | null> {
  const tables = await tablesAt(read, at)
  const nameRecord = tables?.get('name')
  if (!tables || !nameRecord || nameRecord.length > MAX_NAME_TABLE) return null
  const names = readNames(await read(nameRecord.offset, nameRecord.length))
  const family = pick(names, 1, 16)
  if (!family) return null

  let weight = 400
  let slant: ParsedFace['slant'] = 'normal'
  const os2 = tables.get('OS/2')
  if (os2 && os2.length >= 64) {
    const bytes = await read(os2.offset, 64)
    const raw = u16(bytes, 4)
    // a few old fonts give the class on the 1–9 scale
    weight = raw >= 1 && raw <= 9 ? raw * 100 : raw
    const selection = u16(bytes, 62)
    if (selection & 0x200) slant = 'oblique'
    else if (selection & 0x1) slant = 'italic'
  }
  let revision = 0
  const head = tables.get('head')
  if (head && head.length >= 54) {
    const bytes = await read(head.offset, 54)
    revision = u32(bytes, 4) / 65536
    const macStyle = u16(bytes, 44)
    if (!os2) {
      if (macStyle & 0x1) weight = 700
      if (macStyle & 0x2) slant = 'italic'
    }
  }
  if (!Number.isFinite(weight) || weight < 1 || weight > 1000) weight = 400

  const families = unique(names.filter((n) => n.id === 1 || n.id === 16).map((n) => n.text))
  const all = unique([
    ...families,
    ...names.filter((n) => n.id === 4 || n.id === 6).map((n) => n.text),
  ])
  return {
    faceIndex,
    family,
    fullName: pick(names, 4) || family,
    postscriptName: pick(names, 6),
    style: pick(names, 17, 2) || 'Regular',
    names: all,
    families,
    weight,
    slant,
    revision,
  }
}

/** The faces of one font file: one for a plain SFNT, each face of a collection. */
export async function parseFontFaces(read: ReadAt): Promise<ParsedFace[]> {
  const head = await read(0, 12)
  if (head.length < 12) return []
  if (tag(head, 0) === 'ttcf') {
    const count = Math.min(u32(head, 8), 64)
    const offsets = await read(12, count * 4)
    const faces: ParsedFace[] = []
    for (let i = 0; i < count && (i + 1) * 4 <= offsets.length; i++) {
      const face = await faceAt(read, u32(offsets, i * 4), i)
      if (face) faces.push(face)
    }
    return faces
  }
  const face = await faceAt(read, 0, 0)
  return face ? [face] : []
}

async function parseFontFile(path: string): Promise<ParsedFace[]> {
  const file = await open(path, 'r')
  try {
    const read: ReadAt = async (offset, length) => {
      const buffer = new Uint8Array(length)
      const { bytesRead } = await file.read(buffer, 0, length, offset)
      return buffer.subarray(0, bytesRead)
    }
    return await parseFontFaces(read)
  } finally {
    await file.close()
  }
}

// ---------------------------------------------------------------- standard folders

/** Includes the OS-wide and per-user standard font folders, never an app's resources. */
export function systemFontRoots(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string[] {
  if (platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', posix.join(home, 'Library', 'Fonts')]
  if (platform === 'win32') {
    const windows = env.SystemRoot || env.WINDIR || 'C:\\Windows'
    const roots = [win32.join(windows, 'Fonts')]
    if (env.LOCALAPPDATA) roots.push(win32.join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'))
    return roots
  }
  return []
}

function within(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(rel)
}

/** Resolve links before admitting a file; rechecked again before returning any bytes. */
async function allowedPath(path: string, roots: readonly string[]): Promise<boolean> {
  try {
    const resolved = await realpath(path)
    for (const root of roots) {
      if (!within(path, root)) continue
      // The root itself may sit behind an OS link (macOS /var -> /private/var): compare
      // the resolved file with the resolved root so a file inside stays admitted.
      const resolvedRoot = await realpath(root).catch(() => root)
      if (within(resolved, resolvedRoot)) return true
    }
    return false
  } catch { return false }
}

async function walk(dir: string, depth: number, out: SystemFontFile[], roots: readonly string[]): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    const path = join(dir, entry.name)
    // a symbolic link could lead out of the standard folders: not followed
    if (entry.isDirectory()) await walk(path, depth + 1, out, roots)
    else if (entry.isFile() && FONT_FILE.test(entry.name)) {
      try {
        if (!(await allowedPath(path, roots))) continue
        const info = await stat(path)
        if (info.size > 0 && info.size <= MAX_HOST_FONT_BYTES) {
          out.push({ path, size: info.size, mtimeMs: info.mtimeMs })
        }
      } catch {
        /* gone or unreadable: left out */
      }
    }
  }
}

/** The font files inside the standard font folders `dirs`, each folder walked whole. */
export async function findSystemFontFiles(dirs: readonly string[]): Promise<SystemFontFile[]> {
  const files: SystemFontFile[] = []
  for (const dir of dirs) await walk(dir, 0, files, dirs)
  const seen = new Set<string>()
  return files
    .filter((file) => !seen.has(file.path) && seen.add(file.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

// ---------------------------------------------------------------- the catalog

/**
 * One face per family name, weight and slant. The editor gives up on a name two faces of
 * the same style answer to, so a font found twice (the OS can keep copies in several folders)
 * is kept once: the higher font revision, then the newer file.
 */
export function buildCatalog(
  parsed: { file: SystemFontFile; faces: ParsedFace[] }[],
  roots: readonly string[] = [],
): SystemFontCatalog {
  const entries = parsed.flatMap(({ file, faces }) => faces.map((face) => ({ file, face })))
  entries.sort(
    (a, b) =>
      b.face.revision - a.face.revision ||
      b.file.mtimeMs - a.file.mtimeMs ||
      (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0),
  )
  const taken = new Set<string>()
  const faces: CatalogFace[] = []
  const hash = createHash('sha256')
  for (const { file, face } of entries) {
    const keys = face.families.map((name) => `${fontAlias(name)}\u0000${face.weight}\u0000${face.slant}`)
    if (keys.length === 0 || keys.some((key) => taken.has(key))) continue
    for (const key of keys) taken.add(key)
    const id = createHash('sha256')
      .update(`${file.path}\u0000${face.faceIndex}`)
      .digest('hex')
      .slice(0, 24)
    hash.update(`${id}\u0000${file.size}\u0000${file.mtimeMs}\n`)
    faces.push({
      id,
      family: face.family,
      fullName: face.fullName,
      postscriptName: face.postscriptName,
      style: face.style,
      aliases: face.names
        .filter((name) => ![face.family, face.fullName, face.postscriptName].includes(name))
        .slice(0, MAX_ALIASES),
      weight: face.weight,
      slant: face.slant,
      path: file.path,
      faceIndex: face.faceIndex,
      size: file.size,
      mtimeMs: file.mtimeMs,
    })
  }
  return { revision: `system-${hash.digest('hex').slice(0, 16)}`, faces, roots }
}

/** The catalog of the standard folders on this PC. */
export async function scanSystemFonts(dirs: readonly string[] = systemFontRoots()): Promise<SystemFontCatalog> {
  const files = await findSystemFontFiles(dirs)
  const parsed: { file: SystemFontFile; faces: ParsedFace[] }[] = []
  for (const file of files) {
    try {
      parsed.push({ file, faces: await parseFontFile(file.path) })
    } catch {
      /* not a font this reads: left out */
    }
  }
  return buildCatalog(parsed, dirs)
}

/** What the editor is told: the faces without where they lie. */
export function snapshotOf(catalog: SystemFontCatalog): HostFontSnapshotInfo {
  return {
    revision: catalog.revision,
    faces: catalog.faces.map(({ path: _path, faceIndex: _index, size: _size, mtimeMs: _mtime, ...face }) => face),
  }
}

let catalogPromise: Promise<SystemFontCatalog> | null = null

/** The catalog of this run, scanned once on first use. */
export function systemFontCatalog(): Promise<SystemFontCatalog> {
  catalogPromise ??= scanSystemFonts().catch((err) => {
    console.warn('[hwp] System fonts could not be listed:', err)
    return { revision: 'system-none', faces: [], roots: [] }
  })
  return catalogPromise
}

/** The listed face's file as it lies, or null when it changed since the scan. */
async function readFaceFile(face: CatalogFace, roots: readonly string[]): Promise<Uint8Array | null> {
  if (!(await allowedPath(face.path, roots))) return null
  const file = await open(face.path, 'r')
  try {
    const info = await file.stat()
    if (info.size !== face.size || info.mtimeMs !== face.mtimeMs || info.size > MAX_HOST_FONT_BYTES) return null
    const bytes = new Uint8Array(info.size)
    const { bytesRead } = await file.read(bytes, 0, info.size, 0)
    return bytesRead === info.size ? bytes : null
  } finally {
    await file.close()
  }
}

/**
 * The bytes of one listed face, read unchanged, or null when the id or revision is
 * not the current catalog's (an old snapshot, or a value that did not come from it).
 */
export async function readCatalogFace(
  catalog: SystemFontCatalog,
  id: unknown,
  revision: unknown,
): Promise<{ bytes: Uint8Array; faceIndex: number } | null> {
  if (typeof id !== 'string' || revision !== catalog.revision) return null
  const face = catalog.faces.find((entry) => entry.id === id)
  if (!face) return null
  const bytes = await readFaceFile(face, catalog.roots)
  return bytes ? { bytes, faceIndex: face.faceIndex } : null
}

const cssString = (value: string): string =>
  `"${value.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r\f]/g, ' ')}"`

/** Only catalogued standard-folder fonts, read unchanged, are supplied to print/export. */
export async function printFontCss(
  catalog: SystemFontCatalog,
  pages: readonly string[],
): Promise<string> {
  if (catalog.faces.length === 0 || pages.length === 0) return ''
  const text = pages.join('\n')
  const rules: string[] = []
  for (const face of catalog.faces) {
    if (face.faceIndex !== 0) continue
    const names = [face.family, face.fullName, ...face.aliases].filter(
      (name, index, all) => name && all.indexOf(name) === index && text.includes(name),
    )
    if (names.length === 0) continue
    // Reference the approved original file rather than repeating large CJK font bytes
    // for every alias and style in the print page. No repair, copying or redistribution.
    if (!(await allowedPath(face.path, catalog.roots))) continue
    const info = await stat(face.path).catch(() => null)
    if (!info || info.size !== face.size || info.mtimeMs !== face.mtimeMs) continue
    const src = pathToFileURL(face.path).href
    const style = face.slant === 'normal' ? 'normal' : face.slant
    for (const name of names) {
      rules.push(
        `@font-face { font-family: ${cssString(name)}; src: url(${cssString(src)}); ` +
          `font-weight: ${face.weight}; font-style: ${style}; }`,
      )
    }
  }
  return rules.join('\n')
}
