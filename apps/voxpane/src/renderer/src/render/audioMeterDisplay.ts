import type { AudioMeterSnapshot, AudioMeterState } from "../../../shared/audioMeter"

export const AUDIO_METER_WIDTH = 150
export const AUDIO_METER_HEIGHT = 128
export const AUDIO_METER_PAD_PX = 8
const AUDIO_METER_MIN_DB = -60
const AUDIO_METER_MAX_DB = 2
const AUDIO_METER_TICK_VALUES = [2, -10, -20, -30, -40, -50, -60] as const
const AUDIO_METER_GRADIENT = [
  { at: 0, color: 0x2f8cff },
  { at: 0.42, color: 0x35d07f },
  { at: 0.72, color: 0xf7d748 },
  { at: 1, color: 0xff4f5f },
] as const

export interface AudioMeterLabels {
  title: string
  shortTerm: string
  longTerm: string
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
  tertiary: string
  state: AudioMeterState
}

export interface AudioMeterTick {
  value: number
  label: string
  level: number
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

export function audioMeterTicks(): AudioMeterTick[] {
  return AUDIO_METER_TICK_VALUES.map((value) => ({
    value,
    label: formatTick(value),
    level: audioMeterLevel(value),
  }))
}

export function audioMeterLevelColor(level: number, state: AudioMeterState): number {
  if (state === "error" || state === "unsupported") {
    return 0xffc857
  }
  const bounded = Math.max(0, Math.min(1, level))
  for (let index = 1; index < AUDIO_METER_GRADIENT.length; index += 1) {
    const previous = AUDIO_METER_GRADIENT[index - 1]
    const next = AUDIO_METER_GRADIENT[index]
    if (bounded <= next.at) {
      const span = next.at - previous.at
      const amount = span === 0 ? 0 : (bounded - previous.at) / span
      return mixColor(previous.color, next.color, amount)
    }
  }
  return AUDIO_METER_GRADIENT[AUDIO_METER_GRADIENT.length - 1].color
}

export function audioMeterReadout(
  snapshot: AudioMeterSnapshot,
  labels: AudioMeterLabels,
): AudioMeterReadout {
  const primary =
    snapshot.shortTermLufs === null
      ? stateLabel(snapshot.state, labels)
      : `${labels.shortTerm} ${formatDb(snapshot.shortTermLufs)}`
  const secondary =
    snapshot.longTermLufs === null ? "" : `${labels.longTerm} ${formatDb(snapshot.longTermLufs)}`
  const tertiary = snapshot.peakDb === null ? "" : `${labels.peak} ${formatDb(snapshot.peakDb)}`
  return {
    title: labels.title,
    primary,
    secondary: secondary || tertiary || stateLabel(snapshot.state, labels),
    tertiary: secondary ? tertiary : "",
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

function formatTick(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

function mixColor(from: number, to: number, amount: number): number {
  const bounded = Math.max(0, Math.min(1, amount))
  const r = mixChannel((from >> 16) & 0xff, (to >> 16) & 0xff, bounded)
  const g = mixChannel((from >> 8) & 0xff, (to >> 8) & 0xff, bounded)
  const b = mixChannel(from & 0xff, to & 0xff, bounded)
  return (r << 16) | (g << 8) | b
}

function mixChannel(from: number, to: number, amount: number): number {
  return Math.round(from + (to - from) * amount)
}
