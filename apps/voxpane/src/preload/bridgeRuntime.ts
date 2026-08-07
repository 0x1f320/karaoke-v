import type { BridgeSchedule, BridgeState } from "../shared/bridgeChannels"
import { decodeNotes, decodeState } from "../shared/bridgeChannels"

export interface BridgeRuntimeDecoders {
  decodeState(bytes: Uint8Array): BridgeState | null
  decodeNotes(bytes: Uint8Array): BridgeSchedule | null
}

const DECODERS: BridgeRuntimeDecoders = { decodeState, decodeNotes }

export class BridgeRuntime {
  private state: BridgeState | null = null
  private scheduleSeq = 0
  private schedule: BridgeSchedule | null = null

  constructor(private readonly decoders: BridgeRuntimeDecoders = DECODERS) {}

  acceptState(bytes: Uint8Array): void {
    const state = this.decoders.decodeState(bytes)
    if (state) {
      this.state = state
    }
  }

  readState(): BridgeState | null {
    return this.state
  }

  acceptSchedule(notesSeq: number, bytes: Uint8Array): void {
    if (notesSeq <= this.scheduleSeq) {
      return
    }
    const schedule = this.decoders.decodeNotes(bytes)
    if (!schedule) {
      return
    }
    this.scheduleSeq = notesSeq
    this.schedule = schedule
  }

  readSchedule(notesSeq: number): BridgeSchedule | null {
    return notesSeq === this.scheduleSeq ? this.schedule : null
  }
}
