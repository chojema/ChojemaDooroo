import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  buildCatalog,
  systemFontRoots,
  fontAlias,
  parseFontFaces,
  printFontCss,
  readCatalogFace,
  scanSystemFonts,
  snapshotOf,
} from '../src/main/system-fonts'
import type { SystemFontFile, ParsedFace } from '../src/main/system-fonts'
import { installHostFonts } from '../src/renderer/host-fonts'

// ---------------------------------------------------------------- a small font file

const be16 = (value: number) => [(value >>> 8) & 0xff, value & 0xff]
const be32 = (value: number) => [...be16((value >>> 16) & 0xffff), ...be16(value & 0xffff)]
const utf16 = (text: string) => [...text].flatMap((c) => be16(c.charCodeAt(0)))

interface NameSpec {
  id: number
  text: string
  lang?: number
}

function nameTable(names: NameSpec[]): number[] {
  const strings: number[] = []
  const records: number[] = []
  for (const name of names) {
    const bytes = utf16(name.text)
    records.push(...be16(3), ...be16(1), ...be16(name.lang ?? 0x0409), ...be16(name.id))
    records.push(...be16(bytes.length), ...be16(strings.length))
    strings.push(...bytes)
  }
  return [...be16(0), ...be16(names.length), ...be16(6 + records.length), ...records, ...strings]
}

function os2Table(weight: number, selection = 0): number[] {
  const table = new Array(78).fill(0)
  table.splice(4, 2, ...be16(weight))
  table.splice(62, 2, ...be16(selection))
  return table
}

/** A format 4 cmap: one segment A–Z by delta, then the closing 0xFFFF segment. */
function cmapTable(closingDelta: number, pad = 0): number[] {
  const segments = 2
  const sub = [
    ...be16(4),
    ...be16(16 + segments * 8),
    ...be16(0),
    ...be16(segments * 2),
    ...be16(2),
    ...be16(0),
    ...be16(0),
    ...be16(0x5a), // end codes
    ...be16(0xffff),
    ...be16(pad), // reserved pad
    ...be16(0x41), // start codes
    ...be16(0xffff),
    ...be16(-0x40 & 0xffff), // deltas: A → glyph 1
    ...be16(closingDelta),
    ...be16(0), // range offsets
    ...be16(0),
  ]
  return [...be16(0), ...be16(1), ...be16(3), ...be16(1), ...be32(12), ...sub]
}

function sfnt(tables: Record<string, number[]>, searchRange?: number): Uint8Array {
  const tags = Object.keys(tables).sort()
  const header = [...be32(0x00010000), ...be16(tags.length)]
  const selector = Math.floor(Math.log2(tags.length))
  const range = searchRange ?? 2 ** selector * 16
  header.push(...be16(range), ...be16(selector), ...be16(tags.length * 16 - range))
  const dir: number[] = []
  const body: number[] = []
  let offset = 12 + tags.length * 16
  for (const tag of tags) {
    const data = tables[tag]!
    dir.push(...[...tag].map((c) => c.charCodeAt(0)), ...be32(0), ...be32(offset), ...be32(data.length))
    body.push(...data)
    while (body.length % 4) body.push(0)
    offset = 12 + tags.length * 16 + body.length
  }
  return new Uint8Array([...header, ...dir, ...body])
}

function fontFile(options: {
  family: string
  korean?: string
  style?: string
  weight?: number
  italic?: boolean
  extra?: Record<string, number[]>
  searchRange?: number
}): Uint8Array {
  const names: NameSpec[] = [
    { id: 1, text: options.family },
    { id: 2, text: options.style ?? 'Regular' },
    { id: 4, text: `${options.family}${options.style && options.style !== 'Regular' ? ` ${options.style}` : ''}` },
    { id: 6, text: options.family.replace(/\s/g, '') },
  ]
  if (options.korean) names.push({ id: 1, text: options.korean, lang: 0x0412 })
  return sfnt(
    {
      name: nameTable(names),
      'OS/2': os2Table(options.weight ?? 400, options.italic ? 1 : 0),
      maxp: [...be32(0x00005000), ...be16(27)],
      ...options.extra,
    },
    options.searchRange,
  )
}

const readerOf = (bytes: Uint8Array) => async (offset: number, length: number) =>
  bytes.subarray(offset, offset + length)

