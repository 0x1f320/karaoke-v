import { decodeNotes, decodeState } from "../shared/bridgeChannels"

export interface BridgeSamplerDependencies {
  readState(): Uint8Array | null
  readSchedule(): Uint8Array | null
  publishState(bytes: Uint8Array): void
  publishSchedule(notesSeq: number, bytes: Uint8Array): void
}

export class BridgeSampler {
  private notesSeq = 0

  constructor(private readonly dependencies: BridgeSamplerDependencies) {}

  sample(): void {
    const stateBytes = this.dependencies.readState()
    if (!stateBytes) {
      return
    }
    const state = decodeState(stateBytes)
    if (!state) {
      return
    }
    this.dependencies.publishState(stateBytes)

    if (state.notesSeq === 0 || state.notesSeq === this.notesSeq) {
      return
    }
    const scheduleBytes = this.dependencies.readSchedule()
    if (!scheduleBytes) {
      return
    }
    const schedule = decodeNotes(scheduleBytes)
    if (!schedule || schedule.rev !== state.rev) {
      return
    }
    this.dependencies.publishSchedule(state.notesSeq, scheduleBytes)
    this.notesSeq = state.notesSeq
  }
}
