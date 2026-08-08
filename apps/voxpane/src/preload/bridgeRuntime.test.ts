import { describe, expect, it } from "vitest"
import type { BridgeSchedule, BridgeState } from "../shared/bridgeChannels"
import type {
  BridgeChannelDiagnostics,
  BridgeSamplerDiagnostics,
} from "../shared/bridgeDiagnostics"
import { BridgeRuntime } from "./bridgeRuntime"

const STATE = { seq: 9, notesSeq: 3, rev: "abcdef123456" } as BridgeState
const SCHEDULE = { rev: "abcdef123456", notes: [] } as BridgeSchedule

describe("BridgeRuntime", () => {
  it("keeps the latest state pushed independently of renderer reads", () => {
    const runtime = new BridgeRuntime({
      decodeState: () => STATE,
      decodeNotes: () => null,
    })

    expect(runtime.readState()).toBeNull()

    runtime.acceptState(new Uint8Array(256))

    expect(runtime.readState()).toBe(STATE)
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
    const runtime = new BridgeRuntime({
      decodeState: () => STATE,
      decodeNotes: () => null,
    })

    runtime.acceptState(new Uint8Array(256), stateDiagnostics)
    runtime.acceptSchedule(1, new Uint8Array(512), notesDiagnostics)

    expect(runtime.readDiagnostics()).toEqual({
      state: stateDiagnostics,
      notes: null,
      stateRecord: {
        seq: 9,
        notesSeq: 3,
        rev: "abcdef123456",
      },
      notesRecord: null,
      counters: {
        stateMissing: 0,
        stateInvalid: 0,
        notesMissing: 0,
        notesInvalid: 0,
        revMismatch: 0,
      },
      costs: {
        stateReadMs: null,
        notesReadMs: null,
      },
    })
  })

  it("stores accepted schedule metadata and sampler diagnostics", () => {
    const samplerDiagnostics: BridgeSamplerDiagnostics = {
      counters: {
        stateMissing: 1,
        stateInvalid: 2,
        notesMissing: 3,
        notesInvalid: 4,
        revMismatch: 5,
      },
      costs: {
        stateReadMs: 0.5,
        notesReadMs: 8,
      },
    }
    const runtime = new BridgeRuntime({
      decodeState: () => STATE,
      decodeNotes: () => SCHEDULE,
    })

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
