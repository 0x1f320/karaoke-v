import type { NotePayload, ViewMapping } from "./types"

// Everything read out of SynthV, with no opinion about where it goes. Both
// transports need the same answers; only what they do with them differs.

/** 0.1 ms is far finer than anything the effect can show. */
export function round(seconds: number): number {
  return Math.round(seconds * 1e4) / 1e4
}

export function currentGroup(): NoteGroupReference | null {
  const editor = SV.getMainEditor()
  return editor ? editor.getCurrentGroup() : null
}

/**
 * Enough of the view transform for the app to turn blicks into pixels. It
 * rescales this itself from the piano roll's own geometry as the user zooms, so
 * this only has to be right at send time.
 */
export function viewMapping(): ViewMapping {
  const nav = SV.getMainEditor().getNavigation()
  return {
    perBlick: nav.getTimePxPerUnit(),
    perSemitone: nav.getValuePxPerUnit(),
    viewLeft: nav.getTimeViewRange()[0],
    viewTop: nav.getValueViewRange()[1],
  }
}

/**
 * Sampling step for the pitch curve. A 32nd of a quarter is ~16ms at 120bpm,
 * which oversamples a 6Hz vibrato several times over — fine enough that the app
 * can interpolate between samples without the wobble going square.
 */
const BEND_INTERVAL = Math.floor(SV.QUARTER / 32)

/**
 * Below this the frame is silence, not a pitch.
 *
 * The docs say samples with no data come back as `null`. Measured, they do not:
 * a computed group returns a full array in which unvoiced frames read `0`. Taken
 * at face value that is a pitch of MIDI 0, which becomes an offset of about -69
 * semitones and throws the app's effect clean off the screen.
 */
const VOICED_FLOOR = 1

/**
 * The computed pitch across the whole group, or null if the engine has none.
 *
 * Sampled in one call rather than one per note: the curve is a single buffer and
 * asking for it a note at a time would cost hundreds of calls for the same data.
 * An empty array means pitch computation has not finished for this group, which
 * is a state real projects sit in — the app falls back rather than showing
 * nothing.
 */
function computedPitch(ref: NoteGroupReference, startB: Blick, endB: Blick): number[] | null {
  const frames = Math.ceil((endB - startB) / BEND_INTERVAL) + 1
  if (frames <= 0) {
    return null
  }
  const curve = SV.getComputedPitchForGroup(ref, startB, BEND_INTERVAL, frames)
  if (!curve || curve.length === 0) {
    return null
  }
  const out: number[] = []
  for (let i = 0; i < curve.length; i++) {
    const value = curve[i]
    out.push(value === null || value === undefined ? 0 : value)
  }
  return out
}

/**
 * One note's slice of the group curve, in cents from its own pitch. Null when
 * the note has no voiced frame at all, so the app synthesizes that note instead
 * of drawing a flat line through a rest.
 */
function bendForNote(
  curve: number[],
  startB: Blick,
  onB: Blick,
  offB: Blick,
  pitch: number,
): number[] | null {
  const from = Math.max(0, Math.round((onB - startB) / BEND_INTERVAL))
  const to = Math.min(curve.length - 1, Math.round((offB - startB) / BEND_INTERVAL))
  if (to < from) {
    return null
  }

  const bend: number[] = []
  let last = 0
  let voiced = false
  for (let i = from; i <= to; i++) {
    // Unvoiced frames hold the previous offset rather than snapping to zero, so
    // a consonant in the middle of a note does not jerk the effect back.
    if (curve[i] >= VOICED_FLOOR) {
      last = Math.round((curve[i] - pitch) * 100)
      voiced = true
    }
    bend.push(last)
  }
  return voiced ? bend : null
}

export function collectNotes(): NotePayload[] {
  const ref = currentGroup()
  if (!ref) {
    return []
  }

  const timeAxis = SV.getProject().getTimeAxis()
  const offset = ref.getTimeOffset()
  const group = ref.getTarget()
  const count = group.getNumNotes()
  const notes: NotePayload[] = []

  for (let i = 0; i < count; i++) {
    const note = group.getNote(i)
    const onB = note.getOnset() + offset
    const offB = note.getEnd() + offset
    notes.push({
      onB,
      offB,
      onS: round(timeAxis.getSecondsFromBlick(onB)),
      offS: round(timeAxis.getSecondsFromBlick(offB)),
      pitch: note.getPitch(),
      lyric: note.getLyrics(),
    })
  }

  if (notes.length > 0) {
    const startB = notes[0].onB
    const curve = computedPitch(ref, startB, notes[notes.length - 1].offB)
    if (curve) {
      for (const note of notes) {
        const bend = bendForNote(curve, startB, note.onB, note.offB, note.pitch)
        if (bend) {
          note.bend = bend
        }
      }
    }
  }
  return notes
}

/** Cheap fingerprint of the current group's notes — an edit detector. */
export function currentRevision(): string {
  const ref = currentGroup()
  if (!ref) {
    return "0"
  }

  const group = ref.getTarget()
  const count = group.getNumNotes()
  let hash = count * 2654435761

  for (let i = 0; i < count; i++) {
    const note = group.getNote(i)
    const lyric = note.getLyrics()
    let lyricSum = lyric.length
    for (let c = 0; c < lyric.length; c++) {
      lyricSum = (lyricSum * 31 + lyric.charCodeAt(c)) % 1000003
    }
    const mixed = note.getOnset() / 1e3 + note.getEnd() / 1e3 + note.getPitch() + lyricSum
    hash = (hash * 31 + mixed) % 1e12
  }
  return `${ref.getTimeOffset()}:${count}:${Math.round(hash)}`
}
