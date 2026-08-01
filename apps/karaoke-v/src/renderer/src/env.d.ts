import type { PianoRoll } from "@karaoke-v/macos-helper"

declare global {
  interface Window {
    overlay: {
      onPianoRoll(callback: (frame: PianoRoll) => void): void
    }
  }
}
