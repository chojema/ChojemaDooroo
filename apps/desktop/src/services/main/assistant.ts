/** Shared document-assistant IPC extracted from IeumOffice/GenOffice.
 * Chojema Docs modification: no Word editor or document-open/save host.
 * Original copyrights and license: see NOTICE and LICENSE. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, shell, webContents } from 'electron'
import { abortOnDestroyed, fetchRemoteImage, safeExternalUrl, MAX_REMOTE_IMAGE_BYTES, readBodyCapped, writeJsonAtomic } from '@genoffice/electron-utils'
import { getUiLang } from '@genoffice/i18n'
import { ProjectStore } from '@genoffice/project-store'
import { aiChatGptSignInPages, aiSubscriptionLoginWindowText } from '@genoffice/ui/ai-subscription-login-window'
import { AI_MEDIA_PROVIDERS, AI_SEARCH_PROVIDERS, activeCustomEndpoint, inspectLocalModelForIpc, isAiOverloadedError, chatForProvider, listLocalModelsForIpc, localEndpointTimeoutMs, normalizeAiSettings, testLocalModelForIpc, cancelLocalTestForIpc, testMediaProvider, type AiMediaProviderConfig, type AiMediaProviderId, type AiSearchProviderId, maxOutputTokensOf, sanitizeAiSettings, sanitizeCliPath, setCodexImageGenerationAvailable, streamForProvider, type AiChatRequest, type AiSettings, type AiStreamChunk, type AiStreamRequest, type AiSubscriptionProviderId, sealAiSecrets } from '@genoffice/ai-provider'
import { listCodexModels, shutdownCodexAppServers } from '@genoffice/ai-provider/codex-app-server'
import { listCustomModelsForIpc } from '@genoffice/ai-provider/custom-models'
import { ensureSubscriptionIpc, sharedSubscriptionStatuses } from '@genoffice/ai-provider/subscription'
import { abortMediaCalls, aiToolCapabilities, createCodexImageCliGenerator, registerCodexImageGenerator, testSearchProvider, webSearchTool, imageSearchTool, readUrlTool, withMediaCallSignal, type AiToolCallContext, type AiToolCapabilities } from '@genoffice/ai-search'
import { aiChatFailure, aiStreamErrorChunk, resolveAiRun, subscriptionStreamCallbacks, withMeteredAccepted, type AiRunTexts } from './ai-run'
import { createChunkCoalescer } from './stream-coalesce'
import { startFirstChunkKeepalive } from './ai-keepalive'
import { registerFreeAiIpc } from './free-ai-ipc'
import { normalizeReadUrlRequest, unexpectedReadUrlFailure } from './read-url-ipc'
import type { WebContents, BrowserWindow } from 'electron'
import { documentMediaRoots } from '@genoffice/ai-search'

let hostResolver: (wc: WebContents) => BrowserWindow | undefined = () => undefined
let pathResolver: (wcId: number) => string | null = () => null
export function configureAssistant(host: typeof hostResolver, path: typeof pathResolver) { hostResolver = host; pathResolver = path }
function hostWindowFor(wc: WebContents | null | undefined) { return wc ? hostResolver(wc) : undefined }
function docsMediaRoots(wcId: number) { return documentMediaRoots(pathResolver(wcId), join(app.getPath('temp'), 'genoffice-pasted')) }
function tm(key: string, params?: Record<string, unknown>): string {
 const strings: Record<string, string> = { errNoApiKey: '제공업체 연결이 필요합니다.', errNoModel: '모델을 선택해 주세요.', errAiBusy: '요청이 많습니다. 잠시 후 다시 시도해 주세요.', errNoFile: '파일을 찾을 수 없습니다.' }
 return strings[key] ?? key
}

function userDataPath(...parts: string[]): string {
  return join(app.getPath('userData'), ...parts)
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    /* corrupted state file: fall back to defaults */
  }
  return fallback
}

const SETTINGS_PATH = () => userDataPath('ai-settings.json')

const activeAiStreams = new Map<string, AbortController>()

function broadcastAiSettingsChanged(): void {
  for (const wc of webContents.getAllWebContents())
    if (!wc.isDestroyed()) wc.send('ai:settings-changed')
}

function storedAiSettings(): AiSettings {
  return normalizeAiSettings(readJson<unknown>(SETTINGS_PATH(), {}))
}

/** Settings-screen adapter. Stored keys never cross into the host renderer. */
export function assistantSetup() {
  const settings = storedAiSettings()
  const config = settings.provider === 'auto' ? undefined : settings.providers[settings.provider]
  return { provider: settings.provider, model: config?.model ?? '', baseUrl: config?.baseUrl ?? '', hasKey: !!config?.apiKey }
}

