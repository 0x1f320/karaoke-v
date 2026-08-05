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

import { hotChannel } from "./bridge/channels"
import { collectNotes, currentRevision, viewMapping } from "./bridge/model"
import { bridgeDirectory } from "./bridge/paths"
import { createPublisher } from "./bridge/publisher"
import { encodeJson } from "./json"

const SCRIPT_TITLE = "voxpane Lua smoke"

let ticks = 0
let lastCallback = "none yet"
let lastNotes = 0
let lastError = "none"

const publisher = createPublisher()
const notesButton = SV.create("WidgetValue")

// The panel says what went wrong, but nobody outside SynthV can read the panel.
const directory = bridgeDirectory()
const diagnostics = directory !== undefined ? hotChannel(directory, "smoke.json", 512) : undefined

function report(): void {
  diagnostics?.publish(
    encodeJson({
      ticks,
      lastCallback,
      lastNotes,
      lastError,
      channels: publisher.describe(),
    }),
  )
}

notesButton.setValueChangeCallback((value) => {
  lastCallback = `button value=${tostring(value)} (${type(value)})`
  try {
    const notes = collectNotes()
    lastNotes = notes.length
    publisher.publishNotes(currentRevision(), notes)
    lastError = "none"
  } catch (error) {
    lastError = tostring(error)
  }
  report()
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
    viewRight: px.viewRight,
    viewTop: px.viewTop,
    viewBottom: px.viewBottom,
    rev: currentRevision(),
  })
  // Rebuilding the panel is not free and it churns the widgets the user is
  // trying to click: at ten ticks the button never received a press at all.
  if (ticks % 120 === 0) {
    report()
    SV.refreshSidePanel()
  }
  SV.setTimeout(16, loop)
}

loop()

globalThis.getClientInfo = () => ({
  name: SCRIPT_TITLE,
  category: "voxpane",
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
    { type: "Label", text: `last error: ${lastError}` },
    {
      type: "Container",
      columns: [{ type: "Button", text: "Publish notes", value: notesButton, width: 1 }],
    },
  ],
})
