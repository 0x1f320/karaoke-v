import type {
  BridgeSchedule,
  BridgeScrollRecord,
  BridgeSession,
  BridgeState,
  BridgeStateRecord,
} from "../shared/bridgeChannels"
import { decodeNotes, decodeScroll, decodeSession, decodeState } from "../shared/bridgeChannels"
import type {
  BridgeChannelDiagnostics,
  BridgeDiagnostics,
  BridgeSamplerDiagnostics,
} from "../shared/bridgeDiagnostics"

export interface BridgeRuntimeDecoders {
  decodeSession(bytes: Uint8Array): BridgeSession | null
  decodeState(bytes: Uint8Array): BridgeStateRecord | null
  decodeScroll(bytes: Uint8Array): BridgeScrollRecord | null
  decodeNotes(bytes: Uint8Array): BridgeSchedule | null
}

interface Accepted<T> {
  value: T
  diagnostics: BridgeChannelDiagnostics | null
}

const DECODERS: BridgeRuntimeDecoders = { decodeSession, decodeState, decodeScroll, decodeNotes }
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
  private stateCandidate: Accepted<BridgeStateRecord> | null = null
  private scrollCandidate: Accepted<BridgeScrollRecord> | null = null
  private notesCandidate: Accepted<BridgeSchedule> | null = null
  private scheduleSeq = 0
  private schedule: BridgeSchedule | null = null
  private samplerDiagnostics: BridgeSamplerDiagnostics = EMPTY_SAMPLER_DIAGNOSTICS
  private revisionMismatches = 0
  private lastRevisionMismatch: {
    state: BridgeStateRecord
    schedule: BridgeSchedule
  } | null = null
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

  acceptSession(bytes: Uint8Array, _diagnostics: BridgeChannelDiagnostics | null = null): void {
    if (!this.decoders.decodeSession(bytes)) {
      return
    }
    this.stateCandidate = null
    this.scrollCandidate = null
    this.notesCandidate = null
    this.lastRevisionMismatch = null
    this.state = null
    this.schedule = null
    this.scheduleSeq = 0
    this.diagnostics = {
      ...this.diagnostics,
      state: null,
      scroll: null,
      notes: null,
      stateRecord: null,
      scrollRecord: null,
      notesRecord: null,
    }
  }

  acceptState(bytes: Uint8Array, diagnostics: BridgeChannelDiagnostics | null = null): void {
    const state = this.decoders.decodeState(bytes)
    if (!state) {
      return
    }
    this.stateCandidate = { value: state, diagnostics }
    this.compose()
  }

  readState(): BridgeState | null {
    return this.state
  }

  acceptScroll(bytes: Uint8Array, diagnostics?: BridgeChannelDiagnostics | null): void
  acceptScroll(
    _scrollSeq: number,
    bytes: Uint8Array,
    diagnostics?: BridgeChannelDiagnostics | null,
  ): void
  acceptScroll(
    bytesOrScrollSeq: Uint8Array | number,
    bytesOrDiagnostics: Uint8Array | BridgeChannelDiagnostics | null = null,
    legacyDiagnostics: BridgeChannelDiagnostics | null = null,
  ): void {
    const bytes =
      typeof bytesOrScrollSeq === "number" ? (bytesOrDiagnostics as Uint8Array) : bytesOrScrollSeq
    const diagnostics =
      typeof bytesOrScrollSeq === "number"
        ? legacyDiagnostics
        : (bytesOrDiagnostics as BridgeChannelDiagnostics | null)
    const scroll = this.decoders.decodeScroll(bytes)
    if (!scroll) {
      return
    }
    this.scrollCandidate = { value: scroll, diagnostics }
    this.compose()
  }

  acceptSchedule(bytes: Uint8Array, diagnostics?: BridgeChannelDiagnostics | null): void
  acceptSchedule(
    _notesSeq: number,
    bytes: Uint8Array,
    diagnostics?: BridgeChannelDiagnostics | null,
  ): void
  acceptSchedule(
    bytesOrNotesSeq: Uint8Array | number,
    bytesOrDiagnostics: Uint8Array | BridgeChannelDiagnostics | null = null,
    legacyDiagnostics: BridgeChannelDiagnostics | null = null,
  ): void {
    const bytes =
      typeof bytesOrNotesSeq === "number" ? (bytesOrDiagnostics as Uint8Array) : bytesOrNotesSeq
    const diagnostics =
      typeof bytesOrNotesSeq === "number"
        ? legacyDiagnostics
        : (bytesOrDiagnostics as BridgeChannelDiagnostics | null)
    const schedule = this.decoders.decodeNotes(bytes)
    if (!schedule) {
      return
    }
    this.notesCandidate = { value: schedule, diagnostics }
    this.compose()
  }

  readSchedule(notesSeq: number): BridgeSchedule | null {
    return notesSeq === this.scheduleSeq ? this.schedule : null
  }

  readDiagnostics(): BridgeDiagnostics {
    return {
      ...this.diagnostics,
      counters: {
        ...this.samplerDiagnostics.counters,
        revMismatch: this.samplerDiagnostics.counters.revMismatch + this.revisionMismatches,
      },
      costs: this.samplerDiagnostics.costs,
    }
  }

  acceptSamplerDiagnostics(diagnostics: BridgeSamplerDiagnostics): void {
    this.samplerDiagnostics = diagnostics
  }

  private compose(): void {
    const stateCandidate = this.stateCandidate
    const scrollCandidate = this.scrollCandidate
    if (
      !stateCandidate ||
      !scrollCandidate ||
      scrollCandidate.value.scrollSeq !== stateCandidate.value.scrollSeq
    ) {
      return
    }

    const notesCandidate = this.notesCandidate
    let matchingNotesCandidate: Accepted<BridgeSchedule> | null = null
    if (stateCandidate.value.notesSeq !== 0) {
      if (!notesCandidate || notesCandidate.value.notesSeq !== stateCandidate.value.notesSeq) {
        return
      }
      if (notesCandidate.value.rev !== stateCandidate.value.rev) {
        if (
          this.lastRevisionMismatch?.state !== stateCandidate.value ||
          this.lastRevisionMismatch.schedule !== notesCandidate.value
        ) {
          this.revisionMismatches += 1
          this.lastRevisionMismatch = {
            state: stateCandidate.value,
            schedule: notesCandidate.value,
          }
        }
        return
      }
      matchingNotesCandidate = notesCandidate
    }

    const scroll = scrollCandidate.value
    this.state = {
      ...stateCandidate.value,
      px: {
        perBlick: scroll.perBlick,
        perSemitone: scroll.perSemitone,
        viewLeft: scroll.viewLeft,
        viewRight: scroll.viewRight,
        viewTop: scroll.viewTop,
        viewBottom: scroll.viewBottom,
      },
    }
    this.schedule = matchingNotesCandidate?.value ?? null
    this.scheduleSeq = this.schedule?.notesSeq ?? 0
    this.diagnostics = {
      ...this.diagnostics,
      state: stateCandidate.diagnostics,
      scroll: scrollCandidate.diagnostics,
      notes: matchingNotesCandidate?.diagnostics ?? null,
      stateRecord: {
        seq: stateCandidate.value.seq,
        notesSeq: stateCandidate.value.notesSeq,
        scrollSeq: stateCandidate.value.scrollSeq,
        rev: stateCandidate.value.rev,
      },
      scrollRecord: { scrollSeq: scroll.scrollSeq },
      notesRecord:
        this.schedule === null
          ? null
          : { notesSeq: this.schedule.notesSeq, rev: this.schedule.rev },
    }
  }
}
