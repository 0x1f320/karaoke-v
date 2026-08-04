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

const NO_OVERHANG = { lead: 0, tail: 0 }

/**
 * The note's rectangle grown to everything its pitch curve covers — the union,
 * so the note's own lane stays visible inside the band it is stretched into.
 *
 * Sideways as well as up and down, and by different amounts at each end. The
 * curve runs into a note before it starts and out of it after it ends, but only
 * as far as the voice actually went — a phrase has a release drawn after its
 * last note and nothing at all before its first.
 */
export function pitchBounds(
  hit: Rect,
  lowest: number,
  highest: number,
  overhang: { lead: number; tail: number } = NO_OVERHANG,
): Rect {
  const centre = hit.y + hit.h / 2
  const top = Math.min(hit.y, centre - highest * hit.h)
  const bottom = Math.max(hit.y + hit.h, centre - lowest * hit.h)
  const before = hit.w * overhang.lead
  const after = hit.w * overhang.tail
  return { x: hit.x - before, y: top, w: hit.w + before + after, h: bottom - top }
}

/** The same rect with `pad` px of slack on every side. */
export function padRect(rect: Rect, pad: number): Rect {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 }
}

export function composeFrame(
  transform: FrameTransform,
  vp: Viewport,
  /** Window origin, global. */
  origin: { x: number; y: number },
  /** The rect of the sounding note, and how far into it the playhead is. */
  hit: Rect | null,
  progress: number,
  /**
   * How far the voice is from the note's own pitch, in semitones. The rect is
   * one semitone tall — measured against the editor's own `v2y`, the lyric chip
   * matches its note's lane exactly — so this scales by the rect height and
   * needs no mapping of its own.
   */
  offsetSemitones = 0,
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
    emit: hit
      ? {
          x: hit.x + hit.w * progress,
          y: hit.y + hit.h / 2 - offsetSemitones * hit.h,
          spread: hit.h,
        }
      : null,
  }
}
