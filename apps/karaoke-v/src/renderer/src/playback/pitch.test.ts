import { describe, expect, it } from "vitest"
import type { BridgeNote } from "../../../shared/bridgeChannels"
import { DEFAULT_PREFERENCES } from "../../../shared/preferences"
import { intensityScale, pitchExtent, samplePitch } from "./pitch"

function note(over: Partial<BridgeNote> = {}): BridgeNote {
  return { onB: 0, offB: 100, onS: 0, offS: 1, pitch: 60, lyric: "a", bend: EMPTY, ...over }
}

/** An empty contour is how the channel says "the engine has no curve here". */
const EMPTY = new Int16Array()

function bend(...cents: number[]): Int16Array {
  return Int16Array.from(cents)
}

/**
 * A contour shaped the way the bridge sends one: the note's own samples with
 * eight edge-held samples of the curve on each side of it.
 */
function padded(inner: number[], lead = inner[0], tail = inner[inner.length - 1]): Int16Array {
  return Int16Array.from([...Array(8).fill(lead), ...inner, ...Array(8).fill(tail)])
}

const RANGE = 12

describe("samplePitch with a contour from the bridge", () => {
  it("reads the contour in cents, evenly spread from onset to end", () => {
    const n = note({ bend: bend(0, 100, -100) })
    expect(samplePitch(n, null, 0, RANGE).offset).toBeCloseTo(0)
    expect(samplePitch(n, null, 0.5, RANGE).offset).toBeCloseTo(1)
    expect(samplePitch(n, null, 1, RANGE).offset).toBeCloseTo(-1)
  })

  it("interpolates between samples", () => {
    const n = note({ bend: bend(0, 100) })
    expect(samplePitch(n, null, 0.25, RANGE).offset).toBeCloseTo(0.25)
    expect(samplePitch(n, null, 0.75, RANGE).offset).toBeCloseTo(0.75)
  })

  it("holds the ends rather than running off them", () => {
    const n = note({ bend: bend(50, 150) })
    expect(samplePitch(n, null, -5, RANGE).offset).toBeCloseTo(0.5)
    expect(samplePitch(n, null, 99, RANGE).offset).toBeCloseTo(1.5)
  })

  it("takes a single sample as the whole note", () => {
    const n = note({ bend: bend(42) })
    expect(samplePitch(n, null, 0.7, RANGE).offset).toBeCloseTo(0.42)
  })

  it("prefers the contour over anything it would have synthesized", () => {
    const previous = note({ pitch: 72, onS: -1, offS: 0 })
    const n = note({ bend: bend(0, 0, 0) })
    expect(samplePitch(n, previous, 0, RANGE).offset).toBe(0)
  })

  it("survives a zero-length note without dividing by it", () => {
    const n = note({ onS: 2, offS: 2, bend: bend(0, 300) })
    expect(Number.isFinite(samplePitch(n, null, 0, RANGE).offset)).toBe(true)
  })
})

describe("samplePitch bounds", () => {
  // Measured against a sung project: real scoops and portamento carry the voice
  // about ten semitones out, so the default has to clear that or it flattens
  // the very movement the feature exists to show.
  it("lets a real excursion through at the default range", () => {
    const n = note({ bend: bend(-1250), offS: 0.4 })
    expect(samplePitch(n, null, 0.2, DEFAULT_PREFERENCES.pitch.range).offset).toBeCloseTo(-12.5)
  })

  // The engine reports unvoiced frames as a pitch of zero rather than as a gap,
  // which is an offset of most of an octave. The script filters it, so this is
  // the second line: an older or broken writer must not reach the canvas.
  it("bounds a wild contour to the range", () => {
    const n = note({ bend: bend(-6900, -6900) })
    expect(samplePitch(n, null, 0.5, 12).offset).toBe(-12)
    expect(samplePitch(n, null, 0.5, 2).offset).toBe(-2)
  })

  it("bounds upward too", () => {
    expect(samplePitch(note({ bend: bend(5000) }), null, 0, 3).offset).toBe(3)
  })

  it("measures speed before the bound, so intensity follows the voice", () => {
    const clamped = samplePitch(note({ bend: bend(0, 6900) }), null, 0.5, 0.1)
    expect(clamped.offset).toBe(0.1)
    expect(clamped.speed).toBeGreaterThan(0)
  })
})

