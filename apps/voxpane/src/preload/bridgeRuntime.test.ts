import { describe, expect, it } from "vitest"
import type {
  BridgeNote,
  BridgeSchedule,
  BridgeScrollRecord,
  BridgeSession,
  BridgeState,
  BridgeStateRecord,
} from "../shared/bridgeChannels"
import type {
  BridgeChannelDiagnostics,
  BridgeTransportDiagnostics,
} from "../shared/bridgeDiagnostics"
import { BridgeRuntime } from "./bridgeRuntime"

const STATE_BYTES = Uint8Array.of(1)
const STATE_WITHOUT_NOTES_BYTES = Uint8Array.of(2)
const NEWER_STATE_BYTES = Uint8Array.of(3)
const SCROLL_BYTES = Uint8Array.of(4)
const NEWER_SCROLL_BYTES = Uint8Array.of(5)
const NOTES_BYTES = Uint8Array.of(6)
const NEWER_NOTES_BYTES = Uint8Array.of(7)
const MISMATCHED_NOTES_BYTES = Uint8Array.of(8)
const SESSION_BYTES = Uint8Array.of(9)
const INVALID_BYTES = Uint8Array.of(255)
const STATE_RECORD: BridgeStateRecord = {
  seq: 9,
  notesSeq: 3,
  scrollSeq: 5,
  at: 12.5,
  status: "playing",
  loop: null,
  rev: "abcdef123456",
}
const SCROLL: BridgeScrollRecord = {
  scrollSeq: 5,
  perBlick: 1,
  perSemitone: 12,
  viewLeft: 0,
  viewRight: 100,
  viewTop: 80,
  viewBottom: 40,
}
const MAPPING = {
  perBlick: 1,
  perSemitone: 12,
  viewLeft: 0,
  viewRight: 100,
  viewTop: 80,
  viewBottom: 40,
}
const STATE: BridgeState = { ...STATE_RECORD, px: MAPPING }
const SCHEDULE: BridgeSchedule = { notesSeq: 3, rev: "abcdef123456", notes: [] }
const SESSION: BridgeSession = {
  v: 1,
  layout: 5,
  appSession: "0123456789abcdef0123456789abcdef",
}
const ORDERS = [
  ["state", "scroll", "notes"],
  ["state", "notes", "scroll"],
  ["scroll", "state", "notes"],
  ["scroll", "notes", "state"],
  ["notes", "state", "scroll"],
  ["notes", "scroll", "state"],
] as const
const STATE_RECORDS = new Map<number, BridgeStateRecord>([
  [1, STATE_RECORD],
  [2, { ...STATE_RECORD, seq: 10, notesSeq: 0 }],
  [3, { ...STATE_RECORD, seq: 11, notesSeq: 4, scrollSeq: 6, rev: "next" }],
])
const SCROLL_RECORDS = new Map<number, BridgeScrollRecord>([
  [4, SCROLL],
  [5, { ...SCROLL, scrollSeq: 6, viewLeft: 10, viewRight: 110 }],
])
const SCHEDULE_RECORDS = new Map<number, BridgeSchedule>([
  [6, SCHEDULE],
  [7, { notesSeq: 4, rev: "next", notes: [] }],
  [8, { notesSeq: 3, rev: "other", notes: [] }],
])

function cloneNote(note: BridgeNote): BridgeNote {
  return { ...note, bend: Int16Array.from(note.bend) }
}

function runtime() {
  return new BridgeRuntime({
    decodeState: (bytes) => {
      const value = STATE_RECORDS.get(bytes[0])
      return value ? { ...value, loop: value.loop && { ...value.loop } } : null
    },
    decodeScroll: (bytes) => {
      const value = SCROLL_RECORDS.get(bytes[0])
      return value ? { ...value } : null
    },
    decodeNotes: (bytes) => {
      const value = SCHEDULE_RECORDS.get(bytes[0])
      return value ? { ...value, notes: value.notes.map(cloneNote) } : null
    },
    decodeSession: (bytes) => (bytes[0] === SESSION_BYTES[0] ? { ...SESSION } : null),
  })
}

