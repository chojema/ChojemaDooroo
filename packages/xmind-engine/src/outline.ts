/**
 * The map as outline text. This is the one place a map is turned into words:
 * what other readers, the search index, an AI attachment and "export as a
 * markdown outline" all get.
 *
 *     # <sheet title>
 *
 *     - <central topic>
 *       - <branch> [label one, label two] <https://example.com>
 *         > first line of the note
 *         > second line of the note
 *         - <topic below>
 *
 * Every sheet starts with its `# ` line and a blank line; sheets are separated
 * by a blank line, and the text ends with a line break. A topic is a `- ` item,
 * two spaces deeper per level. Labels follow the title in square brackets,
 * a web link in angle brackets, and the note sits right below its topic in
 * `> ` lines. A folded topic is written like an open one.
 *
 * The walk is over the source tree, not the view, so nothing the editor leaves
 * undrawn is missing. Below a topic come, in this order: its note, its
 * branches, and then the items that say what they are:
 *
 * - `(summary)`: a summary topic, with the branches below it
 * - `(callout)`: a callout
 * - `(floating)`: a floating topic
 * - `(other)`: a topic of a kind the engine does not know
 * - `(boundary)`: the title of a boundary around this topic's branches
 * - `(relationship)`: the text on a line that starts at this topic, as
 *   `text -> title of the topic it ends on`
 *
 * Titles, labels and notes are plain text. They are written so that none of
 * them can start a line of its own, and so that `outlineToSheets` reads the
 * same titles, labels, links and notes back:
 *
 * - A title or label of several lines becomes one line: the lines are trimmed
 *   and joined with a space.
 * - In a title or label, `\`, `[`, `]` and a `<` that could open a tag or a
 *   link get a backslash; so does a `,` inside a label.
 * - A topic title that starts like a list item, a heading, a quote, a code
 *   fence, a rule or one of the kind marks above gets a backslash there. A
 *   sheet title that ends in `#` gets one before that `#`.
 * - A note is written as it is, one `> ` line per line (`>` for an empty one),
 *   without the blank lines at its end. Its text is not escaped: it cannot
 *   leave its quote lines, but a program that shows the outline as rendered
 *   markdown must not let raw HTML through, as with any markdown file.
 * - Only a web link (`isWebLink`) is written. Blanks, `<` and `>` inside it are
 *   percent-encoded.
 */

import { noteText } from './notes'
import { kindMarkLength, LINE_BREAK, OUTLINE_KIND_MARKS, type OutlineKind } from './outline-marks'
import { isRecord, type XmindSheet, type XmindTopic } from './types'
import { isWebLink } from './view'

export { OUTLINE_KIND_MARKS, type OutlineKind } from './outline-marks'

export interface OutlineOptions {
  /** Write every topic's id after it, as ` {#id}`, so a tool can name the topic. */
  ids?: boolean
  /**
   * Fold the topics below this level into one `- (+N more)` line under the
   * topic they hang from. The central topic is level 0, its branches level 1.
   * Nothing is folded when left out.
   */
  foldBelowLevel?: number
  /** Fold only a sheet with more topics than this. Every sheet when left out. */
  foldAboveTopics?: number
}

/** A sheet with more topics than this is folded when an assistant reads it. */
export const OUTLINE_FOLD_ABOVE_TOPICS = 300
/** The level below which such a sheet is folded. */
export const OUTLINE_FOLD_BELOW_LEVEL = 3

/** What an assistant reads a map with: ids on every topic, large sheets folded. */
export const OUTLINE_READING_OPTIONS: Readonly<OutlineOptions> = {
  ids: true,
  foldBelowLevel: OUTLINE_FOLD_BELOW_LEVEL,
  foldAboveTopics: OUTLINE_FOLD_ABOVE_TOPICS,
}

/** The outline of every sheet, in file order. Pass a document's `sheets`. */
export function sheetsToOutline(
  sheets: readonly XmindSheet[],
  options: OutlineOptions = {},
): string {
  return sheets.map((sheet) => sheetToOutline(sheet, options)).join('\n')
}

