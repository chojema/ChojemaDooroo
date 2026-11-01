/**
 * The File menu items the plugin puts into the embedded editor, which leaves out its own Save
 * and Print: what is registered, in which order the items stand, and what clicking one fires.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  FILE_COMMAND_EVENT,
  agentPlugin,
  type AgentPluginHost,
} from '../studio-plugin/agent-plugin.mjs'

const LABELS = {
  save: '저장',
  saveAs: '다른 이름으로 저장…',
  pdf: 'PDF로 내보내기…',
  png: 'PNG 그림으로 내보내기…',
  jpg: 'JPG 그림으로 내보내기…',
  preview: '미리 보기…',
  print: '인쇄…',
}

interface Registered {
  id: string
  label: string
  shortcutLabel?: string
  execute(services: never, params?: never): void
}

function editor(withMenu = true) {
  const commands = new Map<string, Registered>()
  // the File menu as the editor keeps it: commandIds from top to bottom
  const menu = ['file:page-setup', 'file:about']
  const host = {
    read: () => undefined,
    transaction: () => undefined,
    events: { on: () => 0 },
    automation: {
      execute: () => ({ ok: false }),
      registerCommand: (command: Registered) => {
        if (commands.has(command.id)) throw new Error(`already registered: ${command.id}`)
        commands.set(command.id, command)
      },
      addMenuItem: (spec: { menuId: string; commandId: string; position?: 'top' | 'bottom' }) => {
        if (!withMenu || spec.menuId !== 'file') throw new Error(`no menu ${spec.menuId}`)
        const at = menu.indexOf(spec.commandId)
        if (at >= 0) menu.splice(at, 1)
        if (spec.position === 'top') menu.unshift(spec.commandId)
        else menu.push(spec.commandId)
      },
    },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), commands, menu }
}

const fired: unknown[] = []
const scope = globalThis as { dispatchEvent?: (event: Event) => boolean }
const original = scope.dispatchEvent
scope.dispatchEvent = (event: Event) => {
  if (event.type === FILE_COMMAND_EVENT) fired.push((event as CustomEvent).detail)
  return true
}

afterEach(() => {
  fired.length = 0
})

describe('the File menu of the embedded editor', () => {
  it('gets Save, Save As, Export as PDF, PNG and JPG, Print Preview and Print on top, in that order', () => {
    const { plugin, commands, menu } = editor()
    expect(plugin.installFileMenu(LABELS)).toEqual({ ok: true })
    expect(menu).toEqual([
      'ext:ieum-save',
      'ext:ieum-save-as',
      'ext:ieum-export-pdf',
      'ext:ieum-export-png',
      'ext:ieum-export-jpg',
      'ext:ieum-preview',
      'ext:ieum-print',
      'file:page-setup',
      'file:about',
    ])
    expect(commands.get('ext:ieum-save')).toMatchObject({ label: '저장', shortcutLabel: 'Ctrl+S' })
    expect(commands.get('ext:ieum-save-as')).toMatchObject({ shortcutLabel: 'Ctrl+Shift+S' })
    expect(commands.get('ext:ieum-export-pdf')?.shortcutLabel).toBeUndefined()
  })

  it('hands each command to the app as an event on the editor window', () => {
    const { plugin, commands } = editor()
    plugin.installFileMenu(LABELS)
    for (const id of [
      'ext:ieum-save',
      'ext:ieum-save-as',
      'ext:ieum-export-pdf',
      'ext:ieum-export-png',
      'ext:ieum-export-jpg',
      'ext:ieum-preview',
      'ext:ieum-print',
    ]) {
      commands.get(id)?.execute(undefined as never)
    }
    expect(fired).toEqual(['save', 'saveAs', 'pdf', 'png', 'jpg', 'preview', 'print'])
  })

  it('puts the items back once when asked again, without registering twice', () => {
    const { plugin, menu } = editor()
    plugin.installFileMenu(LABELS)
    expect(plugin.installFileMenu(LABELS)).toEqual({ ok: true })
    expect(menu.filter((id) => id.startsWith('ext:'))).toHaveLength(7)
  })

  it('says so when the editor has no File menu, and refuses missing labels', () => {
    expect(editor(false).plugin.installFileMenu(LABELS)).toEqual({ ok: false })
    expect(() => editor().plugin.installFileMenu({ ...LABELS, print: '' })).toThrow(/print/)
  })
})

describe("the app's own commands in the editor's menus", () => {
  function menus() {
    const commands = new Map<string, Registered>()
    const lists: Record<string, string[]> = { file: ['file:page-setup', 'file:about'], view: ['view:zoom-in'], tool: [] }
    const host = {
      read: () => undefined,
      transaction: () => undefined,
      events: { on: () => 0 },
      automation: {
        execute: () => ({ ok: false }),
        registerCommand: (command: Registered) => {
          if (commands.has(command.id)) throw new Error(`already registered: ${command.id}`)
          commands.set(command.id, command)
        },
        addMenuItem: (spec: { menuId: string; commandId: string; position?: 'top' | 'bottom' }) => {
          const list = lists[spec.menuId]
          if (!list) throw new Error(`no menu ${spec.menuId}`)
          const at = list.indexOf(spec.commandId)
          if (at >= 0) list.splice(at, 1)
          if (spec.position === 'top') list.unshift(spec.commandId)
          else list.push(spec.commandId)
        },
        removeMenuItem: (commandId: string) => {
          for (const list of Object.values(lists)) {
            const at = list.indexOf(commandId)
            if (at >= 0) list.splice(at, 1)
          }
        },
      },
    } as unknown as AgentPluginHost
    return { plugin: agentPlugin.activate(host), commands, lists }
  }
  const ITEMS = [
    { command: 'new', label: '새 문서', menuId: 'file', position: 'top' as const, shortcut: 'Alt+N' },
    { command: 'open', label: '열기…', menuId: 'file', position: 'top' as const },
    { command: 'close', label: '문서 닫기', menuId: 'file' },
    { command: 'home', label: '홈', menuId: 'view' },
    { command: 'split', label: '나란히 보기', menuId: 'view' },
  ]

  it('puts top items on top in the given order and the rest at the bottom', () => {
    const { plugin, commands, lists } = menus()
    expect(plugin.installAppMenu(ITEMS)).toEqual({ ok: true })
    expect(lists.file).toEqual(['ext:ieum-app-new', 'ext:ieum-app-open', 'file:page-setup', 'file:about', 'ext:ieum-app-close'])
    expect(lists.view).toEqual(['view:zoom-in', 'ext:ieum-app-home', 'ext:ieum-app-split'])
    expect(commands.get('ext:ieum-app-new')).toMatchObject({ label: '새 문서', shortcutLabel: 'Alt+N' })
  })

  it("takes the place of the editor's own item it replaces", () => {
    const { plugin, lists } = menus()
    plugin.installAppMenu([{ command: 'about', label: '정보', menuId: 'tool', replaces: 'file:about' }])
    expect(lists.file).toEqual(['file:page-setup'])
    expect(lists.tool).toEqual(['ext:ieum-app-about'])
  })

  it('hands each command to the app as an event on the editor window', () => {
    const { plugin, commands } = menus()
    plugin.installAppMenu(ITEMS)
    for (const item of ITEMS) commands.get(`ext:ieum-app-${item.command}`)?.execute(undefined as never)
    expect(fired).toEqual(['new', 'open', 'close', 'home', 'split'])
  })

  it('places what it can when a menu is missing, and refuses items without a label', () => {
    const { plugin, lists } = menus()
    expect(plugin.installAppMenu([...ITEMS, { command: 'about', label: '정보', menuId: 'help' }])).toEqual({ ok: false })
    expect(lists.view).toContain('ext:ieum-app-split')
    expect(() => menus().plugin.installAppMenu([{ command: 'home', label: '', menuId: 'view' }])).toThrow(/label/)
  })
})

afterAll(() => {
  if (original === undefined) delete scope.dispatchEvent
  else scope.dispatchEvent = original
})