function publish(bridge: BridgeRuntime, order: readonly ("state" | "scroll" | "notes")[]) {
  for (const channel of order) {
    if (channel === "state") bridge.acceptState(STATE_BYTES)
    if (channel === "scroll") bridge.acceptScroll(SCROLL_BYTES)
    if (channel === "notes") bridge.acceptSchedule(NOTES_BYTES)
  }
}

function expectSnapshot(bridge: BridgeRuntime) {
  expect(bridge.readState()).toEqual(STATE)
  expect(bridge.readSchedule(3)).toEqual(SCHEDULE)
}

describe("BridgeRuntime", () => {
  for (const order of ORDERS) {
    it(`composes matching records received as ${order.join(", ")}`, () => {
      const bridge = runtime()

      publish(bridge, order)

      expectSnapshot(bridge)
    })
  }

  it("keeps the published snapshot while newer scroll and notes candidates are unmatched", () => {
    const scrollBridge = runtime()
    publish(scrollBridge, ["state", "scroll", "notes"])

    scrollBridge.acceptScroll(NEWER_SCROLL_BYTES)

    expectSnapshot(scrollBridge)

    const notesBridge = runtime()
    publish(notesBridge, ["state", "scroll", "notes"])

    notesBridge.acceptSchedule(NEWER_NOTES_BYTES)

    expectSnapshot(notesBridge)
  })

  it("counts repeated mismatched bytes decoded into fresh records once", () => {
    const bridge = runtime()
    publish(bridge, ["state", "scroll"])

    bridge.acceptSchedule(MISMATCHED_NOTES_BYTES)
    bridge.acceptState(STATE_BYTES)
    bridge.acceptSchedule(MISMATCHED_NOTES_BYTES)

    expect(bridge.readState()).toBeNull()
    expect(bridge.readSchedule(3)).toBeNull()
    expect(bridge.readDiagnostics().counters.revMismatch).toBe(1)
  })

  it("clears records and every runtime-owned counter for a valid repeated app session", () => {
    const bridge = runtime()
    publish(bridge, ["state", "scroll", "notes"])
    bridge.acceptSchedule(MISMATCHED_NOTES_BYTES)
    bridge.acceptState(INVALID_BYTES)
    bridge.acceptScroll(INVALID_BYTES)
    bridge.acceptSchedule(INVALID_BYTES)

    bridge.acceptSession(SESSION_BYTES)

    expect(bridge.readState()).toBeNull()
    expect(bridge.readSchedule(3)).toBeNull()
    expect(bridge.readDiagnostics()).toMatchObject({
      state: null,
      scroll: null,
      notes: null,
      stateRecord: null,
      scrollRecord: null,
      notesRecord: null,
      counters: {
        stateInvalid: 0,
        scrollInvalid: 0,
        scrollSeqMismatch: 0,
        notesInvalid: 0,
        notesSeqMismatch: 0,
        revMismatch: 0,
      },
    })
  })

  it("leaves records and diagnostics intact when the session is malformed", () => {
    const bridge = runtime()
    publish(bridge, ["state", "scroll", "notes"])
    bridge.acceptSchedule(MISMATCHED_NOTES_BYTES)

    bridge.acceptSession(INVALID_BYTES)

    expectSnapshot(bridge)
    expect(bridge.readDiagnostics().counters.revMismatch).toBe(1)
  })

  it("matches decoded scroll and notes generations without external sequence fields", () => {
    const bridge = runtime()

    bridge.acceptState(STATE_BYTES)
    bridge.acceptScroll(SCROLL_BYTES)
    bridge.acceptSchedule(NOTES_BYTES)

    expectSnapshot(bridge)
  })

  it("retains candidates and snapshots after invalid decoded records", () => {
    const bridge = runtime()
    publish(bridge, ["state", "scroll", "notes"])

    bridge.acceptState(NEWER_STATE_BYTES)
    bridge.acceptState(INVALID_BYTES)
    bridge.acceptScroll(INVALID_BYTES)
    bridge.acceptSchedule(INVALID_BYTES)

    expectSnapshot(bridge)

    bridge.acceptScroll(NEWER_SCROLL_BYTES)
    bridge.acceptSchedule(NEWER_NOTES_BYTES)

    expect(bridge.readState()).toEqual({
      ...STATE,
      seq: 11,
      notesSeq: 4,
      scrollSeq: 6,
      rev: "next",
      px: { ...MAPPING, viewLeft: 10, viewRight: 110 },
    })
    expect(bridge.readSchedule(4)).toEqual({ notesSeq: 4, rev: "next", notes: [] })
    expect(bridge.readDiagnostics().counters).toMatchObject({
      stateInvalid: 1,
      scrollInvalid: 1,
      notesInvalid: 1,
    })
  })

  it("counts each unresolved generation composition mismatch once and clears it when it resolves", () => {
    const bridge = runtime()

    bridge.acceptState(STATE_BYTES)
    bridge.acceptScroll(NEWER_SCROLL_BYTES)
    bridge.acceptScroll(NEWER_SCROLL_BYTES)
    expect(bridge.readDiagnostics().counters.scrollSeqMismatch).toBe(1)

    bridge.acceptScroll(SCROLL_BYTES)
    bridge.acceptSchedule(NEWER_NOTES_BYTES)
    bridge.acceptSchedule(NEWER_NOTES_BYTES)
    expect(bridge.readDiagnostics().counters.notesSeqMismatch).toBe(1)

    bridge.acceptSchedule(NOTES_BYTES)
    expectSnapshot(bridge)
    expect(bridge.readDiagnostics().counters).toMatchObject({
      scrollSeqMismatch: 1,
      notesSeqMismatch: 1,
      revMismatch: 0,
    })
  })

  it("composes state and scroll without a notes candidate when notesSeq is zero", () => {
    const bridge = runtime()

    bridge.acceptState(STATE_WITHOUT_NOTES_BYTES)
    bridge.acceptScroll(SCROLL_BYTES)

    expect(bridge.readState()).toEqual({ ...STATE, seq: 10, notesSeq: 0 })
    expect(bridge.readSchedule(0)).toBeNull()
  })

  it("publishes diagnostics from the matching accepted candidates", () => {
    const stateDiagnostics: BridgeChannelDiagnostics = {
      receivedAtMs: 1_000,
      sizeBytes: 256,
      acceptedAtMs: 20,
    }
    const scrollDiagnostics: BridgeChannelDiagnostics = {
      receivedAtMs: 1_500,
      sizeBytes: 64,
      acceptedAtMs: 30,
    }
    const notesDiagnostics: BridgeChannelDiagnostics = {
      receivedAtMs: 2_000,
      sizeBytes: 512,
      acceptedAtMs: 40,
    }
    const bridge = runtime()

    bridge.acceptSchedule(NOTES_BYTES, notesDiagnostics)
    bridge.acceptState(STATE_BYTES, stateDiagnostics)
    bridge.acceptScroll(SCROLL_BYTES, scrollDiagnostics)

    expect(bridge.readDiagnostics()).toMatchObject({
      state: stateDiagnostics,
      scroll: scrollDiagnostics,
      notes: notesDiagnostics,
      stateRecord: {
        seq: 9,
        notesSeq: 3,
        scrollSeq: 5,
        rev: "abcdef123456",
      },
      scrollRecord: { scrollSeq: 5 },
      notesRecord: { notesSeq: 3, rev: "abcdef123456" },
    })
  })

  it("retains copy-safe pipe transport diagnostics", () => {
    const transport: BridgeTransportDiagnostics = {
      status: "ready",
      session: "0123456789abcdef0123456789abcdef",
      recoveries: 2,
      malformedFrames: 1,
      endpointFailures: 1,
      disconnects: { state: 3, scroll: 4, notes: 5 },
    }
    const bridge = runtime()

    bridge.acceptTransportDiagnostics(transport)

    expect(bridge.readDiagnostics().transport).toEqual(transport)
    const diagnostics = bridge.readDiagnostics()
    if (diagnostics.transport) {
      diagnostics.transport.disconnects.state = 99
    }
    expect(bridge.readDiagnostics().transport?.disconnects.state).toBe(3)
  })
})
