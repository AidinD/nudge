import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
// electron-updater is CommonJS; a named ESM import ("import { autoUpdater }")
// fails at runtime in the packaged app. Import the default export and
// destructure - the pattern electron-vite documents for CJS deps, and the one
// Jot and Nib use.
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater
// The multi-size .ico rather than the single PNG, so Windows can pick the
// frame for the current DPI scale instead of shrinking one bitmap - see
// scripts/generate-icon.mjs.
import icon from '../../resources/icon.ico?asset'
import { readStore, writeStore } from './store'
import type { StoreData, Reminder } from '../shared/store'
import type { OverlayStep } from '../shared/ipc'

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling')

let mainWindow: BrowserWindow | null = null
let fullscreenWindow: BrowserWindow | null = null
let cornerWindow: BrowserWindow | null = null

let pendingOverlayStep: OverlayStep | null = null
let activeOverlayMode: 'fullscreen' | 'corner' | null = null
let scheduleTimer: ReturnType<typeof setTimeout> | null = null

const GRACE_SECONDS = 5
const CORNER_WIDTH = 360
const CORNER_HEIGHT = 160
const CORNER_MARGIN = 16

const preload = join(__dirname, '../preload/index.js')

function loadRoute(win: BrowserWindow, route: '' | 'overlay'): void {
  const hash = route ? '#/' + route : ''
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl + hash)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), route ? { hash: '/' + route } : {})
  }
}

function pickRandomReminder(reminders: Reminder[]): Reminder | null {
  if (reminders.length === 0) return null
  return reminders[Math.floor(Math.random() * reminders.length)]
}

function randomDelayMs(store: StoreData): number {
  const minMs = Math.max(0, store.minIntervalMinutes) * 60000
  const maxMs = Math.max(minMs, store.maxIntervalMinutes * 60000)
  return minMs + Math.random() * (maxMs - minMs)
}

function clearSchedule(): void {
  if (scheduleTimer) {
    clearTimeout(scheduleTimer)
    scheduleTimer = null
  }
}

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
    scheduleNext()
    return
  }
  showOverlay({
    reminderId: reminder.id,
    text: reminder.text,
    graceSeconds: GRACE_SECONDS,
    mode: store.fullscreenTakeover ? 'fullscreen' : 'corner'
  })
}

function showOverlay(step: OverlayStep): void {
  pendingOverlayStep = step
  activeOverlayMode = step.mode
  const win = step.mode === 'corner' ? getCornerWindow() : getFullscreenWindow()
  const reveal = (): void => {
    if (win.isDestroyed()) return
    win.webContents.send('overlay:step', step)
    if (step.mode === 'corner') {
      positionCornerWindow(win)
      win.showInactive()
    } else {
      win.show()
      win.focus()
    }
  }
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', reveal)
  } else {
    reveal()
  }
}

/**
 * Check GitHub for a newer release, once, at startup - the same arrangement as
 * Jot and Nib.
 *
 * Nudge is unsigned, which does not stop electron-updater on Windows: the first
 * install triggers SmartScreen, updates after that are silent. The download
 * installs on quit rather than mid-session, which is the library's default and
 * the right one for an app that sits in the background all day; the settings
 * window gets a toast offering to restart now.
 *
 * Never in development: there is no packaged app to replace, and the check only
 * produces a confusing error in the log.
 */
function initAutoUpdater(): void {
  if (!app.isPackaged) return

  autoUpdater.on('update-available', (info) => {
    console.log(`Nudge update available: ${info.version}`)
  })
  autoUpdater.on('update-not-available', (info) => {
    console.log(`Nudge is up to date (${info.version})`)
  })
  autoUpdater.on('error', (error) => {
    // Being offline is the common case here, and it is not worth a dialog.
    console.error('Nudge update check failed', error)
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`Nudge update ${info.version} downloaded; it installs on quit`)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('update:ready', info.version)
    }
  })

  void autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error('Nudge update check could not start', error)
  })
}

/**
 * Window controls, because the settings window is frameless (like Jot and Nib)
 * and its header row is the title bar. Minimise + close only: this is a narrow
 * settings panel, so a maximise button would be a button for nothing.
 */
function registerWindowIpc(): void {
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  // "Restart to update" in the toast: quit now and come back on the new version.
  ipcMain.on('update:install', () => {
    autoUpdater.quitAndInstall()
  })
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

  ipcMain.on('overlay:confirm', () => {
    pendingOverlayStep = null
    const win = activeOverlayMode === 'corner' ? cornerWindow : fullscreenWindow
    activeOverlayMode = null
    if (win && !win.isDestroyed()) win.close()
    scheduleNext()
  })
}

function positionCornerWindow(win: BrowserWindow): void {
  const display = screen.getPrimaryDisplay()
  const workArea = display.workArea
  win.setBounds({
    x: workArea.x + workArea.width - CORNER_WIDTH - CORNER_MARGIN,
    y: workArea.y + workArea.height - CORNER_HEIGHT - CORNER_MARGIN,
    width: CORNER_WIDTH,
    height: CORNER_HEIGHT
  })
}

function guardClose(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (pendingOverlayStep) event.preventDefault()
  })
}

function getFullscreenWindow(): BrowserWindow {
  if (fullscreenWindow && !fullscreenWindow.isDestroyed()) return fullscreenWindow
  fullscreenWindow = new BrowserWindow({
    show: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    backgroundColor: '#1b1c1f',
    title: 'Nudge',
    webPreferences: {
      preload,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  fullscreenWindow.setAlwaysOnTop(true, 'screen-saver')
  guardClose(fullscreenWindow)
  fullscreenWindow.on('closed', () => {
    fullscreenWindow = null
  })
  loadRoute(fullscreenWindow, 'overlay')
  return fullscreenWindow
}

function getCornerWindow(): BrowserWindow {
  if (cornerWindow && !cornerWindow.isDestroyed()) return cornerWindow
  cornerWindow = new BrowserWindow({
    width: CORNER_WIDTH,
    height: CORNER_HEIGHT,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    resizable: false,
    movable: false,
    backgroundColor: '#1b1c1f',
    title: 'Nudge',
    webPreferences: {
      preload,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  cornerWindow.setAlwaysOnTop(true, 'screen-saver')
  guardClose(cornerWindow)
  cornerWindow.on('closed', () => {
    cornerWindow = null
  })
  loadRoute(cornerWindow, 'overlay')
  return cornerWindow
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 400,
    minHeight: 480,
    show: false,
    // Frameless, like Jot and Nib: the app header row IS the title bar (drag
    // handle plus window buttons), so the window is not topped by a second,
    // OS-drawn one saying the same thing.
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#1b1c1f',
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
    if (fullscreenWindow && !fullscreenWindow.isDestroyed()) fullscreenWindow.destroy()
    if (cornerWindow && !cornerWindow.isDestroyed()) cornerWindow.destroy()
  })
}

app.whenReady().then(() => {
  initAutoUpdater()
  registerWindowIpc()
  registerStoreIpc()
  registerTimerIpc()
  registerOverlayIpc()
  createMainWindow()

  if (readStore().running) scheduleNext()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  clearSchedule()
  app.quit()
})
