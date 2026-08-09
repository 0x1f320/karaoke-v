import type { AudioMeterSnapshot, AudioMeterState } from "../../../shared/audioMeter"

export const AUDIO_METER_WIDTH = 84
export const AUDIO_METER_HEIGHT = 116
export const AUDIO_METER_PAD_PX = 8
const AUDIO_METER_MIN_DB = -60
const AUDIO_METER_MAX_DB = 12

export interface AudioMeterLabels {
  title: string
  peak: string
  silent: string
  starting: string
  idle: string
  unsupported: string
  error: string
}

export interface AudioMeterRect {
  x: number
  y: number
  w: number
  h: number
}

export interface AudioMeterReadout {
  title: string
  primary: string
  secondary: string
  state: AudioMeterState
}

export function audioMeterRect(clip: AudioMeterRect): AudioMeterRect | null {
  if (
    clip.w < AUDIO_METER_WIDTH + AUDIO_METER_PAD_PX * 2 ||
    clip.h < AUDIO_METER_HEIGHT + AUDIO_METER_PAD_PX * 2
  ) {
    return null
  }
  return {
    x: clip.x + clip.w - AUDIO_METER_WIDTH - AUDIO_METER_PAD_PX,
    y: clip.y + AUDIO_METER_PAD_PX,
    w: AUDIO_METER_WIDTH,
    h: AUDIO_METER_HEIGHT,
  }
}

export function audioMeterLevel(momentaryLufs: number | null): number {
  if (momentaryLufs === null || !Number.isFinite(momentaryLufs)) {
    return 0
  }
  const normalized =
    (momentaryLufs - AUDIO_METER_MIN_DB) / (AUDIO_METER_MAX_DB - AUDIO_METER_MIN_DB)
  return Math.max(0, Math.min(1, normalized))
}

export function audioMeterReadout(
  snapshot: AudioMeterSnapshot,
  labels: AudioMeterLabels,
): AudioMeterReadout {
  const primary =
    snapshot.momentaryLufs === null
      ? stateLabel(snapshot.state, labels)
      : formatDb(snapshot.momentaryLufs)
  const secondary =
    snapshot.peakDb === null
      ? stateLabel(snapshot.state, labels)
      : `${labels.peak} ${formatDb(snapshot.peakDb)}`
  return {
    title: labels.title,
    primary,
    secondary,
    state: snapshot.state,
  }
}

function stateLabel(state: AudioMeterState, labels: AudioMeterLabels): string {
  switch (state) {
    case "idle":
      return labels.idle
    case "starting":
      return labels.starting
    case "silent":
      return labels.silent
    case "unsupported":
      return labels.unsupported
    case "error":
      return labels.error
    case "running":
      return labels.silent
  }
}

function formatDb(value: number): string {
  return value.toFixed(1)
}
