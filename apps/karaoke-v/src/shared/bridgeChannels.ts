// The reading half of the SynthV bridge's channels
// (packages/synthv-script/src/lua/bridge/codec.ts is the writer, and
// packages/synthv-script/scripts/dump.mjs the reference decoder).
//
// The script publishes state — playhead, transport, view transform — on every
// tick, and the note schedule only when it changes. Nothing is streamed and
// nothing is queued: each channel holds one whole record that the writer
// replaces in place, so a reader that misses a generation has missed nothing it
// needed. Pairing across channels is by `rev`, and the record's own `rev` wins
// over the one the state channel was carrying when it was read.
//
// Every decode returns null rather than throwing. A short read, a torn record
// or a layout this build does not know are all "skip this frame", never a
// crash: the writer is a different process that can restart under us at any
// time.

const MAGIC = 0x3142564b // "KVB1", little-endian
const LAYOUT = 2
const HEADER_BYTES = 12

const CHANNEL_STATE = 1
const CHANNEL_NOTES = 2

/** The state record is padded to this, so a reader asks for exactly this much. */
export const STATE_BYTES = 256

const STATUSES = ["stopped", "playing", "looping"] as const

export type BridgeStatus = (typeof STATUSES)[number]

/** Enough of SynthV's view transform to turn blicks into pixels. */
export interface BridgeViewMapping {
  perBlick: number
  perSemitone: number
  /**
   * Both edges of each range, not just the near one. Windows has no
   * accessibility tree to find the piano roll in and identifies the element by
   * the size these ranges imply — see `windowsGeometry.ts`.
   */
  viewLeft: number
  viewRight: number
  viewTop: number
  viewBottom: number
}

export interface BridgeState {
  /** Advances every tick; stops advancing when the script is gone. */
  seq: number
  /** Generation of the notes channel, so it is read only when it changes. */
  notesSeq: number
  /** Playhead in seconds when the script read it. */
  at: number
  status: BridgeStatus
  /** Learned from the first loop wrap, so null until one happens. A hint only. */
  loop: { start: number; end: number } | null
  px: BridgeViewMapping
  /** Note-set fingerprint; a change means any held schedule went stale. */
  rev: string
}

export interface BridgeNote {
  /** Onset/end in blicks — linear in pixels, for placing the note. */
  onB: number
  offB: number
  /** Onset/end in seconds — for firing the effect off the local clock. */
  onS: number
  offS: number
  pitch: number
  lyric: string
  /**
   * The sung pitch across the note, in cents from `pitch`, evenly spaced from
   * onset to end. Empty when the engine has no computed curve for the group —
   * the app then synthesizes a shape from the notes instead.
   */
  bend: Int16Array
}

export interface BridgeSchedule {
  rev: string
  notes: BridgeNote[]
}

class Cursor {
  private readonly view: DataView
  private readonly bytes: Uint8Array
  private offset = 0

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset
  }

  u8(): number {
    const value = this.view.getUint8(this.offset)
    this.offset += 1
    return value
  }

  u16(): number {
    const value = this.view.getUint16(this.offset, true)
    this.offset += 2
    return value
  }

  i16(): number {
    const value = this.view.getInt16(this.offset, true)
    this.offset += 2
    return value
  }

  u32(): number {
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  f64(): number {
    const value = this.view.getFloat64(this.offset, true)
    this.offset += 8
    return value
  }

  /** Length-prefixed UTF-8 — `string.pack`'s `s2`. */
  text(): string {
    const length = this.u16()
    const value = TEXT.decode(this.bytes.subarray(this.offset, this.offset + length))
    this.offset += length
    return value
  }

  i16s(count: number): Int16Array {
    const values = new Int16Array(count)
    for (let i = 0; i < count; i++) {
      values[i] = this.i16()
    }
    return values
  }
}

const TEXT = new TextDecoder()

function header(cursor: Cursor, channel: number): boolean {
  if (cursor.remaining < HEADER_BYTES) {
    return false
  }
  if (cursor.u32() !== MAGIC) {
    return false
  }
  // Refusing beats interpreting: a fixed layout read at the wrong version is
  // wrong silently, where JSON would merely have been missing a field.
  if (cursor.u16() !== LAYOUT || cursor.u16() !== channel) {
    return false
  }
  return cursor.u32() <= cursor.remaining
}

export function decodeState(bytes: Uint8Array): BridgeState | null {
  const cursor = new Cursor(bytes)
  if (!header(cursor, CHANNEL_STATE)) {
    return null
  }
  const seq = cursor.u32()
  const notesSeq = cursor.u32()
  const status = STATUSES[cursor.u8()]
  const hasLoop = (cursor.u8() & 1) === 1
  const at = cursor.f64()
  const loopStart = cursor.f64()
  const loopEnd = cursor.f64()
  if (status === undefined) {
    return null
  }
  return {
    seq,
    notesSeq,
    at,
    status,
    loop: hasLoop ? { start: loopStart, end: loopEnd } : null,
    px: {
      perBlick: cursor.f64(),
      perSemitone: cursor.f64(),
      viewLeft: cursor.f64(),
      viewRight: cursor.f64(),
      viewTop: cursor.f64(),
      viewBottom: cursor.f64(),
    },
    rev: cursor.text(),
  }
}

export function decodeNotes(bytes: Uint8Array): BridgeSchedule | null {
  const cursor = new Cursor(bytes)
  if (!header(cursor, CHANNEL_NOTES)) {
    return null
  }
  const rev = cursor.text()
  const count = cursor.u32()
  const notes: BridgeNote[] = []
  for (let i = 0; i < count; i++) {
    // A record shorter than its own count means the writer is mid-replacement
    // or the file was truncated; either way this frame has no schedule.
    if (cursor.remaining < 36) {
      return null
    }
    const onB = cursor.f64()
    const offB = cursor.f64()
    const onS = cursor.f64()
    const offS = cursor.f64()
    const pitch = cursor.i16()
    const lyric = cursor.text()
    const bendCount = cursor.u16()
    if (cursor.remaining < bendCount * 2) {
      return null
    }
    notes.push({ onB, offB, onS, offS, pitch, lyric, bend: cursor.i16s(bendCount) })
  }
  return { rev, notes }
}