export function saveAssistantSetup(raw: unknown) {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const providers = ['auto', 'codex', 'claude-code', 'chatgpt', 'openai'] as const
  const provider = providers.find((p) => p === input.provider)
  if (!provider) throw new Error('제공업체를 선택해 주세요.')
  const settings = storedAiSettings()
  settings.provider = provider
  if (provider !== 'auto') {
    const current = settings.providers[provider]
    settings.providers[provider] = {
      ...current,
      model: typeof input.model === 'string' && input.model.trim() ? input.model.trim() : current.model,
      ...(provider === 'openai' ? {
        apiKey: typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : current.apiKey,
        baseUrl: typeof input.baseUrl === 'string' && input.baseUrl.trim() ? input.baseUrl.trim() : current.baseUrl,
      } : {}),
    }
  }
  const sanitized = sanitizeAiSettings(settings)
  if (!sanitized) throw new Error('설정값을 확인해 주세요.')
  writeJsonAtomic(SETTINGS_PATH(), sealAiSecrets(sanitized))
  broadcastAiSettingsChanged()
  return assistantSetup()
}

function screenToolContext(): AiToolCallContext {
  return { path: 'screen', statuses: sharedSubscriptionStatuses() }
}

const AI_RUN_TEXTS: AiRunTexts = {
  noApiKey: (provider) => tm('errNoApiKey', { provider }),
  noModel: () => tm('errNoModel'),
}

let codexImageRegistered = false

function registerCodexImageBackend(): void {
  if (codexImageRegistered) return
  codexImageRegistered = true
  registerCodexImageGenerator(
    createCodexImageCliGenerator({
      settingsPath: SETTINGS_PATH,
      tempRoot: () => app.getPath('temp'),
    }),
  )
  setCodexImageGenerationAvailable(true)
}

