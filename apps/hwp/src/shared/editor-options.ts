/**
 * Editor options the app's single Preferences page owns. The editor keeps its own copy
 * (rhwp-studio's user settings); the shell stores the chosen values and hands them to
 * every editor, so the editor's own options dialog is not needed.
 */
export interface EditorOptions {
  /** show recently used fonts at the top of the font list */
  showRecentFonts: boolean
  /** how many recent fonts to show (1–5) */
  recentFontCount: number
  /** write a recovery copy while there are unsaved changes */
  recoveryEnabled: boolean
  /** minutes between recovery copies (1–120) */
  recoveryIntervalMinutes: number
  /** also write one when typing pauses */
  idleSaveEnabled: boolean
  /** seconds of pause before that copy (5–600) */
  idleDelaySeconds: number
  /** show the how-to guidance before saving as PDF */
  showPdfPrintGuidance: boolean
}

/** The editor's own defaults. */
export const DEFAULT_EDITOR_OPTIONS: Readonly<EditorOptions> = Object.freeze({
  showRecentFonts: true,
  recentFontCount: 3,
  recoveryEnabled: true,
  recoveryIntervalMinutes: 10,
  idleSaveEnabled: true,
  idleDelaySeconds: 10,
  showPdfPrintGuidance: true,
})

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

/** Any value made into valid options: missing or bad fields take `base`'s. */
export function normalizeEditorOptions(value: unknown, base: Readonly<EditorOptions> = DEFAULT_EDITOR_OPTIONS): EditorOptions {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    showRecentFonts: bool(v.showRecentFonts, base.showRecentFonts),
    recentFontCount: int(v.recentFontCount, base.recentFontCount, 1, 5),
    recoveryEnabled: bool(v.recoveryEnabled, base.recoveryEnabled),
    recoveryIntervalMinutes: int(v.recoveryIntervalMinutes, base.recoveryIntervalMinutes, 1, 120),
    idleSaveEnabled: bool(v.idleSaveEnabled, base.idleSaveEnabled),
    idleDelaySeconds: int(v.idleDelaySeconds, base.idleDelaySeconds, 5, 600),
    showPdfPrintGuidance: bool(v.showPdfPrintGuidance, base.showPdfPrintGuidance),
  }
}

/** What the shell can ask an open editor to show. */
export type EditorPanel = 'font-sets' | 'font-details'
