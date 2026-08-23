/**
 * Nudge's mark, in the header beside the wordmark.
 *
 * Drawn inline rather than scaled down from `resources/icon.png`: it sits at
 * 20px next to 20px text, where a downscaled bitmap is soft exactly where the
 * eye is most critical.
 *
 * It belongs to the same family as Jot's circle-and-tick and Nib's pen nib: one
 * object on a transparent background, thick strokes with round caps, a warm
 * gradient, no container square. Here that object is the nudge itself - an
 * arrow giving something a push - because that is what the app does: it taps
 * you on the shoulder at a time you did not pick.
 *
 * The head is small and the ring large on purpose: the gesture still reads at
 * 16px, where a full-length arrow would be a smudge against the ring.
 */
export function NudgeMark({ size = 20 }: { size?: number }): JSX.Element {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="url(#nudge-push)"
      strokeWidth={10}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="nudge-push" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffc247" />
          <stop offset="1" stopColor="#ff6b4a" />
        </linearGradient>
      </defs>
      {/* The thing being nudged, then the head giving it the push. There is no
          shaft: an earlier revision had one, `M8 50 H22`, and it never drew a
          pixel - a horizontal line has a zero-height bounding box, and an
          objectBoundingBox gradient over a degenerate box means the element is
          not rendered at all. It is gone rather than left in, because dead
          geometry here is geometry the app icon would faithfully reproduce and
          the header would not. */}
      <circle cx="64" cy="50" r="26" />
      <path d="M15 42 L24 50 L15 58" />
    </svg>
  )
}
