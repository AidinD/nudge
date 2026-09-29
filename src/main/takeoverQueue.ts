/**
 * The one queue every takeover goes through.
 *
 * Random-interval nudges, scheduled run entries and entries from overlapping
 * runs all arrive here, and the screen shows exactly one of them at a time.
 * This exists so that no two sources ever need to know about each other: two
 * runs may overlap, a scheduled entry may come due during a random nudge, and
 * the answer is always the same - it waits its turn.
 *
 * Waiting is bounded. An item that has not reached the screen within
 * LATE_TOLERANCE_MS of its due moment burns: it is dropped silently, never
 * shown late. The same rule covers every way of missing a moment - a takeover
 * left standing, the machine asleep when a timer should have fired - so there
 * is no catch-up, no wake handling and no replay anywhere else.
 *
 * The queue owns order and lateness only. What an item looks like on screen,
 * and what showing or burning it means for a run, belongs to the callbacks.
 */

export type TakeoverSource =
  | { kind: 'random'; reminderId: string }
  | { kind: 'run'; runId: string; entryId: string }

export interface QueuedTakeover {
  source: TakeoverSource
  text: string
  /** Epoch ms of the moment it was meant for. */
  dueAt: number
}

export interface TakeoverQueueCallbacks {
  show: (item: QueuedTakeover) => void
  /** The screen is free again and nothing is waiting. */
  idle: () => void
  confirmed: (item: QueuedTakeover) => void
  burned: (item: QueuedTakeover) => void
}

/**
 * How late an item may still be shown. Long enough to wait out a takeover
 * handled normally (the grace period plus a click), short enough that one left
 * standing burns what came due behind it.
 */
export const LATE_TOLERANCE_MS = 60_000

export class TakeoverQueue {
  private current: QueuedTakeover | null = null
  private waiting: QueuedTakeover[] = []
  private expiryTimers = new Map<QueuedTakeover, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly callbacks: TakeoverQueueCallbacks,
    private readonly now: () => number = Date.now
  ) {}

  get showing(): QueuedTakeover | null {
    return this.current
  }

  /** An item's moment has come. Show it, queue it, or burn it if already too late. */
  arrive(item: QueuedTakeover): void {
    if (this.isTooLate(item)) {
      this.callbacks.burned(item)
      return
    }
    if (!this.current) {
      this.present(item)
      return
    }
    this.waiting.push(item)
    this.waiting.sort((a, b) => a.dueAt - b.dueAt)
    const expiresIn = item.dueAt + LATE_TOLERANCE_MS - this.now()
    this.expiryTimers.set(
      item,
      setTimeout(() => this.expire(item), Math.max(0, expiresIn))
    )
  }

  /** The user confirmed what is on screen. Hand the screen to the next item, if any. */
  confirm(): void {
    const done = this.current
    if (!done) {
      return
    }
    this.current = null
    this.callbacks.confirmed(done)
    this.advance()
  }

  /** Drop waiting items that match, without burning them - their source was stopped. */
  withdraw(matches: (source: TakeoverSource) => boolean): void {
    for (const item of this.waiting.filter((waiting) => matches(waiting.source))) {
      this.removeWaiting(item)
    }
  }

  private advance(): void {
    // Take the next item only if the previous confirm did not already put one up.
    while (!this.current) {
      const next = this.waiting[0]
      if (!next) {
        this.callbacks.idle()
        return
      }
      this.removeWaiting(next)
      if (this.isTooLate(next)) {
        this.callbacks.burned(next)
      } else {
        this.present(next)
      }
    }
  }

  private present(item: QueuedTakeover): void {
    this.current = item
    this.callbacks.show(item)
  }

  private expire(item: QueuedTakeover): void {
    if (!this.waiting.includes(item)) {
      return
    }
    this.removeWaiting(item)
    this.callbacks.burned(item)
  }

  private removeWaiting(item: QueuedTakeover): void {
    this.waiting = this.waiting.filter((waiting) => waiting !== item)
    const timer = this.expiryTimers.get(item)
    if (timer) {
      clearTimeout(timer)
      this.expiryTimers.delete(item)
    }
  }

  private isTooLate(item: QueuedTakeover): boolean {
    return this.now() - item.dueAt > LATE_TOLERANCE_MS
  }
}
