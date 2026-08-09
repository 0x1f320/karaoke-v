import { describe, expect, it } from "vitest"
import type { AudioMeterSnapshot } from "../../../shared/audioMeter"
import {
  AUDIO_METER_HEIGHT,
  AUDIO_METER_PAD_PX,
  AUDIO_METER_WIDTH,
  audioMeterLevel,
  audioMeterReadout,
  audioMeterRect,
} from "./audioMeterDisplay"

const BASE: AudioMeterSnapshot = {
  state: "running",
  updatedAtMs: 10,
  momentaryLufs: -18.25,
  shortTermLufs: -19.5,
  longTermLufs: -20.75,
  rmsDb: -17.5,
  peakDb: -3.2,
  sampleRate: 48000,
  channels: 2,
}

const labels = {
  title: "LUFS",
  longTerm: "L",
  peak: "PK",
  silent: "silent",
  starting: "starting",
  idle: "idle",
  unsupported: "unsupported",
  error: "error",
}

describe("audio meter display", () => {
  it("anchors inside the right edge of the piano-roll clip", () => {
    expect(audioMeterRect({ x: 100, y: 40, w: 900, h: 360 })).toEqual({
      x: 1000 - AUDIO_METER_WIDTH - AUDIO_METER_PAD_PX,
      y: 40 + AUDIO_METER_PAD_PX,
      w: AUDIO_METER_WIDTH,
      h: AUDIO_METER_HEIGHT,
    })
  })

  it("hides when the piano-roll clip cannot fit the meter", () => {
    expect(audioMeterRect({ x: 10, y: 20, w: AUDIO_METER_WIDTH, h: 300 })).toBeNull()
    expect(audioMeterRect({ x: 10, y: 20, w: 600, h: AUDIO_METER_HEIGHT })).toBeNull()
  })

  it("formats running LUFS and peak values", () => {
    expect(audioMeterReadout(BASE, labels)).toEqual({
      title: "LUFS",
      primary: "-19.5",
      secondary: "L -20.8  PK -3.2",
      state: "running",
    })
  })

  it("uses state labels when no measured value exists", () => {
    expect(
      audioMeterReadout(
        {
          ...BASE,
          state: "silent",
          momentaryLufs: null,
          shortTermLufs: null,
          longTermLufs: null,
        },
        labels,
      ),
    ).toEqual({
      title: "LUFS",
      primary: "silent",
      secondary: "PK -3.2",
      state: "silent",
    })
  })

  it("maps loudness into a bounded fill level", () => {
    expect(audioMeterLevel(null)).toBe(0)
    expect(audioMeterLevel(-60)).toBe(0)
    expect(audioMeterLevel(-42)).toBeCloseTo(0.25)
    expect(audioMeterLevel(-24)).toBeCloseTo(0.5)
    expect(audioMeterLevel(-6)).toBeCloseTo(0.75)
    expect(audioMeterLevel(12)).toBe(1)
  })
})