export function registerAiIpc(): void {
  registerCodexImageBackend()
  app.once('before-quit', shutdownCodexAppServers)
  // the subscription channels (statuses, recheck, login, install, metered) exist once per
  // process: whichever editor main asks first registers them and starts the first check
  ensureSubscriptionIpc(ipcMain, {
    getSettings: storedAiSettings,
    setMeteredAccepted: (provider: AiSubscriptionProviderId, accepted: boolean) => {
      writeJsonAtomic(
        SETTINGS_PATH(),
        withMeteredAccepted(readJson<unknown>(SETTINGS_PATH(), {}), provider, accepted),
      )
      broadcastAiSettingsChanged()
    },
    dataDir: app.getPath('userData'),
    broadcast: (channel, statuses) => {
      for (const wc of webContents.getAllWebContents())
        if (!wc.isDestroyed()) wc.send(channel, statuses)
    },
    loginWindowText: (provider) => aiSubscriptionLoginWindowText(getUiLang(), provider),
    // the ChatGPT sign-in is the app's own (decision 0081): OpenAI's page in the system browser
    chatGptSignIn: {
      openBrowser: async (url) => {
        const target = safeExternalUrl(url)
        if (!target) return false
        return shell.openExternal(target).then(
          () => true,
          () => false,
        )
      },
      pages: () => aiChatGptSignInPages(getUiLang()),
    },
  })

  ipcMain.handle('ai:get-settings', async (): Promise<AiSettings> => storedAiSettings())

  // what the search and media tools can do right now, for the renderers that gate
  // generate_image / analyze_media on it (docs, pdf, markdown, html)
  ipcMain.handle('ai:tool-capabilities', (): AiToolCapabilities =>
    aiToolCapabilities(storedAiSettings(), screenToolContext()),
  )

  ipcMain.handle('ai:set-settings', (_event, settings: AiSettings) => {
    // SECURITY.md: payloads are schema-checked in the main process. The settings
    // file feeds cliPath into spawn() and baseUrl receives the provider's API key,
    // so the renderer's copy is sanitized before it touches disk.
    const sanitized = sanitizeAiSettings(settings)
    if (!sanitized) {
      console.warn('[ai] rejected invalid ai:set-settings payload')
      return
    }
    writeJsonAtomic(SETTINGS_PATH(), sealAiSecrets(sanitized))
    broadcastAiSettingsChanged()
  })

  registerFreeAiIpc({
    readSettings: storedAiSettings,
    writeSettings: (settings) => {
      const sanitized = sanitizeAiSettings(settings)
      if (!sanitized) return false
      writeJsonAtomic(SETTINGS_PATH(), sealAiSecrets(sanitized))
      broadcastAiSettingsChanged()
      return true
    },
    windowFor: hostWindowFor,
  })

  ipcMain.handle('ai:codex-models', async (_event, cliPath: unknown) => {
    // the probe spawns the path directly, so it gets the same metacharacter and
    // existence check as the stored setting (anything else: auto-detect)
    return listCodexModels(sanitizeCliPath(cliPath))
  })

  ipcMain.handle('ai:custom-models', (_event, input: unknown) => listCustomModelsForIpc(input))

  // local AI card: discovery, one model's server-reported profile, and the
  // four-step connection test. Payload validation lives in @genoffice/ai-provider
  // (local-ipc.ts), so a malformed payload answers shape and sends nothing.
  ipcMain.handle('ai:local-models', (_event, input: unknown) => listLocalModelsForIpc(input))
  ipcMain.handle('ai:local-inspect', (_event, input: unknown) => inspectLocalModelForIpc(input))
  ipcMain.handle('ai:local-test', async (event, input: unknown) => {
    // the requests end here, not only in the renderer: on a cancel by test id
    // (from the same window) and when the window that asked is closed
    const controller = new AbortController()
    const unwatchSender = abortOnDestroyed(event.sender, controller)
    try {
      return await testLocalModelForIpc(input, {
        owner: event.sender.id,
        signal: controller.signal,
      })
    } finally {
      unwatchSender()
    }
  })
  ipcMain.handle('ai:local-test-cancel', (event, input: unknown) =>
    cancelLocalTestForIpc(input, event.sender.id),
  )

  ipcMain.handle('ai:stream', async (event, request: AiStreamRequest) => {
    // per-request settings get the same schema check as the persisted ones: a
    // compromised renderer could otherwise hand cliPath/baseUrl straight to
    // the provider layer without ever touching the settings file
    const { requestId, system, messages } = request
    const send = (chunk: AiStreamChunk) => {
      if (!event.sender.isDestroyed()) event.sender.send('ai:stream-chunk', chunk)
    }
    // the selection decides, and nothing stands in for a provider that cannot run:
    // the refusal names its cause so the renderer shows how to connect instead
    const target = resolveAiRun(request.settings, sharedSubscriptionStatuses(), AI_RUN_TEXTS)
    if (!target.ok) {
      send({ requestId, type: 'error', ...target.refusal })
      return
    }
    const { settings, provider, config } = target
    const tools = request.tools ?? []
    const maxTokens = request.maxTokens ?? maxOutputTokensOf(settings)
    // A local server loads the model on its first request, so this endpoint's
    // own first-response limit (default 300s) replaces the protocol default,
    // and a timer keeps the renderer informed while nothing has arrived yet.
    // Other providers get neither: their watchdog and silence budget stay as
    // they were.
    const localEndpoint = provider === 'custom' ? activeCustomEndpoint(settings) : undefined
    const localTimeoutMs =
      localEndpoint?.kind === 'local' ? localEndpointTimeoutMs(localEndpoint) : undefined
    const controller = new AbortController()
    activeAiStreams.set(requestId, controller)
    const unwatchSender = abortOnDestroyed(event.sender, controller)
    // deltas go out in short batches, everything else in order behind them
    const out = createChunkCoalescer<AiStreamChunk>(send)
    // wire-activity keepalive: lets the renderer's silence watchdog tell a slow turn from a dead one
    let lastPing = 0
    const ping = () => {
      const now = Date.now()
      if (now - lastPing < 5_000) return
      lastPing = now
      out.push({ requestId, type: 'ping' })
    }
    const keepalive = localTimeoutMs === undefined ? undefined : startFirstChunkKeepalive(ping)
    let answerSeen = false
    const answerStarted = () => {
      if (answerSeen) return
      answerSeen = true
      keepalive?.firstChunk()
    }
    try {
      let stopReason: string | undefined
      await streamForProvider(
        provider,
        config,
        system,
        messages,
        tools,
        maxTokens,
        {
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          signal: controller.signal,
          onDelta: (text) => {
            answerStarted()
            out.push({ requestId, type: 'delta', text })
          },
          onReasoningDelta: (text) => {
            answerStarted()
            out.push({ requestId, type: 'reasoning', text })
          },
          onToolCall: (toolCall) => {
            answerStarted()
            out.push({ requestId, type: 'tool-call', toolCall })
          },
          onActivity: () => {
            // Headers are not an answer: a local server may send them while it is
            // still loading the model. Keep pinging until the first real chunk.
            if (!answerSeen) ping()
          },
          onStopReason: (reason) => {
            stopReason = reason
          },
          onUsage: (usage) => out.push({ requestId, type: 'usage', usage }),
          ...subscriptionStreamCallbacks(requestId, out.push),
        },
        localTimeoutMs === undefined ? undefined : { timeoutMs: localTimeoutMs },
      )
      out.push({ requestId, type: 'done', stopReason })
    } catch (err) {
      if (controller.signal.aborted) {
        out.push({ requestId, type: 'done' })
      } else {
        out.push(aiStreamErrorChunk(requestId, err))
      }
    } finally {
      // success, error and cancel all leave through here: the timer never survives the turn
      keepalive?.stop()
      out.flush()
      unwatchSender()
      activeAiStreams.delete(requestId)
    }
  })

  ipcMain.handle('ai:stream-cancel', (event, requestId: string, scope?: unknown) => {
    activeAiStreams.get(requestId)?.abort()
    // a call that runs no tool (a PDF document job) ends only its own stream
    if (scope === 'request') return
    // Stop while a tool runs names a turn that already ended: end the tab's media calls too
    // (whichever editor main started them; this handler answers every editor in the suite)
    abortMediaCalls(event.sender.id)
  })

  // shared search tools (content + images): Serper with DuckDuckGo fallback (same source as slides/sheets)
  ipcMain.handle('ai:web-search', async (_event, query: string, maxResults?: number) => {
    try {
      return await webSearchTool(
        SETTINGS_PATH(),
        String(query),
        typeof maxResults === 'number' ? maxResults : 6,
      )
    } catch (err) {
      return { results: [], method: 'error', error: String(err) }
    }
  })
  ipcMain.handle('ai:image-search', async (_event, query: string, maxResults?: number) => {
    try {
      return await imageSearchTool(
        SETTINGS_PATH(),
        String(query),
        typeof maxResults === 'number' ? maxResults : 8,
      )
    } catch (err) {
      return { images: [], method: 'error', error: String(err) }
    }
  })

  // reads one web page as text for the model (article, document, a skill's SKILL.md);
  // the settings file is only opened for its GitHub read token. The read counts as a
  // media call, so Stop (ai:stream-cancel → abortMediaCalls) or a closed tab cuts the download.
  ipcMain.handle('ai:read-url', async (event, url: unknown, offset?: unknown) => {
    const request = normalizeReadUrlRequest(url, offset)
    if (!request.ok) return request
    try {
      return await withMediaCallSignal(event.sender, (signal) =>
        readUrlTool(SETTINGS_PATH(), request.url, request.offset, { signal }),
      )
    } catch {
      return unexpectedReadUrlFailure()
    }
  })

  // download image from URL → base64+mime (download in the main process avoids CORS; the renderer builds the image node and measures size itself)
  ipcMain.handle(
    'ai:fetch-image',
    async (_event, url: string): Promise<{ base64: string; mime: string } | null> => {
      try {
        // the URL originates from AI tool calls (prompt-injectable via web search
        // results), so refuse non-http schemes and private/link-local targets;
        // redirects are followed manually so every hop is validated too.
        // fetchRemoteImage adds CDN-friendly headers and transient-error retries.
        const resp = await fetchRemoteImage(String(url))
        if (!resp || !resp.ok) return null
        const buf = Buffer.from(await readBodyCapped(resp, MAX_REMOTE_IMAGE_BYTES))
        const ct = resp.headers.get('content-type') ?? ''
        const mime = ct.includes('png')
          ? 'image/png'
          : ct.includes('gif')
            ? 'image/gif'
            : 'image/jpeg'
        return { base64: buf.toString('base64'), mime }
      } catch {
        return null
      }
    },
  )

  ipcMain.handle('ai:search-test', (_event, input: unknown) => {
    const { provider, apiKey } = (input ?? {}) as { provider?: AiSearchProviderId; apiKey?: string }
    if (!provider || !AI_SEARCH_PROVIDERS.some((meta) => meta.id === provider)) {
      return { ok: false, error: 'No search provider to test' }
    }
    return testSearchProvider(provider, String(apiKey ?? ''))
  })

  // settings-UI connection test for a key media provider
  ipcMain.handle('ai:media-test', (_event, input: unknown) => {
    const { provider, config } = (input ?? {}) as {
      provider?: AiMediaProviderId
      config?: AiMediaProviderConfig
    }
    if (!provider || !AI_MEDIA_PROVIDERS.some((meta) => meta.id === provider)) {
      return { ok: false, error: 'No media provider to test' }
    }
    if (!config) return { ok: false, error: 'No media provider configuration' }
    return testMediaProvider(provider, config)
  })

  ipcMain.handle('ai:chat', async (_event, request: AiChatRequest) => {
    // same schema check and provider choice as ai:stream: one-shot requests would
    // otherwise act on the renderer's settings copy verbatim
    const target = resolveAiRun(request.settings, sharedSubscriptionStatuses(), AI_RUN_TEXTS)
    if (!target.ok) return { ok: false, ...target.refusal }
    const { system, user } = request
    try {
      const result = await chatForProvider(target.provider, target.config, system, user)
      // the one-shot path reports HTTP failures as ok:false with the raw body —
      // replace capacity/rate-limit dumps with the localized "busy" message
      if (!result.ok && isAiOverloadedError(result.error)) {
        return { ok: false, error: tm('errAiBusy') }
      }
      return result
    } catch (err) {
      return aiChatFailure(err, () => tm('errAiBusy'))
    }
  })
}

