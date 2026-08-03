/**
 * The end-to-end check for the Lua toolchain and the channel layer: the
 * smallest script that uses every mechanism the bridge depends on, so that a
 * regression shows up here instead of inside the bridge.
 *
 * It is a side panel section (the bridge is one), it loops on `SV:setTimeout`,
 * it reads notes through 1-based indices, and it publishes them through the
 * real channels — hot state on every tick, the note list only when the button
 * is pressed.
 */

import type { NoteRecord } from "./bridge/codec"
import { createPublisher } from "./bridge/publisher"
import { svIndex } from "./sv-index"

const SCRIPT_TITLE = "karaoke-v Lua smoke"

let ticks = 0
let lastCallback = "none yet"
let lastNotes = 0

const publisher = createPublisher()
const notesButton = SV.create("WidgetValue")

function viewMapping() {
  const nav = SV.getMainEditor().getNavigation()
  return {
    perBlick: nav.getTimePxPerUnit(),
    perSemitone: nav.getValuePxPerUnit(),
    viewLeft: nav.getTimeViewRange()[0],
    viewTop: nav.getValueViewRange()[1],
  }
}

function collectNotes(): NoteRecord[] {
  const group = SV.getMainEditor().getCurrentGroup()
  if (group === undefined) {
    return []
  }
  const timeAxis = SV.getProject().getTimeAxis()
  const offset = group.getTimeOffset()
  const target = group.getTarget()
  const count = target.getNumNotes()
  const notes: NoteRecord[] = []
  for (let i = 0; i < count; i++) {
    const note = target.getNote(svIndex(i))
    const onB = note.getOnset() + offset
    const offB = note.getEnd() + offset
    notes[i] = {
      onB,
      offB,
      onS: timeAxis.getSecondsFromBlick(onB),
      offS: timeAxis.getSecondsFromBlick(offB),
      pitch: note.getPitch(),
      lyric: note.getLyrics(),
    }
  }
  return notes
}

function revision(): string {
  const group = SV.getMainEditor().getCurrentGroup()
  if (group === undefined) {
    return "0"
  }
  return `${group.getTimeOffset()}:${group.getTarget().getNumNotes()}`
}

notesButton.setValueChangeCallback((value) => {
  lastCallback = `button value=${tostring(value)} (${type(value)})`
  const notes = collectNotes()
  lastNotes = notes.length
  publisher.publishNotes(revision(), notes)
  SV.refreshSidePanel()
})

function loop(): void {
  ticks = ticks + 1
  const playback = SV.getPlayback()
  const px = viewMapping()
  publisher.publishState({
    at: playback.getPlayhead(),
    status: playback.getStatus(),
    loop: null,
    perBlick: px.perBlick,
    perSemitone: px.perSemitone,
    viewLeft: px.viewLeft,
    viewTop: px.viewTop,
    rev: revision(),
  })
  if (ticks % 10 === 0) {
    SV.refreshSidePanel()
  }
  SV.setTimeout(16, loop)
}

loop()

globalThis.getClientInfo = () => ({
  name: SCRIPT_TITLE,
  category: "karaoke-v",
  author: "0x1F320",
  versionNumber: 1,
  minEditorVersion: 131330,
  type: "SidePanelSection",
})

globalThis.getSidePanelSectionState = () => ({
  title: SCRIPT_TITLE,
  rows: [
    { type: "Label", text: `ticks: ${ticks}` },
    { type: "Label", text: `channels: ${publisher.describe()}` },
    { type: "Label", text: `callback: ${lastCallback}` },
    { type: "Label", text: `last notes published: ${lastNotes}` },
    {
      type: "Container",
      columns: [{ type: "Button", text: "Publish notes", value: notesButton, width: 1 }],
    },
  ],
})
