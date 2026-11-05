// Ollama on this PC as a provider the user picks by hand. It is never part of
// `auto`, and the app neither installs Ollama nor downloads a model: it only lists
// what an Ollama already running at the default address has, and runs the chosen
// model through the existing local-server path (the `custom` provider with a
// `local` endpoint), so the editor's notices for tool-less models apply.
import {
  inspectLocalModel,
  listLocalModels,
  mergeLocalModelProfile,
  upsertCustomEndpoint,
  type AiLocalInspectionResult,
  type AiLocalModelProfile,
  type AiSettings,
} from '@genoffice/ai-provider'

export const OLLAMA_ENDPOINT_ID = 'dooroo-ollama'
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1'
/** a PC can hold many models; each is inspected for tool support, so the list is capped */
const MAX_LISTED = 40

export interface OllamaModel {
  id: string
  parameterSize?: string
  sizeBytes?: number
  /** tool calling as Ollama reports it; absent when it does not say */
  tools?: boolean
}

export type OllamaListing = { running: true; models: OllamaModel[] } | { running: false }

/**
 * What Ollama says a model can do (`/api/show` capabilities), or undefined when it
 * does not say. A model without `completion` (an embedding model) cannot chat.
 */
async function capabilitiesOf(model: string): Promise<string[] | undefined> {
  try {
    const response = await fetch(new URL('/api/show', OLLAMA_BASE_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return undefined
    const body = (await response.json()) as { capabilities?: unknown }
    return Array.isArray(body.capabilities) ? body.capabilities.filter((c): c is string => typeof c === 'string') : undefined
  } catch {
    return undefined
  }
}

/** A listed model as the picker shows it, or null when it cannot chat at all. */
export function pickerModelOf(model: { id: string; parameterSize?: string | undefined; sizeBytes?: number | undefined }, capabilities: string[] | undefined): OllamaModel | null {
  if (capabilities && !capabilities.includes('completion')) return null
  return {
    id: model.id,
    ...(model.parameterSize ? { parameterSize: model.parameterSize } : {}),
    ...(model.sizeBytes !== undefined ? { sizeBytes: model.sizeBytes } : {}),
    ...(capabilities ? { tools: capabilities.includes('tools') } : {}),
  }
}

/** The chat models of the Ollama running on this PC, or `running: false` when none answers. */
export async function listOllamaModels(): Promise<OllamaListing> {
  const found = await listLocalModels({ baseUrl: OLLAMA_BASE_URL })
  if (!found.ok || found.server !== 'ollama') return { running: false }
  const models = await Promise.all(
    found.models.slice(0, MAX_LISTED).map(async (model) => pickerModelOf(model, await capabilitiesOf(model.id))),
  )
  return { running: true, models: models.filter((model): model is OllamaModel => model !== null) }
}

/**
 * What an inspection says, as a stored profile (server-reported values). The usable
 * context is only what a loaded instance runs with: Ollama serves a model with a far
 * shorter window than the one it was built with unless told otherwise, so the built
 * window is kept for display and an unknown window stays on the conservative default.
 */
export function profileOfInspection(result: AiLocalInspectionResult, now = Date.now()): AiLocalModelProfile | undefined {
  if (!result.ok) return undefined
  const p = result.profile
  const context = p.runningContextLength
  return {
    ...(context !== undefined ? { contextLength: context, contextSource: 'server' as const } : {}),
    ...(p.contextLength !== undefined && p.contextLength !== context ? { maxContextLength: p.contextLength, ...(context === undefined ? { contextSource: 'server' as const } : {}) } : {}),
    ...(p.tools !== undefined ? { tools: p.tools, toolsSource: 'server' as const } : {}),
    ...(p.vision !== undefined ? { vision: p.vision, visionSource: 'server' as const } : {}),
    checkedAt: now,
  }
}

/** `settings` with Ollama's `model` selected, its profile refreshed from `inspection`. */
export function withOllamaModel(settings: AiSettings, model: string, inspection: AiLocalInspectionResult): AiSettings {
  const existing = settings.customEndpoints?.find((entry) => entry.id === OLLAMA_ENDPOINT_ID)
  const profiles = { ...(existing?.modelProfiles ?? {}) }
  profiles[model] = mergeLocalModelProfile(profiles[model], profileOfInspection(inspection))
  const next = upsertCustomEndpoint(
    settings,
    { ...(existing ?? {}), id: OLLAMA_ENDPOINT_ID, name: 'Ollama', baseUrl: OLLAMA_BASE_URL, apiKey: '', model, kind: 'local', modelProfiles: profiles },
    true,
  )
  return { ...next, provider: 'custom' }
}

/** Whether the stored selection is this app's Ollama entry. */
export function isOllamaSelected(settings: AiSettings): boolean {
  return settings.provider === 'custom' && settings.customEndpoint === OLLAMA_ENDPOINT_ID
}

/**
 * Load `model` without generating anything, so Ollama reports the window it actually
 * runs it with. Loading a large model the first time can take a while.
 */
async function loadOllamaModel(model: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/api/generate', OLLAMA_BASE_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: '5m' }),
      signal: AbortSignal.timeout(180_000),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function selectOllamaModel(settings: AiSettings, model: string): Promise<AiSettings> {
  let inspection = await inspectLocalModel({ baseUrl: OLLAMA_BASE_URL, model, server: 'ollama' })
  // not loaded yet: its running window is unknown, and guessing either way misleads
  // (too small refuses every request, the built window overstates what Ollama uses)
  if (inspection.ok && inspection.profile.runningContextLength === undefined && (await loadOllamaModel(model))) {
    inspection = await inspectLocalModel({ baseUrl: OLLAMA_BASE_URL, model, server: 'ollama' })
  }
  return withOllamaModel(settings, model, inspection)
}
