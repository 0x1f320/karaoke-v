import { describe, expect, it } from "vitest"
import { BRIDGE_MARKER, type BridgeNote, type BridgePayload, parseBridgePayload } from "./bridge"

const note: BridgeNote = { onB: 0, offB: 705600000, onS: 0, offS: 0.5, pitch: 60, lyric: "la" }

const base = {
  v: 1,
  kind: "start",
  at: 1.25,
  status: "playing",
  px: { perBlick: 1e-6, perSemitone: 12, viewLeft: 0, viewTop: 100 },
  loop: { start: 0, end: 8 },
  rev: "r1",
  notes: [note],
}

function encode(payload: unknown): string {
  return BRIDGE_MARKER + JSON.stringify(payload)
}

function parse(payload: unknown): BridgePayload | null {
  return parseBridgePayload(encode(payload))
}

describe("parseBridgePayload", () => {
  it("parses a well-formed payload", () => {
    expect(parse(base)).toEqual(base)
  })

  it("rejects text without the marker", () => {
    expect(parseBridgePayload(JSON.stringify(base))).toBeNull()
    expect(parseBridgePayload("")).toBeNull()
    expect(parseBridgePayload(`x${encode(base)}`)).toBeNull()
  })

  it("rejects a marker followed by bad JSON", () => {
    expect(parseBridgePayload(BRIDGE_MARKER)).toBeNull()
    expect(parseBridgePayload(`${BRIDGE_MARKER}{nope`)).toBeNull()
  })

  it("rejects non-object JSON", () => {
    for (const value of [null, 3, "s", true]) {
      expect(parse(value)).toBeNull()
    }
  })

  it("rejects another protocol version", () => {
    expect(parse({ ...base, v: 2 })).toBeNull()
    expect(parse({ ...base, v: "1" })).toBeNull()
  })

  it("rejects a missing or mistyped at / rev", () => {
    expect(parse({ ...base, at: "1.25" })).toBeNull()
    expect(parse({ ...base, at: undefined })).toBeNull()
    expect(parse({ ...base, rev: 7 })).toBeNull()
  })

  it("rejects an unknown kind or status", () => {
    expect(parse({ ...base, kind: "resume" })).toBeNull()
    expect(parse({ ...base, kind: undefined })).toBeNull()
    expect(parse({ ...base, status: "paused" })).toBeNull()
  })

  it("drops a malformed view mapping rather than the whole payload", () => {
    expect(parse({ ...base, px: { perBlick: 1, perSemitone: 1, viewLeft: 1 } })?.px).toBeNull()
    expect(parse({ ...base, px: null })?.px).toBeNull()
    expect(parse({ ...base, px: "x" })?.px).toBeNull()
  })

  it("drops malformed loop bounds", () => {
    expect(parse({ ...base, loop: { start: 0 } })?.loop).toBeNull()
    expect(parse({ ...base, loop: [] })?.loop).toBeNull()
  })

  it("keeps only the notes that carry every field", () => {
    const parsed = parse({
      ...base,
      notes: [
        note,
        { ...note, lyric: 1 },
        { ...note, pitch: "60" },
        null,
        5,
        { ...note, onS: "0" },
      ],
    })
    expect(parsed?.notes).toEqual([note])
  })

  it("leaves notes absent when the payload carries none", () => {
    expect(parse({ ...base, notes: undefined })?.notes).toBeUndefined()
    expect(parse({ ...base, notes: "all" })?.notes).toBeUndefined()
  })
})