/** The outline of one sheet. With no options: the whole sheet, no ids. */
export function sheetToOutline(sheet: XmindSheet, options: OutlineOptions = {}): string {
  const title = escapeHeading(oneLine(sheet.title))
  const lines = [title === '' ? '#' : `# ${title}`, '']
  const root = sheet.rootTopic
  const walk: Walk = {
    lines,
    ids: options.ids === true,
    foldBelow: foldLevel(root, options),
    relationships: relationshipTexts(sheet),
  }
  writeTopic(root, 0, null, walk)
  return `${lines.join('\n')}\n`
}

/** How many topics a sheet holds, of every kind, the central topic included. */
export function countSheetTopics(sheet: XmindSheet): number {
  return countTopics(sheet.rootTopic)
}

interface Walk {
  lines: string[]
  ids: boolean
  /** the last level written in full, or null when nothing is folded */
  foldBelow: number | null
  /** the `(relationship)` texts to write below a topic, by the topic's id */
  relationships: Map<string, string[]>
}

/**
 * Recursion is bounded the way the view's is: the structure check refuses
 * trees deeper than MAX_TOPIC_DEPTH, and it counts every kind of child.
 */
function writeTopic(topic: XmindTopic, level: number, kind: OutlineKind | null, walk: Walk): void {
  const indent = '  '.repeat(level)
  const below = `${indent}  `
  walk.lines.push(`${indent}-${spaced(topicText(topic, kind, walk.ids))}`)
  for (const line of noteLines(topic.notes)) walk.lines.push(`${below}>${spaced(line)}`)

  if (walk.foldBelow !== null && level >= walk.foldBelow) {
    const hidden = countTopics(topic) - 1
    if (hidden > 0) walk.lines.push(`${below}- (+${hidden} more)`)
  } else {
    for (const child of topicsBelow(topic)) writeTopic(child.topic, level + 1, child.kind, walk)
  }

  // What follows is about this topic, not a topic of its own, so folding the
  // levels below leaves it in.
  for (const boundary of records(topic.boundaries)) {
    const title = escapeTitle(oneLine(boundary.title))
    if (title !== '') walk.lines.push(`${below}- ${OUTLINE_KIND_MARKS.boundary} ${title}`)
  }
  for (const text of walk.relationships.get(topic.id) ?? []) {
    walk.lines.push(`${below}- ${OUTLINE_KIND_MARKS.relationship} ${text}`)
  }
}

function spaced(text: string): string {
  return text === '' ? '' : ` ${text}`
}

function topicText(topic: XmindTopic, kind: OutlineKind | null, ids: boolean): string {
  const parts: string[] = []
  if (kind) parts.push(OUTLINE_KIND_MARKS[kind])
  const title = escapeTitle(oneLine(topic.title))
  if (title !== '') parts.push(title)
  const labels = strings(topic.labels)
    .map((label) => escapeLabel(oneLine(label)))
    .filter((label) => label !== '')
  if (labels.length > 0) parts.push(`[${labels.join(', ')}]`)
  if (isWebLink(topic.href)) parts.push(`<${encodeLink(topic.href)}>`)
  if (ids) parts.push(idTag(topic.id))
  return parts.join(' ')
}

/** An id that is not a plain word is written as a JSON string, so it stays one token. */
function idTag(id: string): string {
  return /^[\w.:-]+$/.test(id) ? `{#${id}}` : `{#${JSON.stringify(id)}}`
}

/** The note's lines without the blank ones at its end. */
function noteLines(notes: unknown): string[] {
  const text = noteText(notes)
  if (text === null) return []
  const lines = text.split(LINE_BREAK)
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
  return lines
}

const TOPIC_KINDS = [
  ['attached', null],
  ['summary', 'summary'],
  ['callout', 'callout'],
  ['detached', 'floating'],
] as const

const KNOWN_CHILD_KINDS = new Set<string>(TOPIC_KINDS.map(([name]) => name))

interface TopicBelow {
  kind: OutlineKind | null
  topic: XmindTopic
}

/** The topics right below a topic, of every kind, in the order they are written. */
function topicsBelow(topic: XmindTopic): TopicBelow[] {
  const children = topic.children
  if (!isRecord(children)) return []
  const out: TopicBelow[] = []
  for (const [name, kind] of TOPIC_KINDS) {
    for (const child of topicList(children[name])) out.push({ kind, topic: child })
  }
  for (const [name, list] of Object.entries(children)) {
    if (KNOWN_CHILD_KINDS.has(name)) continue
    for (const child of topicList(list)) out.push({ kind: 'other', topic: child })
  }
  return out
}

