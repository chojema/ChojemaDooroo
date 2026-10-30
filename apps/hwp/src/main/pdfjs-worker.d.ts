/** pdf.js ships no types for its worker module; pdf-import only hands it to pdf.js. */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
