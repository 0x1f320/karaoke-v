import { describe, expect, it } from "vitest"
import type { BridgeNote } from "../../../shared/bridgeChannels"
import type { Rect, Viewport } from "../../../shared/geometry"
import { anchoredRect, anchorFromMatch, followRect, locateNote, rebaseAnchor } from "./locate"
import type { TransportView } from "./transport"

// One blick is one pixel here, so a note's expected x/w read straight off onB/offB.
const VIEW: TransportView = {
  mapping: {
    perBlick: 1,
    perSemitone: 12,
    viewLeft: 0,
    viewRight: 1000,
    viewTop: 0,
    viewBottom: -12,
  },
  contentX: 0,
  contentW: 1000,
  canvasX: 0,
}

const VP: Viewport = {
  canvas: { x: 0, y: 0, w: 1000, h: 400 },
  contentX: 0,
  contentW: 1000,
  refY: 0,
}

const IDENTITY = { scaleX: 1, offsetX: 0 }

function note(onB: number, offB: number): BridgeNote {
  return { onB, offB, onS: 0, offS: 1, pitch: 60, lyric: "a", bend: new Int16Array(0) }
}

function rect(x: number, w: number): Rect {
  return { x, y: 100, w, h: 12 }
}

describe("locateNote", () => {
  it("picks the rect sitting where the mapping predicts", () => {
    const rects = [rect(0, 100), rect(200, 100), rect(600, 100)]
    expect(locateNote(note(200, 300), VIEW, VP, rects, IDENTITY)).toBe(rects[1])
  })

  it("follows scroll between the anchor and the frame", () => {
    const rects = [rect(150, 100)]
    const scrolled = { ...VP, contentX: -50 }
    expect(locateNote(note(200, 300), VIEW, scrolled, rects, IDENTITY)).toBe(rects[0])
  })

  it("scales the prediction with zoom", () => {
    const zoomed = { ...VP, contentW: 2000 }
    const rects = [rect(400, 200)]
    expect(locateNote(note(200, 300), VIEW, zoomed, rects, IDENTITY)).toBe(rects[0])
  })

  it("maps the rects through the read-to-now transform", () => {
    const rects = [rect(100, 50)]
    expect(locateNote(note(200, 300), VIEW, VP, rects, { scaleX: 2, offsetX: 0 })).toBe(rects[0])
  })

  it("rejects a rect whose width disagrees", () => {
    const rects = [rect(200, 40)]
    expect(locateNote(note(200, 300), VIEW, VP, rects, IDENTITY)).toBeNull()
  })

  it("accepts a width inside the tolerance", () => {
    const rects = [rect(200, 120)]
    expect(locateNote(note(200, 300), VIEW, VP, rects, IDENTITY)).toBe(rects[0])
  })

  it("gives short notes an absolute width slack, so they stay matchable", () => {
    const rects = [rect(200, 5)]
    expect(locateNote(note(200, 202), VIEW, VP, rects, IDENTITY)).toBe(rects[0])
  })

  it("takes the closest of several rects of the right width", () => {
    const rects = [rect(150, 100), rect(210, 100), rect(400, 100)]
    expect(locateNote(note(200, 300), VIEW, VP, rects, IDENTITY)).toBe(rects[1])
  })

  it("tolerates a slip up to half the note's width", () => {
    const rects = [rect(249, 100)]
    expect(locateNote(note(200, 300), VIEW, VP, rects, IDENTITY)).toBe(rects[0])
  })

  it("returns null rather than the wrong note when nothing is close enough", () => {
    const rects = [rect(400, 100)]
    expect(locateNote(note(200, 300), VIEW, VP, rects, IDENTITY)).toBeNull()
  })

  it("allows a minimum slip even for a hairline note", () => {
    const rects = [rect(215, 2)]
    expect(locateNote(note(200, 202), VIEW, VP, rects, IDENTITY)).toBe(rects[0])
    expect(locateNote(note(200, 202), VIEW, VP, [rect(230, 2)], IDENTITY)).toBeNull()
  })

  it("returns null with no rects at all", () => {
    expect(locateNote(note(200, 300), VIEW, VP, [], IDENTITY)).toBeNull()
  })

  it("falls back to no zoom when a content width is missing", () => {
    const rects = [rect(200, 100)]
    expect(locateNote(note(200, 300), VIEW, { ...VP, contentW: 0 }, rects, IDENTITY)).toBe(rects[0])
    expect(locateNote(note(200, 300), { ...VIEW, contentW: 0 }, VP, rects, IDENTITY)).toBe(rects[0])
  })
})

