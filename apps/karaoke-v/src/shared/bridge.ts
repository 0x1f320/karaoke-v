// The wire format of the SynthV bridge script (synth-v/src/overlay-bridge.ts).
//
// The script does not stream. It sends a whole note schedule plus one playhead
// anchor when playback starts, and after that speaks only when something makes
// the schedule or the anchor wrong — a loop wrap, a seek, an edit, a stop. The
// consumer runs off its own clock in between, which is why every note carries
// its time twice: blicks are linear in pixels, seconds drive the local clock.

export const BRIDGE_MARKER = "KVBRIDGE1"

export type BridgeStatus = "playing" | "looping" | "stopped"

/** Why the payload was sent — "start"/"edit" carry notes, the rest do not. */
export type BridgeKind = "start" | "anchor" | "edit" | "stop"

export interface BridgeNote {
  /** Onset/end in blicks — linear in pixels, for placing the note. */
  onB: number
  offB: number
  /** Onset/end in seconds — for firing the effect off the local clock. */
  onS: number
  offS: number
  pitch: number
  lyric: string
}

/** Enough of SynthV's view transform to turn blicks into pixels. */
export interface BridgeViewMapping {
  perBlick: number
  perSemitone: number
  viewLeft: number
  viewTop: number
}

export interface BridgePayload {
  v: number
  kind: BridgeKind
  /** Playhead in seconds at the moment the script read it. */
  at: number
  status: BridgeStatus
  px: BridgeViewMapping | null
  /** Learned from the first wrap, so null until one happens. A hint only. */
  loop: { start: number; end: number } | null
  /** Note-set fingerprint; a change means any held schedule went stale. */
  rev: string
  notes?: BridgeNote[]
}

export interface BridgeMessage {
  payload: BridgePayload
  /** Addon monotonic clock (ms) when the payload was detected. */
  monotonicMs: number
}

const KINDS: BridgeKind[] = ["start", "anchor", "edit", "stop"]
const STATUSES: BridgeStatus[] = ["playing", "looping", "stopped"]

/**
 * Parse a clipboard payload, or null if it is not one of ours. The clipboard is
 * shared with the user, so nothing here may assume well-formed input.
 */
export function parseBridgePayload(text: string): BridgePayload | null {
  if (!text.startsWith(BRIDGE_MARKER)) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(BRIDGE_MARKER.length))
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null
  }

  const p = parsed as Record<string, unknown>
  if (p.v !== 1 || typeof p.at !== "number" || typeof p.rev !== "string") {
    return null
  }
  if (!KINDS.includes(p.kind as BridgeKind) || !STATUSES.includes(p.status as BridgeStatus)) {
    return null
  }

  return {
    v: 1,
    kind: p.kind as BridgeKind,
    at: p.at,
    status: p.status as BridgeStatus,
    px: viewMapping(p.px),
    loop: loopBounds(p.loop),
    rev: p.rev,
    notes: Array.isArray(p.notes) ? p.notes.filter(isNote) : undefined,
  }
}

function viewMapping(value: unknown): BridgeViewMapping | null {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const v = value as Record<string, unknown>
  if (
    typeof v.perBlick !== "number" ||
    typeof v.perSemitone !== "number" ||
    typeof v.viewLeft !== "number" ||
    typeof v.viewTop !== "number"
  ) {
    return null
  }
  return {
    perBlick: v.perBlick,
    perSemitone: v.perSemitone,
    viewLeft: v.viewLeft,
    viewTop: v.viewTop,
  }
}

function loopBounds(value: unknown): { start: number; end: number } | null {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const v = value as Record<string, unknown>
  if (typeof v.start !== "number" || typeof v.end !== "number") {
    return null
  }
  return { start: v.start, end: v.end }
}

function isNote(value: unknown): value is BridgeNote {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const n = value as Record<string, unknown>
  return (
    typeof n.onB === "number" &&
    typeof n.offB === "number" &&
    typeof n.onS === "number" &&
    typeof n.offS === "number" &&
    typeof n.pitch === "number" &&
    typeof n.lyric === "string"
  )
}
