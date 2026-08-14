/** The reminder currently being shown, and where it's being shown. */
export interface OverlayStep {
  reminderId: string
  text: string
  graceSeconds: number
  mode: 'fullscreen' | 'corner'
}
