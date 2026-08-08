import { decodeNotes, decodeState } from "../shared/bridgeChannels"
import type {
  BridgeDiagnosticsCounters,
  BridgeReadCosts,
  BridgeRecordRead,
  BridgeSamplerDiagnostics,
} from "../shared/bridgeDiagnostics"

export interface BridgeSamplerDependencies {
  now(): number
  readState(diagnostics: boolean): BridgeRecordRead | null
  readSchedule(diagnostics: boolean): BridgeRecordRead | null
  publishState(record: BridgeRecordRead): void
  publishSchedule(notesSeq: number, record: BridgeRecordRead): void
  publishDiagnostics(event: BridgeSamplerDiagnostics): void
}

function zeroCounters(): BridgeDiagnosticsCounters {
  return {
    stateMissing: 0,
    stateInvalid: 0,
    notesMissing: 0,
    notesInvalid: 0,
    revMismatch: 0,
  }
}

export class BridgeSampler {
  private notesSeq = 0
  private readonly counters = zeroCounters()

  constructor(private readonly dependencies: BridgeSamplerDependencies) {}

  sample(diagnostics = false): void {
    const costs: BridgeReadCosts = { stateReadMs: null, notesReadMs: null }
    const finish = (): void => {
      if (diagnostics) {
        this.dependencies.publishDiagnostics({
          counters: { ...this.counters },
          costs,
        })
      }
    }

    const stateRecord = this.measuredRead(
      () => this.dependencies.readState(diagnostics),
      diagnostics,
      (ms) => {
        costs.stateReadMs = ms
      },
    )
    if (!stateRecord) {
      if (diagnostics) {
        this.counters.stateMissing += 1
      }
      finish()
      return
    }
    const stateBytes = stateRecord.bytes
    const state = decodeState(stateBytes)
    if (!state) {
      if (diagnostics) {
        this.counters.stateInvalid += 1
      }
      finish()
      return
    }
    this.dependencies.publishState(stateRecord)

    if (state.notesSeq === 0 || state.notesSeq === this.notesSeq) {
      finish()
      return
    }
    const scheduleRecord = this.measuredRead(
      () => this.dependencies.readSchedule(diagnostics),
      diagnostics,
      (ms) => {
        costs.notesReadMs = ms
      },
    )
    if (!scheduleRecord) {
      if (diagnostics) {
        this.counters.notesMissing += 1
      }
      finish()
      return
    }
    const scheduleBytes = scheduleRecord.bytes
    const schedule = decodeNotes(scheduleBytes)
    if (!schedule) {
      if (diagnostics) {
        this.counters.notesInvalid += 1
      }
      finish()
      return
    }
    if (schedule.rev !== state.rev) {
      if (diagnostics) {
        this.counters.revMismatch += 1
      }
      finish()
      return
    }
    this.dependencies.publishSchedule(state.notesSeq, scheduleRecord)
    this.notesSeq = state.notesSeq
    finish()
  }

  private measuredRead(
    read: () => BridgeRecordRead | null,
    diagnostics: boolean,
    setCost: (ms: number) => void,
  ): BridgeRecordRead | null {
    if (!diagnostics) {
      return read()
    }
    const startedAtMs = this.dependencies.now()
    const record = read()
    setCost(this.dependencies.now() - startedAtMs)
    return record
  }
}
