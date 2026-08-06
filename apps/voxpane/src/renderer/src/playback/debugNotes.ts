import type { BridgeNote } from "../../../shared/bridgeChannels"
import type { Rect, Viewport } from "../../../shared/geometry"
import type { FrameTransform } from "./frame"
import type { TransportView } from "./transport"

export function predictedNoteRect(note: BridgeNote, view: TransportView, vp: Viewport): Rect {
  const { mapping } = view
  const zoomX = view.contentW > 0 && vp.contentW > 0 ? vp.contentW / view.contentW : 1
  const anchorX = view.canvasX + (note.onB - mapping.viewLeft) * mapping.perBlick
  return {
    x: vp.contentX + (anchorX - view.contentX) * zoomX,
    y: vp.refY === undefined ? vp.canvas.y : vp.refY - (note.pitch + 0.5) * mapping.perSemitone,
    w: (note.offB - note.onB) * mapping.perBlick * zoomX,
    h: mapping.perSemitone,
  }
}

export function toReadFrame(rect: Rect, transform: FrameTransform): Rect {
  return {
    x: (rect.x - transform.contentOffsetX) / transform.scaleX,
    y: rect.y - transform.dy,
    w: rect.w / transform.scaleX,
    h: rect.h,
  }
}
