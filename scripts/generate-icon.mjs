import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { renderPng, renderIco, coverage, distRing, distSegment, mix } from 'keel/icon'

/*
 * Nudge's app icon.
 *
 * The mark is the one in the header (`src/renderer/src/NudgeMark.tsx`): a ring
 * being given a push by an arrow. The geometry below is that component's,
 * scaled off its 100-unit viewBox, so the mark beside the wordmark and the mark
 * in the taskbar are the same drawing. Change one, change the other.
 *
 * One drawing at every size - no simplified twin for the small frames, because
 * a second drawing would be a second mark nobody approved. (keel supplies
 * `SMALL_BELOW` for the apps that do want one; Nudge deliberately does not.)
 *
 * It goes into a multi-size icon.ico so Windows renders each frame at its own
 * size rather than downscaling the 256.
 *
 * The PNG writer, the ICO writer and the distance-field primitives come from
 * `keel/icon`, shared with the rest of the suite. What is left here is Nudge's
 * geometry and Nudge's colour.
 *
 * Run with `node scripts/generate-icon.mjs`. The output is committed, because
 * packaging must not depend on having run a script first.
 */

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })

// ---------- signed distances ----------

/*
 * keel's primitives are UNSIGNED - distance to the skeleton of a shape - and its
 * `coverage(distance, halfWeight)` subtracts the weight itself. Nudge unions two
 * shapes of the same weight before shading, so it wants them SIGNED: negative
 * inside, unioned with a plain Math.min, shaded by one rule.
 *
 * Subtracting the half-weight here is exactly what the local copies did, in the
 * same order, so the output is unchanged to the byte. That is the point - see
 * keel's README on verifying a migration rather than trusting it.
 */

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

/** Signed distance to a stroked ring of half-weight `half`. */
const sdRing = (px, py, cx, cy, r, half) => distRing(px, py, cx, cy, r) - half

/**
 * Signed distance to a round-capped stroke of half-weight `half` - which is
 * exactly what SVG draws for a line with `stroke-linecap: round`, so the arms of
 * the head are the same shapes the component paints, not an approximation.
 */
const sdStroke = (px, py, ax, ay, bx, by, half) => distSegment(px, py, ax, ay, bx, by) - half

/**
 * The amber ramp from NudgeMark's gradient.
 *
 * Per SHAPE, not across the canvas - which is why keel's `diagonalRamp` is not
 * used here. The component paints each element with an objectBoundingBox
 * gradient, so the ring runs the full ramp over the ring's box and the head runs
 * it again over its own. The boxes are the geometry boxes, without the stroke,
 * which is what SVG measures against.
 */
function amber(px, py, box) {
  const t = clamp(((px - box[0]) / (box[2] - box[0])) * 0.5 + ((py - box[1]) / (box[3] - box[1])) * 0.5, 0, 1)
  return [255, Math.round(mix(194, 107, t)), Math.round(mix(71, 74, t))]
}

// ---------- the drawing ----------

/*
 * NudgeMark.tsx's geometry over its 100-unit viewBox: the ring at (64,50), r=26,
 * stroke 10, and the head as two arms meeting at (24,50).
 */
const RING = { cx: 64, cy: 50, r: 26, half: 5 }
// Ring and head only. NudgeMark.tsx also carries a shaft path, but it does not
// render and never has: its stroke paint is an objectBoundingBox gradient, and
// a horizontal line has a zero-height bounding box, which SVG says makes the
// element not render at all. The mark IS a ring and a chevron, so that is what
// the icon draws.
const STROKES = [
  { from: [15, 42], to: [24, 50], radius: 5 },
  { from: [24, 50], to: [15, 58], radius: 5 }
]

const RING_BOX = [38, 24, 90, 76]
const HEAD_BOX = [15, 42, 24, 58]

/** A ring, and the chevron giving it a push. */
function shadeMark(x, y, size) {
  const unit = size / 100
  // Work in the 100-unit space the mark is drawn in, then scale the distance
  // back to pixels - one conversion instead of one per primitive.
  const ux = x / unit
  const uy = y / unit

  const ring = sdRing(ux, uy, RING.cx, RING.cy, RING.r, RING.half)
  let head = Infinity
  for (const stroke of STROKES) {
    head = Math.min(head, sdStroke(ux, uy, stroke.from[0], stroke.from[1], stroke.to[0], stroke.to[1], stroke.radius))
  }

  // Already signed, so the weight keel would subtract is zero.
  const alpha = coverage(Math.min(ring, head) * unit, 0)
  if (alpha === 0) {
    return [0, 0, 0, 0]
  }
  const [red, green, blue] = head < ring ? amber(ux, uy, HEAD_BOX) : amber(ux, uy, RING_BOX)
  return [red, green, blue, Math.round(255 * alpha)]
}

// ---------- output ----------

// The PNG electron-builder falls back to (and what non-Windows targets use).
writeFileSync(join(outDir, 'icon.png'), renderPng(512, shadeMark))

/*
 * The one .ico, used for the packaged app and for the window icon in dev.
 *
 * keel's DEFAULT_LADDER carries 20 and 24 as well as the usual sizes, because
 * Windows asks for those at 125% and 150% display scaling - the two scales where
 * a missing frame means it resamples a neighbour and the mark goes soft again.
 */
writeFileSync(join(outDir, 'icon.ico'), renderIco(shadeMark))

console.log('Wrote resources/icon.png and resources/icon.ico')
