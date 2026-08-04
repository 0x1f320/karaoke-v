import type { BridgeNote } from "../../../shared/bridgeChannels"
import type { Rect } from "../../../shared/geometry"
import type { PitchPreferences } from "../../../shared/preferences"
import { intensityScale, samplePitch } from "./pitch"

// The phrase the settings preview plays: a rising staircase of notes, and a
// playhead crossing it at a constant speed.
//
// The notes are a bridge note set like any other, so the sung curve under them
// is the one `samplePitch` synthesizes for a real project — the preview follows
// the same line the overlay would, rather than a shape of its own.

/** Notes in the phrase, every step the same length. */
const NOTE_COUNT = 3
export const NOTE_HEIGHT = 24
/** Room kept before the first note and after the last one. */
const INSET_X = 28
/**
 * Pitch step between consecutive notes, in semitones. A note rect is one
 * semitone tall, so this is also its height in lanes — which is what makes the
 * glide into a note land exactly on the lane it came from.
 */
const NOTE_STEP = 1
/** Seconds for the playhead to cross the preview edge to edge. */
export const CYCLE_SEC = 2.9
/** Arbitrary: nothing here depends on where the phrase sits on the keyboard. */
const BASE_PITCH = 60
/** Spacing of the sampled contour, in px. */
const CONTOUR_STEP_PX = 2

const NO_BEND = new Int16Array(0)

export interface PreviewPhrase {
  notes: readonly Rect[]
  /** One per note rect, in the same order. */
  voices: readonly BridgeNote[]
  secondsPerPx: number
}

export interface PreviewEmit {
  /** Which note is sounding. */
  index: number
  /** Where the effect sits, in preview px. */
  y: number
  /** Where the trail is written — on the sung curve however the effects are set. */
  trailY: number
  /** What pitch movement does to the effect's strength. */
  boost: number
}

export function previewPhrase(width: number, height: number): PreviewPhrase {
  const slot = Math.max(width - INSET_X * 2, NOTE_COUNT) / NOTE_COUNT
  const step = NOTE_HEIGHT * NOTE_STEP
  const topY = Math.round((height - NOTE_HEIGHT - step * (NOTE_COUNT - 1)) / 2)
  // Edges are rounded once and shared, so consecutive steps butt up against
  // each other with no seam and still come out the same length.
  const edges = Array.from({ length: NOTE_COUNT + 1 }, (_, i) => Math.round(INSET_X + slot * i))
  const secondsPerPx = width > 0 ? CYCLE_SEC / width : 0

  const notes = Array.from({ length: NOTE_COUNT }, (_, i) => ({
    x: edges[i],
    y: topY + step * (NOTE_COUNT - 1 - i),
    w: edges[i + 1] - edges[i],
    h: NOTE_HEIGHT,
  }))
  const voices = notes.map((_, i) => ({
    onB: 0,
    offB: 0,
    onS: edges[i] * secondsPerPx,
    offS: edges[i + 1] * secondsPerPx,
    pitch: BASE_PITCH + i * NOTE_STEP,
    lyric: "",
    bend: NO_BEND,
  }))
  return { notes, voices, secondsPerPx }
}

export function phraseStart(phrase: PreviewPhrase): number {
  const first = phrase.notes[0]
  return first ? first.x : 0
}

export function phraseEnd(phrase: PreviewPhrase): number {
  const last = phrase.notes[phrase.notes.length - 1]
  return last ? last.x + last.w : 0
}

/** Which note the playhead is over, or -1 where the phrase is silent. */
export function noteAtX(phrase: PreviewPhrase, x: number): number {
  return phrase.notes.findIndex((n) => x >= n.x && x < n.x + n.w)
}

/**
 * Where the effect sits with the playhead at `x`, and how hard it burns there.
 * Null where nothing sounds.
 */
export function previewEmit(
  phrase: PreviewPhrase,
  x: number,
  pitch: PitchPreferences,
): PreviewEmit | null {
  const index = noteAtX(phrase, x)
  if (index < 0) {
    return null
  }
  const note = phrase.notes[index]
  const centre = note.y + note.h / 2
  const voice = phrase.voices[index]
  const sung = samplePitch(
    voice,
    phrase.voices[index - 1] ?? null,
    x * phrase.secondsPerPx - voice.onS,
    pitch.range,
  )
  // The rect is one semitone tall, so an offset in semitones scales by its
  // height — the same mapping the overlay places the effect with.
  const emit: PreviewEmit = { index, y: centre, trailY: centre - sung.offset * note.h, boost: 1 }
  if (!pitch.enabled) {
    return emit
  }
  if (pitch.mode !== "intensity") {
    emit.y = emit.trailY
  }
  if (pitch.mode !== "position") {
    emit.boost = intensityScale(sung.speed, pitch.sensitivity)
  }
  return emit
}

/**
 * The whole sung line across the phrase, as preview px. What the effect is
 * about to follow, drawn ahead of it so the path it takes is legible before the
 * playhead gets there.
 */
export function previewContour(phrase: PreviewPhrase, range: number): { x: number; y: number }[] {
  const rider: PitchPreferences = { enabled: false, mode: "position", range, sensitivity: 0 }
  const end = phraseEnd(phrase)
  const points: { x: number; y: number }[] = []
  const push = (x: number) => {
    const emit = previewEmit(phrase, x, rider)
    if (emit) {
      points.push({ x, y: emit.trailY })
    }
  }
  for (let x = phraseStart(phrase); x < end; x += CONTOUR_STEP_PX) {
    push(x)
  }
  // The last note ends where nothing sounds any more, so its final sample has
  // to be taken just inside it or the line stops a step short.
  push(end - CONTOUR_STEP_PX / 100)
  return points
}
