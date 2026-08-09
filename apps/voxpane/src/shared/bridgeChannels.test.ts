import { describe, expect, it } from "vitest"
import {
  type BridgeStatus,
  decodeNotes,
  decodeScroll,
  decodeSession,
  decodeState,
} from "./bridgeChannels"

// The writer is Lua's string.pack in packages/synthv-script. These builders are
// the same layout written by hand, so a change on either side has to be made on
// both — which is the point of having them.

const MAGIC = 0x31425056
const SESSION = "app-session-1"
const SCROLL_RECORD_BYTES = 64
const NOTES_METADATA_BYTES = 12
const NOTE_FIXED_PREFIX_BYTES = 34
const NOTE_TEXT_PREFIX_BYTES = 2
const NOTE_TEXT_BYTES = 3
const BEND_COUNT_BYTES = 2
const STATUS_CODES: Record<BridgeStatus, number> = { stopped: 0, playing: 1, looping: 2 }

class Writer {
  private readonly bytes: number[] = []

  u8(value: number): this {
    this.bytes.push(value & 0xff)
    return this
  }
  u16(value: number): this {
    return this.u8(value).u8(value >>> 8)
  }
  u32(value: number): this {
    return this.u16(value).u16(value >>> 16)
  }
  i16(value: number): this {
    return this.u16(value < 0 ? value + 0x10000 : value)
  }
  f64(value: number): this {
    const view = new DataView(new ArrayBuffer(8))
    view.setFloat64(0, value, true)
    for (let i = 0; i < 8; i++) {
      this.u8(view.getUint8(i))
    }
    return this
  }
  text(value: string): this {
    const encoded = new TextEncoder().encode(value)
    this.u16(encoded.length)
    for (const byte of encoded) {
      this.u8(byte)
    }
    return this
  }
  header(channel: number, length: number, layout = 5, magic = MAGIC): this {
    return this.u32(magic).u16(layout).u16(channel).u32(length)
  }

