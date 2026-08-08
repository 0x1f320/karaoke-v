import type {
  BridgeSchedule,
  BridgeScrollRecord,
  BridgeState,
  BridgeStateRecord,
} from "../shared/bridgeChannels"
import { decodeNotes, decodeScroll, decodeState } from "../shared/bridgeChannels"
import type {
  BridgeChannelDiagnostics,
  BridgeDiagnostics,
  BridgeSamplerDiagnostics,
} from "../shared/bridgeDiagnostics"

export interface BridgeRuntimeDecoders {
  decodeState(bytes: Uint8Array): BridgeStateRecord | null
  decodeScroll(bytes: Uint8Array): BridgeScrollRecord | null
  decodeNotes(bytes: Uint8Array): BridgeSchedule | null
}

const DECODERS: BridgeRuntimeDecoders = { decodeState, decodeScroll, decodeNotes }
const EMPTY_SAMPLER_DIAGNOSTICS: BridgeSamplerDiagnostics = {
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
}

export class BridgeRuntime {
  private state: BridgeState | null = null
  private scroll: BridgeScrollRecord | null = null
  private scheduleSeq = 0
  private schedule: BridgeSchedule | null = null
  private diagnostics: BridgeDiagnostics = {
    state: null,
    scroll: null,
    notes: null,
    stateRecord: null,
    scrollRecord: null,
    notesRecord: null,
    ...EMPTY_SAMPLER_DIAGNOSTICS,
  }

  constructor(private readonly decoders: BridgeRuntimeDecoders = DECODERS) {}

  acceptState(bytes: Uint8Array, diagnostics: BridgeChannelDiagnostics | null = null): void {
    const state = this.decoders.decodeState(bytes)
    if (state && this.scroll?.scrollSeq === state.scrollSeq) {
      this.state = {
        ...state,
        px: {
          perBlick: this.scroll.perBlick,
          perSemitone: this.scroll.perSemitone,
          viewLeft: this.scroll.viewLeft,
          viewRight: this.scroll.viewRight,
          viewTop: this.scroll.viewTop,
          viewBottom: this.scroll.viewBottom,
        },
      }
      this.diagnostics = {
        ...this.diagnostics,
        state: diagnostics,
        stateRecord: {
          seq: state.seq,
          notesSeq: state.notesSeq,
          scrollSeq: state.scrollSeq,
          rev: state.rev,
        },
      }
    }
  }

  readState(): BridgeState | null {
    return this.state
  }

  acceptScroll(
    scrollSeq: number,
    bytes: Uint8Array,
    diagnostics: BridgeChannelDiagnostics | null = null,
  ): void {
    const scroll = this.decoders.decodeScroll(bytes)
    if (!scroll || scroll.scrollSeq !== scrollSeq) {
      return
    }
    this.scroll = scroll
    this.diagnostics = {
      ...this.diagnostics,
      scroll: diagnostics,
      scrollRecord: { scrollSeq },
    }
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
