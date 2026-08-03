/**
 * The bridge: reads playback and notes out of SynthV and publishes them to the
 * channels the app reads.
 *
 * It is much smaller than the JavaScript bridge it replaces, and the reason is
 * the transport. That one could only speak in blips — the clipboard belongs to
 * the user, so it was taken for 150ms on a transport *event* and given back —
 * and so the script had to decide what counted as an event: is this a seek, a
 * loop wrap, an edit? A file has no such cost, so state simply goes out on every
 * tick and the app, which is already reading once a frame to draw, sees the
 * discontinuity itself. `kind`, the seek tolerance and the anchor machinery all
 * belonged to the clipboard and left with it.
 *
 * What stays here is what only the script can see: the note schedule, the
 * computed pitch curve, and the view transform.
 */

import { collectNotes, currentRevision, viewMapping } from "./bridge/model"
import { createPublisher } from "./bridge/publisher"
import { getClientInfoFactory } from "./client-info"
import { button } from "./ui/button"
import { label } from "./ui/label"
import { row } from "./ui/row"

const SCRIPT_TITLE = "Overlay Bridge"

const CONFIG = {
  /** Publishing costs ~4us, so the gap is set by how fresh the playhead has to be. */
  activeInterval: 16,
  /** Nothing moves while stopped except the user's edits and their scrolling. */
  idleInterval: 50,
  /**
   * Fingerprinting walks every note and calls into the host per note, which is
   * the one thing here that scales with project size — so it runs on its own
   * cadence rather than per tick.
   */
  revisionInterval: 500,
}

class OverlayBridge {
  private enabled = true
  private ticks = 0
  private lastStatus: Status = "stopped"
  private lastPlayhead = 0
  private lastRevisionCheck = 0
  private revision = ""

  private loopStart: number | null = null
  private loopEnd: number | null = null

  private notesPublished = 0
  private lastError = "none"

  private readonly publisher = createPublisher()
  private readonly toggleButton = SV.create("WidgetValue")
  private readonly resendButton = SV.create("WidgetValue")

  constructor() {
    this.toggleButton.setValueChangeCallback(() => this.toggle())
    this.resendButton.setValueChangeCallback(() => this.publishNotes())
    this.loop()
  }

  getState(): SVSidePanelState {
    const loop =
      this.loopStart === null || this.loopEnd === null
        ? "not seen yet"
        : `${string.format("%.2f", this.loopStart)}s - ${string.format("%.2f", this.loopEnd)}s`

    return {
      title: SCRIPT_TITLE,
      rows: [
        label(`Bridge: ${this.enabled ? "on" : "off"}`),
        label(`Channels: ${this.publisher.describe()}`),
        label(`Transport: ${this.lastStatus}`),
        label(`Notes published: ${this.notesPublished}`),
        label(`Loop: ${loop}`),
        label(`Last error: ${this.lastError}`),
        row([button(this.enabled ? "Disable" : "Enable", this.toggleButton, 1)]),
        row([button("Resend schedule", this.resendButton, 1)]),
      ],
    }
  }

  private toggle(): void {
    this.enabled = !this.enabled
    this.refresh()
  }

  private loop(): void {
    // Rescheduling happens in `finally` on purpose. A throw anywhere in a tick
    // would otherwise end the loop for the rest of the session, with the panel
    // still showing its last state as though the bridge were alive.
    try {
      if (this.enabled) {
        this.tick()
      }
      this.lastError = "none"
    } catch (error) {
      // Not just rescheduling past it: a tick that throws every time publishes
      // nothing and looks exactly like a bridge that is switched off, which is
      // how a packing bug went unnoticed until a channel stayed empty.
      this.lastError = tostring(error)
    } finally {
      const active = this.enabled && this.lastStatus !== "stopped"
      SV.setTimeout(active ? CONFIG.activeInterval : CONFIG.idleInterval, () => this.loop())
    }
  }

  /**
   * The panel is a view of the bridge, never a thing the bridge depends on —
   * and never something to rebuild on a timer: refreshing recreates its widgets,
   * and a button pressed while that happens never reaches its callback.
   */
  private refresh(): void {
    try {
      SV.refreshSidePanel()
    } catch (_error) {
      // Closed, or not rendered yet — the state shows up when it reopens.
    }
  }

  private tick(): void {
    this.ticks = this.ticks + 1

    const playback = SV.getPlayback()
    const status = playback.getStatus()
    const head = playback.getPlayhead()

    // A backward jump while looping is a wrap. The bounds are a hint the app may
    // use for smoothing, never for correctness — it re-anchors on the wrap
    // anyway, because it reads the playhead every frame.
    if (status === "looping" && head < this.lastPlayhead) {
      this.loopStart = head
      this.loopEnd = this.lastPlayhead
    }

    // The schedule goes out before the state that indexes it, so `rev` and
    // `notesSeq` describe this tick rather than the previous one.
    if (status !== "stopped" && this.lastStatus === "stopped") {
      // Playback just began: the app has no schedule if this session never
      // published one.
      this.publishNotes()
      this.refresh()
    } else if (this.dueForRevisionCheck()) {
      this.checkForEdits()
    }

    const view = viewMapping()
    this.publisher.publishState({
      at: head,
      status,
      loop: this.loopBounds(),
      perBlick: view.perBlick,
      perSemitone: view.perSemitone,
      viewLeft: view.viewLeft,
      viewRight: view.viewRight,
      viewTop: view.viewTop,
      viewBottom: view.viewBottom,
      rev: this.revision,
    })

    if (status !== this.lastStatus) {
      this.refresh()
    }
    this.lastStatus = status
    this.lastPlayhead = head
  }

  private dueForRevisionCheck(): boolean {
    const interval = this.lastStatus === "stopped" ? CONFIG.idleInterval : CONFIG.activeInterval
    const elapsed = (this.ticks - this.lastRevisionCheck) * interval
    if (elapsed < CONFIG.revisionInterval) {
      return false
    }
    this.lastRevisionCheck = this.ticks
    return true
  }

  private checkForEdits(): void {
    if (currentRevision() !== this.revision) {
      this.publishNotes()
      this.refresh()
    }
  }

  /**
   * Publishing while stopped is the whole point of the file transport. The
   * clipboard could not do it — taking the user's clipboard on every note edit
   * was not a cost worth paying — so the app used to see an edited schedule only
   * once playback started.
   */
  private publishNotes(): void {
    try {
      const notes = collectNotes()
      this.revision = currentRevision()
      this.publisher.publishNotes(this.revision, notes)
      this.notesPublished = notes.length
      this.lastError = "none"
    } catch (error) {
      this.lastError = tostring(error)
    }
  }

  private loopBounds(): { start: number; end: number } | null {
    if (this.loopStart === null || this.loopEnd === null) {
      return null
    }
    return { start: this.loopStart, end: this.loopEnd }
  }
}

const bridge = new OverlayBridge()

globalThis.getClientInfo = getClientInfoFactory(SCRIPT_TITLE, {
  minEditorVersion: 131330,
  type: "SidePanelSection",
})
globalThis.getSidePanelSectionState = () => bridge.getState()
