import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
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
    if (fullscreenWindow && !fullscreenWindow.isDestroyed()) fullscreenWindow.destroy()
    if (cornerWindow && !cornerWindow.isDestroyed()) cornerWindow.destroy()
  })
}

app.whenReady().then(() => {
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
