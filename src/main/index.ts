import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import { readStore, writeStore } from './store'
import type { StoreData, Reminder } from '../shared/store'
import type { OverlayStep } from '../shared/ipc'

// See PomPom's main/index.ts for the original finding: Chromium throttles a
// backgrounded/occluded window's timers even with per-window
// backgroundThrottling disabled, unless these platform features are off too.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling')

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

/** The reminder currently being shown in the overlay (pull-based seed for its renderer). */
let pendingOverlayStep: OverlayStep | null = null

/** Timer handle for the next scheduled nudge; null while stopped. */
let scheduleTimer: ReturnType<typeof setTimeout> | null = null

const GRACE_SECONDS = 5

const preload = join(__dirname, '../preload/index.js')

function loadRoute(win: BrowserWindow, route: '' | 'overlay'): void {
  const hash = route ? `#/${route}` : ''
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(`${devUrl}${hash}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), route ? { hash: `/${route}` } : {})
  }
}

function pickRandomReminder(reminders: Reminder[]): Reminder | null {
  if (reminders.length === 0) return null
  return reminders[Math.floor(Math.random() * reminders.length)]
}

/** Random delay in ms, uniformly between the store's min/max minutes. */
function randomDelayMs(store: StoreData): number {
  const minMs = Math.max(0, store.minIntervalMinutes) * 60_000
  const maxMs = Math.max(minMs, store.maxIntervalMinutes * 60_000)
  return minMs + Math.random() * (maxMs - minMs)
}

/** Clear any pending scheduled nudge without touching `running` state. */
function clearSchedule(): void {
  if (scheduleTimer) {
    clearTimeout(scheduleTimer)
    scheduleTimer = null
  }
}

/** Schedule the next nudge from now, based on the current store's interval. */
function scheduleNext(): void {
  clearSchedule()
  const store = readStore()
  if (!store.running) return
  scheduleTimer = setTimeout(fireNudge, randomDelayMs(store))
}

function fireNudge(): void {
  const store = readStore()
  if (!store.running) return
  const reminder = pickRandomReminder(store.reminders)
  if (!reminder) {
    // No reminders configured; just try again later instead of stalling forever.
    scheduleNext()
    return
  }
  showOverlay({ reminderId: reminder.id, text: reminder.text, graceSeconds: GRACE_SECONDS })
}

function showOverlay(step: OverlayStep): void {
  pendingOverlayStep = step
  const win = getOverlayWindow()
  const reveal = (): void => {
    if (win.isDestroyed()) return
    win.webContents.send('overlay:step', step)
    win.show()
    win.focus()
  }
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', reveal)
  } else {
    reveal()
  }
}

function registerStoreIpc(): void {
  ipcMain.handle('store:get', () => readStore())
  ipcMain.handle('store:set', (_event, partial: Partial<StoreData>) => writeStore(partial))
}

function registerTimerIpc(): void {
  ipcMain.handle('timer:start', () => {
    writeStore({ running: true })
    scheduleNext()
    return readStore()
  })

  ipcMain.handle('timer:stop', () => {
    writeStore({ running: false })
    clearSchedule()
    return readStore()
  })
}

function registerOverlayIpc(): void {
  ipcMain.handle('overlay:get', () => pendingOverlayStep)

  // The overlay is fully locked (per DECISIONS.md): the only way out is the
  // Confirm click after the grace period, which is what fires this.
  ipcMain.on('overlay:confirm', () => {
    pendingOverlayStep = null
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
    scheduleNext()
  })
}

/** The fullscreen, always-on-top, unclosable-by-the-user overlay window. */
function getOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow
  overlayWindow = new BrowserWindow({
    show: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    closable: false,
    backgroundColor: '#0d0f13',
    title: 'Nudge',
    webPreferences: {
      preload,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  // Locked overlay: block the OS close affordances (Alt+F4 etc). Confirm is
  // the only way out, via overlay:confirm above.
  overlayWindow.on('close', (event) => {
    if (pendingOverlayStep) event.preventDefault()
  })
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
  loadRoute(overlayWindow, 'overlay')
  return overlayWindow
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 400,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d0f13',
    title: 'Nudge',
    icon,
    webPreferences: {
      preload,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  loadRoute(mainWindow, '')

  mainWindow.on('closed', () => {
    mainWindow = null
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy()
  })
}

app.whenReady().then(() => {
  registerStoreIpc()
  registerTimerIpc()
  registerOverlayIpc()
  createMainWindow()

  // Resume a running schedule across app restarts.
  if (readStore().running) scheduleNext()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  clearSchedule()
  app.quit()
})