  done(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

interface StateFields {
  seq?: number
  notesSeq?: number
  scrollSeq?: number
  status?: BridgeStatus
  at?: number
  loop?: { start: number; end: number } | null
  rev?: string
  layout?: number
  magic?: number
}

function stateRecord(fields: StateFields = {}): Uint8Array {
  const loop = fields.loop ?? null
  const body = new Writer()
    .u32(fields.seq ?? 1)
    .u32(fields.notesSeq ?? 0)
    .u32(fields.scrollSeq ?? 1)
    .u8(STATUS_CODES[fields.status ?? "playing"])
    .u8(loop ? 1 : 0)
    .f64(fields.at ?? 12.5)
    .f64(loop?.start ?? 0)
    .f64(loop?.end ?? 0)
    .text(fields.rev ?? "91595700000:70:3183490408")
    .done()

  const record = new Writer().header(1, body.length, fields.layout, fields.magic).done()
  return concat(record, body, 256 - record.length - body.length)
}

function sessionRecord(fields: { appSession?: string; layout?: number } = {}): Uint8Array {
  const body = new TextEncoder().encode(
    JSON.stringify({ v: 1, layout: 5, appSession: fields.appSession ?? SESSION }),
  )
  const record = new Writer().header(0, body.length, fields.layout).done()
  return concat(record, body, 0)
}

function layout4StateRecord(): Uint8Array {
  return stateRecord({ layout: 4 })
}

interface ScrollFields {
  scrollSeq?: number
  layout?: number
  channel?: number
}

function scrollRecord(fields: ScrollFields = {}): Uint8Array {
  const body = new Writer()
    .u32(fields.scrollSeq ?? 1)
    .f64(2.13e-7)
    .f64(24)
    .f64(88355201996.439)
    .f64(97030858275.339)
    .f64(88.6875)
    .f64(60.5)
    .done()

  const record = new Writer().header(fields.channel ?? 3, body.length, fields.layout).done()
  return concat(record, body, SCROLL_RECORD_BYTES - record.length - body.length)
}

interface NoteFields {
  onB?: number
  offB?: number
  onS?: number
  offS?: number
  pitch?: number
  lyric?: string
  bend?: number[]
}

interface NotesFields {
  notes?: NoteFields[]
  notesSeq?: number
  rev?: string
}

function notesRecord(fields: NoteFields[] | NotesFields, rev = "r1"): Uint8Array {
  const notes = Array.isArray(fields) ? fields : (fields.notes ?? [])
  const notesSeq = Array.isArray(fields) ? 0 : (fields.notesSeq ?? 0)
  const revision = Array.isArray(fields) ? rev : (fields.rev ?? "r1")
  const body = new Writer().u32(notesSeq).text(revision).u32(notes.length)
  for (const note of notes) {
    body
      .f64(note.onB ?? 0)
      .f64(note.offB ?? 705600000)
      .f64(note.onS ?? 0)
      .f64(note.offS ?? 0.5)
      .i16(note.pitch ?? 60)
      .text(note.lyric ?? "가")
      .u16(note.bend?.length ?? 0)
    for (const cents of note.bend ?? []) {
      body.i16(cents)
    }
  }
  const payload = body.done()
  return concat(new Writer().header(2, payload.length).done(), payload, 0)
}

function concat(head: Uint8Array, body: Uint8Array, padding: number): Uint8Array {
  const out = new Uint8Array(head.length + body.length + Math.max(0, padding))
  out.set(head, 0)
  out.set(body, head.length)
  out.fill(0x20, head.length + body.length)
  return out
}

function withDeclaredPayloadLength(record: Uint8Array, length: number): Uint8Array {
  const out = Uint8Array.from(record)
  out[8] = length & 0xff
  out[9] = (length >>> 8) & 0xff
  out[10] = (length >>> 16) & 0xff
  out[11] = (length >>> 24) & 0xff
  return out
}

describe("decodeState", () => {
  it("reads a record the script wrote", () => {
    const state = decodeState(stateRecord({ seq: 7, notesSeq: 3, scrollSeq: 5, at: 91.646 }))
    expect(state).toEqual({
      seq: 7,
      notesSeq: 3,
      scrollSeq: 5,
      at: 91.646,
      status: "playing",
      loop: null,
      rev: "91595700000:70:3183490408",
    })
  })

  it("reads loop bounds only when the record says it has them", () => {
    expect(decodeState(stateRecord({ loop: { start: 1, end: 2 } }))?.loop).toEqual({
      start: 1,
      end: 2,
    })
    expect(decodeState(stateRecord({ loop: null }))?.loop).toBeNull()
  })

  it.each(["stopped", "playing", "looping"] as const)("round-trips the %s status", (status) => {
    expect(decodeState(stateRecord({ status }))?.status).toBe(status)
  })

  it("refuses a record from a layout it does not know", () => {
    expect(decodeState(stateRecord({ layout: 3 }))).toBeNull()
    expect(decodeState(layout4StateRecord())).toBeNull()
  })

  it("refuses bytes that are not a record at all", () => {
    expect(decodeState(stateRecord({ magic: 0 }))).toBeNull()
    expect(decodeState(new Uint8Array(0))).toBeNull()
    expect(decodeState(new Uint8Array(8))).toBeNull()
  })

  it("refuses the notes channel read as state", () => {
    expect(decodeState(notesRecord([{}]))).toBeNull()
  })

  it("refuses a layout 5 record with an undersized declared payload", () => {
    const record = withDeclaredPayloadLength(stateRecord(), 1)

    expect(() => decodeState(record)).not.toThrow()
    expect(decodeState(record)).toBeNull()
  })
})

describe("decodeScroll", () => {
  it("reads the complete view transform", () => {
    expect(decodeScroll(scrollRecord({ scrollSeq: 5 }))).toEqual({
      scrollSeq: 5,
      perBlick: 2.13e-7,
      perSemitone: 24,
      viewLeft: 88355201996.439,
      viewRight: 97030858275.339,
      viewTop: 88.6875,
      viewBottom: 60.5,
    })
  })

  it("keeps blicks exact past the precision a float32 would give", () => {
    expect(decodeScroll(scrollRecord())?.viewLeft).toBe(88355201996.439)
  })

  it("refuses the wrong layout, channel, and a truncated record", () => {
    expect(decodeScroll(scrollRecord({ layout: 3 }))).toBeNull()
    expect(decodeScroll(scrollRecord({ channel: 1 }))).toBeNull()
    expect(decodeScroll(scrollRecord().slice(0, SCROLL_RECORD_BYTES - 1))).toBeNull()
  })

  it("refuses a layout 5 record with an undersized declared payload", () => {
    const record = withDeclaredPayloadLength(scrollRecord(), 4)

    expect(() => decodeScroll(record)).not.toThrow()
    expect(decodeScroll(record)).toBeNull()
  })
})

describe("decodeSession", () => {
  it("reads and validates the layout 5 session record", () => {
    expect(decodeSession(sessionRecord({ appSession: SESSION }))).toMatchObject({
      v: 1,
      layout: 5,
      appSession: SESSION,
    })
  })
})

describe("decodeNotes", () => {
  it("reads a schedule", () => {
    const schedule = decodeNotes(
      notesRecord(
        [
          { onS: 95.185, offS: 95.37, pitch: 56, lyric: "다", bend: [-120, -36, 281] },
          { onS: 95.37, offS: 96.111, pitch: 63, lyric: "른" },
        ],
        "rev-1",
      ),
    )
    expect(schedule?.notesSeq).toBe(0)
    expect(schedule?.rev).toBe("rev-1")
    expect(schedule?.notes).toHaveLength(2)
    expect(schedule?.notes[0].lyric).toBe("다")
    expect(Array.from(schedule?.notes[0].bend ?? [])).toEqual([-120, -36, 281])
    expect(schedule?.notes[1].bend).toHaveLength(0)
  })

  it("keeps multi-byte lyrics intact", () => {
    const schedule = decodeNotes(notesRecord([{ lyric: "がんばって" }]))
    expect(schedule?.notes[0].lyric).toBe("がんばって")
  })

  it("reads an empty schedule", () => {
    expect(decodeNotes(notesRecord([]))?.notes).toEqual([])
  })

  it("reads the self-indexed notes generation", () => {
    expect(decodeNotes(notesRecord({ notesSeq: 7, rev: "r7" }))).toMatchObject({
      notesSeq: 7,
      rev: "r7",
    })
  })

  it("refuses a record that claims more notes than it carries", () => {
    const truncated = notesRecord([{ lyric: "a" }, { lyric: "b" }]).slice(0, 40)
    expect(decodeNotes(truncated)).toBeNull()
  })

  it("refuses a bend array the record is too short to hold", () => {
    const record = notesRecord([{ bend: [1, 2, 3, 4, 5] }])
    expect(decodeNotes(record.slice(0, record.length - 4))).toBeNull()
  })

  it.each([
    ["fixed prefix", NOTES_METADATA_BYTES + NOTE_FIXED_PREFIX_BYTES - 1],
    ["lyric text", NOTES_METADATA_BYTES + NOTE_FIXED_PREFIX_BYTES + NOTE_TEXT_PREFIX_BYTES],
    ["bend", NOTES_METADATA_BYTES + NOTE_FIXED_PREFIX_BYTES + NOTE_TEXT_BYTES + BEND_COUNT_BYTES],
  ] as const)("refuses a note truncated at its %s", (_part, length) => {
    const record = withDeclaredPayloadLength(notesRecord([{ lyric: "a", bend: [1] }]), length)

    expect(() => decodeNotes(record)).not.toThrow()
    expect(decodeNotes(record)).toBeNull()
  })
})
