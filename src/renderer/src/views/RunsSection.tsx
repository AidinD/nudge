/**
 * The scheduled-runs part of the app window: what is running and what remains
 * of it, and the template you start the next run from.
 *
 * This is the surface for "what is left of my runs?" - the full list of
 * remaining entries lives here, never on the takeover, which shows one
 * instruction and one line of context and nothing else.
 *
 * Starting is always from a template: pick one, adjust it in the draft below,
 * press Start. Adjusting does not change the saved template unless you save,
 * so a one-off tweak stays one-off. Every time field shows what it resolves to
 * right now, so an absolute time already past - which burns at once rather than
 * rolling to tomorrow - is visible before Start rather than after.
 *
 * Row order matters, because an offset counts from the row above. Rows are
 * reordered by dragging their grip; the grip alone is draggable, so dragging
 * inside a text field still selects text. A clock time earlier than the row
 * above is allowed but flagged: the run shows rows in clock order, so it would
 * not come where the list puts it.
 *
 * Hand-built confirmation only (delete asks twice inline): native dialogs look
 * foreign and `window.prompt` does not work in Electron at all.
 */

import { useEffect, useRef, useState } from 'react'
import {
  formatClock,
  resolveEntryTimes,
  type ActiveRun,
  type RunTemplate,
  type TemplateEntry
} from '../../../shared/schedule'

interface Draft {
  /** The saved template this draft came from; null for a new one. */
  templateId: string | null
  name: string
  entries: TemplateEntry[]
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface TimeLabel {
  tone: 'ok' | 'warn' | 'invalid'
  label: string
}

/** What each row's time field means if the run started now, in row order. */
function describeTimes(entries: TemplateEntry[], now: number): TimeLabel[] {
  const dueTimes = resolveEntryTimes(
    entries.map((entry) => entry.at),
    now
  )
  let previous: number | null = null
  return dueTimes.map((due) => {
    if (due === null) {
      return { tone: 'invalid', label: 'HH:MM, or +1h / +30m / +0 after the row above' }
    }
    const before = previous
    previous = due
    if (due < now) {
      return { tone: 'warn', label: `${formatClock(due)} - passed, burns` }
    }
    if (before !== null && due < before) {
      return { tone: 'warn', label: `${formatClock(due)} - before the row above, runs in clock order` }
    }
    return { tone: 'ok', label: formatClock(due) }
  })
}

interface RunsSectionProps {
  templates: RunTemplate[]
  onTemplatesChange: (templates: RunTemplate[]) => void
}

export default function RunsSection({ templates, onTemplatesChange }: RunsSectionProps): JSX.Element {
  const [runs, setRuns] = useState<ActiveRun[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // The row being dragged, and where it would land: before the row at dropIndex.
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const entryListRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    window.nudge.store.get().then((store) => setRuns(store.runs))
    return window.nudge.runs.onChanged(setRuns)
  }, [])

  // The resolved-time previews drift with the clock; a coarse tick is enough.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])

  function openTemplate(template: RunTemplate): void {
    setConfirmingDelete(false)
    setDraft({
      templateId: template.id,
      name: template.name,
      entries: template.entries.map((entry) => ({ ...entry }))
    })
  }

  function openNewTemplate(): void {
    setConfirmingDelete(false)
    setDraft({ templateId: null, name: '', entries: [{ id: makeId(), at: '+0', text: '' }] })
  }

  function updateEntry(id: string, change: Partial<TemplateEntry>): void {
    if (!draft) {
      return
    }
    setDraft({
      ...draft,
      entries: draft.entries.map((entry) => (entry.id === id ? { ...entry, ...change } : entry))
    })
  }

  function removeEntry(id: string): void {
    if (!draft) {
      return
    }
    setDraft({ ...draft, entries: draft.entries.filter((entry) => entry.id !== id) })
  }

  function addEntry(): void {
    if (!draft) {
      return
    }
    setDraft({ ...draft, entries: [...draft.entries, { id: makeId(), at: '', text: '' }] })
  }

  function moveEntry(from: number, to: number): void {
    if (!draft) {
      return
    }
    const entries = [...draft.entries]
    const [moved] = entries.splice(from, 1)
    entries.splice(to > from ? to - 1 : to, 0, moved)
    setDraft({ ...draft, entries })
  }

  function endDrag(): void {
    setDragIndex(null)
    setDropIndex(null)
  }

  /**
   * Where a row would land for a pointer at this height: before the first row
   * whose middle is below it. Used for both the landing line and the drop
   * itself, and computed from the drop's own position - the last dragover can
   * lag behind the pointer, and a drop that trusted it landed a row too high.
   */
  function dropIndexAt(clientY: number): number {
    const rows = [...(entryListRef.current?.children ?? [])]
    const index = rows.findIndex((row) => {
      const box = row.getBoundingClientRect()
      return clientY < box.top + box.height / 2
    })
    return index < 0 ? rows.length : index
  }

  function saveTemplate(): void {
    if (!draft) {
      return
    }
    const saved: RunTemplate = {
      id: draft.templateId ?? makeId(),
      name: draft.name.trim(),
      entries: cleanEntries(draft.entries)
    }
    const exists = templates.some((template) => template.id === saved.id)
    onTemplatesChange(
      exists
        ? templates.map((template) => (template.id === saved.id ? saved : template))
        : [...templates, saved]
    )
    setDraft({ ...draft, templateId: saved.id })
  }

