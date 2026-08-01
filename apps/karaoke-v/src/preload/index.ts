import type { PianoRoll, Viewport } from "@karaoke-v/macos-helper"
import * as macHelper from "@karaoke-v/macos-helper"
import { contextBridge } from "electron"

// The renderer reads AX directly (requires sandbox: false): getViewport at rAF
// time for zero-lag positioning, and getPianoRollAsync in a background pump for
// always-fresh notes. No main-process hop in the per-frame path.
contextBridge.exposeInMainWorld("overlay", {
  getViewport: (): Viewport | null => macHelper.getViewport(),
  readNotes: (): Promise<PianoRoll | null> => macHelper.getPianoRollAsync("synth"),
})