let projectStore: ProjectStore | null = null

let projectIpcRegistered = false

function getProjectStore(): ProjectStore {
  if (!projectStore) projectStore = new ProjectStore(app.getPath('userData'))
  return projectStore
}

let sessionPathResolver: ((senderId: number, sessionId: string) => string | null) | null = null

export function registerProjectIpc(): void {
  if (projectIpcRegistered) return
  projectIpcRegistered = true

  /** Resolve projectId + chatId from a file path (sheets without a path resolves via sessionId) */
  ipcMain.handle(
    'project:resolveChat',
    (event, args: { filePath: string | null; tempChatId?: string; sessionId?: string }) => {
      const store = getProjectStore()
      store.ensureDefaultProject()
      let resolvedPath = args.filePath
      if (!resolvedPath && args.sessionId && sessionPathResolver) {
        resolvedPath = sessionPathResolver(event.sender.id, args.sessionId)
      }
      if (!resolvedPath) {
        return {
          projectId: 'default',
          chatId: args.tempChatId ?? `unsaved-${Date.now()}`,
        }
      }
      return store.resolveChatForFile(resolvedPath)
    },
  )

  /** Append a message */
  ipcMain.handle(
    'project:appendChat',
    (
      _event,
      args: {
        projectId: string
        chatId: string
        role: 'user' | 'assistant'
        text: string
        tools?: Array<{
          name: string
          summary: string
          isError?: boolean
          input?: string
          output?: string
        }>
        attachments?: Array<{ name: string; path?: string; ext?: string; sizeBytes?: number }>
        scope?: { label: string; text?: string }
        /** skill chips of a user message; the store bounds and filters them */
        skills?: unknown
      },
    ) => {
      if (args.role !== 'user' && args.role !== 'assistant') {
        throw new Error(`Invalid chat role: ${String(args.role)}`)
      }
      if (typeof args.text !== 'string' || args.text.length > 200_000) {
        throw new Error('Invalid chat text: must be a string up to 200000 chars')
      }
      if (args.tools && !Array.isArray(args.tools)) throw new Error('Invalid chat tools')
      if (args.attachments && !Array.isArray(args.attachments)) {
        throw new Error('Invalid chat attachments')
      }
      const store = getProjectStore()
      const msg: Parameters<ProjectStore['appendChatMessage']>[2] = {
        role: args.role,
        text: args.text,
      }
      if (args.tools) msg.tools = args.tools
      if (args.attachments) msg.attachments = args.attachments
      if (args.scope) msg.scope = args.scope
      if (Array.isArray(args.skills)) msg.skills = args.skills as NonNullable<typeof msg.skills>

      store.appendChatMessage(args.projectId, args.chatId, msg)
    },
  )

  /** Read history */
  ipcMain.handle(
    'project:loadChat',
    (
      _event,
      args: {
        projectId: string
        chatId: string
        limit?: number
      },
    ) => {
      const store = getProjectStore()
      return store.loadChat(args.projectId, args.chatId, args.limit ?? 200)
    },
  )

  /** rebind chat (called after a file first hits disk): newFilePath/sessionId take priority; the main process computes chatId and records fileMap */
  ipcMain.handle(
    'project:rebindChat',
    (
      event,
      args: {
        projectId: string
        tempChatId: string
        newChatId?: string
        newFilePath?: string
        sessionId?: string
      },
    ) => {
      const store = getProjectStore()
      let path = args.newFilePath ?? null
      if (!path && args.sessionId && sessionPathResolver) {
        path = sessionPathResolver(event.sender.id, args.sessionId)
      }
      if (path) {
        return store.rebindChatToFile(args.projectId, args.tempChatId, path)
      }
      if (args.newChatId) store.rebindChat(args.projectId, args.tempChatId, args.newChatId)
      return { projectId: args.projectId, chatId: args.newChatId ?? args.tempChatId }
    },
  )
}
