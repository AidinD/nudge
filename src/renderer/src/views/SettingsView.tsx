import { useEffect, useState } from 'react'
import type { Reminder, StoreData } from '../../../shared/store'
import { NudgeMark } from '../NudgeMark'

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function SettingsView(): JSX.Element {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [newText, setNewText] = useState('')
  const [minMinutes, setMinMinutes] = useState(30)
  const [maxMinutes, setMaxMinutes] = useState(60)
  // Free-text drafts for the interval fields, so the user can clear the
  // field and type a new value instead of it snapping back on every
  // keystroke. Committed (clamped + persisted) on blur.
  const [minDraft, setMinDraft] = useState('30')
  const [maxDraft, setMaxDraft] = useState('60')
  const [running, setRunning] = useState(false)
  const [fullscreenTakeover, setFullscreenTakeover] = useState(true)
  const [loaded, setLoaded] = useState(false)
  // Set once electron-updater has a new version on disk; the toast is the only
  // thing that tells the user, since the install itself waits for a quit.
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)

  useEffect(() => {
    window.nudge.store.get().then((store) => {
      setReminders(store.reminders)
      setMinMinutes(store.minIntervalMinutes)
      setMaxMinutes(store.maxIntervalMinutes)
      setMinDraft(String(store.minIntervalMinutes))
      setMaxDraft(String(store.maxIntervalMinutes))
      setRunning(store.running)
      setFullscreenTakeover(store.fullscreenTakeover)
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    return window.nudge.onUpdateReady((version) => setUpdateVersion(version))
  }, [])

  function persist(partial: Partial<StoreData>): void {
    window.nudge.store.set(partial)
  }

  function addReminder(): void {
    const text = newText.trim()
    if (!text) return
    const next = [...reminders, { id: makeId(), text }]
    setReminders(next)
    setNewText('')
    persist({ reminders: next })
  }

  function removeReminder(id: string): void {
    const next = reminders.filter((r) => r.id !== id)
    setReminders(next)
    persist({ reminders: next })
  }

  /** Clamp the drafts to valid numbers, persist, and reflect the result back into both fields. */
  function commitInterval(): void {
    const parsedMin = Number(minDraft)
    const parsedMax = Number(maxDraft)
    const min = Math.max(1, Math.round(Number.isFinite(parsedMin) ? parsedMin : minMinutes))
    const max = Math.max(min, Math.round(Number.isFinite(parsedMax) ? parsedMax : maxMinutes))
    setMinMinutes(min)
    setMaxMinutes(max)
    setMinDraft(String(min))
    setMaxDraft(String(max))
    persist({ minIntervalMinutes: min, maxIntervalMinutes: max })
  }

  function toggleTakeoverMode(next: boolean): void {
    setFullscreenTakeover(next)
    persist({ fullscreenTakeover: next })
  }

  async function toggleRunning(): Promise<void> {
    if (running) {
      await window.nudge.timer.stop()
      setRunning(false)
    } else {
      await window.nudge.timer.start()
      setRunning(true)
    }
  }

  if (!loaded) return <div className="app loading">Loading...</div>

  return (
    <div className="app">
      <header className="app-header">
        {/* Frameless window: this row is the drag handle. */}
        <div className="brand">
          <NudgeMark />
          <span className="wordmark">Nudge</span>
          <span className="version">v{__APP_VERSION__}</span>
        </div>
        <div className="window-controls">
          <button type="button" onClick={() => void window.nudge.minimizeWindow()} title="Minimise">
            –
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => void window.nudge.closeWindow()}
            title="Close"
          >
            ×
          </button>
        </div>
      </header>

      <div className="body">
        <section>
          <h2>Reminders</h2>
          <ul className="reminder-list">
            {reminders.map((r) => (
              <li key={r.id}>
                <span>{r.text}</span>
                <button className="ghost" onClick={() => removeReminder(r.id)}>
                  Remove
                </button>
              </li>
            ))}
            {reminders.length === 0 && <li className="empty">No reminders yet.</li>}
          </ul>
          <div className="add-row">
            <input
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addReminder()
              }}
              placeholder="e.g. Drink water"
            />
            <button onClick={addReminder}>Add</button>
          </div>
        </section>

        <section>
          <h2>Interval</h2>
          <div className="interval-row">
            <label>
              Min (minutes)
              <input
                type="number"
                min={1}
                value={minDraft}
                onChange={(e) => setMinDraft(e.target.value)}
                onBlur={commitInterval}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitInterval()
                }}
              />
            </label>
            <label>
              Max (minutes)
              <input
                type="number"
                min={1}
                value={maxDraft}
                onChange={(e) => setMaxDraft(e.target.value)}
                onBlur={commitInterval}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitInterval()
                }}
              />
            </label>
          </div>
        </section>

        <section>
          <h2>Notification style</h2>
          <label className="radio-row">
            <input
              type="radio"
              name="takeover-mode"
              checked={fullscreenTakeover}
              onChange={() => toggleTakeoverMode(true)}
            />
            Fullscreen takeover
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="takeover-mode"
              checked={!fullscreenTakeover}
              onChange={() => toggleTakeoverMode(false)}
            />
            Small popup in the corner
          </label>
        </section>

        <section>
          <button className="primary" onClick={toggleRunning} disabled={reminders.length === 0}>
            {running ? 'Stop' : 'Start'}
          </button>
          {reminders.length === 0 && <p className="hint">Add at least one reminder to start.</p>}
          {running && <p className="hint">Running - next nudge at a random time.</p>}
        </section>
      </div>

      {updateVersion !== null && (
        <div className="update-toast">
          <span className="update-toast-text">Update ready (v{updateVersion})</span>
          <button className="update-toast-action" onClick={() => window.nudge.installUpdate()}>
            Restart to update
          </button>
          <button
            className="update-toast-dismiss"
            title="Dismiss"
            onClick={() => setUpdateVersion(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
