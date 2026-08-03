/**
 * Everything read out of SynthV, with no opinion about where it goes.
 *
 * This module only ever compiles to Lua, which matters twice: `&`, `^` and
 * `>>>` are Lua's 64-bit integer operators here, not JavaScript's 32-bit ones,
 * and division is a place to be careful — `/` always produces a float, and a
 * float handed to an API that wants an index or a blick count fails with "number
 * has no integer representation".
 */

import { svIndex } from "../sv-index"
import type { NoteRecord } from "./codec"

export interface ViewMapping {
  perBlick: number
  perSemitone: number
  viewLeft: number
  viewRight: number
  viewTop: number
  viewBottom: number
}

export function currentGroup(): NoteGroupReference | undefined {
  return SV.getMainEditor().getCurrentGroup()
}

/**
 * Enough of the view transform for the app to turn blicks into pixels. It
 * rescales this itself from the piano roll's own geometry as the user zooms, so
 * this only has to be right at send time.
 */
export function viewMapping(): ViewMapping {
  const nav = SV.getMainEditor().getNavigation()
  const time = nav.getTimeViewRange()
  const value = nav.getValueViewRange()
  return {
    perBlick: nav.getTimePxPerUnit(),
    perSemitone: nav.getValuePxPerUnit(),
    viewLeft: time[0],
    viewRight: time[1],
    viewTop: value[1],
    viewBottom: value[0],
  }
}

/**
 * Sampling step for the pitch curve. A 32nd of a quarter is ~16ms at 120bpm,
 * which oversamples a 6Hz vibrato several times over — fine enough that the app
 * can interpolate between samples without the wobble going square.
 */
const BEND_INTERVAL = math.floor(SV.QUARTER / 32)

/**
 * Below this the frame is silence, not a pitch.
 *
 * The docs say samples with no data come back as null. Measured, they do not: a
 * computed group returns a full array in which unvoiced frames read 0. Taken at
 * face value that is a pitch of MIDI 0, which becomes an offset of about -69
 * semitones and throws the app's effect clean off the screen.
 */
const VOICED_FLOOR = 1

/** `bend` travels as int16, and `string.pack` raises on anything that overflows. */
const BEND_LIMIT = 32767

/**
 * The computed pitch across the whole group, or undefined if the engine has
 * none.
 *
 * Sampled in one call rather than one per note: the curve is a single buffer and
 * asking for it a note at a time would cost hundreds of calls for the same data.
 * An empty result means pitch computation has not finished for this group, which
 * is a state real projects sit in — the app falls back rather than showing
 * nothing.
 */
function computedPitch(
  ref: NoteGroupReference,
  startB: number,
  endB: number,
): { curve: number[]; frames: number } | undefined {
  const frames = math.ceil((endB - startB) / BEND_INTERVAL) + 1
  if (frames <= 0) {
    return undefined
  }
  const curve = SV.getComputedPitchForGroup(ref, startB, BEND_INTERVAL, frames)
  // Length, not `#curve`: one nil sample would truncate the length operator and
  // silently shorten every note's bend after it.
  if (curve[0] === undefined) {
    return undefined
  }
  return { curve, frames }
}

/**
 * One note's slice of the group curve, in cents from its own pitch. Undefined
 * when the note has no voiced frame at all, so the app synthesizes that note
 * instead of drawing a flat line through a rest.
 */
function bendForNote(
  curve: number[],
  frames: number,
  startB: number,
  note: NoteRecord,
): number[] | undefined {
  const from = math.max(0, math.floor((note.onB - startB) / BEND_INTERVAL + 0.5))
  const to = math.min(frames - 1, math.floor((note.offB - startB) / BEND_INTERVAL + 0.5))
  if (to < from) {
    return undefined
  }

  const bend: number[] = []
  let last = 0
  let voiced = false
  for (let i = from; i <= to; i++) {
    const sample = curve[i]
    // Unvoiced frames hold the previous offset rather than snapping to zero, so
    // a consonant in the middle of a note does not jerk the effect back.
    if (sample !== undefined && sample >= VOICED_FLOOR) {
      const cents = math.floor((sample - note.pitch) * 100 + 0.5)
      last = math.max(-BEND_LIMIT, math.min(BEND_LIMIT, cents))
      voiced = true
    }
    bend[bend.length] = last
  }
  return voiced ? bend : undefined
}

export function collectNotes(): NoteRecord[] {
  const ref = currentGroup()
  if (ref === undefined) {
    return []
  }

  const timeAxis = SV.getProject().getTimeAxis()
  const offset = ref.getTimeOffset()
  const group = ref.getTarget()
  const count = group.getNumNotes()
  const notes: NoteRecord[] = []

  for (let i = 0; i < count; i++) {
    const note = group.getNote(svIndex(i))
    const onB = note.getOnset() + offset
    const offB = note.getEnd() + offset
    notes[i] = {
      onB,
      offB,
      onS: timeAxis.getSecondsFromBlick(onB),
      offS: timeAxis.getSecondsFromBlick(offB),
      pitch: note.getPitch(),
      lyric: note.getLyrics(),
    }
  }

  if (notes.length > 0) {
    const startB = notes[0].onB
    const computed = computedPitch(ref, startB, notes[notes.length - 1].offB)
    if (computed !== undefined) {
      for (const note of notes) {
        note.bend = bendForNote(computed.curve, computed.frames, startB, note)
      }
    }
  }
  return notes
}

const FNV_PRIME = 16777619
const FNV_OFFSET = 2166136261
const MASK32 = 0xffffffff

/**
 * Rewritten rather than ported. The JavaScript version leans on doubles —
 * `hash * 31 % 1e12` with a float modulus — and Lua 5.4 integers wrap at 2^63
 * instead of losing precision, so the same expressions produce a different
 * number for the same project. This keeps every intermediate inside 32 bits,
 * where wrapping is the definition rather than an accident.
 */
function mix(hash: number, value: number): number {
  return ((hash ^ (value & MASK32)) * FNV_PRIME) & MASK32
}

function mixBlick(hash: number, blick: number): number {
  // `>>>` because typescript-to-lua reserves it for Lua's logical shift; the
  // value is a positive blick, so there is no arithmetic-shift question.
  return mix(mix(hash, blick & MASK32), blick >>> 32)
}

function mixString(hash: number, text: string): number {
  let mixed = mix(hash, string.len(text))
  for (let i = 1; i <= string.len(text); i++) {
    mixed = mix(mixed, string.byte(text, i) ?? 0)
  }
  return mixed
}

/** Cheap fingerprint of the current group's notes — an edit detector. */
export function currentRevision(): string {
  const ref = currentGroup()
  if (ref === undefined) {
    return "0"
  }

  const group = ref.getTarget()
  const count = group.getNumNotes()
  let hash = mix(FNV_OFFSET, count)

  for (let i = 0; i < count; i++) {
    const note = group.getNote(svIndex(i))
    hash = mixBlick(hash, note.getOnset())
    hash = mixBlick(hash, note.getEnd())
    hash = mix(hash, note.getPitch())
    hash = mixString(hash, note.getLyrics())
  }
  return `${ref.getTimeOffset()}:${count}:${hash}`
}