describe("followRect", () => {
  const FRAME = { contentX: 0, contentW: 1000, refY: 0 }

  it("finds the same note after a scroll, without consulting the mapping", () => {
    // The roll scrolled 300px left: the read's frame and its rects moved together.
    const moved = { ...FRAME, contentX: -300 }
    const rects = [rect(-100, 100), rect(-300, 100)]
    expect(followRect(rect(0, 100), FRAME, moved, rects)).toBe(rects[1])
  })

  it("follows a vertical scroll through the reference chip", () => {
    const moved = { ...FRAME, refY: -40 }
    const rects = [{ ...rect(0, 100), y: 60 }, rect(0, 100)]
    expect(followRect(rect(0, 100), FRAME, moved, rects)).toBe(rects[0])
  })

  it("follows a zoom through the content width", () => {
    const zoomed = { ...FRAME, contentW: 2000 }
    const rects = [rect(200, 200), rect(100, 100)]
    expect(followRect(rect(100, 100), FRAME, zoomed, rects)).toBe(rects[0])
  })

  it("takes no rect at all rather than the note next door", () => {
    expect(followRect(rect(0, 100), FRAME, FRAME, [rect(120, 100)])).toBeNull()
    expect(followRect(rect(0, 100), FRAME, FRAME, [])).toBeNull()
  })

  it("will not follow into a rect of another width", () => {
    expect(followRect(rect(0, 100), FRAME, FRAME, [rect(0, 40)])).toBeNull()
  })
})

describe("anchorFromMatch", () => {
  const READ = { contentX: 0, contentW: 1000, refY: 0 }

  it("reads the whole read's musical-to-pixel line off one matched rect", () => {
    const matched = note(200, 300)
    const anchor = anchorFromMatch(matched, rect(500, 100), VIEW, READ)
    // The rect it came from comes back exactly.
    expect(anchoredRect(matched, anchor)).toEqual({ x: 500, y: 100, w: 100, h: 12 })
    // And every other note follows from it, with no mapping anchor involved.
    expect(anchoredRect(note(400, 500), anchor)).toEqual({ x: 700, y: 100, w: 100, h: 12 })
  })

  it("places other pitches by the lane height", () => {
    const anchor = anchorFromMatch(note(200, 300), rect(500, 100), VIEW, READ)
    const higher = { ...note(200, 300), pitch: 62 }
    const lower = { ...note(200, 300), pitch: 59 }
    expect(anchoredRect(higher, anchor).y).toBe(100 - 2 * 12)
    expect(anchoredRect(lower, anchor).y).toBe(100 + 12)
  })

  it("rescales the mapping into the read's own zoom", () => {
    const zoomed = { ...READ, contentW: 2000 }
    const anchor = anchorFromMatch(note(200, 300), rect(500, 200), VIEW, zoomed)
    expect(anchor.perBlick).toBe(2)
    expect(anchoredRect(note(400, 500), anchor)).toMatchObject({ x: 900, w: 200 })
  })

  it("survives being carried into the next read", () => {
    const anchor = anchorFromMatch(note(200, 300), rect(500, 100), VIEW, READ)
    const moved = { ...READ, contentX: -300, refY: -40 }
    const carried = rebaseAnchor(anchor, READ, moved)
    // The read moved with the roll, so the same note is where that read has it.
    expect(anchoredRect(note(200, 300), carried)).toEqual({ x: 200, y: 60, w: 100, h: 12 })
  })

  it("carries a zoom between reads through the content width", () => {
    const anchor = anchorFromMatch(note(200, 300), rect(500, 100), VIEW, READ)
    const zoomed = { ...READ, contentW: 2000 }
    const carried = rebaseAnchor(anchor, READ, zoomed)
    expect(anchoredRect(note(200, 300), carried)).toMatchObject({ x: 1000, w: 200 })
  })
})
