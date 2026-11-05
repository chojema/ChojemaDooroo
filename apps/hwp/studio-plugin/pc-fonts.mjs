/**
 * The PC's fonts in the editor's font lists from the start.
 *
 * The studio reads only the fonts it found last time; looking at the PC again is the
 * 찾기 button in its options dialog, so a user who never pressed it saw the seven base
 * fonts and the document's own, and a font installed later stayed out of the list. On a
 * website that is deliberate (the browser asks the user before listing the fonts); the app
 * already lets its pages list them, as the Word, Excel and PowerPoint pickers do.
 *
 * At start-up the editor asks the PC for its font list. That answer is cheap: names only.
 * The studio's own detection then reads each font file's name table for the Korean names,
 * which touches every installed file, so it runs only when the list differs from what the
 * studio kept (first run, a font installed or removed). Nothing is shown or asked; a refused
 * or failed look leaves the kept list and the 찾기 button as they were.
 */

/** Module specifier the studio-pc-fonts patch imports; build-studio.mjs aliases it. */
export const PC_FONTS_MODULE = '@ieum/pc-fonts'

// The main process supplies these names from standard OS font folders only.
// No browser presence test, application scan or saved font list can add a name.
const genericFamilies = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong'])
let systemNames = new Map()
const canvasAliases = new Set()

export function setSystemFontFaces(faces) {
  systemNames = new Map()
  canvasAliases.clear()
  for (const face of faces) {
    for (const name of [face.family, face.fullName, face.postscriptName, ...(face.aliases ?? [])]) {
      if (alias(name)) systemNames.set(alias(name), name)
    }
  }
}

/** Only aliases registered after a standard-folder FontFace loaded successfully. */
export function allowCanvasFontAlias(name) { canvasAliases.add(name) }

export function allowedFontFamilies(families) {
  const allowed = families.filter(name => genericFamilies.has(alias(name))
    || systemNames.has(alias(name)) || canvasAliases.has(name))
  return allowed.length ? allowed : ['sans-serif']
}

function familyList(text) {
  const names = []
  let name = '', quote = '', escaped = false
  for (const char of text) {
    if (escaped) { name += char; escaped = false }
    else if (char === '\\') escaped = true
    else if (quote) { if (char === quote) quote = ''; else name += char }
    else if (char === '"' || char === "'") quote = char
    else if (char === ',') { if (name.trim()) names.push(name.trim()); name = '' }
    else name += char
  }
  if (name.trim()) names.push(name.trim())
  return names
}

/** Rendering only: never pass this string back to document formatting commands. */
export function systemFontFamily(text) {
  return allowedFontFamilies(familyList(text)).map(name => genericFamilies.has(alias(name))
    ? alias(name) : `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(', ')
}

const xmlDecode = text => text.replace(/&(?:quot|apos|amp|lt|gt);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
  const named = { '&quot;': '"', '&apos;': "'", '&amp;': '&', '&lt;': '<', '&gt;': '>' }
  if (named[entity]) return named[entity]
  const code = entity.startsWith('&#x') ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10)
  return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : ''
})
const xmlEncode = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/</g, '&lt;')

/** The engine emits presentation font-family attributes. Filter the rendered SVG,
 * including style declarations, without touching the document's stored font names. */
export function systemFontSvg(svg) {
  return svg.replace(/\bfont-family\s*=\s*(["'])(.*?)\1/gi,
    (_match, quote, value) => `font-family=${quote}${xmlEncode(systemFontFamily(xmlDecode(value)))}${quote}`)
    .replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi, (_match, quote, value) => {
      const style = xmlDecode(value).replace(/\bfont-family\s*:\s*([^;}]+)/gi,
        (_property, families) => `font-family:${systemFontFamily(families)}`)
      return `style=${quote}${xmlEncode(style)}${quote}`
    })
}

/** A font name the way the studio compares them (its `normalizeFontAlias`). */
const alias = (value) =>
  typeof value === 'string'
    ? value
        .replaceAll('\u0000', '')
        .normalize('NFC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('en-US')
    : ''

/** The name the studio keys one listed face by: PostScript name, else full name, else family. */
const faceKey = (face) => alias(face.postscriptName) || alias(face.fullName) || alias(face.family)

/**
 * Whether the kept records already hold exactly the faces the PC lists now: as many faces,
 * and each listed one known under some name of a record (a record merges the names the
 * enumeration gave with those read from the file). Records the studio found by trying a
 * name (a presence probe) are not part of the list and are left out.
 */
export function sameFaces(listed, kept) {
  const faces = kept.filter((record) => record.detectionSource !== 'font-presence-probe')
  const now = new Set(listed.map(faceKey).filter(Boolean))
  if (now.size !== faces.length) return false
  const known = new Set(
    faces.flatMap((record) =>
      [record.postscriptName, record.fullName, record.family, ...(record.aliases ?? [])].map(alias),
    ),
  )
  for (const key of now) if (!known.has(key)) return false
  return true
}

/** Resolves once the page is visible: the enumeration refuses a hidden page (a tab opened behind another). */
function whenVisible(doc) {
  if (!doc || doc.visibilityState === 'visible') return Promise.resolve()
  return new Promise((resolve) => {
    const onShow = () => {
      if (doc.visibilityState !== 'visible') return
      doc.removeEventListener('visibilitychange', onShow)
      resolve()
    }
    doc.addEventListener('visibilitychange', onShow)
  })
}

/**
 * @param {{
 *   queryLocalFonts?: () => Promise<ReadonlyArray<{ family?: string; fullName?: string; postscriptName?: string }>>,
 *   loadStored: () => Promise<unknown>,
 *   records: () => ReadonlyArray<{ family?: string; fullName?: string; postscriptName?: string; aliases?: readonly string[]; detectionSource?: string }>,
 *   detect: () => Promise<unknown>,
 *   changed: () => void,
 *   document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
 * }} studio
 * @returns {Promise<boolean>} whether the studio's list was detected anew
 */
export async function refreshPcFonts(studio) {
  if (!studio.queryLocalFonts) return false
  try {
    await whenVisible(studio.document)
    await studio.loadStored()
    const listed = await studio.queryLocalFonts()
    if (listed.length === 0 || sameFaces(listed, studio.records())) return false
    await studio.detect()
    studio.changed()
    return true
  } catch (error) {
    console.warn('[pc-fonts] PC font list not refreshed; the kept list stays:', error)
    return false
  }
}
