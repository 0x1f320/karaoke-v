import type { PianoRoll } from "../../../shared/geometry"

export function settleNoteRead(
  current: PianoRoll | null,
  next: PianoRoll | null,
): { read: PianoRoll | null; accepted: boolean } {
  if (!next) {
    return { read: current, accepted: false }
  }
  if (!next.xStable || !next.yStable) {
    return { read: current, accepted: false }
  }
  return { read: next, accepted: true }
}