  function deleteTemplate(): void {
    if (!draft?.templateId) {
      return
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    onTemplatesChange(templates.filter((template) => template.id !== draft.templateId))
    setDraft(null)
    setConfirmingDelete(false)
  }

  async function startRun(): Promise<void> {
    if (!draft) {
      return
    }
    const next = await window.nudge.runs.start(draft.name.trim() || 'Run', cleanEntries(draft.entries))
    setRuns(next)
    setDraft(null)
  }

  async function stopRun(runId: string): Promise<void> {
    setRuns(await window.nudge.runs.stop(runId))
  }

  const timeLabels = draft ? describeTimes(draft.entries, now) : []

  const draftValid =
    draft !== null &&
    draft.name.trim() !== '' &&
    cleanEntries(draft.entries).length > 0 &&
    draft.entries.every((entry, index) => entry.text.trim() === '' || timeLabels[index].tone !== 'invalid')

  return (
    <section>
      <h2>Scheduled runs</h2>

      {runs.length > 0 && (
        <ul className="run-list">
          {runs.map((run) => (
            <ActiveRunCard key={run.id} run={run} onStop={() => void stopRun(run.id)} />
          ))}
        </ul>
      )}

      <div className="template-row">
        {templates.map((template) => (
          <button
            key={template.id}
            className={draft?.templateId === template.id ? 'active' : undefined}
            onClick={() => openTemplate(template)}
          >
            {template.name}
          </button>
        ))}
        <button className={draft && draft.templateId === null ? 'active' : undefined} onClick={openNewTemplate}>
          New template
        </button>
      </div>

      {draft && (
        // Drag handling lives on the whole form, not the list: the natural place
        // to drop a row that should go first is the gap above the first row,
        // which is outside the list. And one handler means a drop is never
        // handled twice.
        <div
          className="draft"
          onDragEnd={endDrag}
          // Cancelling dragenter too is what makes a newly entered element a
          // drop target; without it a drop right after entering one is lost.
          onDragEnter={(e) => {
            if (dragIndex !== null) {
              e.preventDefault()
            }
          }}
          onDragOver={(e) => {
            if (dragIndex === null) {
              return
            }
            e.preventDefault()
            setDropIndex(dropIndexAt(e.clientY))
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragIndex !== null) {
              moveEntry(dragIndex, dropIndexAt(e.clientY))
            }
            endDrag()
          }}
        >
          <input
            className="draft-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Template name"
          />
          <ul className="draft-entries" ref={entryListRef}>
            {draft.entries.map((entry, index) => {
              const time = timeLabels[index]
              const rowClass = [
                dragIndex === index ? 'dragging' : '',
                dragIndex !== null && dropIndex === index ? 'drop-before' : '',
                dragIndex !== null && dropIndex === index + 1 && index === draft.entries.length - 1
                  ? 'drop-after'
                  : ''
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <li key={entry.id} className={rowClass || undefined}>
                  <span
                    className="draft-grip"
                    draggable
                    title="Drag to reorder"
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      const row = e.currentTarget.parentElement
                      if (row) {
                        e.dataTransfer.setDragImage(row, 12, row.offsetHeight / 2)
                      }
                      setDragIndex(index)
                    }}
                  >
                    ⠿
                  </span>
                  <input
                    className={time.tone === 'invalid' ? 'draft-time invalid' : 'draft-time'}
                    value={entry.at}
                    onChange={(e) => updateEntry(entry.id, { at: e.target.value })}
                    placeholder="+1h"
                  />
                  <input
                    className="draft-text"
                    value={entry.text}
                    onChange={(e) => updateEntry(entry.id, { text: e.target.value })}
                    placeholder="What to do"
                  />
                  <button className="ghost" title="Remove entry" onClick={() => removeEntry(entry.id)}>
                    ×
                  </button>
                  <span className={`draft-resolved ${time.tone}`}>{time.label}</span>
                </li>
              )
            })}
          </ul>
          <div className="draft-actions">
            <button onClick={addEntry}>Add entry</button>
            <button onClick={saveTemplate} disabled={!draftValid}>
              Save template
            </button>
            {draft.templateId !== null && (
              <button className={confirmingDelete ? 'ghost confirming' : 'ghost'} onClick={deleteTemplate}>
                {confirmingDelete ? 'Really delete?' : 'Delete'}
              </button>
            )}
            <button className="draft-start" onClick={() => void startRun()} disabled={!draftValid}>
              Start run
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** Entries with no text are unfinished rows, not entries. */
function cleanEntries(entries: TemplateEntry[]): TemplateEntry[] {
  return entries
    .filter((entry) => entry.text.trim() !== '')
    .map((entry) => ({ ...entry, at: entry.at.trim(), text: entry.text.trim() }))
}

function ActiveRunCard({ run, onStop }: { run: ActiveRun; onStop: () => void }): JSX.Element {
  const remaining = run.entries.filter((entry) => entry.state === 'pending')
  const shown = run.entries.filter((entry) => entry.state === 'shown').length
  const burned = run.entries.filter((entry) => entry.state === 'burned').length
  return (
    <li>
      <div className="run-head">
        <span className="run-name">{run.name}</span>
        <span className="run-meta">
          started {formatClock(run.startedAt)} · {shown} shown{burned > 0 ? ` · ${burned} burned` : ''}
        </span>
        <button className="ghost" onClick={onStop}>
          Stop
        </button>
      </div>
      <ul className="run-remaining">
        {remaining.map((entry) => (
          <li key={entry.id}>
            <span className="run-time">{formatClock(entry.dueAt)}</span>
            <span>{entry.text}</span>
          </li>
        ))}
      </ul>
    </li>
  )
}
