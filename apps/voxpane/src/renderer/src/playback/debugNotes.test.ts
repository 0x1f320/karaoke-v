import { describe, expect, it } from "vitest"
import type { BridgeNote } from "../../../shared/bridgeChannels"
import type { Viewport } from "../../../shared/geometry"
import { predictedNoteRect, toReadFrame } from "./debugNotes"
import type { FrameTransform } from "./frame"
import type { TransportView } from "./transport"

const note: BridgeNote = {
  onB: 30,
  offB: 50,
  onS: 0,
  offS: 1,
  pitch: 60,
  lyric: "a",
  bend: new Int16Array(0),
}

const view: TransportView = {
  mapping: {
    perBlick: 2,
    perSemitone: 12,
    viewLeft: 10,
    viewRight: 100,
    viewTop: 72,
    viewBottom: 48,
  },
  canvasX: 100,
  contentX: 80,
  contentW: 1000,
}

const vp: Viewport = {
  canvas: { x: 120, y: 40, w: 600, h: 300 },
  contentX: 90,
  contentW: 2000,
  refY: 760,
}

describe("predictedNoteRect", () => {
  it("places a note in the current viewport from the transport view mapping", () => {
    expect(predictedNoteRect(note, view, vp)).toEqual({
      x: 210,
      y: 34,
      w: 80,
      h: 12,
    })
  })
})

describe("toReadFrame", () => {
  it("expresses a current global rect in the coordinate frame that content transform draws", () => {
    const transform: FrameTransform = { scaleX: 2, contentOffsetX: 30, dy: -5 }
    expect(toReadFrame({ x: 370, y: 34, w: 80, h: 12 }, transform)).toEqual({
      x: 170,
      y: 39,
      w: 40,
      h: 12,
    })
  })
})
