import { contextBridge, ipcRenderer } from 'electron'
import type { StoreData } from '../shared/store'
import type { OverlayStep } from '../shared/ipc'

const api = {
  /** Frameless window: the header row's buttons drive the real window. */
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  /** An update finished downloading and is waiting for a restart. */
  onUpdateReady: (cb: (version: string) => void): (() => void) => {
    const listener = (_e: unknown, version: string): void => cb(version)
    ipcRenderer.on('update:ready', listener)
    return () => ipcRenderer.removeListener('update:ready', listener)
  },
  /** Quit and come back on the new version. */
  installUpdate: (): void => ipcRenderer.send('update:install'),
  store: {
    get: (): Promise<StoreData> => ipcRenderer.invoke('store:get'),
    set: (partial: Partial<StoreData>): Promise<StoreData> =>
      ipcRenderer.invoke('store:set', partial)
  },
  timer: {
    /** (main window) Start the random-interval nudge schedule. */
    start: (): Promise<StoreData> => ipcRenderer.invoke('timer:start'),
    /** (main window) Stop the schedule; any pending nudge is cancelled. */
    stop: (): Promise<StoreData> => ipcRenderer.invoke('timer:stop')
  },
  overlay: {
    /** (overlay window) Fetch the current pending step on mount. */
    get: (): Promise<OverlayStep | null> => ipcRenderer.invoke('overlay:get'),
    /** (overlay window) Subscribe to pending-step pushes. Returns an unsubscribe. */
    onStep: (cb: (step: OverlayStep) => void): (() => void) => {
      const listener = (_e: unknown, step: OverlayStep): void => cb(step)
      ipcRenderer.on('overlay:step', listener)
      return () => ipcRenderer.removeListener('overlay:step', listener)
    },
    /** (overlay window) User clicked Confirm after the grace period. */
    confirm: (): void => ipcRenderer.send('overlay:confirm')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('nudge', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define on window when context isolation is off)
  window.nudge = api
}

export type NudgeApi = typeof api
