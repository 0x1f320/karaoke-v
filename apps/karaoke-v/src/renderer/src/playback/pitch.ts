import type { BridgeNote } from "../../../shared/bridgeChannels"

// Where the voice actually is inside a note, as a distance from the note's own
// pitch. The overlay anchors effects to the matched note rectangle, and that
// rectangle is exactly one semitone tall, so a semitone here is a rectangle
// height there and the existing scroll/zoom alignment carries over untouched.
//
// Two sources, same units. The bridge sends the engine's computed curve when it
// has one; when its `bend` is empty — the engine has not computed that group's
// pitch, which real projects do sit in — the shape is synthesized from the notes
// alone. The caller cannot tell which it got, and should not have to.

/** How far the voice is from the note, and how fast that is changing. */
export interface PitchSample {
  /** Semitones from the note's pitch; positive is higher, which is upward. */
  offset: number
  /** |d(offset)/dt| in semitones per second. */
  speed: number
}

// A note does not begin on its own pitch — the engine glides into it from the
// note before. Roughly a tenth of a second, from the computed curves.
const TRANSITION_SEC = 0.09
// Past this gap the two notes are not neighbours and nothing glides between
// them: the voice restarts rather than sliding across the rest.
const TRANSITION_GAP_SEC = 0.12

// Vibrato is a held-note ornament, so it waits, then fades in rather than
// switching on. Notes shorter than the wait never reach it, which is what keeps
// it off the fast passages by itself.
const VIBRATO_ONSET_SEC = 0.28
const VIBRATO_FADE_SEC = 0.18
const VIBRATO_HZ = 5.5
const VIBRATO_SEMITONES = 0.18

/** Step the speed is differenced over — one frame at 60Hz. */
const SPEED_DT = 1 / 60

/** Ceiling on the boost movement may add, so an effect cannot run away. */
const MAX_BOOST = 2

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/**
 * The contour the bridge sent, read at `progress` through the note. Samples are
 * evenly spaced from onset to end, so progress indexes them directly — there is
 * no separate time base to keep in step with the transport's.
 */
function bendAt(bend: ArrayLike<number>, progress: number): number {
  if (bend.length === 1) {
    return bend[0] / 100
  }
  const at = clamp(progress, 0, 1) * (bend.length - 1)
  const low = Math.floor(at)
  const high = Math.min(low + 1, bend.length - 1)
  const t = at - low
  return (bend[low] * (1 - t) + bend[high] * t) / 100
}

function synthesized(note: BridgeNote, previous: BridgeNote | null, elapsed: number): number {
  let offset = 0

  if (previous && note.onS - previous.offS <= TRANSITION_GAP_SEC) {
    offset += (previous.pitch - note.pitch) * (1 - smoothstep(elapsed / TRANSITION_SEC))
  }

  const held = elapsed - VIBRATO_ONSET_SEC
  if (held > 0) {
    const depth = VIBRATO_SEMITONES * smoothstep(held / VIBRATO_FADE_SEC)
    offset += depth * Math.sin(2 * Math.PI * VIBRATO_HZ * held)
  }

  return offset
}

function offsetAt(note: BridgeNote, previous: BridgeNote | null, elapsed: number): number {
  if (note.bend.length > 0) {
    const span = note.offS - note.onS
    return bendAt(note.bend, span > 0 ? elapsed / span : 0)
  }
  return synthesized(note, previous, elapsed)
}

/**
 * Where the effect should sit `elapsed` seconds into `note`, and how hard the
 * voice is moving there.
 *
 * `range` bounds the offset rather than trusting it. The contour is written by
 * a separate process that can restart under us at any version, and the engine
 * reports unvoiced frames as a pitch of zero rather than as a gap — which is an
 * offset of most of an octave, enough to throw the effect off the canvas. The
 * script filters that today; bounding it here is what keeps an older or broken
 * writer from doing it anyway. Speed is taken before the bound, because
 * intensity is meant to follow the voice and not the place the drawing was
 * allowed to reach.
 */
export function samplePitch(
  note: BridgeNote,
  previous: BridgeNote | null,
  elapsed: number,
  range: number,
): PitchSample {
  const now = offsetAt(note, previous, elapsed)
  const before = offsetAt(note, previous, Math.max(0, elapsed - SPEED_DT))
  return {
    offset: clamp(now, -range, range),
    speed: Math.abs(now - before) / SPEED_DT,
  }
}

/** What to multiply an effect's strength by, given how fast the pitch moves. */
export function intensityScale(speed: number, sensitivity: number): number {
  if (sensitivity <= 0) {
    return 1
  }
  return 1 + Math.min(speed * sensitivity, MAX_BOOST)
}
