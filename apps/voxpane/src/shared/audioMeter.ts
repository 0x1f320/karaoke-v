export type AudioMeterState = "unsupported" | "idle" | "starting" | "running" | "silent" | "error"

export interface AudioMeterSnapshot {
  state: AudioMeterState
  updatedAtMs: number
  momentaryLufs: number | null
  shortTermLufs: number | null
  longTermLufs: number | null
  rmsDb: number | null
  peakDb: number | null
  sampleRate: number | null
  channels: number | null
  error?: string
}

export const EMPTY_AUDIO_METER_SNAPSHOT: AudioMeterSnapshot = {
  state: "idle",
  updatedAtMs: 0,
  momentaryLufs: null,
  shortTermLufs: null,
  longTermLufs: null,
  rmsDb: null,
  peakDb: null,
  sampleRate: null,
  channels: null,
}

export function unsupportedAudioMeterSnapshot(reason: string, updatedAtMs = 0): AudioMeterSnapshot {
  return {
    ...EMPTY_AUDIO_METER_SNAPSHOT,
    state: "unsupported",
    updatedAtMs,
    error: reason,
  }
}

export function silentAudioMeterSnapshot(
  updatedAtMs: number,
  sampleRate: number,
  channels: number,
): AudioMeterSnapshot {
  return {
    ...EMPTY_AUDIO_METER_SNAPSHOT,
    state: "silent",
    updatedAtMs,
    sampleRate,
    channels,
  }
}

export function audioMeterCanPoll(state: AudioMeterState): boolean {
  return state === "starting" || state === "running" || state === "silent"
}

export function audioMeterShouldDisableAfterRead(state: AudioMeterState): boolean {
  return !audioMeterCanPoll(state)
}

export function clampPcmSample(sample: number): number {
  if (!Number.isFinite(sample)) {
    return 0
  }
  return Math.max(-1, Math.min(1, sample))
}

export function peakDb(samples: readonly number[]): number | null {
  let peak = 0
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(clampPcmSample(sample)))
  }
  return amplitudeToDb(peak)
}

export function rmsDb(samples: readonly number[]): number | null {
  if (samples.length === 0) {
    return null
  }
  let sumSquares = 0
  for (const sample of samples) {
    const clamped = clampPcmSample(sample)
    sumSquares += clamped * clamped
  }
  return amplitudeToDb(Math.sqrt(sumSquares / samples.length))
}

export function estimateMomentaryLufs(samples: readonly number[]): number | null {
  const rms = rmsDb(samples)
  return rms === null ? null : rms - 0.691
}

function amplitudeToDb(amplitude: number): number | null {
  if (amplitude <= 0) {
    return null
  }
  return 20 * Math.log10(amplitude)
}
