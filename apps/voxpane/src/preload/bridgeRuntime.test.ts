import { describe, expect, it } from "vitest"
import type {
  BridgeSchedule,
  BridgeScrollRecord,
  BridgeSession,
  BridgeState,
  BridgeStateRecord,
} from "../shared/bridgeChannels"
import type {
  BridgeChannelDiagnostics,
  BridgeSamplerDiagnostics,
} from "../shared/bridgeDiagnostics"
import { BridgeRuntime } from "./bridgeRuntime"

const STATE_BYTES = new Uint8Array(256)
const SCROLL_BYTES = new Uint8Array(64)
const NOTES_BYTES = new Uint8Array(512)
const SESSION_BYTES = new Uint8Array(128)
const STATE_RECORD = {
  seq: 9,
  notesSeq: 3,
  scrollSeq: 5,
  rev: "abcdef123456",
} as BridgeStateRecord
const SCROLL = {
  scrollSeq: 5,
  perBlick: 1,
  perSemitone: 12,
  viewLeft: 0,
  viewRight: 100,
  viewTop: 80,
  viewBottom: 40,
} satisfies BridgeScrollRecord
const STATE = {
  ...STATE_RECORD,
  px: {
    perBlick: 1,
    perSemitone: 12,
    viewLeft: 0,
    viewRight: 100,
    viewTop: 80,
    viewBottom: 40,
  },
} as BridgeState
const SCHEDULE = { notesSeq: 3, rev: "abcdef123456", notes: [] } as BridgeSchedule
const SESSION = {
  v: 1,
  layout: 5,
  appSession: "0123456789abcdef0123456789abcdef",
} as BridgeSession
const ORDERS = [
  ["state", "scroll", "notes"],
  ["state", "notes", "scroll"],
  ["scroll", "state", "notes"],
  ["scroll", "notes", "state"],
  ["notes", "state", "scroll"],
  ["notes", "scroll", "state"],
] as const

function runtime(
  options: {
    state?: () => BridgeStateRecord | null
    scroll?: () => BridgeScrollRecord | null
    notes?: () => BridgeSchedule | null
    session?: () => BridgeSession | null
  } = {},
) {
  return new BridgeRuntime({
    decodeState: options.state ?? (() => STATE_RECORD),
    decodeScroll: options.scroll ?? (() => SCROLL),
    decodeNotes: options.notes ?? (() => SCHEDULE),
    decodeSession: options.session ?? (() => SESSION),
  })
}

function publish(runtime: BridgeRuntime, order: readonly ("state" | "scroll" | "notes")[]) {
  for (const channel of order) {
    if (channel === "state") runtime.acceptState(STATE_BYTES)
    if (channel === "scroll") runtime.acceptScroll(SCROLL_BYTES)
    if (channel === "notes") runtime.acceptSchedule(NOTES_BYTES)
  }
}

describe("BridgeRuntime", () => {
  for (const order of ORDERS) {
    it(`composes matching records received as ${order.join(", ")}`, () => {
      const bridge = runtime()

      publish(bridge, order)

      expect(bridge.readState()).toEqual(STATE)
      expect(bridge.readSchedule(3)).toEqual(SCHEDULE)
    })
  }

  it("keeps the published snapshot while a newer state candidate is unmatched", () => {
    let state = STATE_RECORD
    const bridge = runtime({ state: () => state })
    publish(bridge, ["state", "scroll", "notes"])

    state = { ...STATE_RECORD, seq: 10, notesSeq: 4, scrollSeq: 6, rev: "next" }
    bridge.acceptState(STATE_BYTES)

    expect(bridge.readState()).toEqual(STATE)
    expect(bridge.readSchedule(3)).toEqual(SCHEDULE)
  })

  it("does not publish a revision mismatch and counts it once per candidate", () => {
    const bridge = runtime({ notes: () => ({ ...SCHEDULE, rev: "other" }) })
    publish(bridge, ["state", "scroll", "notes"])

    expect(bridge.readState()).toBeNull()
    expect(bridge.readSchedule(3)).toBeNull()
    expect(bridge.readDiagnostics().counters.revMismatch).toBe(1)

    bridge.acceptState(STATE_BYTES)

    expect(bridge.readDiagnostics().counters.revMismatch).toBe(1)
  })

  it("clears candidates and published records for every valid session frame", () => {
    let session: BridgeSession | null = SESSION
    const bridge = runtime({ session: () => session })
    publish(bridge, ["state", "scroll", "notes"])

    session = null
    bridge.acceptSession(SESSION_BYTES)

    expect(bridge.readState()).toEqual(STATE)
    expect(bridge.readSchedule(3)).toEqual(SCHEDULE)

    session = SESSION
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
    })
  })

  it("composes state and scroll without a notes candidate when notesSeq is zero", () => {
    const bridge = runtime({ state: () => ({ ...STATE_RECORD, notesSeq: 0 }) })

    publish(bridge, ["state", "scroll"])

    expect(bridge.readState()).toEqual({ ...STATE, notesSeq: 0 })
    expect(bridge.readSchedule(0)).toBeNull()
  })

  it("publishes diagnostics from the matching accepted candidates", () => {
    const stateDiagnostics: BridgeChannelDiagnostics = {
      modifiedAtMs: 1_000,
      sizeBytes: 256,
      acceptedAtMs: 20,
    }
    const scrollDiagnostics: BridgeChannelDiagnostics = {
      modifiedAtMs: 1_500,
      sizeBytes: 64,
      acceptedAtMs: 30,
    }
    const notesDiagnostics: BridgeChannelDiagnostics = {
      modifiedAtMs: 2_000,
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
      stateRecord: STATE_RECORD,
      scrollRecord: { scrollSeq: 5 },
      notesRecord: { notesSeq: 3, rev: "abcdef123456" },
    })
  })

  it("retains sampler diagnostics", () => {
    const samplerDiagnostics: BridgeSamplerDiagnostics = {
      counters: {
        stateMissing: 1,
        stateInvalid: 2,
        scrollMissing: 3,
        scrollInvalid: 4,
        scrollSeqMismatch: 5,
        notesMissing: 6,
        notesInvalid: 7,
        revMismatch: 8,
      },
      costs: {
        stateReadMs: 0.5,
        scrollReadMs: 0.25,
        notesReadMs: 8,
      },
    }
    const bridge = runtime()

    bridge.acceptSamplerDiagnostics(samplerDiagnostics)

    expect(bridge.readDiagnostics()).toMatchObject(samplerDiagnostics)
  })
})
