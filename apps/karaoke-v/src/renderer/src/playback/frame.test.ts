import { describe, expect, it } from "vitest"
import type { PianoRoll, Viewport } from "../../../shared/geometry"
import { composeFrame, frameTransform, pitchBounds } from "./frame"

const READ: PianoRoll = {
  canvas: { x: 500, y: 200, w: 800, h: 400 },
  contentX: 400,
  contentW: 2000,
  refY: 300,
  xStable: true,
  yStable: true,
  notes: [],
}

const VP: Viewport = {
  canvas: { x: 500, y: 200, w: 800, h: 400 },
  contentX: 400,
  contentW: 2000,
}

const VP_REF_Y = 300

const TRANSFORM = frameTransform(READ, VP, VP_REF_Y)

describe("frameTransform", () => {
  it("is the identity when nothing moved since the read", () => {
    expect(TRANSFORM).toEqual({ scaleX: 1, contentOffsetX: 0, dy: 0 })
  })

  it("turns horizontal scroll into a pure shift", () => {
    expect(frameTransform(READ, { ...VP, contentX: 250 }, VP_REF_Y)).toEqual({
      scaleX: 1,
      contentOffsetX: -150,
      dy: 0,
    })
  })

  it("turns vertical scroll into dy, from the reference chip", () => {
    expect(frameTransform(READ, VP, 260).dy).toBe(-40)
  })

  it("scales about the content origin when the zoom changed", () => {
    // Zoomed 2x with the content edge held: a note at the read's contentX must
    // stay at the viewport's contentX, so the shift has to absorb the scaling.
    const zoomed = frameTransform(READ, { ...VP, contentW: 4000 }, VP_REF_Y)
    expect(zoomed.scaleX).toBe(2)
    expect(zoomed.contentOffsetX).toBe(400 - 800)
    expect(READ.contentX * zoomed.scaleX + zoomed.contentOffsetX).toBe(VP.contentX)
  })

  it("falls back to no scaling when a content width is missing", () => {
    expect(frameTransform(READ, { ...VP, contentW: 0 }, VP_REF_Y).scaleX).toBe(1)
    expect(frameTransform({ ...READ, contentW: 0 }, VP, VP_REF_Y).scaleX).toBe(1)
  })
})

describe("composeFrame", () => {
  const origin = { x: 480, y: 180 }

  it("rebases the transform and the canvas onto the window origin", () => {
    const frame = composeFrame(TRANSFORM, VP, origin, null, 0)
    expect(frame).toEqual({
      offsetX: -480,
      offsetY: -180,
      scaleX: 1,
      clip: { x: 20, y: 20, w: 800, h: 400 },
      emit: null,
    })
  })

  it("keeps the clip in window-local coordinates as the window moves", () => {
    const moved = composeFrame(TRANSFORM, VP, { x: 0, y: 0 }, null, 0)
    expect(moved.clip).toEqual(VP.canvas)
  })

  it("emits from the playhead inside the note, not from the note as a whole", () => {
    const hit = { x: 600, y: 300, w: 100, h: 20 }
    expect(composeFrame(TRANSFORM, VP, origin, hit, 0).emit).toEqual({
      x: 600,
      y: 310,
      spread: 20,
    })
    expect(composeFrame(TRANSFORM, VP, origin, hit, 0.25).emit).toEqual({
      x: 625,
      y: 310,
      spread: 20,
    })
    expect(composeFrame(TRANSFORM, VP, origin, hit, 1).emit?.x).toBe(700)
  })

  it("has nothing to emit without a matched rect", () => {
    expect(composeFrame(TRANSFORM, VP, origin, null, 0.5).emit).toBeNull()
  })

  it("lifts the emission point by the pitch offset, a rect height per semitone", () => {
    const hit = { x: 600, y: 300, w: 100, h: 20 }
    // Up the piano roll is a smaller y, so a higher pitch subtracts.
    expect(composeFrame(TRANSFORM, VP, origin, hit, 0, 1).emit?.y).toBe(290)
    expect(composeFrame(TRANSFORM, VP, origin, hit, 0, -1).emit?.y).toBe(330)
    expect(composeFrame(TRANSFORM, VP, origin, hit, 0, 0.5).emit?.y).toBe(300)
  })

  it("leaves the emission point on the note's centre when the offset is zero", () => {
    const hit = { x: 600, y: 300, w: 100, h: 20 }
    expect(composeFrame(TRANSFORM, VP, origin, hit, 0.5, 0).emit).toEqual(
      composeFrame(TRANSFORM, VP, origin, hit, 0.5).emit,
    )
  })
})

describe("pitchBounds", () => {
  const hit = { x: 600, y: 300, w: 100, h: 20 }

  it("is the note itself when the voice never leaves it", () => {
    expect(pitchBounds(hit, 0, 0)).toEqual(hit)
  })

  it("grows upward by a rect height per semitone reached above", () => {
    // A semitone up puts the emitter at 300, half a lane above the note's top.
    expect(pitchBounds(hit, 0, 1)).toEqual({ x: 600, y: 300 - 10, w: 100, h: 30 })
  })

  it("grows downward the same way", () => {
    expect(pitchBounds(hit, -1, 0)).toEqual({ x: 600, y: 300, w: 100, h: 30 })
  })

  it("spans both reaches at once, keeping the note inside", () => {
    const box = pitchBounds(hit, -2, 3)
    expect(box.y).toBe(310 - 3 * 20)
    expect(box.y + box.h).toBe(310 + 2 * 20)
    expect(box.y).toBeLessThan(hit.y)
    expect(box.y + box.h).toBeGreaterThan(hit.y + hit.h)
  })

  it("leaves x alone when the contour does not run past the note", () => {
    const box = pitchBounds(hit, -5, 5)
    expect(box.x).toBe(hit.x)
    expect(box.w).toBe(hit.w)
  })

  it("spills sideways by the overhang, evenly on both sides", () => {
    // Half a note's width of curve on each side: twice as wide, centred still.
    const box = pitchBounds(hit, 0, 0, 0.5)
    expect(box.x).toBe(550)
    expect(box.w).toBe(200)
    expect(box.x + box.w / 2).toBe(hit.x + hit.w / 2)
  })
})
