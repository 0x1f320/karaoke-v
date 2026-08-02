import type {
  BridgeMessage,
  BridgeNote,
  BridgeStatus,
  BridgeViewMapping,
} from "../../../shared/bridge"

// Turns the bridge's sparse anchors into a continuous playhead.
//
// The bridge speaks only when something changes, so between payloads this runs
// entirely on the local clock. That is sound because both clocks are on this
// machine: drift is parts-per-million, far under a frame, and every transport
// event re-anchors anyway.
//
// Timing is read from the payload alone. Where a note sits on screen is not —
// that comes from the AX pipeline, which is already exact and self-correcting
// under scroll. All this contributes to geometry is the view mapping and the
// scroll position at anchor time, so a note can be found among the AX rects.

export interface TransportView {
  mapping: BridgeViewMapping
  /** Horizontal scroll at the moment the anchor was taken. */
  contentX: number
  /** Horizontal zoom scale at the moment the anchor was taken. */
  contentW: number
  /** Canvas x at the moment the anchor was taken. */
  canvasX: number
}

export class Transport {
  private schedule: readonly BridgeNote[] = []
  private status: BridgeStatus = "stopped"
  private anchorAt = 0
  private anchorClockMs = 0
  private anchored = false
  private loop: { start: number; end: number } | null = null
  private viewState: TransportView | null = null
  private unsubscribe: (() => void) | null = null

  start(): void {
    this.unsubscribe = window.bridge.onPayload((message) => this.apply(message, true))
    // Catch up if playback is already under way — the next transport event could
    // be a whole song away.
    window.bridge.last().then((message) => {
      if (message && !this.anchored) {
        this.apply(message, false)
      }
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  /** Seconds of playhead, or null before the first anchor. */
  playhead(nowMs: number): number | null {
    if (!this.anchored) {
      return null
    }
    if (this.status === "stopped") {
      return this.anchorAt
    }

    let t = this.anchorAt + (nowMs - this.anchorClockMs) / 1000
    // Wrapping locally only keeps the picture right until the wrap's own anchor
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

  /** Null until a live payload arrives — a replayed one has a stale scroll. */
  get view(): TransportView | null {
    return this.viewState
  }

  /** The note under `seconds`, or null in a gap between notes. */
  noteAt(seconds: number): BridgeNote | null {
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
    if (found < 0) {
      return null
    }
    const note = notes[found]
    return seconds < note.offS ? note : null
  }

  private apply(message: BridgeMessage, live: boolean): void {
    const { payload, monotonicMs } = message
    if (payload.notes) {
      this.schedule = payload.notes
    }
    this.loop = payload.loop
    this.status = payload.status
    this.anchorAt = payload.at
    this.anchorClockMs = monotonicMs
    this.anchored = true

    // The mapping is only usable paired with the scroll position it was taken
    // at. On a replayed payload that pairing is long gone, so keep no view at
    // all rather than one that quietly points a note somewhere else.
    if (live && payload.px) {
      const vp = window.overlay.getViewport()
      this.viewState = vp
        ? {
            mapping: payload.px,
            contentX: vp.contentX,
            contentW: vp.contentW,
            canvasX: vp.canvas.x,
          }
        : null
    } else if (!live) {
      this.viewState = null
    }
  }
}
