/**
 * Active scheduled runs, in the main process: starting one, arming its timers,
 * and recording what became of each entry.
 *
 * This exists so that a run survives the app being closed without anything
 * having to catch up. Runs are persisted in the store with every entry's due
 * moment resolved once, at start. On launch each pending entry is simply armed
 * again; one whose moment passed while the app was closed or the machine slept
 * reaches the takeover queue too late and burns there, by the queue's own rule.
 * Nothing in this file decides lateness.
 *
 * A run ends when no entry is pending, and is then removed. There is no history
 * of finished runs; nothing asked for one.
 */

import { readStore, writeStore } from './store'
import type { TakeoverQueue } from './takeoverQueue'
import {
  formatClock,
  resolveEntryTimes,
  type ActiveRun,
  type RunEntryState,
  type TemplateEntry
} from '../shared/schedule'

export class RunScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly queue: TakeoverQueue,
    /** Told after every change, so the app window can redraw the run list. */
    private readonly changed: (runs: ActiveRun[]) => void
  ) {}

  /** Arm every pending entry of every persisted run. Called once at launch. */
  resume(): void {
    for (const run of readStore().runs) {
      this.arm(run)
    }
  }

  /**
   * Start a run from a template as the user adjusted it. The entries arrive over
   * IPC, so every time is parsed again here rather than trusted.
   */
  start(name: string, entries: TemplateEntry[]): ActiveRun {
    if (entries.length === 0) {
      throw new Error(`Cannot start run "${name}": it has no entries`)
    }
    const startedAt = Date.now()
    // Resolved in the order the rows were given, since each offset counts from
    // the row above; only then sorted into clock order.
    const dueTimes = resolveEntryTimes(
      entries.map((entry) => entry.at),
      startedAt
    )
    const run: ActiveRun = {
      id: `${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      startedAt,
      entries: entries
        .map((entry, index) => {
          const dueAt = dueTimes[index]
          if (dueAt === null) {
            throw new Error(`Cannot start run "${name}": entry time "${entry.at}" is not HH:MM or +offset`)
          }
          return {
            id: entry.id,
            at: entry.at,
            text: entry.text,
            dueAt,
            state: 'pending' as const
          }
        })
        .sort((a, b) => a.dueAt - b.dueAt)
    }
    this.save([...readStore().runs, run])
    this.arm(run)
    return run
  }

  /** End a run early. What is already on screen stays until confirmed. */
  stop(runId: string): void {
    const run = readStore().runs.find((candidate) => candidate.id === runId)
    if (!run) {
      return
    }
    for (const entry of run.entries) {
      this.disarm(runId, entry.id)
    }
    this.queue.withdraw((source) => source.kind === 'run' && source.runId === runId)
    this.save(readStore().runs.filter((candidate) => candidate.id !== runId))
  }

  /** The entry reached the screen. */
  markShown(runId: string, entryId: string): void {
    this.setState(runId, entryId, 'shown')
  }

  /** The entry's moment passed without it reaching the screen. */
  markBurned(runId: string, entryId: string): void {
    this.setState(runId, entryId, 'burned')
  }

  /**
   * The single line of context under a run entry's takeover: its place in the
   * run, and when the next one is due. A run's last entry has no "next".
   */
  contextLine(runId: string, entryId: string): string | undefined {
    const run = readStore().runs.find((candidate) => candidate.id === runId)
    if (!run) {
      return undefined
    }
    const index = run.entries.findIndex((entry) => entry.id === entryId)
    if (index < 0) {
      return undefined
    }
    const position = `${index + 1} of ${run.entries.length}`
    const next = run.entries.slice(index + 1).find((entry) => entry.state === 'pending')
    return next ? `${position} · next ${formatClock(next.dueAt)}` : position
  }

  private arm(run: ActiveRun): void {
    for (const entry of run.entries) {
      if (entry.state !== 'pending') {
        continue
      }
      const key = timerKey(run.id, entry.id)
      this.timers.set(
        key,
        setTimeout(
          () => {
            this.timers.delete(key)
            this.queue.arrive({
              source: { kind: 'run', runId: run.id, entryId: entry.id },
              text: entry.text,
              dueAt: entry.dueAt
            })
          },
          Math.max(0, entry.dueAt - Date.now())
        )
      )
    }
  }

  private disarm(runId: string, entryId: string): void {
    const key = timerKey(runId, entryId)
    const timer = this.timers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(key)
    }
  }

  private setState(runId: string, entryId: string, state: RunEntryState): void {
    const runs = readStore()
      .runs.map((run) =>
        run.id !== runId
          ? run
          : {
              ...run,
              entries: run.entries.map((entry) => (entry.id === entryId ? { ...entry, state } : entry))
            }
      )
      .filter((run) => run.entries.some((entry) => entry.state === 'pending'))
    this.save(runs)
  }

  private save(runs: ActiveRun[]): void {
    writeStore({ runs })
    this.changed(runs)
  }
}

function timerKey(runId: string, entryId: string): string {
  return `${runId}/${entryId}`
}
