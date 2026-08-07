import type { BridgeSchedule } from "../shared/bridgeChannels"

export class ScheduleCache {
  private schedule: BridgeSchedule | null = null
  private notesSeq = -1

  constructor(private readonly readSchedule: () => BridgeSchedule | null) {}

  read(notesSeq: number): BridgeSchedule | null {
    if (notesSeq === this.notesSeq) {
      return this.schedule
    }
    const schedule = this.readSchedule()
    if (!schedule) {
      return null
    }
    this.schedule = schedule
    this.notesSeq = notesSeq
    return schedule
  }

  get latest(): BridgeSchedule | null {
    return this.schedule
  }
}
