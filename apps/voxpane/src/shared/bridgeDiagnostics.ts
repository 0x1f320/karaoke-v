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
  scrollMissing: number
  scrollInvalid: number
  scrollSeqMismatch: number
  notesMissing: number
  notesInvalid: number
  revMismatch: number
}

export interface BridgeReadCosts {
  stateReadMs: number | null
  scrollReadMs: number | null
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
  costs: BridgeReadCosts
}
