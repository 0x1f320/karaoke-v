import { describe, expect, it } from "vitest"
import { composeFrame, frameTransform } from "../src/renderer/src/playback/frame"
import type { PianoRoll, Viewport } from "../src/shared/geometry"

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
})
