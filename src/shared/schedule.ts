/**
 * Scheduled runs: the data model and the grammar of an entry's time.
 *
 * A run is started from a template - pick one, adjust it, press start - and it
 * lives until its entries are done. This file owns what a template and a run
 * are, and how the text a user types into an entry's time field ("14:30",
 * "+1h", "+0") becomes a moment on the clock. It is shared by main (which
 * schedules) and the renderer (which validates as the user types), so the two
 * can never disagree about what a time means.
 *
 * It exists so that a run can be a plain list of moments. Deliberately absent:
 * any recurrence. Templates are saved runs, not rules - avoiding a recurrence
 * engine is the simplification that keeps the feature small. A separate "start
 * activity" is absent too; `+0` on the first row already puts something at the
 * very start.
 *
 * An offset counts from the row above it, not from the start. Offsets counted
 * from the start were the first version and were rejected in use: a run is
 * started in the morning, the first measurement is at lunch, and the ones after
 * it are "an hour after that" - which from the start meant typing +5h30m, and
 * moving lunch meant retyping every row. Chained, the lunch row is a clock time,
 * the rest are +1h, and moving lunch moves them. The price is that row order
 * now means something, so the adjust form lets rows be dragged.
 */

/** One line of a template: when, and what the takeover says. */
export interface TemplateEntry {
  id: string
  /** As typed: an absolute clock time ("14:30") or an offset from the row above ("+1h"). */
  at: string
  text: string
}

export interface RunTemplate {
  id: string
  name: string
  entries: TemplateEntry[]
}

/**
 * pending: not yet due, or due and waiting in the takeover queue.
 * shown: reached the screen. burned: its moment passed without being shown.
 */
export type RunEntryState = 'pending' | 'shown' | 'burned'

export interface RunEntry {
  id: string
  at: string
  text: string
  /** Epoch ms, resolved once when the run starts. */
  dueAt: number
  state: RunEntryState
}

/** A started run. It ends - and is removed - when no entry is pending. */
export interface ActiveRun {
  id: string
  name: string
  startedAt: number
  /** Sorted by dueAt, so "n of m" and "next" read in clock order. */
  entries: RunEntry[]
}

export type EntryTime =
  | { kind: 'clock'; hours: number; minutes: number }
  | { kind: 'offset'; offsetMs: number }

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/
// "+0", or hours and/or minutes: "+1h", "+90m", "+2min", "+1h30m".
const OFFSET = /^\+(?:(0)|(?:(\d+)h)?(?:(\d+)(?:m|min))?)$/

/** Parse an entry's time as typed. Returns null for anything that is not one. */
export function parseEntryTime(input: string): EntryTime | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, '')
  const clock = CLOCK.exec(text)
  if (clock) {
    return { kind: 'clock', hours: Number(clock[1]), minutes: Number(clock[2]) }
  }
  const offset = OFFSET.exec(text)
  if (offset && (offset[1] !== undefined || offset[2] !== undefined || offset[3] !== undefined)) {
    const hours = Number(offset[2] ?? 0)
    const minutes = Number(offset[3] ?? 0)
    return { kind: 'offset', offsetMs: (hours * 60 + minutes) * 60000 }
  }
  return null
}

/**
 * The moment each row is due in a run started at `startedAt`, in row order.
 *
 * An offset counts from the row above, and the first row's from the start. A
 * clock time is that time on the day the run starts, even when already past:
 * such a row burns at once. Rolling it to tomorrow was rejected - it would make
 * runs that span days, which nothing else here has, and a nudge tomorrow from a
 * run started today is a surprise. A clock time also becomes the anchor for the
 * offsets below it. A row that does not parse is null and anchors nothing, so
 * the rows below it chain from the last row that did.
 */
export function resolveEntryTimes(ats: string[], startedAt: number): Array<number | null> {
  let anchor = startedAt
  return ats.map((at) => {
    const time = parseEntryTime(at)
    if (!time) {
      return null
    }
    if (time.kind === 'offset') {
      anchor += time.offsetMs
    } else {
      const due = new Date(startedAt)
      due.setHours(time.hours, time.minutes, 0, 0)
      anchor = due.getTime()
    }
    return anchor
  })
}

/** "14:30", local time - the one clock format the run surfaces use. */
export function formatClock(epochMs: number): string {
  const date = new Date(epochMs)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/**
 * Shipped with the app so there is something to start on day one: four steps an
 * hour apart, the first at the very start. Its texts are placeholders to edit.
 */
export const HOURLY_TEMPLATE: RunTemplate = {
  id: 'hourly-four',
  name: 'Every hour, 4 steps',
  entries: [
    { id: 'hourly-four-0', at: '+0', text: 'Step 1' },
    { id: 'hourly-four-1', at: '+1h', text: 'Step 2' },
    { id: 'hourly-four-2', at: '+1h', text: 'Step 3' },
    { id: 'hourly-four-3', at: '+1h', text: 'Step 4' }
  ]
}
