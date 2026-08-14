import { useEffect, useState } from 'react'
import type { Reminder, StoreData } from '../../../shared/store'

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function SettingsView(): JSX.Element {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [newText, setNewText] = useState('')
  const [minMinutes, setMinMinutes] = useState(30)
  const [maxMinutes, setMaxMinutes] = useState(60)
  const [running, setRunning] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.nudge.store.get().then((store) => {
      setReminders(store.reminders)
      setMinMinutes(store.minIntervalMinutes)
      setMaxMinutes(store.maxIntervalMinutes)
      setRunning(store.running)
      setLoaded(true)
    })
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

  function commitInterval(nextMin: number, nextMax: number): void {
    const min = Math.max(1, Math.round(nextMin))
    const max = Math.max(min, Math.round(nextMax))
    setMinMinutes(min)
    setMaxMinutes(max)
    persist({ minIntervalMinutes: min, maxIntervalMinutes: max })
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

  if (!loaded) return <div className="app">Loading...</div>

  return (
    <div className="app">
      <h1>Nudge</h1>
      <p className="subtitle">Random reminders that take over your screen.</p>

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
              value={minMinutes}
              onChange={(e) => commitInterval(Number(e.target.value), maxMinutes)}
            />
          </label>
          <label>
            Max (minutes)
            <input
              type="number"
              min={1}
              value={maxMinutes}
              onChange={(e) => commitInterval(minMinutes, Number(e.target.value))}
            />
          </label>
        </div>
      </section>

      <section>
        <button className="primary" onClick={toggleRunning} disabled={reminders.length === 0}>
          {running ? 'Stop' : 'Start'}
        </button>
        {reminders.length === 0 && <p className="hint">Add at least one reminder to start.</p>}
        {running && <p className="hint">Running - next nudge at a random time.</p>}
      </section>
    </div>
  )
}
