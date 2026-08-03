import type { Kind, Payload, Status, Transport } from "./types"

/**
 * The clipboard is the only channel out of the scripting host on macOS, and it
 * belongs to the user. So this never streams: it takes the clipboard for a blip
 * on a transport event and gives it straight back, which is what makes the cost
 * a flicker rather than an occupation.
 */

/** The app matches this prefix to tell our writes from whatever the user copied. */
export const PROTOCOL = "KVBRIDGE1"

const CONFIG = {
  // A tick that sees no event writes nothing, so these gaps only bound how
  // quickly a loop wrap or a seek is noticed — they are not a streaming rate.
  idleInterval: 100,
  activeInterval: 20,
  // How long a payload may sit on the clipboard before the user's content goes
  // back. The app polls the pasteboard change count far faster than this.
  restoreDelay: 150,
}

export class ClipboardTransport implements Transport {
  readonly name = "clipboard"

  // Publishing while stopped would mean taking the user's clipboard every time
  // they nudge a note, which is exactly the cost this design exists to avoid.
  readonly schedulesWhileStopped = false

  /** The user's content, never one of our own payloads. */
  private saved = ""
  private lastKind: Kind | "-" = "-"

  interval(active: boolean): number {
    return active ? CONFIG.activeInterval : CONFIG.idleInterval
  }

  onTick(_status: Status, _playhead: number): void {
    // Nothing to publish between events.
  }

  send(payload: Payload): void {
    const text = `${PROTOCOL} ${JSON.stringify(payload)}`
    const current = SV.getHostClipboard()
    if (!isOurs(current)) {
      this.saved = current
    }

    SV.setHostClipboard(text)
    this.lastKind = payload.kind

    SV.setTimeout(CONFIG.restoreDelay, () => {
      // Anything that is not our payload by now is something the user copied in
      // the meantime, and must not be overwritten.
      if (SV.getHostClipboard() === text) {
        SV.setHostClipboard(this.saved)
      }
    })
  }

  describe(): string {
    return `clipboard (${PROTOCOL}), last sent: ${this.lastKind}`
  }
}

function isOurs(text: string): boolean {
  return text.substring(0, PROTOCOL.length) === PROTOCOL
}
