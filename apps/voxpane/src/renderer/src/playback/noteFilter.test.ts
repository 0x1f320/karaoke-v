import { describe, expect, it } from "vitest"
import type { BridgeNote } from "../../../shared/bridgeChannels"
import { effectNoteAt, isSilenceLyric, noteInContour } from "./noteFilter"

function note(lyric: string, onS: number, offS: number): BridgeNote {
  return {
    onB: onS * 1000,
    offB: offS * 1000,
    onS,
    offS,
    pitch: 60,
    lyric,
    bend: new Int16Array(),
  }
}

function transport(notes: BridgeNote[]) {
  return {
    noteAt(seconds: number) {
      return notes.find((n) => n.onS <= seconds && seconds < n.offS) ?? null
    },
    neighbours(seconds: number) {
      let before: BridgeNote | null = null
      let after: BridgeNote | null = null
      for (const candidate of notes) {
        if (candidate.onS <= seconds) before = candidate
        if (candidate.onS > seconds) {
          after = candidate
          break
        }
      }
      return { before, after }
    },
  }
}

describe("isSilenceLyric", () => {
  it("recognizes the SynthV silence helper lyrics", () => {
    expect(["br", "sil", "cl"].map(isSilenceLyric)).toEqual([true, true, true])
    expect(isSilenceLyric("la")).toBe(false)
  })
})

describe("noteInContour", () => {
  it("filters the directly sounding note", () => {
    const br = note("br", 0, 1)
    const source = transport([br])

    expect(effectNoteAt(source, 0.5, true)).toBeNull()
    expect(effectNoteAt(source, 0.5, false)).toBe(br)
  })

  it("drops silence helper notes while filtering is enabled", () => {
    const br = note("br", 0, 1)
    expect(noteInContour(transport([br]), 0.5, true)).toBeNull()
  })

  it("keeps silence helper notes when filtering is disabled", () => {
    const sil = note("sil", 0, 1)
    expect(noteInContour(transport([sil]), 0.5, false)).toBe(sil)
  })

  it("can still choose the next voiced note when the previous contour is silence", () => {
    const cl = note("cl", 0, 0.5)
    const voiced = note("가", 0.55, 1)
    voiced.bend = new Int16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])

    expect(noteInContour(transport([cl, voiced]), 0.53, true)).toBe(voiced)
  })
})
