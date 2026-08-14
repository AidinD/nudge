import { useEffect, useRef, useState } from 'react'
import type { OverlayStep } from '../../../shared/ipc'

/** Two-note chime synthesized with Web Audio, so no audio asset is needed. */
function playChime(): void {
  const ctx = new AudioContext()
  const now = ctx.currentTime
  const notes: Array<[frequency: number, start: number]> = [
    [880, 0],
    [1320, 0.12]
  ]
  notes.forEach(([frequency, start]) => {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0, now + start)
    gain.gain.linearRampToValueAtTime(0.2, now + start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.3)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(now + start)
    oscillator.stop(now + start + 0.35)
  })
  setTimeout(() => ctx.close(), 800)
}

export default function OverlayView(): JSX.Element {
  const [step, setStep] = useState<OverlayStep | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    window.nudge.overlay.get().then((seed) => {
      if (seed) applyStep(seed)
    })
    const unsubscribe = window.nudge.overlay.onStep(applyStep)
    return () => {
      unsubscribe()
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  function applyStep(next: OverlayStep): void {
    setStep(next)
    setSecondsLeft(next.graceSeconds)
    playChime()
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  if (!step) return <div className="overlay" />

  const canConfirm = secondsLeft <= 0

  return (
    <div className={step.mode === 'corner' ? 'overlay overlay-corner' : 'overlay'}>
      <p className="overlay-text">{step.text}</p>
      <button
        className="primary overlay-confirm"
        disabled={!canConfirm}
        onClick={() => window.nudge.overlay.confirm()}
      >
        {canConfirm ? 'Confirm' : `Confirm (${secondsLeft})`}
      </button>
    </div>
  )
}
