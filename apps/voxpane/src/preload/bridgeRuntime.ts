import type { BridgeSchedule, BridgeState } from "../shared/bridgeChannels"
import { decodeNotes, decodeState } from "../shared/bridgeChannels"
import type {
  BridgeChannelDiagnostics,
  BridgeDiagnostics,
  BridgeSamplerDiagnostics,
} from "../shared/bridgeDiagnostics"

export interface BridgeRuntimeDecoders {
  decodeState(bytes: Uint8Array): BridgeState | null
  decodeNotes(bytes: Uint8Array): BridgeSchedule | null
}

const DECODERS: BridgeRuntimeDecoders = { decodeState, decodeNotes }
const EMPTY_SAMPLER_DIAGNOSTICS: BridgeSamplerDiagnostics = {
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
}

export class BridgeRuntime {
  private state: BridgeState | null = null
  private scheduleSeq = 0
  private schedule: BridgeSchedule | null = null
  private diagnostics: BridgeDiagnostics = {
    state: null,
    notes: null,
    stateRecord: null,
    notesRecord: null,
    ...EMPTY_SAMPLER_DIAGNOSTICS,
  }

  constructor(private readonly decoders: BridgeRuntimeDecoders = DECODERS) {}

  acceptState(bytes: Uint8Array, diagnostics: BridgeChannelDiagnostics | null = null): void {
    const state = this.decoders.decodeState(bytes)
    if (state) {
      this.state = state
      this.diagnostics = {
        ...this.diagnostics,
        state: diagnostics,
        stateRecord: {
          seq: state.seq,
          notesSeq: state.notesSeq,
          rev: state.rev,
        },
      }
    }
  }

  readState(): BridgeState | null {
    return this.state
  }

  acceptSchedule(
    notesSeq: number,
    bytes: Uint8Array,
    diagnostics: BridgeChannelDiagnostics | null = null,
  ): void {
    if (notesSeq <= this.scheduleSeq) {
      return
    }
    const schedule = this.decoders.decodeNotes(bytes)
    if (!schedule) {
      return
    }
    this.scheduleSeq = notesSeq
    this.schedule = schedule
    this.diagnostics = {
      ...this.diagnostics,
      notes: diagnostics,
      notesRecord: {
        notesSeq,
        rev: schedule.rev,
      },
    }
  }

  readSchedule(notesSeq: number): BridgeSchedule | null {
    return notesSeq === this.scheduleSeq ? this.schedule : null
  }

  readDiagnostics(): BridgeDiagnostics {
    return this.diagnostics
  }

  acceptSamplerDiagnostics(diagnostics: BridgeSamplerDiagnostics): void {
    this.diagnostics = {
      ...this.diagnostics,
      counters: diagnostics.counters,
      costs: diagnostics.costs,
    }
  }
}
