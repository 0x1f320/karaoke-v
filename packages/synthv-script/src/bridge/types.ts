export type Status = "playing" | "looping" | "stopped"

/** Why a payload was sent. The app uses it to decide what to replace. */
export type Kind = "start" | "anchor" | "edit" | "stop"

export interface NotePayload {
  /** Onset/end in blicks — linear in pixels, for placing the note. */
  onB: Blick
  offB: Blick
  /** Onset/end in seconds — for firing the effect off the local clock. */
  onS: number
  offS: number
  pitch: number
  lyric: string
  /**
   * The sung pitch across the note, in cents from `pitch`, evenly spaced from
   * onset to end. Absent when the engine has no computed curve for the group —
   * the app then synthesizes a shape from the notes instead.
   */
  bend?: number[]
}

/** View mapping, so the app can place blicks in pixels and rescale on zoom. */
export interface ViewMapping {
  perBlick: number
  perSemitone: number
  viewLeft: Blick
  viewTop: number
}

export interface Payload {
  v: number
  kind: Kind
  /** Playhead in seconds at the moment this was read. */
  at: number
  status: Status
  px: ViewMapping | null
  /** Learned from the first wrap; null until then. Hint only. */
  loop: { start: number; end: number } | null
  /** Note-set fingerprint. A change means the schedule below went stale. */
  rev: string
  /** Present on "start" and "edit" only — anchors stay small. */
  notes?: NotePayload[]
}

/**
 * How a payload leaves SynthV. The two implementations are not variations on
 * one idea: the clipboard is a blip on an event, shared memory is a surface the
 * app reads whenever it likes. What they share is everything above them — the
 * poll loop, and the reading of playback and notes.
 */
export interface Transport {
  readonly name: string

  /** Poll gap in ms; `active` means playback is running. */
  interval(active: boolean): number

  /**
   * Whether the app can see the note schedule while playback is stopped. Only
   * true where publishing costs nothing: on the clipboard it would mean taking
   * the user's clipboard every time they edit a note.
   */
  readonly schedulesWhileStopped: boolean

  /** Every tick, with the state the loop has already read. */
  onTick(status: Status, playhead: number): void

  send(payload: Payload): void

  /** One line for the side panel. */
  describe(): string
}
