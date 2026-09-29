/** The reminder currently being shown, and where it's being shown. */
export interface OverlayStep {
  text: string
  /** One small line under the instruction, for run entries: "2 of 4 · next 14:30". */
  context?: string
  graceSeconds: number
  mode: 'fullscreen' | 'corner'
}
