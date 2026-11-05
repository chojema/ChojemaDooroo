import type { HostFontSnapshotInfo } from '../shared/ipc'

/**
 * Which of a document's fonts this PC does not have, for a notice when the document opens.
 *
 * A font the editor cannot find is drawn in a similar one while its name stays in the
 * document. That is right, but a page that looks different from the original with no word
 * of why is confusing. Only the main process's standard-folder catalog counts as present;
 * browser presence measurements cannot establish where an available font came from.
 */

/** CSS generic families: never missing. */
const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
])

/** A font name the way the editor compares them. */
export function fontKey(value: string): string {
  return value
    .replaceAll('\u0000', '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

/** Every name the standard-folder catalog answers to. */
export function hostFontNames(snapshot: HostFontSnapshotInfo | null | undefined): Set<string> {
  const names = new Set<string>()
  for (const face of snapshot?.faces ?? []) {
    for (const name of [face.family, face.fullName, face.postscriptName, ...face.aliases]) {
      const key = fontKey(name ?? '')
      if (key) names.add(key)
    }
  }
  return names
}

/**
 * The document's fonts drawn in a substitute on this PC, each once, in the document's order:
 * absent from the approved standard-folder catalog.
 */
export function missingFonts(
  documentFonts: readonly string[],
  hostNames: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>()
  const missing: string[] = []
  for (const raw of documentFonts) {
    const name = raw.trim()
    const key = fontKey(name)
    if (!key || seen.has(key) || GENERIC.has(key)) continue
    seen.add(key)
    if (hostNames.has(key)) continue
    missing.push(name)
  }
  return missing
}
