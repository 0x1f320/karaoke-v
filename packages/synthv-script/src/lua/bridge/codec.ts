/**
 * The wire format. Binary, because the cost that matters is the encoder, and it
 * runs on SynthV's UI thread: a 2000-note schedule with pitch curves takes
 * 18.8 ms to build as JSON and 2.0 ms with `string.pack` — the difference
 * between the editor dropping a frame on every edit and not. The record also
 * halves, 420 KB to 195 KB, and the reader stops allocating an object per
 * frame for the hot channel.
 *
 * What binary costs is forgiveness. JSON tolerates a field appearing or
 * changing type; a fixed layout silently misreads it. So every record carries
 * `MAGIC` and a layout version, and a reader that does not recognise both must
 * refuse the record rather than interpret it.
 *
 * Blicks travel as float64, not int64. They are exact well past any project
 * length (2^53 blicks is millions of minutes) and it keeps the reader off
 * `getBigInt64`, which allocates a BigInt per field.
 */

const MAGIC = "KVB1"

export const LAYOUT = 2

export const CHANNEL_STATE = 1
export const CHANNEL_NOTES = 2

const HEADER = "<c4I2I2I4"

export const STATUS_CODES: Record<string, number> = {
  stopped: 0,
  playing: 1,
  looping: 2,
}

function record(channel: number, payload: string): string {
  return string.pack(HEADER, MAGIC, LAYOUT, channel, string.len(payload)) + payload
}

export interface StateRecord {
  seq: number
  notesSeq: number
  at: number
  status: string
  loop: { start: number; end: number } | null
  perBlick: number
  perSemitone: number
  /** Both edges of each view range, not just the near one: Windows identifies
   * the piano-roll element by the size the ranges imply, having no accessibility
   * tree to find it in. */
  viewLeft: number
  viewRight: number
  viewTop: number
  viewBottom: number
  rev: string
}

const HAS_LOOP = 1

export function encodeState(state: StateRecord): string {
  const loop = state.loop
  // The format is built from the values rather than written beside them. Getting
  // the two out of step is not a compile error and not a wrong number either:
  // `string.pack` reads the next argument as whatever the next letter says, so
  // one `d` too many consumed `rev` and raised — which the tick then swallowed.
  const doubles = [
    state.at,
    loop !== null ? loop.start : 0,
    loop !== null ? loop.end : 0,
    state.perBlick,
    state.perSemitone,
    state.viewLeft,
    state.viewRight,
    state.viewTop,
    state.viewBottom,
  ]
  return record(
    CHANNEL_STATE,
    string.pack(
      `<I4I4BB${string.rep("d", doubles.length)}s2`,
      state.seq,
      state.notesSeq,
      STATUS_CODES[state.status] ?? 0,
      loop !== null ? HAS_LOOP : 0,
      ...doubles,
      state.rev,
    ),
  )
}

export interface NoteRecord {
  onB: number
  offB: number
  onS: number
  offS: number
  pitch: number
  lyric: string
  bend?: number[]
}

/**
 * One `string.pack` per bend array rather than one per sample: packing sample
 * by sample and concatenating costs 7.4 ms where this costs 2.0 ms, for the
 * same bytes.
 */
const BEND_FORMATS: Record<number, string> = {}

function bendFormat(count: number): string {
  const cached = BEND_FORMATS[count]
  if (cached !== undefined) {
    return cached
  }
  const format = `<${string.rep("i2", count)}`
  BEND_FORMATS[count] = format
  return format
}

export function encodeNotes(rev: string, notes: NoteRecord[]): string {
  const parts: string[] = []
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]
    const bend = note.bend ?? []
    let packed = string.pack(
      "<ddddi2s2I2",
      note.onB,
      note.offB,
      note.onS,
      note.offS,
      note.pitch,
      note.lyric,
      bend.length,
    )
    if (bend.length > 0) {
      packed = packed + string.pack(bendFormat(bend.length), ...bend)
    }
    parts[i] = packed
  }
  return record(CHANNEL_NOTES, string.pack("<s2I4", rev, notes.length) + table.concat(parts))
}
