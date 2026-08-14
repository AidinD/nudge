import type { NudgeApi } from './index'

declare global {
  interface Window {
    nudge: NudgeApi
  }
}
