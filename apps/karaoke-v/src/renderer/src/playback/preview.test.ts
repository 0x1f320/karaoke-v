import { describe, expect, it } from "vitest"
import { DEFAULT_PREFERENCES, type PitchPreferences } from "../../../shared/preferences"
import {
  noteAtX,
  phraseEnd,
  phraseStart,
  previewContour,
  previewEmit,
  previewPhrase,
} from "./preview"

const WIDTH = 400
const HEIGHT = 128

const OFF: PitchPreferences = { ...DEFAULT_PREFERENCES.pitch, enabled: false }
const RIDING: PitchPreferences = { ...DEFAULT_PREFERENCES.pitch, enabled: true, mode: "position" }
const SWELLING: PitchPreferences = {
  ...DEFAULT_PREFERENCES.pitch,
  enabled: true,
  mode: "intensity",
}

describe("previewPhrase", () => {
  it("lays the notes out contiguously, rising by one lane a step", () => {
    const { notes } = previewPhrase(WIDTH, HEIGHT)
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i].x).toBe(notes[i - 1].x + notes[i - 1].w)
      expect(notes[i - 1].y - notes[i].y).toBe(notes[i].h)
    }
  })

  it("times the notes off the playhead's constant sweep", () => {
    const phrase = previewPhrase(WIDTH, HEIGHT)
    for (const [i, voice] of phrase.voices.entries()) {
      expect(voice.onS).toBeCloseTo(phrase.notes[i].x * phrase.secondsPerPx)
      expect(voice.offS).toBeCloseTo((phrase.notes[i].x + phrase.notes[i].w) * phrase.secondsPerPx)
    }
  })

  it("stays laid out at a width too small for the inset", () => {
    const { notes } = previewPhrase(8, HEIGHT)
    expect(notes.every((n) => n.w > 0)).toBe(true)
  })
})

describe("previewEmit", () => {
  it("sounds only over the notes", () => {
    const phrase = previewPhrase(WIDTH, HEIGHT)
    expect(previewEmit(phrase, phraseStart(phrase) - 1, RIDING)).toBeNull()
    expect(previewEmit(phrase, phraseEnd(phrase), RIDING)).toBeNull()
    expect(previewEmit(phrase, phraseStart(phrase), RIDING)).not.toBeNull()
  })

  it("sits on the note's centre while nothing follows the pitch", () => {
    const phrase = previewPhrase(WIDTH, HEIGHT)
    for (const [i, note] of phrase.notes.entries()) {
      const emit = previewEmit(phrase, note.x + note.w / 2, OFF)
      expect(emit).toEqual({ index: i, y: note.y + note.h / 2, boost: 1 })
    }
  })

  it("glides up from the note before, a lane below", () => {
    const phrase = previewPhrase(WIDTH, HEIGHT)
    const second = phrase.notes[1]
    const onset = previewEmit(phrase, second.x, RIDING)
    expect(onset?.y).toBeCloseTo(phrase.notes[0].y + second.h / 2, 0)
    // Off the centre only by the vibrato, which is a fraction of a lane.
    const settled = previewEmit(phrase, second.x + second.w / 2, RIDING)
    expect(Math.abs((settled?.y ?? 0) - (second.y + second.h / 2))).toBeLessThan(second.h / 4)
  })

  it("holds the centre in intensity mode and swells instead", () => {
    const phrase = previewPhrase(WIDTH, HEIGHT)
    const second = phrase.notes[1]
    const emit = previewEmit(phrase, second.x + 2, SWELLING)
    expect(emit?.y).toBe(second.y + second.h / 2)
    expect(emit?.boost).toBeGreaterThan(1)
  })
})

describe("previewContour", () => {
  it("runs the whole phrase and follows the emission point", () => {
    const phrase = previewPhrase(WIDTH, HEIGHT)
    const points = previewContour(phrase, RIDING.range)
    expect(points[0].x).toBe(phraseStart(phrase))
    expect(points[points.length - 1].x).toBeCloseTo(phraseEnd(phrase), 0)
    for (const p of points) {
      expect(p.y).toBeCloseTo(previewEmit(phrase, p.x, RIDING)?.y ?? Number.NaN, 5)
    }
  })

  it("never leaves the note it belongs to unmatched", () => {
    const phrase = previewPhrase(WIDTH, HEIGHT)
    for (const p of previewContour(phrase, RIDING.range)) {
      expect(noteAtX(phrase, p.x)).toBeGreaterThanOrEqual(0)
    }
  })
})