/** Whatever in a list under `children` has the shape of a topic. */
function topicList(value: unknown): XmindTopic[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is XmindTopic => isRecord(item) && typeof item.id === 'string' && item.id !== '',
  )
}

/** A topic and everything below it, counted without recursion. */
function countTopics(root: XmindTopic): number {
  let count = 0
  const pending = [root]
  for (let topic = pending.pop(); topic; topic = pending.pop()) {
    count++
    for (const child of topicsBelow(topic)) pending.push(child.topic)
  }
  return count
}

function foldLevel(root: XmindTopic, options: OutlineOptions): number | null {
  const level = options.foldBelowLevel
  if (level === undefined || !Number.isInteger(level) || level < 0) return null
  const above = options.foldAboveTopics
  return above === undefined || countTopics(root) > above ? level : null
}

/**
 * The text of every relationship that has one, under the id of the topic it
 * starts at. A line whose start is not a topic of the sheet is written under
 * the central topic, so its text is not lost. A line without text says nothing
 * and is not written.
 */
function relationshipTexts(sheet: XmindSheet): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const titled = records(sheet.relationships).filter((line) => oneLine(line.title) !== '')
  if (titled.length === 0) return out

  const titles = new Map<string, string>()
  const pending = [sheet.rootTopic]
  for (let topic = pending.pop(); topic; topic = pending.pop()) {
    titles.set(topic.id, oneLine(topic.title))
    for (const child of topicsBelow(topic)) pending.push(child.topic)
  }
  for (const line of titled) {
    const { end1Id, end2Id } = line
    const from = typeof end1Id === 'string' && titles.has(end1Id) ? end1Id : sheet.rootTopic.id
    const target = typeof end2Id === 'string' ? (titles.get(end2Id) ?? '') : ''
    const text = target === '' ? oneLine(line.title) : `${oneLine(line.title)} -> ${target}`
    const list = out.get(from) ?? []
    list.push(escapeTitle(text))
    out.set(from, list)
  }
  return out
}

/**
 * Where a title or label is cut into lines: at more than markdown's own line
 * breaks, so that no reader of the outline sees a title end early.
 */
const TITLE_BREAK = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/

/** A value from the file as one line of text: anything that is not text is empty. */
function oneLine(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .split(TITLE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
}

const INLINE_SPECIAL = /\\|[[\]]|<(?=[A-Za-z/!?])/g
const LABEL_SPECIAL = /\\|[[\],]|<(?=[A-Za-z/!?])/g

function escapeInline(text: string): string {
  return text.replace(INLINE_SPECIAL, '\\$&')
}

function escapeLabel(text: string): string {
  return text.replace(LABEL_SPECIAL, '\\$&')
}

/** What a list item must not start with, each with the place its backslash goes. */
const BULLET_START = /^[-+*](?=[ \t]|$)/
const ORDERED_START = /^(\d{1,9})(?=[.)](?:[ \t]|$))/
const BLOCK_START = /^(?:#{1,6}(?=[ \t]|$)|>|`{3}|~{3})/
const RULE = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/

/**
 * A topic title as the text of a list item. The reader tests for a rule on the
 * whole line, item marker included, so `--` is escaped as well as `---`.
 */
function escapeTitle(title: string): string {
  const text = escapeInline(title)
  const ordered = ORDERED_START.exec(text)
  if (ordered) return `${ordered[1]}\\${text.slice(ordered[1]!.length)}`
  const startsSomething =
    BULLET_START.test(text) ||
    BLOCK_START.test(text) ||
    RULE.test(`- ${text}`) ||
    RULE.test(text) ||
    kindMarkLength(text) > 0
  return startsSomething ? `\\${text}` : text
}

/** A sheet title as the text of a heading: a `#` run at its end would close the heading. */
function escapeHeading(title: string): string {
  const text = escapeInline(title)
  let start = text.length
  while (start > 0 && text[start - 1] === '#') start--
  if (start === text.length) return text
  const closes = start === 0 || text[start - 1] === ' ' || text[start - 1] === '\t'
  return closes ? `${text.slice(0, start)}\\${text.slice(start)}` : text
}

/** A link as it sits between angle brackets: nothing in it may end the line or the brackets. */
function encodeLink(href: string): string {
  return href.replace(/[\s<>]/g, (char) => encodeURIComponent(char))
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}
