import { ClipboardTransport } from "@/bridge/clipboard"
import { collectNotes, currentRevision, viewMapping } from "@/bridge/model"
import { ShmTransport } from "@/bridge/shm"
import type { Kind, Payload, Status, Transport } from "@/bridge/types"
import { getClientInfoFactory } from "@/common/client-info"
import { button } from "@/ui/button"
import { label } from "@/ui/label"
import { row } from "@/ui/row"

const SCRIPT_TITLE = "Overlay Bridge"

const CONFIG = {
  // A forward playhead jump larger than this (seconds) is a seek rather than
  // normal advance between two ticks.
  seekTolerance: 0.35,
  // Revision hashing walks every note, so it runs on a slower cadence than the
  // poll itself.
  revisionEvery: 25,
}

/**
 * Streams nothing, on either platform. The playhead is exact here but unreadable
 * from outside, so instead of feeding it continuously we hand the app one
 * schedule plus an anchor and let it run off its own clock: local drift is
 * parts-per-million, far below what a visual effect can show.
 *
 * What differs between platforms is only how a payload leaves — see
 * bridge/types.ts. macOS has the clipboard and nothing else; Windows has no
 * Accessibility API and therefore needs the view transform continuously, which
 * the clipboard is the wrong shape for.
 */
class OverlayBridge {
  private enabled = true
  private lastStatus: Status = "stopped"
  private lastPlayhead = 0
  private ticks = 0
  private revision = ""

  private loopStart: number | null = null
  private loopEnd: number | null = null

  private lastKind: Kind | "-" = "-"
  private lastNoteCount = 0

  private readonly transport: Transport
  private readonly toggleButton = SV.create("WidgetValue")
  private readonly resendButton = SV.create("WidgetValue")

  constructor(transport: Transport) {
    this.transport = transport
    this.toggleButton.setValueChangeCallback(() => this.toggle())
    this.resendButton.setValueChangeCallback(() => this.resend())
    this.loop()
  }

  getState(): SVSidePanelState {
    const loop =
      this.loopStart === null || this.loopEnd === null
        ? "not seen yet"
        : `${this.loopStart.toFixed(2)}s - ${this.loopEnd.toFixed(2)}s`

    return {
      title: SCRIPT_TITLE,
      rows: [
        label(`Bridge: ${this.enabled ? "on" : "off"}`),
        label(`Via: ${this.transport.describe()}`),
        label(`Transport: ${this.lastStatus}`),
        label(`Last sent: ${this.lastKind} (${this.lastNoteCount} notes)`),
        label(`Loop: ${loop}`),
        row([button(this.enabled ? "Disable" : "Enable", this.toggleButton, 1)]),
        row([button("Resend schedule", this.resendButton, 1)]),
      ],
    }
  }

  private toggle(): void {
    this.enabled = !this.enabled
    // Re-announce on the next tick rather than leaving the app on a schedule it
    // can no longer trust.
    this.lastStatus = "stopped"
    this.refresh()
  }

  private resend(): void {
    const playback = SV.getPlayback()
    this.emitSchedule("edit", playback.getStatus(), playback.getPlayhead())
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
    } finally {
      const active = this.enabled && this.lastStatus !== "stopped"
      SV.setTimeout(this.transport.interval(active), () => this.loop())
    }
  }

  /** The panel is a view of the bridge, never a thing the bridge depends on. */
  private refresh(): void {
    try {
      SV.refreshSidePanel()
    } catch (_error) {
      // Closed, or not rendered yet — the state shows up when it reopens.
    }
  }

  private tick(): void {
    const playback = SV.getPlayback()
    const status = playback.getStatus()
    const head = playback.getPlayhead()

    this.transport.onTick(status, head)

    if (status === "stopped") {
      if (this.lastStatus !== "stopped") {
        this.emitAnchor("stop", status, head)
        this.refresh()
      } else if (this.transport.schedulesWhileStopped) {
        this.checkEdits(status, head)
      }
    } else if (this.lastStatus === "stopped") {
      // Playback just began: the app has no schedule, so send everything.
      this.loopStart = null
      this.loopEnd = null
      this.emitSchedule("start", status, head)
      this.refresh()
    } else {
      this.checkDiscontinuity(status, head)
    }

    this.lastStatus = status
    this.lastPlayhead = head
  }

  /**
   * Between ticks the playhead should advance by roughly the poll gap. Anything
   * else means the app's extrapolation has diverged and needs a fresh anchor.
   */
  private checkDiscontinuity(status: Status, head: number): void {
    const delta = head - this.lastPlayhead

    if (delta < 0) {
      // Looping wraps backwards. A backward seek during a loop is indis-
      // tinguishable from a wrap, so the bounds below are a hint the app may
      // use for smoothing — never for correctness, since every wrap re-anchors
      // anyway.
      if (status === "looping") {
        this.loopStart = head
        this.loopEnd = this.lastPlayhead
      }
      this.emitAnchor("anchor", status, head)
      this.refresh()
      return
    }

    if (delta > CONFIG.seekTolerance) {
      this.emitAnchor("anchor", status, head)
      this.refresh()
      return
    }

    this.checkEdits(status, head)
  }

  private checkEdits(status: Status, head: number): void {
    this.ticks++
    if (this.ticks % CONFIG.revisionEvery === 0 && currentRevision() !== this.revision) {
      this.emitSchedule("edit", status, head)
      this.refresh()
    }
  }

  private emitAnchor(kind: Kind, status: Status, at: number): void {
    this.send({
      v: 1,
      kind,
      at,
      status,
      px: viewMapping(),
      loop: this.loopBounds(),
      rev: this.revision,
    })
  }

  private emitSchedule(kind: Kind, status: Status, at: number): void {
    const notes = collectNotes()
    this.revision = currentRevision()
    this.lastNoteCount = notes.length
    this.send({
      v: 1,
      kind,
      at,
      status,
      px: viewMapping(),
      loop: this.loopBounds(),
      rev: this.revision,
      notes,
    })
  }

  private loopBounds(): { start: number; end: number } | null {
    if (this.loopStart === null || this.loopEnd === null) {
      return null
    }
    return { start: this.loopStart, end: this.loopEnd }
  }

  private send(payload: Payload): void {
    this.lastKind = payload.kind
    this.transport.send(payload)
  }
}

/**
 * Matched loosely rather than exactly: the host reports its own label for the
 * OS, and being wrong about its spelling should fall back to the clipboard —
 * which works anywhere — instead of allocating a buffer nothing will read.
 */
function chooseTransport(): Transport {
  const os = (SV.getHostInfo().osType || "").toLowerCase()
  if (os.indexOf("win") >= 0) {
    try {
      return new ShmTransport()
    } catch (_error) {
      // No typed arrays, or no room for the buffer.
    }
  }
  return new ClipboardTransport()
}

const bridge = new OverlayBridge(chooseTransport())

globalThis.getClientInfo = getClientInfoFactory(SCRIPT_TITLE, {
  minEditorVersion: 131330,
  type: "SidePanelSection",
})
globalThis.getSidePanelSectionState = () => bridge.getState()
