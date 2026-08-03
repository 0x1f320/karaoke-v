import { describe, expect, it } from "vitest"
import type { BridgeNote } from "../../../shared/bridge"
import type { Rect, Viewport } from "../../../shared/geometry"
import { locateNote } from "./locate"
import type { TransportView } from "./transport"

// One blick is one pixel here, so a note's expected x/w read straight off onB/offB.
const VIEW: TransportView = {
  mapping: { perBlick: 1, perSemitone: 12, viewLeft: 0, viewTop: 0 },
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
  return { onB, offB, onS: 0, offS: 1, pitch: 60, lyric: "a" }
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
