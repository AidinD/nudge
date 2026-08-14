import { useEffect, useRef, useState } from 'react'
import type { OverlayStep } from '../../../shared/ipc'

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
    <div className="overlay">
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
