export interface BridgeFileDiagnostics {
  modifiedAtMs: number
  sizeBytes: number
}

export interface BridgeChannelDiagnostics extends BridgeFileDiagnostics {
  acceptedAtMs: number
}

export interface BridgeDiagnosticsCounters {
  stateMissing: number
  stateInvalid: number
  notesMissing: number
  notesInvalid: number
  revMismatch: number
}

export interface BridgeReadCosts {
  stateReadMs: number | null
  notesReadMs: number | null
}

export interface BridgeSamplerDiagnostics {
  counters: BridgeDiagnosticsCounters
  costs: BridgeReadCosts
}

export interface BridgeRecordRead {
  bytes: Uint8Array
  diagnostics: BridgeFileDiagnostics | null
}

export interface BridgeDiagnostics {
  state: BridgeChannelDiagnostics | null
  notes: BridgeChannelDiagnostics | null
  stateRecord: { seq: number; notesSeq: number; rev: string } | null
  notesRecord: { notesSeq: number; rev: string } | null
  counters: BridgeDiagnosticsCounters
  costs: BridgeReadCosts
}
