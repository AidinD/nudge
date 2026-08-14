/** A single reminder text the user has configured. */
export interface Reminder {
  id: string
  text: string
}

export interface StoreData {
  reminders: Reminder[]
  minIntervalMinutes: number
  maxIntervalMinutes: number
  running: boolean
  /** true = fullscreen takeover, false = small popup in the corner of the screen. */
  fullscreenTakeover: boolean
}

export const DEFAULT_STORE: StoreData = {
  reminders: [],
  minIntervalMinutes: 30,
  maxIntervalMinutes: 60,
  running: false,
  fullscreenTakeover: true
}
