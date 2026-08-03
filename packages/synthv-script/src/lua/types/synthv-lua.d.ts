/**
 * The SynthV script API as the **Lua** host exposes it. Measured against
 * Synthesizer V Studio 2 Pro 2.3.0tp1: every member below was read back out of
 * the live host, and the two rules that make these declarations differ from
 * `src/types/synthv.d.ts` are load-bearing.
 *
 * 1. Indices are **1-based**. `getNote(0)` is not a silent off-by-one, it is an
 *    "out-of-bound access (index = 0, size = 70)" error at runtime — so every
 *    index parameter takes `SVIndex`, which only `svIndex()` can produce.
 * 2. Callbacks are invoked **by the host**, with no `self`. They must be
 *    declared `this: void` or typescript-to-lua gives the emitted function a
 *    leading self parameter and the real argument lands in it.
 *
 * Arrays need no such care: the API returns 1-based tables and tstl shifts
 * TypeScript's 0-based indices by one, so `getTimeViewRange()[0]` reads the
 * first element correctly.
 */

type Blick = number

/** A 1-based index into a SynthV collection. See `svIndex`. */
type SVIndex = number & { readonly __svOneBased: unique symbol }

interface SVClientInfo {
  name: string
  category?: string
  author?: string
  versionNumber?: number
  minEditorVersion?: number
  type?: string
}

interface WidgetValue {
  getValue(): unknown
  setValue(value: unknown): void
  getEnabled(): boolean
  setEnabled(enabled: boolean): void
  setValueChangeCallback(callback: (this: void, value: unknown) => void): void
}

interface CoordinateSystem {
  getTimeViewRange(): [Blick, Blick]
  getValueViewRange(): [number, number]
  getTimePxPerUnit(): number
  getValuePxPerUnit(): number
  setTimeLeft(t: Blick): void
  setTimeRight(t: Blick): void
  setTimeScale(scale: number): void
  setValueCenter(v: number): void
  snap(t: Blick): Blick
  t2x(t: Blick): number
  x2t(x: number): Blick
  v2y(v: number): number
  y2v(y: number): number
}

interface Note {
  getOnset(): Blick
  getEnd(): Blick
  getDuration(): Blick
  getPitch(): number
  setPitch(pitch: number): void
  getLyrics(): string
  setLyrics(lyrics: string): void
  getPhonemes(): string
  getIndexInParent(): SVIndex
}

interface NoteGroup {
  getName(): string
  getNumNotes(): number
  getNote(index: SVIndex): Note
  getUUID(): string
  getIndexInParent(): SVIndex
}

interface NoteGroupReference {
  getTarget(): NoteGroup
  getOnset(): Blick
  getEnd(): Blick
  getDuration(): Blick
  getTimeOffset(): Blick
  getPitchOffset(): number
  isInstrumental(): boolean
  isMain(): boolean
  isMuted(): boolean
  getIndexInParent(): SVIndex
  getParent(): Track
}

interface Track {
  getName(): string
  getNumGroups(): number
  getGroupReference(index: SVIndex): NoteGroupReference
  getDisplayColor(): string
  getDisplayOrder(): number
  getDuration(): Blick
}

interface TimeAxis {
  getBlickFromSeconds(seconds: number): Blick
  getSecondsFromBlick(b: Blick): number
}

interface Project {
  getNumTracks(): number
  getTrack(index: SVIndex): Track
  getNoteGroup(index: SVIndex): NoteGroup
  getNumNoteGroupsInLibrary(): number
  getTimeAxis(): TimeAxis
  getDuration(): Blick
  getFileName(): string
  newUndoRecord(): void
}

interface SelectionState {
  getSelectedNotes(): Note[]
  getSelectedGroups(): NoteGroupReference[]
  hasSelectedNotes(): boolean
  hasSelectedContent(): boolean
  clearAll(): void
  registerSelectionCallback(callback: (this: void, type: string, selected: boolean) => void): void
  registerClearCallback(callback: (this: void, type: string) => void): void
}

interface MainEditorView {
  getNavigation(): CoordinateSystem
  getSelection(): SelectionState
  getCurrentGroup(): NoteGroupReference | undefined
  setCurrentGroup(ref: NoteGroupReference): void
  getCurrentTrack(): Track
}

interface Arrangement {
  getNavigation(): CoordinateSystem
}

interface PlaybackControl {
  play(): void
  pause(): void
  stop(): void
  seek(seconds: number): void
  loop(begin: number, end: number): void
  getStatus(): "playing" | "looping" | "stopped"
  getPlayhead(): number
}

interface HostInfo {
  hostName: string
  hostVersion: string
  hostVersionNumber: number
  osType: string
  osName: string
  languageCode: string
}

interface SVPanelWidget {
  type: string
  text?: string
  value?: WidgetValue
  width?: number
  height?: number
  format?: string
  minValue?: number
  maxValue?: number
  interval?: number
  choices?: string[]
}

interface SVPanelRow {
  type: "Label" | "Container"
  text?: string
  columns?: SVPanelWidget[]
}

interface SVSidePanelState {
  title: string
  rows: SVPanelRow[]
}

interface SVHost {
  readonly QUARTER: number

  T(text: string): string
  create(type: "WidgetValue"): WidgetValue
  finish(): void

  getMainEditor(): MainEditorView
  getArrangement(): Arrangement
  getProject(): Project
  getPlayback(): PlaybackControl
  getHostInfo(): HostInfo

  /**
   * Rendered pitch for a group on a uniform blick grid, in semitones. Measured
   * on a computed group: `numFrames` entries, no nil holes, unvoiced frames
   * read 0 rather than nil — but an EMPTY table means computation has not
   * finished, never silence. Trust `numFrames` over `#curve` regardless: one
   * nil entry would truncate the length operator.
   */
  getComputedPitchForGroup(
    groupReference: NoteGroupReference,
    blickStart: Blick,
    blickInterval: Blick,
    numFrames: number,
  ): number[]
  getPhonemesForGroup(groupReference: NoteGroupReference): string[]

  getHostClipboard(): string
  setHostClipboard(text: string): void

  showMessageBox(title: string, message: string): void
  showInputBox(title: string, message: string, defaultText: string): string
  refreshSidePanel(): void

  setTimeout(milliseconds: number, callback: (this: void) => void): void

  print(...args: unknown[]): void

  blick2Quarter(b: Blick): number
  quarter2Blick(q: number): Blick
  blick2Seconds(b: Blick, bpm: number): number
  seconds2Blick(s: number, bpm: number): Blick
  freq2Pitch(frequency: number): number
  pitch2Freq(pitch: number): number
}

declare const SV: SVHost

declare var getClientInfo: () => SVClientInfo
declare var main: () => void
declare var getSidePanelSectionState: () => SVSidePanelState
declare var getTranslations: (langCode: string) => Array<[string, string]>
