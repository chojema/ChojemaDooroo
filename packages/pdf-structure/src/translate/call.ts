/**
 * The model call of the translation job (spec §8): one batch in, one result
 * per block out, in order.
 *
 * Each block is sent with placeholders. A block that comes back with the
 * wrong placeholders, empty, or not at all is sent again, together with the
 * other such blocks of the batch, up to TRANSLATION_MAX_RESENDS times; after
 * that it keeps its source text and is recorded as failed with the reason.
 * Blocks that came back right are not sent again.
 *
 * When no answer of the batch could be read at all, the call throws
 * JobUnitFailure: nothing is stored, the batch stays pending, and resuming
 * the translation sends it again. Run errors (rate limit, timeout, …) from
 * `send` go to the job engine untouched; it retries or stops (spec §9).
 */
import { JobUnitFailure } from '../jobs/errors'
import type {
  TranslationBlockResult,
  TranslationJobItem,
  TranslationSourceBlock,
} from '../jobs/translate'
import { runsText } from '../tree/inline'
import { decodeTranslation, encodeRuns, type PlaceholderFailure } from './placeholders'
import { buildTranslationRequest, parseTranslationOutput, type TranslationRequest } from './prompt'

/** times a batch's wrong blocks are sent again (spec §8: up to two) */
export const TRANSLATION_MAX_RESENDS = 2

/** why a block stayed in the source language */
export type TranslationFailureReason = PlaceholderFailure | 'missing-translation'

export interface TranslationModelRequest extends TranslationRequest {
  /** target language code */
  lang: string
  /** 0 for the first send, then 1, 2 for the resends */
  attempt: number
}

/** one model call: the answer text, or a thrown run error */
export type TranslationSend = (
  request: TranslationModelRequest,
  signal: AbortSignal,
) => Promise<string>

export interface TranslationModelCallOptions {
  /** target language code */
  lang: string
  send: TranslationSend
  /** default TRANSLATION_MAX_RESENDS */
  maxResends?: number
}

/** the `callModel` of startTranslationJob */
export function createTranslationModelCall<B extends TranslationSourceBlock>(
  o: TranslationModelCallOptions,
): (batch: TranslationJobItem<B>[], signal: AbortSignal) => Promise<TranslationBlockResult[]> {
  const maxResends = o.maxResends ?? TRANSLATION_MAX_RESENDS
  if (!Number.isInteger(maxResends) || maxResends < 0) {
    throw new RangeError(`translation: invalid resend count ${maxResends}`)
  }
  return async (batch, signal) => {
    const encoded = batch.map((item) => encodeRuns(item.block.runs))
    const results: (TranslationBlockResult | undefined)[] = batch.map(() => undefined)
    const reasons: TranslationFailureReason[] = batch.map(() => 'missing-translation')
    let pending = batch.map((_, i) => i)
    let anyParsed = false
    for (let attempt = 0; attempt <= maxResends && pending.length > 0; attempt++) {
      if (signal.aborted) throw signal.reason
      const request = buildTranslationRequest(
        o.lang,
        pending.map((i) => ({ id: String(i + 1), text: encoded[i]!.text })),
      )
      const answer = await o.send({ ...request, lang: o.lang, attempt }, signal)
      const parsed = parseTranslationOutput(answer)
      if (!parsed) continue
      anyParsed = true
      pending = pending.filter((i) => {
        const text = parsed.get(String(i + 1))
        if (text === undefined) {
          reasons[i] = 'missing-translation'
          return true
        }
        const decoded = decodeTranslation(encoded[i]!, text)
        if (!decoded.ok) {
          reasons[i] = decoded.reason
          return true
        }
        results[i] = { status: 'translated', text: runsText(decoded.runs), runs: decoded.runs }
        return false
      })
    }
    if (!anyParsed) throw new JobUnitFailure('unparseable-response')
    return results.map((r, i) => r ?? { status: 'failed', reason: reasons[i]! })
  }
}
