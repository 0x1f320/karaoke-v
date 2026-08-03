import { describe, expect, it } from "vitest"
import type { BridgeNote, BridgeState } from "./bridgeChannels"
import { expectedCanvasSize, pianoRollFrom, viewportFrom } from "./windowsGeometry"

// A view two quarters wide showing twelve semitones, at one pixel per hundredth
// of a quarter and ten pixels per semitone: everything below is in whole pixels
// on purpose, so a wrong sign or a swapped edge is visible rather than plausible.
const QUARTER = 705600000

function state(overrides: Partial<BridgeState["px"]> = {}): BridgeState {
  return {
    seq: 1,
    notesSeq: 1,
    at: 0,
    status: "playing",
    loop: null,
    rev: "r",
    px: {
      perBlick: 100 / QUARTER,
      perSemitone: 10,
      viewLeft: QUARTER,
      viewRight: 3 * QUARTER,
      viewTop: 72,
      viewBottom: 60,
      ...overrides,
    },
  }
}

const CANVAS = { x: 1000, y: 500, w: 200, h: 120 }

function note(onQuarters: number, offQuarters: number, pitch: number): BridgeNote {
  return {
    onB: onQuarters * QUARTER,
    offB: offQuarters * QUARTER,
    onS: onQuarters * 0.5,
    offS: offQuarters * 0.5,
    pitch,
    lyric: "a",
    bend: new Int16Array(0),
  }
}

describe("expectedCanvasSize", () => {
  it("is the view range in pixels — what identifies the element to UI Automation", () => {
    expect(expectedCanvasSize(state())).toEqual({ width: 200, height: 120 })
  })

  it("follows a zoom", () => {
    expect(expectedCanvasSize(state({ perBlick: 200 / QUARTER })).width).toBe(400)
  })
})

describe("viewportFrom", () => {
  it("puts blick 0 one screenful left of the canvas, and value 0 far below it", () => {
    const viewport = viewportFrom(state(), CANVAS)
    // viewLeft is one quarter in, at 100px per quarter.
    expect(viewport.contentX).toBe(CANVAS.x - 100)
    // The top of the view is value 72, at 10px per semitone.
    expect(viewport.refY).toBe(CANVAS.y + 720)
    expect(viewport.canvas).toBe(CANVAS)
  })

  it("scrolls contentX with the view and leaves contentW alone", () => {
    const scrolled = viewportFrom(state({ viewLeft: 2 * QUARTER, viewRight: 4 * QUARTER }), CANVAS)
    expect(scrolled.contentX).toBe(CANVAS.x - 200)
    expect(scrolled.contentW).toBe(viewportFrom(state(), CANVAS).contentW)
  })

  it("moves contentW only when the zoom does, since that is all it is compared for", () => {
    const zoomed = viewportFrom(state({ perBlick: 200 / QUARTER }), CANVAS)
    expect(zoomed.contentW).toBeCloseTo(viewportFrom(state(), CANVAS).contentW * 2)
  })

  it("carries the window origin through when the helper sampled one", () => {
    expect(viewportFrom(state(), CANVAS, { x: 900, y: 400 })?.origin).toEqual({ x: 900, y: 400 })
    expect(viewportFrom(state(), CANVAS).origin).toBeUndefined()
  })
})

describe("pianoRollFrom", () => {
  it("places a note where the transform says it is", () => {
    const roll = pianoRollFrom(state(), [note(1, 2, 72)], CANVAS)
    expect(roll.notes).toEqual([
      {
        x: CANVAS.x, // onset is exactly viewLeft
        // A lane is centred on its value, so its top edge is half a semitone up.
        y: CANVAS.y + 720 - 72.5 * 10,
        w: 100,
        h: 10,
      },
    ])
  })

  it("drops notes that fall outside the canvas", () => {
    const roll = pianoRollFrom(
      state(),
      [note(-10, -9, 66), note(1, 2, 66), note(40, 41, 66)],
      CANVAS,
    )
    expect(roll.notes).toHaveLength(1)
  })

  it("keeps a note straddling the edge", () => {
    const roll = pianoRollFrom(state(), [note(0, 4, 66)], CANVAS)
    expect(roll.notes).toHaveLength(1)
  })

  it("reports stable geometry — it is computed, not read off a moving tree", () => {
    const roll = pianoRollFrom(state(), [], CANVAS)
    expect(roll.xStable).toBe(true)
    expect(roll.yStable).toBe(true)
  })

  it("carries the same viewport the viewport call would give", () => {
    const roll = pianoRollFrom(state(), [], CANVAS)
    const viewport = viewportFrom(state(), CANVAS)
    expect(roll.contentX).toBe(viewport.contentX)
    expect(roll.refY).toBe(viewport.refY)
    expect(roll.contentW).toBe(viewport.contentW)
  })
})
