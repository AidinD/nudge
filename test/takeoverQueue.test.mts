/**
 * Unit tests for the takeover queue - the one piece of Nudge with real logic in
 * it, and the one whose rules are decisions rather than mechanics: one takeover
 * at a time, items wait their turn, and an item not shown within
 * LATE_TOLERANCE_MS of its moment burns instead of showing late.
 *
 * This exists so those rules survive the next change. They were first proven by
 * driving the running app, which is good evidence once and none at all a week
 * later.
 *
 * Time is Node's mock clock, which moves `Date` and `setTimeout` together, so
 * the expiry timer the queue arms for a waiting item fires exactly when the test
 * says the minute has passed. No real waiting, no flakiness from a slow machine.
 *
 * Run with `npm test`. Node runs the TypeScript directly with
 * --experimental-transform-types (the queue uses constructor parameter
 * properties, which plain type stripping refuses), so there is no build step and
 * no test dependency. It lives outside src/ because Node needs the `.ts`
 * extension on the import, which the app's tsconfig does not allow.
 */

import { beforeEach, afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  LATE_TOLERANCE_MS,
  TakeoverQueue,
  type QueuedTakeover
} from '../src/main/takeoverQueue.ts'

interface Harness {
  queue: TakeoverQueue
  events: string[]
}

function harness(): Harness {
  const events: string[] = []
  const queue = new TakeoverQueue(
    {
      show: (item) => events.push(`show ${item.text}`),
      idle: () => events.push('idle'),
      confirmed: (item) => events.push(`confirmed ${item.text}`),
      burned: (item) => events.push(`burned ${item.text}`)
    },
    () => Date.now()
  )
  return { queue, events }
}

function randomItem(text: string, dueAt = Date.now()): QueuedTakeover {
  return { source: { kind: 'random', reminderId: text }, text, dueAt }
}

function runItem(text: string, runId: string, dueAt = Date.now()): QueuedTakeover {
  return { source: { kind: 'run', runId, entryId: text }, text, dueAt }
}

describe('TakeoverQueue', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  })

  afterEach(() => {
    mock.timers.reset()
  })

  it('shows an item at once when the screen is free', () => {
    const { queue, events } = harness()
    queue.arrive(randomItem('A'))
    assert.deepEqual(events, ['show A'])
    assert.equal(queue.showing?.text, 'A')
  })

  it('queues a second item behind the first and shows it after Confirm', () => {
    const { queue, events } = harness()
    queue.arrive(randomItem('random'))
    queue.arrive(runItem('scheduled', 'run-1'))
    assert.deepEqual(events, ['show random'], 'the second item must wait, not overlap')

    mock.timers.tick(10_000)
    queue.confirm()
    assert.deepEqual(events, ['show random', 'confirmed random', 'show scheduled'])
  })

  it('goes idle when the last item is confirmed', () => {
    const { queue, events } = harness()
    queue.arrive(randomItem('A'))
    queue.confirm()
    assert.deepEqual(events, ['show A', 'confirmed A', 'idle'])
    assert.equal(queue.showing, null)
  })

  it('shows waiting items in the order they were due, not the order they arrived', () => {
    const { queue, events } = harness()
    const now = Date.now()
    queue.arrive(randomItem('on screen'))
    queue.arrive(runItem('due later', 'run-1', now + 5_000))
    queue.arrive(runItem('due earlier', 'run-2', now))
    queue.confirm()
    queue.confirm()
    assert.deepEqual(events, [
      'show on screen',
      'confirmed on screen',
      'show due earlier',
      'confirmed due earlier',
      'show due later'
    ])
  })

  it('burns a waiting item once the tolerance passes behind a takeover left standing', () => {
    const { queue, events } = harness()
    queue.arrive(runItem('first', 'run-1'))
    queue.arrive(runItem('second', 'run-1'))

    mock.timers.tick(LATE_TOLERANCE_MS)
    assert.deepEqual(events, ['show first'], 'at exactly the tolerance it may still be shown')

    mock.timers.tick(1)
    assert.deepEqual(events, ['show first', 'burned second'])

    queue.confirm()
    assert.deepEqual(events, ['show first', 'burned second', 'confirmed first', 'idle'], 'never shown late')
  })

  it('burns an item that arrives already too late - the app was closed at its moment', () => {
    const { queue, events } = harness()
    queue.arrive(runItem('missed', 'run-1', Date.now() - LATE_TOLERANCE_MS - 1))
    assert.deepEqual(events, ['burned missed'])
    assert.equal(queue.showing, null)
  })

  it('still shows an item that arrives late but within the tolerance', () => {
    const { queue, events } = harness()
    queue.arrive(runItem('slightly late', 'run-1', Date.now() - 30_000))
    assert.deepEqual(events, ['show slightly late'])
  })

  it('skips burned items when handing over the screen and shows the next live one', () => {
    const { queue, events } = harness()
    const start = Date.now()
    queue.arrive(randomItem('on screen'))
    queue.arrive(runItem('stale', 'run-1', start))
    mock.timers.tick(50_000)
    queue.arrive(runItem('fresh', 'run-2'))
    mock.timers.tick(LATE_TOLERANCE_MS - 50_000 + 1)
    queue.confirm()
    assert.deepEqual(events, [
      'show on screen',
      'burned stale',
      'confirmed on screen',
      'show fresh'
    ])
  })

  it('withdraws waiting items of a stopped source without burning them', () => {
    const { queue, events } = harness()
    queue.arrive(randomItem('on screen'))
    queue.arrive(runItem('stopped run', 'run-1'))
    queue.arrive(runItem('other run', 'run-2'))
    queue.withdraw((source) => source.kind === 'run' && source.runId === 'run-1')

    mock.timers.tick(LATE_TOLERANCE_MS + 1)
    queue.confirm()
    assert.deepEqual(events, ['show on screen', 'burned other run', 'confirmed on screen', 'idle'])
  })

  it('ignores Confirm when nothing is on screen', () => {
    const { queue, events } = harness()
    queue.confirm()
    assert.deepEqual(events, [])
  })
})
