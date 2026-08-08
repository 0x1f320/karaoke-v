import { describe, expect, it } from "vitest"
import type {
  BridgeSchedule,
  BridgeScrollRecord,
  BridgeState,
  BridgeStateRecord,
} from "../shared/bridgeChannels"
import type {
  BridgeChannelDiagnostics,
  BridgeSamplerDiagnostics,
} from "../shared/bridgeDiagnostics"
import { BridgeRuntime } from "./bridgeRuntime"

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

describe("BridgeRuntime", () => {
  it("exposes state only after its matching scroll is available", () => {
    const runtime = new BridgeRuntime({
      decodeState: () => STATE_RECORD,
      decodeScroll: () => SCROLL,
      decodeNotes: () => null,
    })

    expect(runtime.readState()).toBeNull()

    runtime.acceptState(new Uint8Array(256))
    expect(runtime.readState()).toBeNull()

    runtime.acceptScroll(5, new Uint8Array(64))
    runtime.acceptState(new Uint8Array(256))

    expect(runtime.readState()).toEqual(STATE)
  })

  it("does not compose state with a different scroll generation", () => {
    const runtime = new BridgeRuntime({
      decodeState: () => STATE_RECORD,
      decodeScroll: () => ({ ...SCROLL, scrollSeq: 4 }),
      decodeNotes: () => null,
    })

    runtime.acceptScroll(4, new Uint8Array(64))
    runtime.acceptState(new Uint8Array(256))

    expect(runtime.readState()).toBeNull()
  })

  it("updates channel diagnostics only when the matching record is accepted", () => {
    const stateDiagnostics: BridgeChannelDiagnostics = {
      modifiedAtMs: 1_000,
      sizeBytes: 256,
      acceptedAtMs: 20,
    }
    const notesDiagnostics: BridgeChannelDiagnostics = {
      modifiedAtMs: 2_000,
      sizeBytes: 512,
      acceptedAtMs: 40,
    }
    const scrollDiagnostics: BridgeChannelDiagnostics = {
      modifiedAtMs: 1_500,
      sizeBytes: 64,
      acceptedAtMs: 30,
    }
    const runtime = new BridgeRuntime({
      decodeState: () => STATE_RECORD,
      decodeScroll: () => SCROLL,
      decodeNotes: () => null,
    })

    runtime.acceptScroll(5, new Uint8Array(64), scrollDiagnostics)
    runtime.acceptState(new Uint8Array(256), stateDiagnostics)
    runtime.acceptSchedule(1, new Uint8Array(512), notesDiagnostics)

    expect(runtime.readDiagnostics()).toEqual({
      state: stateDiagnostics,
      scroll: scrollDiagnostics,
      notes: null,
      stateRecord: {
        seq: 9,
        notesSeq: 3,
        scrollSeq: 5,
        rev: "abcdef123456",
      },
      scrollRecord: {
        scrollSeq: 5,
      },
      notesRecord: null,
      counters: {
        stateMissing: 0,
        stateInvalid: 0,
        scrollMissing: 0,
        scrollInvalid: 0,
        scrollSeqMismatch: 0,
        notesMissing: 0,
        notesInvalid: 0,
        revMismatch: 0,
      },
      costs: {
        stateReadMs: null,
        scrollReadMs: null,
        notesReadMs: null,
      },
    })
  })

  it("stores accepted schedule metadata and sampler diagnostics", () => {
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
    const runtime = new BridgeRuntime({
      decodeState: () => STATE_RECORD,
      decodeScroll: () => SCROLL,
      decodeNotes: () => SCHEDULE,
    })

    runtime.acceptScroll(5, new Uint8Array(64))
    runtime.acceptState(new Uint8Array(256))
    runtime.acceptSchedule(3, new Uint8Array(512))
    runtime.acceptSamplerDiagnostics(samplerDiagnostics)

    expect(runtime.readDiagnostics()).toMatchObject({
      notesRecord: {
        notesSeq: 3,
        rev: "abcdef123456",
      },
      counters: samplerDiagnostics.counters,
      costs: samplerDiagnostics.costs,
    })
  })
})
