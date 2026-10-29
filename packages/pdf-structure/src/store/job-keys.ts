/**
 * Job kinds and the second key of a job record (reading-assist spec 5.3).
 * Pure: no Node APIs, so the renderer's job session can import this file
 * directly; the store (store.ts) re-exports it.
 *
 * The record of a job is found by (kind, key): the key is the language for
 * 'translate', 'translate-page' and 'summary', the run id for 'highlight',
 * and none for 'ai-read'.
 */

/** every job kind */
export const JOB_KINDS = ['ai-read', 'translate', 'translate-page', 'highlight', 'summary'] as const
export type JobKind = (typeof JOB_KINDS)[number]

const LANG_KEYED_JOBS: readonly JobKind[] = ['translate', 'translate-page', 'summary']

/** the record field that holds a kind's second key, or null for 'ai-read' */
export function jobKeyField(kind: JobKind): 'lang' | 'runId' | null {
  if (LANG_KEYED_JOBS.includes(kind)) return 'lang'
  return kind === 'highlight' ? 'runId' : null
}

/** a job's second key: its language, its run id, or undefined for 'ai-read' */
export function jobKeyOf(job: {
  kind: JobKind
  lang?: string
  runId?: string
}): string | undefined {
  const field = jobKeyField(job.kind)
  return field === null ? undefined : job[field]
}
