import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  configuredDefaultSaveDir,
  defaultSaveDirFallback,
  isUsableSaveDir,
  readDefaultSaveDirSetting,
  resolveDefaultSaveDir,
} from '../src/index'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'genoffice-save-dir-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('readDefaultSaveDirSetting', () => {
  const settingsPath = () => join(root, 'app-settings.json')

  it('returns the configured absolute path', () => {
    writeFileSync(settingsPath(), JSON.stringify({ defaultSaveDir: '/some/where' }))
    expect(readDefaultSaveDirSetting(settingsPath())).toBe('/some/where')
  })

  it('returns null when the file is missing, corrupt, or the key is absent', () => {
    expect(readDefaultSaveDirSetting(settingsPath())).toBeNull()
    writeFileSync(settingsPath(), 'not json')
    expect(readDefaultSaveDirSetting(settingsPath())).toBeNull()
    writeFileSync(settingsPath(), JSON.stringify({ language: 'en' }))
    expect(readDefaultSaveDirSetting(settingsPath())).toBeNull()
  })

  it('rejects non-string and relative values', () => {
    writeFileSync(settingsPath(), JSON.stringify({ defaultSaveDir: 42 }))
    expect(readDefaultSaveDirSetting(settingsPath())).toBeNull()
    writeFileSync(settingsPath(), JSON.stringify({ defaultSaveDir: 'relative/dir' }))
    expect(readDefaultSaveDirSetting(settingsPath())).toBeNull()
  })
})

describe('resolveDefaultSaveDir', () => {
  it('uses the configured folder when it is usable (creating it on demand)', () => {
    const configured = join(root, 'custom', 'nested')
    const resolved = resolveDefaultSaveDir(configured, join(root, 'fallback'))
    expect(resolved).toBe(configured)
    expect(existsSync(configured)).toBe(true)
  })

  it('creates and returns the fallback when nothing is configured', () => {
    const fallback = join(root, 'Documents', 'GenOffice')
    expect(resolveDefaultSaveDir(null, fallback)).toBe(fallback)
    expect(existsSync(fallback)).toBe(true)
  })

  it('degrades to the fallback when the configured folder is not writable', () => {
    const readOnly = join(root, 'read-only')
    mkdirSync(readOnly)
    chmodSync(readOnly, 0o500)
    const fallback = join(root, 'fallback')
    try {
      expect(resolveDefaultSaveDir(readOnly, fallback)).toBe(fallback)
    } finally {
      chmodSync(readOnly, 0o700)
    }
  })

  it('throws a descriptive error when the fallback itself is unusable', () => {
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'x')
    expect(() => resolveDefaultSaveDir(null, blocker)).toThrow(/default save dir not usable/)
  })
})

describe('configuredDefaultSaveDir', () => {
  it('reads the setting from userData/app-settings.json and honors it', () => {
    const userData = join(root, 'userData')
    const documents = join(root, 'Documents')
    mkdirSync(userData, { recursive: true })
    const custom = join(root, 'my-files')
    writeFileSync(join(userData, 'app-settings.json'), JSON.stringify({ defaultSaveDir: custom }))
    const app = {
      getPath: (name: 'userData' | 'documents') => (name === 'userData' ? userData : documents),
    }
    expect(configuredDefaultSaveDir(app)).toBe(custom)
  })

  it('falls back to <Documents>/<product name> without a setting', () => {
    const userData = join(root, 'userData')
    const documents = join(root, 'Documents')
    mkdirSync(userData, { recursive: true })
    const app = {
      getPath: (name: 'userData' | 'documents') => (name === 'userData' ? userData : documents),
    }
    expect(configuredDefaultSaveDir(app)).toBe(join(documents, 'IeumOffice'))
    expect(existsSync(join(documents, 'IeumOffice'))).toBe(true)
    // the upstream app's folder is its own: never created or reused here
    expect(existsSync(join(documents, 'GenOffice'))).toBe(false)
  })
})

describe('a blocked Documents folder', () => {
  const appAt = (userData: string, documents: string, home: string) => ({
    getPath: (name: 'userData' | 'documents' | 'home') =>
      name === 'userData' ? userData : name === 'documents' ? documents : home,
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('falls back to <home>/<product name> and reports the switch', () => {
    const userData = join(root, 'userData')
    const documents = join(root, 'Documents')
    const home = join(root, 'home')
    mkdirSync(userData, { recursive: true })
    mkdirSync(documents, { recursive: true })
    // a file where the folder should be: neither creatable nor writable as a folder
    writeFileSync(join(documents, 'IeumOffice'), 'x')
    expect(configuredDefaultSaveDir(appAt(userData, documents, home))).toBe(
      join(home, 'IeumOffice'),
    )
    expect(defaultSaveDirFallback()).toEqual({
      blocked: join(documents, 'IeumOffice'),
      using: join(home, 'IeumOffice'),
    })
  })

  it('skips the blocked folder for a while instead of retrying on every call, then picks it up', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const blocked = join(root, 'Documents', 'IeumOffice')
    const next = join(root, 'home', 'IeumOffice')
    mkdirSync(join(root, 'Documents'))
    writeFileSync(blocked, 'x')
    expect(resolveDefaultSaveDir(null, [blocked, next])).toBe(next)
    // the block is lifted, but the resolver does not touch the folder again yet
    rmSync(blocked)
    expect(resolveDefaultSaveDir(null, [blocked, next])).toBe(next)
    expect(existsSync(blocked)).toBe(false)
    vi.advanceTimersByTime(30_000)
    expect(resolveDefaultSaveDir(null, [blocked, next])).toBe(blocked)
    expect(existsSync(blocked)).toBe(true)
    expect(defaultSaveDirFallback()).toBeNull()
  })

  it('leaves an existing folder as it is when checking it', () => {
    const existing = join(root, 'existing')
    mkdirSync(existing)
    expect(isUsableSaveDir(existing)).toBe(true)
    expect(isUsableSaveDir(join(root, 'created', 'nested'))).toBe(true)
    expect(existsSync(join(root, 'created', 'nested'))).toBe(true)
  })
})
