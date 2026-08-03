import type { PianoRoll, Rect, Viewport } from "../../../shared/geometry"

// Turns one accepted note read plus the live viewport into the transform the
// overlay draws under.
//
// The read's note rects are absolute screen coordinates as of read time; the
// viewport is sampled at paint time. Everything here is the difference between
// those two moments — horizontal scroll and zoom through contentX/contentW,
// vertical scroll through the reference chip's y.

export interface FrameTransform {
  scaleX: number
  /** Global-x shift from the read's frame to the live one. */
  contentOffsetX: number
  /** Global-y shift from the read's frame to the live one. */
  dy: number
}

export interface FrameLayout {
  /** Window-local shift applied to the read's rects. */
  offsetX: number
  offsetY: number
  scaleX: number
  /** Window-local note canvas — nothing may draw over the lanes beside it. */
  clip: Rect
  emit: { x: number; y: number; spread: number } | null
}

function horizontalScale(currentW: number, readW: number): number {
  return currentW > 0 && readW > 0 ? currentW / readW : 1
}

export function frameTransform(
  read: PianoRoll,
  vp: Viewport,
  /** The live vertical reference. Without one nothing can be placed at all. */
  refY: number,
): FrameTransform {
  const scaleX = horizontalScale(vp.contentW, read.contentW)
  return {
    scaleX,
    contentOffsetX: vp.contentX - read.contentX * scaleX,
    dy: refY - read.refY,
  }
}

export function composeFrame(
  transform: FrameTransform,
  vp: Viewport,
  /** Window origin, global. */
  origin: { x: number; y: number },
  /** The rect of the sounding note, and how far into it the playhead is. */
  hit: Rect | null,
  progress: number,
): FrameLayout {
  return {
    offsetX: transform.contentOffsetX - origin.x,
    offsetY: transform.dy - origin.y,
    scaleX: transform.scaleX,
    clip: {
      x: vp.canvas.x - origin.x,
      y: vp.canvas.y - origin.y,
      w: vp.canvas.w,
      h: vp.canvas.h,
    },
    // Sparks come off where the playhead is inside the note, not off the note as
    // a whole — that is what makes the effect read as following the sound.
    emit: hit ? { x: hit.x + hit.w * progress, y: hit.y + hit.h / 2, spread: hit.h } : null,
  }
}
