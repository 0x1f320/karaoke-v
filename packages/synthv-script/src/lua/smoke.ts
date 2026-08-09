/**
 * The end-to-end check for the Lua toolchain and the channel layer: the
 * smallest script that uses every mechanism the bridge depends on, so that a
 * regression shows up here instead of inside the bridge.
 *
 * It is a side panel section (the bridge is one), it loops on `SV:setTimeout`,
 * it reads notes through 1-based indices, and it publishes them through the
 * real pipe client.
 */

import { collectNotes, currentRevision, viewMapping } from "./bridge/model"
import { createPublisher } from "./bridge/publisher"

const SCRIPT_TITLE = "voxpane Lua smoke"
const TICK_INTERVAL = 16

let ticks = 0
let lastCallback = "none yet"
let lastNotes = 0
let lastError = "none"

const publisher = createPublisher()
const notesButton = SV.create("WidgetValue")

function publishCurrentNotes(exactSnapshot = false): string | undefined {
  try {
    const notes = collectNotes()
    const revision = currentRevision()
    if (!publisher.publishNotes(revision, notes)) {
      return undefined
    }
    lastNotes = notes.length
    lastError = "none"
    return revision
  } catch (error) {
    lastError = tostring(error)
    if (exactSnapshot) {
      publisher.abortSnapshot(lastError)
    }
    return undefined
  }
}

notesButton.setValueChangeCallback((value) => {
  lastCallback = `button value=${tostring(value)} (${type(value)})`
  publishCurrentNotes()
  SV.refreshSidePanel()
})

function loop(): void {
  const preparation = publisher.prepare(ticks * TICK_INTERVAL)
  ticks = ticks + 1
  if (preparation === "disconnected") {
    if (ticks % 120 === 0) {
      SV.refreshSidePanel()
    }
    SV.setTimeout(TICK_INTERVAL, loop)
    return
  }

  const playback = SV.getPlayback()
  const revision = preparation === "new-session" ? publishCurrentNotes(true) : currentRevision()
  if (revision === undefined) {
    SV.setTimeout(TICK_INTERVAL, loop)
    return
  }
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
    rev: revision,
  })
  // Rebuilding the panel is not free and it churns the widgets the user is
  // trying to click: at ten ticks the button never received a press at all.
  if (ticks % 120 === 0) {
    SV.refreshSidePanel()
  }
  SV.setTimeout(TICK_INTERVAL, loop)
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
