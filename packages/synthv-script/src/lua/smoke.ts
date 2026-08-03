/**
 * The end-to-end check for the Lua toolchain: the smallest script that uses
 * every mechanism the bridge will depend on, so that a toolchain regression
 * shows up here instead of inside the bridge.
 *
 * It is a side panel section (the bridge is one), it loops on `SV:setTimeout`,
 * it reads notes through 1-based indices, it encodes a payload, and it writes
 * that payload to a file the way the transport will — temp file plus
 * `os.rename`, which is atomic for a reader watching the destination.
 */

import { encodeJson } from "./json"
import { svIndex } from "./sv-index"

const SCRIPT_TITLE = "karaoke-v Lua smoke"
const OUT_PATH = "/tmp/karaoke-v-lua-smoke.json"

let ticks = 0
let lastCallback = "none yet"
let lastWrite = "not tried"

const writeButton = SV.create("WidgetValue")

function writeAtomically(path: string, text: string): string {
  const temp = `${path}.tmp`
  const [file, openError] = io.open(temp, "w")
  if (file === undefined) {
    return `io.open failed: ${openError}`
  }
  file.write(text)
  file.close()

  const [renamed, renameError] = os.rename(temp, path)
  if (renamed === undefined) {
    os.remove(temp)
    return `os.rename failed: ${renameError}`
  }
  return `wrote ${string.len(text)} bytes`
}

function snapshot(): string {
  const playback = SV.getPlayback()
  const nav = SV.getMainEditor().getNavigation()
  const group = SV.getMainEditor().getCurrentGroup()

  const lyrics: string[] = []
  let offset = 0
  if (group !== undefined) {
    const target = group.getTarget()
    offset = group.getTimeOffset()
    const count = target.getNumNotes()
    for (let i = 0; i < count && i < 8; i++) {
      lyrics[i] = target.getNote(svIndex(i)).getLyrics()
    }
  }

  return encodeJson({
    v: 1,
    at: playback.getPlayhead(),
    status: playback.getStatus(),
    px: {
      perBlick: nav.getTimePxPerUnit(),
      perSemitone: nav.getValuePxPerUnit(),
      viewLeft: nav.getTimeViewRange()[0],
      viewTop: nav.getValueViewRange()[1],
    },
    offset,
    lyrics,
    loop: null,
  })
}

writeButton.setValueChangeCallback((value) => {
  lastCallback = `button value=${tostring(value)} (${type(value)})`
  lastWrite = writeAtomically(OUT_PATH, snapshot())
  SV.refreshSidePanel()
})

function loop(): void {
  ticks = ticks + 1
  if (ticks % 10 === 0) {
    SV.refreshSidePanel()
  }
  SV.setTimeout(100, loop)
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
    { type: "Label", text: `callback: ${lastCallback}` },
    { type: "Label", text: `file: ${lastWrite}` },
    {
      type: "Container",
      columns: [{ type: "Button", text: "Write a payload", value: writeButton, width: 1 }],
    },
  ],
})
