// The reading half of the SynthV bridge's channels
// (packages/synthv-script/src/lua/bridge/codec.ts is the writer, and
// packages/synthv-script/scripts/dump.mjs the reference decoder).
//
// The script publishes state on every tick, and the view transform and note
// schedule only when they change. Nothing is streamed and
// nothing is queued: each channel holds one whole record that the writer
// replaces in place, so a reader that misses a generation has missed nothing it
// needed. Scroll pairs by `scrollSeq`; notes pair by both `notesSeq` and `rev`,
// and the notes record's own `rev` wins over the state value read beside it.
//
// Every decode returns null rather than throwing. A short read, a torn record
// or a layout this build does not know are all "skip this frame", never a
// crash: the writer is a different process that can restart under us at any
// time.

const MAGIC = 0x31425056 // "VPB1", little-endian
export const BRIDGE_LAYOUT = 5
export const BRIDGE_HEADER_BYTES = 12
export const BRIDGE_CHANNEL_SESSION = 0
export const BRIDGE_CHANNEL_STATE = 1
export const BRIDGE_CHANNEL_NOTES = 2
export const BRIDGE_CHANNEL_SCROLL = 3

const STATUSES = ["stopped", "playing", "looping"] as const

export type BridgeStatus = (typeof STATUSES)[number]

/** Enough of SynthV's view transform to turn blicks into pixels. */
export interface BridgeViewMapping {
  perBlick: number
  perSemitone: number
  /**
   * Both edges of each range, not just the near one. The app identifies the
   * piano-roll canvas by the size these ranges imply — see
   * `pianoRollGeometry.ts`.
   */
  viewLeft: number
  viewRight: number
  viewTop: number
  viewBottom: number
}

export interface BridgeStateRecord {
  /** Advances every tick; stops advancing when the script is gone. */
  seq: number
  /** Generation of the notes channel, so it is read only when it changes. */
  notesSeq: number
  /** Generation of the scroll channel, so it is read only when it changes. */
  scrollSeq: number
  /** Playhead in seconds when the script read it. */
  at: number
  status: BridgeStatus
  /** Learned from the first loop wrap, so null until one happens. A hint only. */
  loop: { start: number; end: number } | null
  /** Note-set fingerprint; a change means any held schedule went stale. */
  rev: string
}

export interface BridgeScrollRecord extends BridgeViewMapping {
  scrollSeq: number
}

export interface BridgeState extends BridgeStateRecord {
  px: BridgeViewMapping
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
  notesSeq: number
  rev: string
  notes: BridgeNote[]
}

export interface BridgeSession {
  v: 1
  layout: typeof BRIDGE_LAYOUT
  appSession: string
  [key: string]: unknown
}

class Cursor {
  private readonly view: DataView
  private readonly bytes: Uint8Array
  private offset = 0
  private end: number

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.end = bytes.byteLength
  }

  get remaining(): number {
    return this.end - this.offset
  }

  limit(count: number): void {
    if (count < 0 || count > this.remaining) {
      throw new RangeError("payload exceeds record")
    }
    this.end = this.offset + count
  }

  private require(count: number): void {
    if (count < 0 || count > this.remaining) {
      throw new RangeError("read exceeds payload")
    }
  }

  u8(): number {
    this.require(1)
    const value = this.view.getUint8(this.offset)
    this.offset += 1
    return value
  }

  u16(): number {
    this.require(2)
    const value = this.view.getUint16(this.offset, true)
    this.offset += 2
    return value
  }

  i16(): number {
    this.require(2)
    const value = this.view.getInt16(this.offset, true)
    this.offset += 2
    return value
  }

  u32(): number {
    this.require(4)
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  f64(): number {
    this.require(8)
    const value = this.view.getFloat64(this.offset, true)
    this.offset += 8
    return value
  }

  /** Length-prefixed UTF-8 — `string.pack`'s `s2`. */
  text(): string {
    const length = this.u16()
    this.require(length)
    const value = TEXT.decode(this.bytes.subarray(this.offset, this.offset + length))
    this.offset += length
    return value
  }

  take(count: number): Uint8Array {
    this.require(count)
    const value = this.bytes.subarray(this.offset, this.offset + count)
    this.offset += count
    return value
  }

  i16s(count: number): Int16Array {
    this.require(count * 2)
    const values = new Int16Array(count)
    for (let i = 0; i < count; i++) {
      values[i] = this.i16()
    }
    return values
  }
}

const TEXT = new TextDecoder()

function header(cursor: Cursor, channel: number): number | null {
  if (cursor.remaining < BRIDGE_HEADER_BYTES) {
    return null
  }
  if (cursor.u32() !== MAGIC) {
    return null
  }
  // Refusing beats interpreting: a fixed layout read at the wrong version is
  // wrong silently, where JSON would merely have been missing a field.
  if (cursor.u16() !== BRIDGE_LAYOUT || cursor.u16() !== channel) {
    return null
  }
  const length = cursor.u32()
  if (length > cursor.remaining) {
    return null
  }
  cursor.limit(length)
  return length
}

export function decodeState(bytes: Uint8Array): BridgeStateRecord | null {
  try {
    const cursor = new Cursor(bytes)
    if (header(cursor, BRIDGE_CHANNEL_STATE) === null) {
      return null
    }
    const seq = cursor.u32()
    const notesSeq = cursor.u32()
    const scrollSeq = cursor.u32()
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
      scrollSeq,
      at,
      status,
      loop: hasLoop ? { start: loopStart, end: loopEnd } : null,
      rev: cursor.text(),
    }
  } catch {
    return null
  }
}

export function decodeScroll(bytes: Uint8Array): BridgeScrollRecord | null {
  try {
    const cursor = new Cursor(bytes)
    if (header(cursor, BRIDGE_CHANNEL_SCROLL) === null) {
      return null
    }
    return {
      scrollSeq: cursor.u32(),
      perBlick: cursor.f64(),
      perSemitone: cursor.f64(),
      viewLeft: cursor.f64(),
      viewRight: cursor.f64(),
      viewTop: cursor.f64(),
      viewBottom: cursor.f64(),
    }
  } catch {
    return null
  }
}

export function decodeNotes(bytes: Uint8Array): BridgeSchedule | null {
  try {
    const cursor = new Cursor(bytes)
    if (header(cursor, BRIDGE_CHANNEL_NOTES) === null) {
      return null
    }
    const notesSeq = cursor.u32()
    const rev = cursor.text()
    const count = cursor.u32()
    const notes: BridgeNote[] = []
    for (let i = 0; i < count; i++) {
      // A record shorter than its own count means the writer is mid-replacement
      // or the file was truncated; either way this frame has no schedule.
      if (cursor.remaining < 38) {
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
    return { notesSeq, rev, notes }
  } catch {
    return null
  }
}

export function decodeSession(bytes: Uint8Array): BridgeSession | null {
  const cursor = new Cursor(bytes)
  const length = header(cursor, BRIDGE_CHANNEL_SESSION)
  if (length === null) {
    return null
  }
  try {
    const value: unknown = JSON.parse(TEXT.decode(cursor.take(length)))
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null
    }
    const session = value as Record<string, unknown>
    if (
      session.v !== 1 ||
      session.layout !== BRIDGE_LAYOUT ||
      typeof session.appSession !== "string"
    ) {
      return null
    }
    return session as BridgeSession
  } catch {
    return null
  }
}
