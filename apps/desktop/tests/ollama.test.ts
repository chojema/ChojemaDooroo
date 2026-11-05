import { describe, expect, it } from 'vitest'
import { localModelCapabilities, normalizeAiSettings, sanitizeAiSettings, selectAiProvider } from '@genoffice/ai-provider'
import { OLLAMA_BASE_URL, OLLAMA_ENDPOINT_ID, isOllamaSelected, pickerModelOf, profileOfInspection, withOllamaModel } from '../src/services/main/ollama'

const toolless = { ok: true as const, profile: { contextLength: 32768, runningContextLength: 8192, tools: false, vision: false } }

describe('Ollama as a provider', () => {
  it('is stored as a local server the user chose, with the model profile from Ollama', () => {
    const settings = withOllamaModel(normalizeAiSettings({}), 'gemma3:4b', toolless)
    expect(isOllamaSelected(settings)).toBe(true)
    expect(settings.providers.custom).toMatchObject({ model: 'gemma3:4b', baseUrl: OLLAMA_BASE_URL, apiKey: '' })
    const endpoint = settings.customEndpoints?.find((e) => e.id === OLLAMA_ENDPOINT_ID)
    expect(endpoint?.kind).toBe('local')
    // the editor's notice for a model without tools reads this
    expect(localModelCapabilities(settings)).toEqual({ contextLength: 8192, tools: false, vision: false })
  })

  it('survives sanitizing and runs without a key', () => {
    const sanitized = sanitizeAiSettings(withOllamaModel(normalizeAiSettings({}), 'qwen3:8b', { ok: true, profile: { tools: true } }))
    expect(sanitized).toBeTruthy()
    expect(isOllamaSelected(sanitized!)).toBe(true)
    expect(selectAiProvider(sanitized!, {})).toMatchObject({ connected: true, provider: 'custom' })
  })

  it('is never chosen by auto', () => {
    const settings = { ...withOllamaModel(normalizeAiSettings({}), 'qwen3:8b', { ok: true, profile: {} }), provider: 'auto' as const }
    expect(isOllamaSelected(settings)).toBe(false)
    expect(selectAiProvider(settings, {})).toMatchObject({ connected: false, reason: 'no-subscription' })
  })

  it('keeps an unreachable inspection from inventing capabilities', () => {
    expect(profileOfInspection({ ok: false, errorCode: 'unreachable' })).toBeUndefined()
    expect(profileOfInspection(toolless, 5)).toEqual({
      contextLength: 8192, contextSource: 'server', maxContextLength: 32768,
      tools: false, toolsSource: 'server', vision: false, visionSource: 'server', checkedAt: 5,
    })
  })

  it('leaves an unloaded model on the conservative context instead of its built window', () => {
    const settings = withOllamaModel(normalizeAiSettings({}), 'big:12b', { ok: true, profile: { contextLength: 1048576, tools: true } })
    expect(localModelCapabilities(settings).contextLength).toBeUndefined()
    expect(settings.customEndpoints?.[0]?.modelProfiles?.['big:12b']?.maxContextLength).toBe(1048576)
  })

  it('lists chat models only and marks the ones without tools', () => {
    expect(pickerModelOf({ id: 'embed:1b' }, ['embedding'])).toBeNull()
    expect(pickerModelOf({ id: 'small:1b' }, ['completion'])).toEqual({ id: 'small:1b', tools: false })
    expect(pickerModelOf({ id: 'qwen3:8b', parameterSize: '8.2B' }, ['completion', 'tools'])).toEqual({ id: 'qwen3:8b', parameterSize: '8.2B', tools: true })
    expect(pickerModelOf({ id: 'old:7b' }, undefined)).toEqual({ id: 'old:7b' })
  })
})
