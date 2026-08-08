import type {
  BridgeFileDiagnostics,
  BridgeRecordRead,
  BridgeSamplerDiagnostics,
} from "../shared/bridgeDiagnostics"
import { readScheduleRecord, readStateRecord } from "./bridgeReader"
import { BridgeSampler } from "./bridgeSampler"

interface WorkerScope {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void
  onmessage: ((event: { data: WorkerCommand }) => void) | null
}

interface WorkerCommand {
  type: "diagnostics"
  enabled: boolean
}

const scope = globalThis as unknown as WorkerScope
let diagnosticsEnabled = false

function transferRecord(record: BridgeRecordRead): {
  bytes: ArrayBuffer
  diagnostics: BridgeFileDiagnostics | null
} {
  const copy = Uint8Array.from(record.bytes)
  return { bytes: copy.buffer, diagnostics: record.diagnostics }
}

const sampler = new BridgeSampler({
  now: () => performance.now(),
  readState: readStateRecord,
  readSchedule: readScheduleRecord,
  publishState: (record) => {
    const message = transferRecord(record)
    scope.postMessage({ type: "state", ...message }, [message.bytes])
  },
  publishSchedule: (notesSeq, record) => {
    const message = transferRecord(record)
    scope.postMessage({ type: "schedule", notesSeq, ...message }, [message.bytes])
  },
  publishDiagnostics: (diagnostics: BridgeSamplerDiagnostics) => {
    scope.postMessage({ type: "diagnostics", diagnostics }, [])
  },
})

scope.onmessage = ({ data }) => {
  if (data.type === "diagnostics") {
    diagnosticsEnabled = data.enabled
  }
}

const sample = (): void => {
  try {
    sampler.sample(diagnosticsEnabled)
  } catch {}
  setTimeout(sample, 4)
}

sample()