const work = mkdtempSync(join(tmpdir(), 'system-fonts-test-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))

// ---------------------------------------------------------------- tests

describe('System font names', () => {
  it('reads the family, Korean name, style, weight and slant of a face', async () => {
    const faces = await parseFontFaces(
      readerOf(fontFile({ family: 'HYgtrE', korean: 'HY견고딕', weight: 400 })),
    )
    expect(faces).toHaveLength(1)
    expect(faces[0]).toMatchObject({
      faceIndex: 0,
      family: 'HYgtrE',
      fullName: 'HYgtrE',
      postscriptName: 'HYgtrE',
      style: 'Regular',
      weight: 400,
      slant: 'normal',
    })
    expect(faces[0]!.families).toEqual(['HYgtrE', 'HY견고딕'])
    const italic = await parseFontFaces(
      readerOf(fontFile({ family: 'HCR Batang', style: 'Bold Italic', weight: 700, italic: true })),
    )
    expect(italic[0]).toMatchObject({ weight: 700, slant: 'italic', style: 'Bold Italic' })
  })

  it('reads each face of a collection, and nothing from a file that is no font', async () => {
    const a = fontFile({ family: 'A' })
    const b = fontFile({ family: 'B' })
    const head = 12 + 8
    const ttc = new Uint8Array(head + a.length + b.length)
    ttc.set([...'ttcf'].map((c) => c.charCodeAt(0)), 0)
    ttc.set([...be32(0x00010000), ...be32(2), ...be32(head), ...be32(head + a.length)], 4)
    // the second face's table offsets count from the start of the collection
    const shifted = (font: Uint8Array, by: number) => {
      const copy = font.slice()
      const count = (copy[4]! << 8) | copy[5]!
      for (let i = 0; i < count; i++) {
        const at = 12 + i * 16 + 8
        const value = ((copy[at]! << 24) >>> 0) + (copy[at + 1]! << 16) + (copy[at + 2]! << 8) + copy[at + 3]!
        copy.set(be32(value + by), at)
      }
      return copy
    }
    ttc.set(shifted(a, head), head)
    ttc.set(shifted(b, head + a.length), head + a.length)
    const faces = await parseFontFaces(readerOf(ttc))
    expect(faces.map((face) => [face.family, face.faceIndex])).toEqual([
      ['A', 0],
      ['B', 1],
    ])
    expect(await parseFontFaces(readerOf(new TextEncoder().encode('not a font at all')))).toEqual([])
  })

  it('compares names the way the editor does', () => {
    expect(fontAlias('  HCR   Batang ')).toBe('hcr batang')
    expect(fontAlias('함초롬바탕')).toBe('함초롬바탕'.normalize('NFC'))
  })
})

describe('standard system font folders', () => {
  it('uses only the system and user standard folders on both platforms', () => {
    expect(systemFontRoots('darwin', {}, '/Users/test')).toEqual([
      '/System/Library/Fonts', '/Library/Fonts', '/Users/test/Library/Fonts',
    ])
    expect(systemFontRoots('win32', { SystemRoot: 'D:\\Windows', LOCALAPPDATA: 'D:\\Users\\test\\AppData\\Local', ProgramFiles: 'E:\\Apps' }, '')).toEqual([
      'D:\\Windows\\Fonts', 'D:\\Users\\test\\AppData\\Local\\Microsoft\\Windows\\Fonts',
    ])
    expect(systemFontRoots('linux', {}, '/home/test')).toEqual([])
  })
  it('ignores applications, HFT files and fonts outside the admitted folders', async () => {
    const dir = join(work, 'Fonts')
    const app = join(work, 'Other.app')
    mkdirSync(dir, { recursive: true }); mkdirSync(app, { recursive: true })
    writeFileSync(join(dir, 'System.ttf'), fontFile({ family: 'System', korean: '시스템' }))
    writeFileSync(join(dir, 'Legacy.hft'), fontFile({ family: 'HFT' }))
    writeFileSync(join(app, 'Private.ttf'), fontFile({ family: 'Private' }))
    const catalog = await scanSystemFonts([dir])
    expect(catalog.faces.map(face => face.family)).toEqual(['System'])
    expect(snapshotOf(catalog).faces[0]!.aliases).toContain('시스템')
    expect(JSON.stringify(snapshotOf(catalog))).not.toContain(dir)
    const foreign = await scanSystemFonts([app])
    foreign.roots = [dir]
    expect(await readCatalogFace(foreign, foreign.faces[0]!.id, foreign.revision)).toBeNull()
    expect(await printFontCss(foreign, ['Private'])).toBe('')
  })
  it('does not follow a linked font folder into another application', async () => {
    const dir = join(work, 'linked-Fonts')
    const app = join(work, 'OtherApp')
    mkdirSync(dir, { recursive: true }); mkdirSync(app, { recursive: true })
    writeFileSync(join(app, 'Private.ttf'), fontFile({ family: 'AppOnly' }))
    symlinkSync(app, join(dir, 'AppFonts'), process.platform === 'win32' ? 'junction' : 'dir')
    expect((await scanSystemFonts([dir])).faces).toEqual([])
  })
})

describe('System font catalog', () => {
  const file = (path: string, mtimeMs = 1): SystemFontFile => ({ path, size: 10, mtimeMs })
  const face = (family: string, extra: Partial<ParsedFace> = {}): ParsedFace => ({
    faceIndex: 0,
    family,
    fullName: family,
    postscriptName: family,
    style: 'Regular',
    names: [family],
    families: [family],
    weight: 400,
    slant: 'normal',
    revision: 1,
    ...extra,
  })

  it('keeps one face per name and style: the higher revision, then the newer file', () => {
    const catalog = buildCatalog([
      { file: file('/a/HBatang.ttf', 5), faces: [face('한컴바탕', { revision: 1 })] },
      { file: file('/b/HBatang.ttf', 1), faces: [face('한컴바탕', { revision: 2 })] },
      { file: file('/c/HBatangB.ttf'), faces: [face('한컴바탕', { weight: 700 })] },
      { file: file('/d/Other.ttf', 9), faces: [face('HY견고딕')] },
      { file: file('/e/Other.ttf', 3), faces: [face('HY견고딕')] },
    ])
    expect(catalog.faces.map((entry) => [entry.family, entry.weight, entry.path])).toEqual([
      ['한컴바탕', 400, '/b/HBatang.ttf'],
      ['HY견고딕', 400, '/d/Other.ttf'],
      ['한컴바탕', 700, '/c/HBatangB.ttf'],
    ])
    expect(new Set(catalog.faces.map((entry) => entry.id)).size).toBe(3)
  })

  it('changes its revision when a file changes', () => {
    const a = buildCatalog([{ file: file('/a.ttf', 1), faces: [face('A')] }])
    const b = buildCatalog([{ file: file('/a.ttf', 2), faces: [face('A')] }])
    expect(a.revision).not.toBe(b.revision)
    expect(buildCatalog([]).faces).toEqual([])
  })
})

describe('System font bytes', () => {
  it('are read only for a listed face of the current revision', async () => {
    const dir = join(work, 'read')
    mkdirSync(dir, { recursive: true })
    const bytes = fontFile({ family: 'HYgtrE' })
    writeFileSync(join(dir, 'HYGTRE.TTF'), bytes)
    const catalog = await scanSystemFonts([dir])
    const id = catalog.faces[0]!.id
    const data = await readCatalogFace(catalog, id, catalog.revision)
    expect(data?.faceIndex).toBe(0)
    expect(Buffer.from(data!.bytes).equals(Buffer.from(bytes))).toBe(true)
    expect(await readCatalogFace(catalog, id, 'old')).toBeNull()
    expect(await readCatalogFace(catalog, 'unknown', catalog.revision)).toBeNull()
    expect(await readCatalogFace(catalog, { id }, catalog.revision)).toBeNull()
    // a file changed since the scan is not read
    writeFileSync(join(dir, 'HYGTRE.TTF'), new Uint8Array([...bytes, 0, 0, 0, 0]))
    expect(await readCatalogFace(catalog, id, catalog.revision)).toBeNull()
  })

})

describe('System fonts in print', () => {
  it('give the hidden print page the faces its pages name, and only those', async () => {
    const dir = join(work, 'print')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'HANBatang.ttf'), fontFile({ family: 'HCR Batang', korean: '함초롬바탕' }))
    writeFileSync(
      join(dir, 'HYGTRE.TTF'),
      fontFile({ family: 'HYgtrE', korean: 'HY견고딕', searchRange: 0 }),
    )
    writeFileSync(join(dir, 'Unused.ttf'), fontFile({ family: 'Unused' }))
    const catalog = await scanSystemFonts([dir])
    const css = await printFontCss(catalog, [
      '<svg><text font-family="함초롬바탕, Batang">a</text></svg>',
      `<svg><text font-family="'HY견고딕'">b</text></svg>`,
    ])
    // Original standard-folder files are referenced directly without repair or base64 duplication.
    expect(css).toMatch(/font-family: "함초롬바탕"; src: url\("file:\/\/[^\"]*HANBatang\.ttf"\)/)
    expect(css).toMatch(/font-family: "HY견고딕"; src: url\("file:\/\/[^\"]*HYGTRE\.TTF"\)/)
    expect(css).not.toContain('base64')
    expect(css).not.toContain('Unused')
    expect(css).toContain('font-weight: 400; font-style: normal;')
    expect(await printFontCss(catalog, ['<svg>nothing</svg>'])).toBe('')
    expect(await printFontCss({ revision: 'none', faces: [], roots: [] }, ['함초롬바탕'])).toBe('')
  })
})

