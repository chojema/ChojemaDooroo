/** Only these document operations can cross the main/renderer automation boundary. */
export const AUTOMATION_METHODS = [
  'readText', 'findText', 'replaceText', 'insertParagraphs',
  'listTables', 'readTable', 'fillCells', 'insertTable',
] as const
export type AutomationMethod = typeof AUTOMATION_METHODS[number]
export interface AutomationRequest { id: string; method: AutomationMethod | 'ready'; args: unknown[] }
export interface AutomationReply { id: string; ok: boolean; value?: unknown; error?: string }
export const AUTOMATION_REQUEST = 'hwp:automation-request'
export const AUTOMATION_REPLY = 'hwp:automation-reply'
