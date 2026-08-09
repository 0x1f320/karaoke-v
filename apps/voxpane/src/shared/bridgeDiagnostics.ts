export interface BridgeChannelDiagnostics {
  receivedAtMs: number
  acceptedAtMs: number
  sizeBytes: number
}

export interface BridgeReceiptDiagnostics {
  receivedAtMs: number
  sizeBytes: number
}

export type BridgeTransportStatus = "starting" | "ready" | "connected" | "error" | "stopped"

export interface BridgeTransportDiagnostics {
  status: BridgeTransportStatus
  session: string | null
  recoveries: number
  malformedFrames: number
  endpointFailures: number
  disconnects: Record<"state" | "scroll" | "notes", number>
}

export interface BridgeDiagnosticsCounters {
  stateInvalid: number
  scrollInvalid: number
  scrollSeqMismatch: number
  notesInvalid: number
  notesSeqMismatch: number
  revMismatch: number
}

export interface BridgeStateRecordDiagnostics {
  seq: number
  notesSeq: number
  scrollSeq: number
  rev: string
}

export interface BridgeScrollRecordDiagnostics {
  scrollSeq: number
}

export interface BridgeNotesRecordDiagnostics {
  notesSeq: number
  rev: string
}

export interface BridgeDiagnostics {
  state: BridgeChannelDiagnostics | null
  scroll: BridgeChannelDiagnostics | null
  notes: BridgeChannelDiagnostics | null
  stateRecord: BridgeStateRecordDiagnostics | null
  scrollRecord: BridgeScrollRecordDiagnostics | null
  notesRecord: BridgeNotesRecordDiagnostics | null
  counters: BridgeDiagnosticsCounters
  transport: BridgeTransportDiagnostics | null
}
