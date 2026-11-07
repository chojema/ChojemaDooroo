/** Decorative, theme-aware icons; the surrounding button supplies its name. */
function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`
}

const documentOutline = '<path d="M14 2.5H5.5A1.5 1.5 0 0 0 4 4v16a1.5 1.5 0 0 0 1.5 1.5h12A1.5 1.5 0 0 0 19 20V7.5Z"/><path d="M14 2.5v5h5"/>'

export const DOCUMENT_ICON = icon(`${documentOutline}<path d="M7.5 12h8M7.5 15.5h8M7.5 19h4"/>`)
export const NEW_DOCUMENT_ICON = icon(`${documentOutline}<path d="M7.5 12h6M7.5 15.5h3"/><circle cx="18" cy="18" r="4.5" fill="var(--panel)"/><path d="M18 15.8v4.4M15.8 18h4.4"/>`)
export const OPEN_FOLDER_ICON = icon('<path d="M3 10V6a2 2 0 0 1 2-2h4l2.5 3H19a2 2 0 0 1 2 2v1"/><path d="M3.8 20h13.7a2 2 0 0 0 1.9-1.4L22 11H7l-3.2 9L2 12a1.6 1.6 0 0 1 1.6-2H7" fill="currentColor" fill-opacity=".08"/>')
