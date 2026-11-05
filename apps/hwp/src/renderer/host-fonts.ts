import type { HwpApi } from '../shared/ipc'

/** Provides only the standard-folder catalog; font names in documents remain unchanged.
 * Buffers are copied into the studio iframe realm. */

type FontApi = Pick<HwpApi, 'hostFonts' | 'hostFontRead'>

interface StudioFonts {
  setProvider(provider: unknown): Promise<void>
}

interface StudioFrame {
  ArrayBuffer: ArrayBufferConstructor
  Uint8Array: Uint8ArrayConstructor
  rhwpStudio?: { fonts?: StudioFonts }
}

/** Whether the provider was set: false when the frame cannot take it. */
export async function installHostFonts(
  frame: Window | null | undefined,
  api: FontApi,
): Promise<boolean> {
  if (!frame || !api.hostFonts || !api.hostFontRead) return false
  const read = api.hostFontRead
  let studio: StudioFrame
  let fonts: StudioFonts | undefined
  try {
    studio = frame as unknown as StudioFrame
    fonts = studio.rhwpStudio?.fonts
  } catch {
    return false // a frame of another origin
  }
  if (!fonts || typeof fonts.setProvider !== 'function') return false
  const snapshot = await api.hostFonts().catch(() => null)
  if (!snapshot) return false
  const provider = {
    getSnapshot: async () => snapshot,
    readFace: async (id: string, revision: string) => {
      const data = await read(id, revision)
      if (!data) throw new Error('host font is no longer available')
      const bytes = new studio.ArrayBuffer(data.bytes.byteLength)
      new studio.Uint8Array(bytes).set(data.bytes)
      return { bytes, faceIndex: data.faceIndex }
    },
    // the list is read once per run: nothing to announce
    subscribe: () => () => {},
  }
  try {
    await fonts.setProvider(provider)
    return true
  } catch (error) {
    console.warn('[hwp] the editor did not take the system fonts:', error)
    return false
  }
}