describe("samplePitch without a contour", () => {
  it("glides in from the note before instead of starting on pitch", () => {
    const previous = note({ pitch: 62, onS: -1, offS: 0 })
    const n = note({ pitch: 60 })
    const start = samplePitch(n, previous, 0, RANGE).offset
    const later = samplePitch(n, previous, 0.06, RANGE).offset
    expect(start).toBeCloseTo(2)
    expect(later).toBeLessThan(start)
    expect(later).toBeGreaterThan(0)
  })

  it("settles onto the note's own pitch once the glide is done", () => {
    const previous = note({ pitch: 62, onS: -1, offS: 0 })
    expect(samplePitch(note(), previous, 0.2, RANGE).offset).toBeCloseTo(0)
  })

  it("does not glide across a rest", () => {
    const distant = note({ pitch: 72, onS: -2, offS: -1 })
    expect(samplePitch(note(), distant, 0, RANGE).offset).toBe(0)
  })

  it("starts flat when there is no note before", () => {
    expect(samplePitch(note(), null, 0, RANGE).offset).toBe(0)
  })

  it("leaves short notes without vibrato", () => {
    const short = note({ offS: 0.2 })
    for (const t of [0, 0.1, 0.2]) {
      expect(samplePitch(short, null, t, RANGE).offset).toBe(0)
    }
  })

  it("works vibrato into a held note", () => {
    const held = note({ offS: 4 })
    const offsets = []
    for (let t = 0.3; t < 1.5; t += 0.01) {
      offsets.push(samplePitch(held, null, t, RANGE).offset)
    }
    const min = Math.min(...offsets)
    const max = Math.max(...offsets)
    expect(max).toBeGreaterThan(0.05)
    expect(min).toBeLessThan(-0.05)
    // An ornament, not a transposition: it has to stay well inside its lane.
    expect(max).toBeLessThan(0.5)
    expect(min).toBeGreaterThan(-0.5)
  })

  it("reports movement as speed while the pitch is moving", () => {
    const previous = note({ pitch: 64, onS: -1, offS: 0 })
    const moving = samplePitch(note(), previous, 0.02, RANGE)
    const settled = samplePitch(note(), previous, 0.5, RANGE)
    expect(moving.speed).toBeGreaterThan(settled.speed)
  })
})

describe("intensityScale", () => {
  it("leaves the effect alone when it is switched off", () => {
    expect(intensityScale(50, 0)).toBe(1)
  })

  it("leaves a still pitch alone", () => {
    expect(intensityScale(0, 0.2)).toBe(1)
  })

  it("rises with movement", () => {
    expect(intensityScale(4, 0.1)).toBeCloseTo(1.4)
    expect(intensityScale(8, 0.1)).toBeCloseTo(1.8)
  })

  it("caps, so a portamento cannot blow the effect out", () => {
    expect(intensityScale(1000, 1)).toBe(3)
  })
})

describe("pitchExtent", () => {
  it("spans the contour it was given", () => {
    expect(pitchExtent(note({ bend: bend(-250, 0, 380) }), null, RANGE)).toEqual({
      lowest: -2.5,
      highest: 3.8,
      overhang: 0,
    })
  })

  it("always contains the note's own pitch", () => {
    expect(pitchExtent(note({ bend: bend(100, 200) }), null, RANGE)).toEqual({
      lowest: 0,
      highest: 2,
      overhang: 0,
    })
  })

  it("is bounded exactly as one sample is", () => {
    expect(pitchExtent(note({ bend: bend(-6900, 6900) }), null, 3)).toEqual({
      lowest: -3,
      highest: 3,
      overhang: 0,
    })
  })

  it("reads the glide off the synthesis when there is no contour", () => {
    const previous = note({ pitch: 65, onS: -1, offS: 0 })
    expect(pitchExtent(note(), previous, RANGE).highest).toBe(5)
  })

  it("counts vibrato on a note long enough to have it", () => {
    const held = pitchExtent(note({ offS: 4 }), null, RANGE)
    expect(held.highest).toBeGreaterThan(0)
    expect(held.lowest).toBeLessThan(0)
    expect(pitchExtent(note({ offS: 0.2 }), null, RANGE)).toEqual({
      lowest: 0,
      highest: 0,
      overhang: 0,
    })
  })
})

describe("a contour with the padding the bridge sends", () => {
  // Nine samples over the note, so the note's own span is eight steps wide and
  // the eight pad samples on each side are exactly one note-width of overhang.
  const inner = [0, 0, 0, 0, 0, 0, 0, 0, 0]

  it("reads the note's onset and end at the pad, not at the array's ends", () => {
    const n = note({ bend: padded(inner, -900, 900) })
    expect(samplePitch(n, null, 0, RANGE).offset).toBeCloseTo(0)
    expect(samplePitch(n, null, 1, RANGE).offset).toBeCloseTo(0)
  })

  it("still walks the note's own samples across it", () => {
    const n = note({ bend: padded([0, 100, 200, 300, 400, 500, 600, 700, 800]) })
    expect(samplePitch(n, null, 0, RANGE).offset).toBeCloseTo(0)
    expect(samplePitch(n, null, 0.5, RANGE).offset).toBeCloseTo(4)
    expect(samplePitch(n, null, 1, RANGE).offset).toBeCloseTo(8)
  })

  it("reaches the padding in the extent, which is what the band draws", () => {
    const extent = pitchExtent(note({ bend: padded(inner, -900, 900) }), null, RANGE)
    expect(extent.lowest).toBe(-9)
    expect(extent.highest).toBe(9)
  })

  it("measures the overhang as a fraction of the note's width", () => {
    expect(pitchExtent(note({ bend: padded(inner) }), null, RANGE).overhang).toBeCloseTo(1)
  })

  it("claims no overhang for a contour too short to carry the padding", () => {
    expect(pitchExtent(note({ bend: bend(0, 50) }), null, RANGE).overhang).toBe(0)
  })
})
