/// <reference types="vite/client" />

import type { ProjectApi } from '@genoffice/project-store'
import type { SplitPaneBridge } from '@genoffice/ui'
import type { HwpApi } from '../shared/ipc'

declare global {
  interface Window {
    hwpApi: HwpApi
    /** the shell's chat history of documents; absent where no shell registered it */
    projectApi?: Pick<ProjectApi, 'resolveChat' | 'appendChat' | 'loadChat' | 'rebindChat'>
    /** the shell's split panes; read through @genoffice/ui's split-pane-role helpers */
    aiOfficeSplit?: SplitPaneBridge
  }
}

export {}
