import type { Rect, Viewport } from "@karaoke-v/macos-helper"
import type { BridgeNote } from "../../../shared/bridgeChannels"
import type { TransportView } from "./transport"

// Finds which AX rect is the note the bridge says is playing.
//
// The bridge knows a note's musical position exactly and the AX walk knows where
// rects actually are; neither alone says which rect is which note. So the view
// mapping gives a predicted position, and the prediction picks a rect rather
// than being drawn from — the rect is the truth about geometry.
//
// Predicting is what tolerates being slightly wrong. The scroll position paired
// with the mapping is sampled a few ms after the payload was written, so a fast
// flick at that instant skews the prediction; snapping absorbs that, as long as
// the skew stays well under the spacing between notes.

/** Widths must agree this closely (fraction of the expected width). */
const WIDTH_TOLERANCE = 0.25
/** Never accept a rect further from the prediction than this. */
const MIN_SLIP_PX = 24

export function locateNote(
  note: BridgeNote,
  view: TransportView,
  vp: Viewport,
  rects: readonly Rect[],
  /** Transform from the AX read's x coordinates into current global x coordinates. */
  xform: { scaleX: number; offsetX: number },
): Rect | null {
  const { mapping } = view
  const zoomX = view.contentW > 0 && vp.contentW > 0 ? vp.contentW / view.contentW : 1
  const anchorX = view.canvasX + (note.onB - mapping.viewLeft) * mapping.perBlick
  const expectedX = vp.contentX + (anchorX - view.contentX) * zoomX
  const expectedW = (note.offB - note.onB) * mapping.perBlick * zoomX
  const widthSlack = Math.max(4, expectedW * WIDTH_TOLERANCE)
  const limit = Math.max(MIN_SLIP_PX, expectedW * 0.5)

  let best: Rect | null = null
  let bestSlip = Number.POSITIVE_INFINITY
  for (const rect of rects) {
    const rectW = rect.w * xform.scaleX
    if (Math.abs(rectW - expectedW) > widthSlack) {
      continue
    }
    const rectX = rect.x * xform.scaleX + xform.offsetX
    const slip = Math.abs(rectX - expectedX)
    if (slip < bestSlip) {
      bestSlip = slip
      best = rect
    }
  }
  // Nothing close enough means the prediction and the rects disagree about what
  // is on screen. Showing an effect on the wrong note is worse than showing none.
  return bestSlip <= limit ? best : null
}

/** What a read says about where its coordinates sit — its scroll and zoom. */
export interface ReadFrame {
  contentX: number
  contentW: number
  refY: number
}

/**
 * How far a followed rect may have moved out of place before it counts as a
 * different rect, px. Both frames carry exact scroll deltas, so a match that is
 * really the same note lands within a pixel; anything else is another note.
 */
const FOLLOW_SLIP_PX = 6

/**
 * The same note's rect in a new read.
 *
 * A note is matched to a rect by prediction once, and then followed — the
 * prediction is built from the bridge's view mapping, which is a round trip
 * old, so re-running it every frame lets a moving roll snap the effect onto the
 * note next door. Following asks a question the reads can answer between
 * themselves: both carry the scroll and zoom their coordinates were taken at,
 * so the old rect maps into the new frame exactly and the new read's own rect
 * for that note is simply the one sitting there.
 */
export function followRect(
  rect: Rect,
  from: ReadFrame,
  to: ReadFrame,
  rects: readonly Rect[],
): Rect | null {
  const scaleX = from.contentW > 0 && to.contentW > 0 ? to.contentW / from.contentW : 1
  const x = to.contentX + (rect.x - from.contentX) * scaleX
  const y = rect.y + (to.refY - from.refY)
  const w = rect.w * scaleX

  let best: Rect | null = null
  let bestSlip = Number.POSITIVE_INFINITY
  for (const candidate of rects) {
    const slip = Math.abs(candidate.x - x) + Math.abs(candidate.y - y)
    if (slip < bestSlip && Math.abs(candidate.w - w) <= FOLLOW_SLIP_PX) {
      bestSlip = slip
      best = candidate
    }
  }
  // Gone from this read — edited away, scrolled off, or the track was switched.
  // The caller matches again from scratch rather than holding a stale rect.
  return bestSlip <= FOLLOW_SLIP_PX ? best : null
}

/**
 * The musical-to-pixel relation of one read, taken from a rect that is known to
 * be a particular note's.
 *
 * Measured 2026-08-04: the bridge's view mapping is 18ms old while playing (35ms
 * at the tail), which at a real scroll speed is one to two notes of error — far
 * past what matching tolerates, so a mapping-built prediction can only ever be a
 * guess about which note it is looking at. A read can answer that question about
 * itself instead. Every note on a piano roll sits on one straight line from
 * blicks to pixels, so a single matched rect fixes that line for the whole read,
 * and every other note follows from arithmetic — with no bridge latency in it at
 * all. The mapping keeps only what it is good at: the scale.
 *
 * Coordinates are the read's own, so the frame transform carries scroll and zoom
 * as it does for everything else. Anchors are read-scoped: carrying one into the
 * next read means rebasing it, exactly as a rect is followed.
 */
export interface ReadAnchor {
  /** Read x of blick zero. */
  x0: number
  /** Read px per blick. */
  perBlick: number
  /** The pitch `y` belongs to, MIDI semitones. */
  pitch: number
  /** Read y of that pitch's lane. */
  y: number
  /** Read px per semitone — the lane height. */
  laneH: number
}

/**
 * The relation a matched rect implies. `read` is the frame `rect` is in, and the
 * mapping only contributes the scale, rescaled from the view it was read in to
 * that frame.
 */
export function anchorFromMatch(
  note: BridgeNote,
  rect: Rect,
  view: TransportView,
  read: ReadFrame,
): ReadAnchor {
  const scale = view.contentW > 0 && read.contentW > 0 ? read.contentW / view.contentW : 1
  const perBlick = view.mapping.perBlick * scale
  return {
    x0: rect.x - note.onB * perBlick,
    perBlick,
    pitch: note.pitch,
    y: rect.y,
    laneH: rect.h,
  }
}

/** Where the anchor says a note is. */
export function anchoredRect(note: BridgeNote, anchor: ReadAnchor): Rect {
  return {
    x: anchor.x0 + note.onB * anchor.perBlick,
    y: anchor.y + (anchor.pitch - note.pitch) * anchor.laneH,
    w: (note.offB - note.onB) * anchor.perBlick,
    h: anchor.laneH,
  }
}

/** The same relation, expressed in a new read's coordinates. */
export function rebaseAnchor(anchor: ReadAnchor, from: ReadFrame, to: ReadFrame): ReadAnchor {
  const scaleX = from.contentW > 0 && to.contentW > 0 ? to.contentW / from.contentW : 1
  return {
    x0: to.contentX + (anchor.x0 - from.contentX) * scaleX,
    perBlick: anchor.perBlick * scaleX,
    pitch: anchor.pitch,
    y: anchor.y + (to.refY - from.refY),
    laneH: anchor.laneH,
  }
}