describe('System fonts in the editor', () => {
  /** A stand-in for the studio frame: its own realm's buffers and its public font API. */
  function frameWith(setProvider: (provider: unknown) => Promise<void>) {
    class FrameBuffer extends ArrayBuffer {}
    return {
      frame: {
        ArrayBuffer: FrameBuffer,
        Uint8Array,
        rhwpStudio: { fonts: { setProvider } },
      } as unknown as Window,
      FrameBuffer,
    }
  }
  const snapshot = {
    revision: 'r1',
    faces: [
      {
        id: 'f1',
        family: 'HYgtrE',
        fullName: 'HYgtrE',
        postscriptName: 'HYgtrE',
        style: 'Regular',
        aliases: ['HY견고딕'],
        weight: 400,
        slant: 'normal' as const,
      },
    ],
  }

  it('hands the faces to the studio, their bytes in buffers of its frame', async () => {
    let provider: {
      getSnapshot(): Promise<unknown>
      readFace(id: string, revision: string): Promise<{ bytes: ArrayBuffer; faceIndex: number }>
      subscribe(listener: () => void): () => void
    } | null = null
    const { frame, FrameBuffer } = frameWith(async (given) => {
      provider = given as typeof provider
    })
    const reads: [string, string][] = []
    const ok = await installHostFonts(frame, {
      hostFonts: async () => snapshot,
      hostFontRead: async (id, revision) => {
        reads.push([id, revision])
        return { bytes: new Uint8Array([1, 2, 3]), faceIndex: 0 }
      },
    })
    expect(ok).toBe(true)
    expect(await provider!.getSnapshot()).toEqual(snapshot)
    const data = await provider!.readFace('f1', 'r1')
    expect(data.bytes).toBeInstanceOf(FrameBuffer)
    expect([...new Uint8Array(data.bytes)]).toEqual([1, 2, 3])
    expect(reads).toEqual([['f1', 'r1']])
    expect(typeof provider!.subscribe(() => {})).toBe('function')
  })

  it('sets nothing without System fonts, so the editor keeps its own substitution', async () => {
    let set = 0
    const { frame } = frameWith(async () => {
      set++
    })
    const none = { hostFonts: async () => ({ revision: 'x', faces: [] }), hostFontRead: async () => null }
    expect(await installHostFonts(frame, none)).toBe(true)
    expect(await installHostFonts(null, none)).toBe(false)
    expect(await installHostFonts({} as Window, { ...none, hostFonts: async () => snapshot })).toBe(false)
    expect(await installHostFonts(frame, {})).toBe(false)
    expect(set).toBe(1)
  })

  it('reports a face that went away, and a studio that refused the provider', async () => {
    let provider: { readFace(id: string, revision: string): Promise<unknown> } | null = null
    const { frame } = frameWith(async (given) => {
      provider = given as typeof provider
    })
    await installHostFonts(frame, { hostFonts: async () => snapshot, hostFontRead: async () => null })
    await expect(provider!.readFace('f1', 'r1')).rejects.toThrow(/no longer available/)
    const refusing = frameWith(async () => {
      throw new Error('no')
    })
    expect(
      await installHostFonts(refusing.frame, {
        hostFonts: async () => snapshot,
        hostFontRead: async () => null,
      }),
    ).toBe(false)
  })
})
