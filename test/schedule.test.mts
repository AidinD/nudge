/**
 * Unit tests for how an entry's time becomes a moment: the grammar of what can
 * be typed, and the chain in which an offset counts from the row above.
 *
 * This exists because the chain is the part a later change could quietly get
 * wrong. It replaced offsets counted from the start, and the case that forced it
 * is the first test here: a run started in the morning, the first row a lunch
 * clock time, the rest "+1h" after each other. If a change ever makes that
 * produce anything but 12:00, 13:00, 14:00, 15:00, the reason for the design is
 * gone.
 *
 * Times are built in local time, the way the app resolves them, so the tests
 * hold in any time zone.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatClock, parseEntryTime, resolveEntryTimes } from '../src/shared/schedule.ts'

const morning = new Date(2026, 8, 30, 8, 33).getTime()

function clocks(ats: string[], startedAt = morning): Array<string | null> {
  return resolveEntryTimes(ats, startedAt).map((due) => (due === null ? null : formatClock(due)))
}

describe('resolveEntryTimes', () => {
  it('chains offsets from a lunch clock time in a run started in the morning', () => {
    assert.deepEqual(clocks(['12:00', '+1h', '+1h', '+1h']), ['12:00', '13:00', '14:00', '15:00'])
  })

  it('counts the first row from the start, and each offset from the row above', () => {
    assert.deepEqual(clocks(['+0', '+30m', '+1h']), ['08:33', '09:03', '10:03'])
  })

  it('moves every chained row when the clock time they hang on changes', () => {
    assert.deepEqual(clocks(['12:30', '+1h', '+1h']), ['12:30', '13:30', '14:30'])
  })

  it('re-anchors on a later clock time, whatever came before it', () => {
    assert.deepEqual(clocks(['+0', '+1h', '14:00', '+15m']), ['08:33', '09:33', '14:00', '14:15'])
  })

  it('puts a clock time already past on the start day, not tomorrow', () => {
    const due = resolveEntryTimes(['07:00'], morning)[0]
    assert.equal(due, new Date(2026, 8, 30, 7, 0).getTime())
  })

  it('leaves an unparsable row null and chains the next from the last valid row', () => {
    assert.deepEqual(clocks(['+1h', 'soon', '+1h']), ['09:33', null, '10:33'])
  })
})

describe('parseEntryTime', () => {
  it('accepts clock times and offsets in hours, minutes or both', () => {
    assert.deepEqual(parseEntryTime('14:30'), { kind: 'clock', hours: 14, minutes: 30 })
    assert.deepEqual(parseEntryTime('+0'), { kind: 'offset', offsetMs: 0 })
    assert.deepEqual(parseEntryTime('+1h30m'), { kind: 'offset', offsetMs: 90 * 60000 })
    assert.deepEqual(parseEntryTime('+2min'), { kind: 'offset', offsetMs: 2 * 60000 })
  })

  it('refuses a bare number, a missing plus and an impossible clock time', () => {
    for (const input of ['+5', '1h', '+', '24:00', '12:60']) {
      assert.equal(parseEntryTime(input), null, `"${input}" should not parse`)
    }
  })
})
