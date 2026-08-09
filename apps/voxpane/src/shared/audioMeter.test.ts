import { describe, expect, it } from "vitest"
import {
  audioMeterCanPoll,
  audioMeterShouldDisableAfterRead,
  clampPcmSample,
  EMPTY_AUDIO_METER_SNAPSHOT,
  estimateMomentaryLufs,
  peakDb,
  rmsDb,
  silentAudioMeterSnapshot,
  unsupportedAudioMeterSnapshot,
} from "./audioMeter"

describe("audio meter snapshots", () => {
  it("builds an idle snapshot with no measured values", () => {
    expect(EMPTY_AUDIO_METER_SNAPSHOT).toEqual({
      state: "idle",
      updatedAtMs: 0,
      momentaryLufs: null,
      shortTermLufs: null,
      longTermLufs: null,
      rmsDb: null,
      peakDb: null,
      sampleRate: null,
      channels: null,
    })
  })

  it("builds unsupported snapshots with a reason", () => {
    expect(unsupportedAudioMeterSnapshot("process loopback unavailable", 12)).toEqual({
      state: "unsupported",
      updatedAtMs: 12,
      momentaryLufs: null,
      shortTermLufs: null,
      longTermLufs: null,
      rmsDb: null,
      peakDb: null,
      sampleRate: null,
      channels: null,
      error: "process loopback unavailable",
    })
  })

  it("builds silent snapshots without treating silence as an error", () => {
    expect(silentAudioMeterSnapshot(34, 48000, 2)).toEqual({
      state: "silent",
      updatedAtMs: 34,
      momentaryLufs: null,
      shortTermLufs: null,
      longTermLufs: null,
      rmsDb: null,
      peakDb: null,
      sampleRate: 48000,
      channels: 2,
    })
  })
})

describe("audio meter polling state", () => {
  it("keeps polling active capture states", () => {
    expect(audioMeterCanPoll("starting")).toBe(true)
    expect(audioMeterCanPoll("running")).toBe(true)
    expect(audioMeterCanPoll("silent")).toBe(true)
  })

  it("disables the meter after terminal read states", () => {
    expect(audioMeterShouldDisableAfterRead("idle")).toBe(true)
    expect(audioMeterShouldDisableAfterRead("unsupported")).toBe(true)
    expect(audioMeterShouldDisableAfterRead("error")).toBe(true)
  })
})

describe("audio meter math", () => {
  it("clamps PCM samples into the normalized range", () => {
    expect(clampPcmSample(-2)).toBe(-1)
    expect(clampPcmSample(-0.25)).toBe(-0.25)
    expect(clampPcmSample(0.25)).toBe(0.25)
    expect(clampPcmSample(2)).toBe(1)
    expect(clampPcmSample(Number.NaN)).toBe(0)
  })

  it("returns null levels for silence or empty buffers", () => {
    expect(peakDb([])).toBeNull()
    expect(rmsDb([])).toBeNull()
    expect(estimateMomentaryLufs([])).toBeNull()
    expect(peakDb([0, 0, 0])).toBeNull()
    expect(rmsDb([0, 0, 0])).toBeNull()
    expect(estimateMomentaryLufs([0, 0, 0])).toBeNull()
  })

  it("reports full-scale peak near zero dBFS", () => {
    expect(peakDb([0, 1, -0.5])).toBeCloseTo(0, 6)
  })

  it("reports lower RMS for lower-amplitude samples", () => {
    const loud = rmsDb([1, -1, 1, -1])
    const quiet = rmsDb([0.25, -0.25, 0.25, -0.25])

    expect(loud).toBeCloseTo(0, 6)
    if (quiet === null || loud === null) {
      throw new Error("expected finite RMS values")
    }
    expect(quiet).toBeLessThan(loud)
    expect(quiet).toBeCloseTo(-12.041, 3)
  })

  it("estimates momentary LUFS from RMS with the documented first-pass offset", () => {
    expect(estimateMomentaryLufs([1, -1, 1, -1])).toBeCloseTo(-0.691, 3)
    expect(estimateMomentaryLufs([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(-6.712, 3)
  })
})
