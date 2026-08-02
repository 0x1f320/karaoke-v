import type { Rect, Viewport } from "@karaoke-v/macos-helper"
import type { BridgeNote } from "../../../shared/bridge"
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
