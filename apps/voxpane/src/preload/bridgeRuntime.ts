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
  BridgeTransportDiagnostics,
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
function emptyCounters(): BridgeDiagnostics["counters"] {
  return {
    stateInvalid: 0,
    scrollInvalid: 0,
    scrollSeqMismatch: 0,
    notesInvalid: 0,
    notesSeqMismatch: 0,
    revMismatch: 0,
  }
}

export class BridgeRuntime {
  private state: BridgeState | null = null
  private stateCandidate: Accepted<BridgeStateRecord> | null = null
  private scrollCandidate: Accepted<BridgeScrollRecord> | null = null
  private notesCandidate: Accepted<BridgeSchedule> | null = null
  private scheduleSeq = 0
  private schedule: BridgeSchedule | null = null
  private counters = emptyCounters()
  private lastScrollMismatchKey: string | null = null
  private lastNotesMismatchKey: string | null = null
  private lastRevisionMismatchKey: string | null = null
  private diagnostics: BridgeDiagnostics = {
    state: null,
    scroll: null,
    notes: null,
    stateRecord: null,
    scrollRecord: null,
    notesRecord: null,
    transport: null,
    counters: emptyCounters(),
  }

  constructor(private readonly decoders: BridgeRuntimeDecoders = DECODERS) {}

  acceptSession(bytes: Uint8Array, _diagnostics: BridgeChannelDiagnostics | null = null): void {
    if (!this.decoders.decodeSession(bytes)) {
      return
    }
    this.stateCandidate = null
    this.scrollCandidate = null
    this.notesCandidate = null
    this.counters = emptyCounters()
    this.clearMismatchKeys()
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
      counters: emptyCounters(),
    }
  }

  acceptState(bytes: Uint8Array, diagnostics: BridgeChannelDiagnostics | null = null): void {
    const state = this.decoders.decodeState(bytes)
    if (!state) {
      this.counters.stateInvalid += 1
      return
    }
    this.stateCandidate = { value: state, diagnostics }
    this.compose()
  }

  readState(): BridgeState | null {
    return this.state
  }

  acceptScroll(bytes: Uint8Array, diagnostics: BridgeChannelDiagnostics | null = null): void {
    const scroll = this.decoders.decodeScroll(bytes)
    if (!scroll) {
      this.counters.scrollInvalid += 1
      return
    }
    this.scrollCandidate = { value: scroll, diagnostics }
    this.compose()
  }

  acceptSchedule(bytes: Uint8Array, diagnostics: BridgeChannelDiagnostics | null = null): void {
    const schedule = this.decoders.decodeNotes(bytes)
    if (!schedule) {
      this.counters.notesInvalid += 1
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
      state: this.diagnostics.state && { ...this.diagnostics.state },
      scroll: this.diagnostics.scroll && { ...this.diagnostics.scroll },
      notes: this.diagnostics.notes && { ...this.diagnostics.notes },
      stateRecord: this.diagnostics.stateRecord && { ...this.diagnostics.stateRecord },
      scrollRecord: this.diagnostics.scrollRecord && { ...this.diagnostics.scrollRecord },
      notesRecord: this.diagnostics.notesRecord && { ...this.diagnostics.notesRecord },
      counters: { ...this.counters },
      transport: this.diagnostics.transport && {
        ...this.diagnostics.transport,
        disconnects: { ...this.diagnostics.transport.disconnects },
      },
    }
  }

  acceptTransportDiagnostics(diagnostics: BridgeTransportDiagnostics): void {
    this.diagnostics = {
      ...this.diagnostics,
      transport: { ...diagnostics, disconnects: { ...diagnostics.disconnects } },
    }
  }

  private compose(): void {
    const stateCandidate = this.stateCandidate
    const scrollCandidate = this.scrollCandidate
    if (!stateCandidate || !scrollCandidate) {
      this.clearMismatchKeys()
      return
    }
    if (scrollCandidate.value.scrollSeq !== stateCandidate.value.scrollSeq) {
      this.observeMismatch(
        "scroll",
        JSON.stringify([
          stateCandidate.value.seq,
          stateCandidate.value.scrollSeq,
          scrollCandidate.value.scrollSeq,
        ]),
      )
      return
    }

    const notesCandidate = this.notesCandidate
    let matchingNotesCandidate: Accepted<BridgeSchedule> | null = null
    if (stateCandidate.value.notesSeq !== 0) {
      if (!notesCandidate) {
        this.clearMismatchKeys()
        return
      }
      if (notesCandidate.value.notesSeq !== stateCandidate.value.notesSeq) {
        this.observeMismatch(
          "notes",
          JSON.stringify([
            stateCandidate.value.seq,
            stateCandidate.value.notesSeq,
            notesCandidate.value.notesSeq,
          ]),
        )
        return
      }
      if (notesCandidate.value.rev !== stateCandidate.value.rev) {
        this.observeMismatch(
          "revision",
          JSON.stringify([
            stateCandidate.value.seq,
            stateCandidate.value.notesSeq,
            stateCandidate.value.rev,
            notesCandidate.value.rev,
          ]),
        )
        return
      }
      matchingNotesCandidate = notesCandidate
    }

    this.clearMismatchKeys()

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

  private observeMismatch(kind: "scroll" | "notes" | "revision", key: string): void {
    if (kind === "scroll") {
      this.lastNotesMismatchKey = null
      this.lastRevisionMismatchKey = null
      if (this.lastScrollMismatchKey !== key) this.counters.scrollSeqMismatch += 1
      this.lastScrollMismatchKey = key
      return
    }
    if (kind === "notes") {
      this.lastScrollMismatchKey = null
      this.lastRevisionMismatchKey = null
      if (this.lastNotesMismatchKey !== key) this.counters.notesSeqMismatch += 1
      this.lastNotesMismatchKey = key
      return
    }
    this.lastScrollMismatchKey = null
    this.lastNotesMismatchKey = null
    if (this.lastRevisionMismatchKey !== key) this.counters.revMismatch += 1
    this.lastRevisionMismatchKey = key
  }

  private clearMismatchKeys(): void {
    this.lastScrollMismatchKey = null
    this.lastNotesMismatchKey = null
    this.lastRevisionMismatchKey = null
  }
}
