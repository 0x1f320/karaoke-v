import { describe, expect, it } from "vitest"
import type { PianoRoll, Viewport } from "../src/shared/geometry"
import {
  type DipTransform,
  IDENTITY_DIP,
  toDipPianoRoll,
  toDipRect,
  toDipViewport,
  toDipX,
  toDipY,
} from "../src/shared/native"

// A 2x display whose top-left sits at physical (1920, 0) and DIP (1440, 0) —
// the second-monitor case, where scale alone would put everything in the wrong place.
const SCALED: DipTransform = {
  scale: 2,
  originPx: { x: 1920, y: 0 },
  originDip: { x: 1440, y: 0 },
}

describe("toDipX / toDipY", () => {
  it("is the identity under IDENTITY_DIP", () => {
    expect(toDipX(IDENTITY_DIP, 137)).toBe(137)
    expect(toDipY(IDENTITY_DIP, -42)).toBe(-42)
  })

  it("scales relative to the display origin, not the desktop origin", () => {
    expect(toDipX(SCALED, 1920)).toBe(1440)
    expect(toDipX(SCALED, 2920)).toBe(1940)
    expect(toDipY(SCALED, 300)).toBe(150)
  })
})

describe("toDipRect", () => {
  it("moves the origin and shrinks the size", () => {
    expect(toDipRect(SCALED, { x: 2920, y: 400, w: 200, h: 100 })).toEqual({
      x: 1940,
      y: 200,
      w: 100,
      h: 50,
    })
  })

  it("leaves a rect alone under IDENTITY_DIP", () => {
    const rect = { x: 10, y: 20, w: 30, h: 40 }
    expect(toDipRect(IDENTITY_DIP, rect)).toEqual(rect)
  })
})

describe("toDipViewport", () => {
  const viewport: Viewport = {
    canvas: { x: 2920, y: 400, w: 800, h: 600 },
    contentX: 2020,
    contentW: 4000,
    refY: 500,
    origin: { x: 2000, y: 100 },
  }

  it("maps the canvas, the scroll position and the optional fields", () => {
    expect(toDipViewport(SCALED, viewport)).toEqual({
      canvas: { x: 1940, y: 200, w: 400, h: 300 },
      contentX: 1490,
      contentW: 2000,
      refY: 250,
      origin: { x: 1480, y: 50 },
    })
  })

  it("omits refY and origin when they were absent, rather than emitting NaN", () => {
    const bare: Viewport = { canvas: viewport.canvas, contentX: 2020, contentW: 4000 }
    const out = toDipViewport(SCALED, bare)
    expect("refY" in out).toBe(false)
    expect("origin" in out).toBe(false)
  })

  it("treats contentX as a coordinate, not a length", () => {
    // Scale alone would give 1010; the display origin is what makes it 1490.
    expect(toDipViewport(SCALED, viewport).contentX).toBe(1490)
  })
})

describe("toDipPianoRoll", () => {
  const read: PianoRoll = {
    canvas: { x: 2920, y: 400, w: 800, h: 600 },
    contentX: 2020,
    contentW: 4000,
    refY: 500,
    xStable: true,
    yStable: false,
    notes: [
      { x: 2920, y: 400, w: 100, h: 20 },
      { x: 3120, y: 440, w: 60, h: 20 },
    ],
  }

  it("maps every note and keeps the non-geometric fields", () => {
    const out = toDipPianoRoll(SCALED, read)
    expect(out.notes).toEqual([
      { x: 1940, y: 200, w: 50, h: 10 },
      { x: 2040, y: 220, w: 30, h: 10 },
    ])
    expect(out.xStable).toBe(true)
    expect(out.yStable).toBe(false)
    expect(out.refY).toBe(250)
  })

  it("is a no-op under IDENTITY_DIP", () => {
    expect(toDipPianoRoll(IDENTITY_DIP, read)).toEqual(read)
  })
})
