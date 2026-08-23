import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

/*
 * Nudge's app icon, drawn without dependencies.
 *
 * The mark is the one in the header (`src/renderer/src/NudgeMark.tsx`): a ring
 * being given a push by an arrow. The geometry below is that component's,
 * scaled off its 100-unit viewBox, so the mark beside the wordmark and the mark
 * in the taskbar are the same drawing. Change one, change the other.
 *
 * Two drawings, per the family rule Nib's and Jot's generators set out:
 *
 *  - The full mark at 32px and up: ring, shaft, head.
 *  - Below 32, a heavier ring and the shaft dropped altogether. At that size
 *    the shaft is a smudge running into the ring, and what survives of the
 *    gesture is the head - so the small drawing is a chevron and a ring.
 *
 * Both go into a multi-size icon.ico, so Windows picks the drawing meant for the
 * size it is asking for instead of downscaling the detailed one.
 *
 * The PNG and ICO writers are Nib's and Jot's, kept byte-compatible on purpose -
 * four apps, one icon pipeline.
 *
 * Run with `node scripts/generate-icon.mjs`. The output is committed, because
 * packaging must not depend on having run a script first.
 */

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })

// ---------- PNG ----------

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function renderPng(size, shade) {
  const rows = []
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x += 1) {
      row.set(shade(x + 0.5, y + 0.5, size), 1 + x * 4)
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- ICO ----------

/**
 * A Vista-era .ico: a directory of entries, each holding a whole PNG.
 *
 * Written by hand so the small sizes can be a different drawing. Handing
 * electron-builder a single large PNG would have it downscale that one drawing
 * to 16px, which is exactly what the second drawing exists to avoid.
 */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const directory = []
  let offset = 6 + images.length * 16
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size // 0 means 256
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0 // palette
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    directory.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...directory, ...images.map((image) => image.png)])
}

// ---------- distance fields ----------

/*
 * Every primitive returns a SIGNED distance - negative inside the shape - so a
 * filled body and a stroked stalk can be unioned with a plain Math.min and
 * shaded by one coverage rule.
 */

const mix = (a, b, t) => a + (b - a) * t
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

/** Signed distance to a stroked ring of half-weight `half`. */
function sdRing(px, py, cx, cy, r, half) {
  return Math.abs(Math.hypot(px - cx, py - cy) - r) - half
}

/**
 * Signed distance to a round cone: a segment whose radius runs from `ra` at A
 * to `rb` at B. With ra === rb it is a round-capped stroke, which is what draws
 * the shaft and the two arms of the head.
 */
function sdCone(px, py, ax, ay, bx, by, ra, rb) {
  const abx = bx - ax
  const aby = by - ay
  const lengthSquared = abx * abx + aby * aby
  const t = lengthSquared === 0 ? 0 : clamp(((px - ax) * abx + (py - ay) * aby) / lengthSquared, 0, 1)
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t)) - mix(ra, rb, t)
}

/** Anti-aliasing: coverage falls off across about a pixel of distance. */
function coverage(signedDistance, feather = 1.1) {
  return clamp(-signedDistance / feather + 0.5, 0, 1)
}

/** The amber ramp from NudgeMark's gradient, run across the diagonal. */
function amber(x, y, size) {
  const t = clamp((x / size) * 0.5 + (y / size) * 0.5, 0, 1)
  return [255, Math.round(mix(194, 107, t)), Math.round(mix(71, 74, t))]
}

// ---------- the two drawings ----------

/*
 * The two drawings, as fractions of the canvas.
 *
 * FULL is NudgeMark's geometry over its 100-unit viewBox: the ring at (64,50)
 * with r=26 and stroke 10, a stub of shaft from x=8 to x=22, and the head as
 * two arms meeting at (24,50).
 *
 * SMALL keeps the ring and the head and drops the shaft, on a heavier stroke.
 * Below 32px the shaft has nowhere to be: it is a pixel long and it welds the
 * head to the ring.
 */
const FULL = {
  ring: { cx: 0.64, cy: 0.5, r: 0.26, half: 0.05 },
  parts: [
    { from: [0.08, 0.5], to: [0.22, 0.5], ra: 0.05, rb: 0.05 },
    { from: [0.15, 0.42], to: [0.24, 0.5], ra: 0.05, rb: 0.05 },
    { from: [0.24, 0.5], to: [0.15, 0.58], ra: 0.05, rb: 0.05 }
  ]
}

const SMALL = {
  ring: { cx: 0.63, cy: 0.5, r: 0.27, half: 0.075 },
  parts: [
    { from: [0.13, 0.38], to: [0.27, 0.5], ra: 0.075, rb: 0.075 },
    { from: [0.27, 0.5], to: [0.13, 0.62], ra: 0.075, rb: 0.075 }
  ]
}

/** A ring, and the arrow giving it a push. */
function shadeMark(x, y, size) {
  const mark = size < 32 ? SMALL : FULL
  const { ring, parts } = mark

  let distance = sdRing(x, y, size * ring.cx, size * ring.cy, size * ring.r, size * ring.half)
  for (const part of parts) {
    distance = Math.min(
      distance,
      sdCone(
        x,
        y,
        size * part.from[0],
        size * part.from[1],
        size * part.to[0],
        size * part.to[1],
        size * part.ra,
        size * part.rb
      )
    )
  }

  const alpha = coverage(distance)
  if (alpha === 0) {
    return [0, 0, 0, 0]
  }
  const [red, green, blue] = amber(x, y, size)
  return [red, green, blue, Math.round(255 * alpha)]
}

// ---------- output ----------

// The PNG electron-builder falls back to (and what non-Windows targets use).
writeFileSync(join(outDir, 'icon.png'), renderPng(512, shadeMark))

/*
 * The one .ico, used for the packaged app and for the window icon in dev.
 *
 * It carries 20 and 24 as well as the usual ladder, because Windows asks for
 * those at 125% and 150% display scaling - the two scales where a missing frame
 * means it resamples a neighbour and the mark goes soft again.
 */
writeFileSync(
  join(outDir, 'icon.ico'),
  buildIco(
    [256, 128, 64, 48, 32, 24, 20, 16].map((size) => ({ size, png: renderPng(size, shadeMark) }))
  )
)

console.log('Wrote resources/icon.png and resources/icon.ico')
