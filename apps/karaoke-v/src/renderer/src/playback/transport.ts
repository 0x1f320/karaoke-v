import type { BridgeNote, BridgeStatus, BridgeViewMapping } from "../../../shared/bridgeChannels"

// Turns the bridge's state channel into a continuous playhead.
//
// The script publishes state on every tick and the app reads it once a frame,
// so this no longer waits to be told about seeks, wraps and stops — it sees
// them. What it still does is interpolate: the script's tick and this frame loop
// beat against each other, so between two fresh records the playhead runs on the
// local clock. That is sound because both clocks are on this machine and every
// read re-anchors.
//
// Timing is read from the channel alone. Where a note sits on screen is not —
// that comes from the AX pipeline, which is already exact and self-correcting
// under scroll. All this contributes to geometry is the view mapping and the
// scroll position it was read at, so a note can be found among the AX rects.

export interface TransportView {
  mapping: BridgeViewMapping
  /** Horizontal scroll at the moment the mapping was read. */
  contentX: number
  /** Horizontal zoom scale at the moment the mapping was read. */
  contentW: number
  /** Canvas x at the moment the mapping was read. */
  canvasX: number
}

/**
 * How long the state channel may stand still before the script counts as gone.
 * It publishes every 16ms playing and every 50ms stopped, so this is generous
 * enough to survive a stalled editor and short enough that a closed SynthV stops
 * driving effects almost immediately.
 */
const SILENCE_MS = 500

export class Transport {
  private schedule: readonly BridgeNote[] = []
  private status: BridgeStatus = "stopped"
  private anchorAt = 0
  private anchorClockMs = 0
  private anchored = false
  private loop: { start: number; end: number } | null = null
  private viewState: TransportView | null = null
  private lastSeq = -1
  private lastSeqClockMs = 0
  private notesSeq = -1

  /** Reads the channels. Call once a frame, before anything else here. */
  poll(nowMs: number): void {
    const state = window.bridge.readState()
    if (state === null) {
      this.forget()
      return
    }

    if (state.seq === this.lastSeq) {
      // The script has not ticked since the last frame. Keep extrapolating —
      // unless it has been quiet long enough to have gone away, in which case
      // there is nothing left to extrapolate from.
      if (nowMs - this.lastSeqClockMs > SILENCE_MS) {
        this.forget()
      }
      return
    }
    this.lastSeq = state.seq
    this.lastSeqClockMs = nowMs

    if (state.notesSeq !== this.notesSeq) {
      const schedule = window.bridge.readSchedule()
      // A torn or half-written schedule leaves notesSeq alone, so the next frame
      // tries again rather than holding a schedule that never arrived.
      if (schedule !== null) {
        this.schedule = schedule.notes
        this.notesSeq = state.notesSeq
      }
    }

    this.loop = state.loop
    this.status = state.status
    this.anchorAt = state.at
    this.anchorClockMs = nowMs
    this.anchored = true

    // The mapping is only usable paired with the scroll position it was read at,
    // and both are read here, one after the other, in the same frame.
    const vp = window.overlay.getViewport()
    this.viewState = vp
      ? {
          mapping: state.px,
          contentX: vp.contentX,
          contentW: vp.contentW,
          canvasX: vp.canvas.x,
        }
      : null
  }

  /** Seconds of playhead, or null before the first read. */
  playhead(nowMs: number): number | null {
    if (!this.anchored) {
      return null
    }
    if (this.status === "stopped") {
      return this.anchorAt
    }

    let t = this.anchorAt + (nowMs - this.anchorClockMs) / 1000
    // Wrapping locally only keeps the picture right until the wrap's own record
    // lands; it is a smoothing hint, never the source of truth.
    const loop = this.loop
    if (loop && loop.end > loop.start && t >= loop.end) {
      t = loop.start + ((t - loop.start) % (loop.end - loop.start))
    }
    return t
  }

  get playing(): boolean {
    return this.anchored && this.status !== "stopped"
  }

  /** Null until a state record has been paired with a viewport read. */
  get view(): TransportView | null {
    return this.viewState
  }

  /** The note under `seconds`, or null in a gap between notes. */
  noteAt(seconds: number): BridgeNote | null {
    const found = this.indexAt(seconds)
    if (found < 0) {
      return null
    }
    const note = this.schedule[found]
    return seconds < note.offS ? note : null
  }

  /**
   * The note before the one starting at or before `seconds`. A synthesized
   * contour glides into a note from whatever was sung last, so it needs the
   * neighbour even on frames where the gap between them is what is sounding.
   */
  noteBefore(seconds: number): BridgeNote | null {
    const found = this.indexAt(seconds)
    return found > 0 ? this.schedule[found - 1] : null
  }

  /**
   * The last note to have started at or before `seconds`, whether or not it is
   * still sounding, and the first to start after it. A contour reaches past its
   * note at both ends, so the frame loop has to be able to ask about a moment
   * that falls between two of them.
   */
  neighbours(seconds: number): { before: BridgeNote | null; after: BridgeNote | null } {
    const index = this.indexAt(seconds)
    return {
      before: index >= 0 ? this.schedule[index] : null,
      after: index + 1 < this.schedule.length ? this.schedule[index + 1] : null,
    }
  }

  /**
   * Every note overlapping the blick range, which is how the visible ones are
   * found: the view mapping says what span of the roll is on screen, and the
   * schedule is the only thing that knows a note's pitch contour.
   */
  notesBetween(fromB: number, toB: number): BridgeNote[] {
    const out: BridgeNote[] = []
    for (const note of this.schedule) {
      if (note.offB < fromB) {
        continue
      }
      if (note.onB > toB) {
        break
      }
      out.push(note)
    }
    return out
  }

  /** The note immediately before `note` in the schedule, or null. */
  before(note: BridgeNote): BridgeNote | null {
    const index = this.schedule.indexOf(note)
    return index > 0 ? this.schedule[index - 1] : null
  }

  /** Index of the last note starting at or before `seconds`, or -1. */
  private indexAt(seconds: number): number {
    const notes = this.schedule
    let lo = 0
    let hi = notes.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (notes[mid].onS <= seconds) {
        found = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return found
  }

  /**
   * The script is not there. The schedule is kept — it is still the right answer
   * for the project that was open — but nothing may be extrapolated from a
   * playhead that has stopped arriving, and a view mapping with no live scroll
   * to pair it with would point notes somewhere they are not.
   */
  private forget(): void {
    this.anchored = false
    this.viewState = null
    this.lastSeq = -1
  }
}
