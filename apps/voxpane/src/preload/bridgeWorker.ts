import { readScheduleRecord, readStateRecord } from "./bridgeReader"
import { BridgeSampler } from "./bridgeSampler"

interface WorkerScope {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void
}

const scope = globalThis as unknown as WorkerScope

const sampler = new BridgeSampler({
  readState: readStateRecord,
  readSchedule: readScheduleRecord,
  publishState: (bytes) => {
    const copy = Uint8Array.from(bytes)
    scope.postMessage({ type: "state", bytes: copy.buffer }, [copy.buffer])
  },
  publishSchedule: (notesSeq, bytes) => {
    const copy = Uint8Array.from(bytes)
    scope.postMessage({ type: "schedule", notesSeq, bytes: copy.buffer }, [copy.buffer])
  },
})

const sample = (): void => {
  try {
    sampler.sample()
  } catch {}
  setTimeout(sample, 4)
}

sample()
