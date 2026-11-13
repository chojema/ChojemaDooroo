declare module 'turndown/lib/turndown.cjs.js' {
  import TurndownService = require('turndown')
  export = TurndownService
}
declare module 'turndown-plugin-gfm' {
  import type { Plugin } from 'turndown'
  export const gfm: Plugin
}
declare module 'word-extractor' {
  export default class WordExtractor {
    extract(buffer: Buffer): Promise<{ getBody(): string }>
  }
}
