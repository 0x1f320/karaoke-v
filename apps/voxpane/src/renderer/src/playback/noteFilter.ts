import type { BridgeNote } from "../../../shared/bridgeChannels"
import { overhangSeconds } from "./pitch"

const SILENCE_LYRICS = new Set(["br", "sil", "cl"])

export function isSilenceLyric(lyric: string): boolean {
  return SILENCE_LYRICS.has(lyric.trim().toLowerCase())
}

export function acceptsEffectNote(note: BridgeNote, ignoreSilenceLyrics: boolean): boolean {
  return !ignoreSilenceLyrics || !isSilenceLyric(note.lyric)
}

interface ContourSource {
  noteAt(seconds: number): BridgeNote | null
  neighbours(seconds: number): { before: BridgeNote | null; after: BridgeNote | null }
}

export function effectNoteAt(
  source: Pick<ContourSource, "noteAt">,
  seconds: number,
  ignoreSilenceLyrics: boolean,
): BridgeNote | null {
  const note = source.noteAt(seconds)
  return note && acceptsEffectNote(note, ignoreSilenceLyrics) ? note : null
}

export function noteInContour(
  source: ContourSource,
  seconds: number,
  ignoreSilenceLyrics: boolean,
): BridgeNote | null {
  const sounding = source.noteAt(seconds)
  if (sounding) {
    return acceptsEffectNote(sounding, ignoreSilenceLyrics) ? sounding : null
  }
  const { before, after } = source.neighbours(seconds)
  if (
    before &&
    acceptsEffectNote(before, ignoreSilenceLyrics) &&
    seconds - before.offS <= overhangSeconds(before).tail
  ) {
    return before
  }
  if (
    after &&
    acceptsEffectNote(after, ignoreSilenceLyrics) &&
    after.onS - seconds <= overhangSeconds(after).lead
  ) {
    return after
  }
  return null
}
