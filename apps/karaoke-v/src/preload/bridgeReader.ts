import { closeSync, openSync, readSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  type BridgeSchedule,
  type BridgeState,
  decodeNotes,
  decodeState,
  STATE_BYTES,
} from "../shared/bridgeChannels"
import { bridgeDirectory, CHANNEL_NOTES, CHANNEL_STATE } from "../shared/bridgePath"

// Reads the bridge channels straight from the renderer process, the way the AX
// geometry already is: a per-frame path with no main-process hop. The state read
// is a `pread` into a buffer that is allocated once — 0.6us and no garbage,
// which is what a 60Hz overlay wants from its input.
//
// The schedule is read only when the state record says its generation changed,
// so the expensive channel is touched a handful of times per session rather than
// per frame.
//
// Nothing here throws. The writer is SynthV, which may not be running, may have
// been restarted, or may be replacing a record at the moment of the read; all of
// those are "no data this frame".

const stateBuffer = Buffer.allocUnsafe(STATE_BYTES)

class Channel {
  private readonly path: string
  private fd: number | null = null

  constructor(name: string) {
    this.path = join(bridgeDirectory(), name)
  }

  /** Reads `length` bytes from the start, or null if the file is not readable. */
  read(buffer: Uint8Array, length: number): Uint8Array | null {
    if (this.fd === null) {
      try {
        this.fd = openSync(this.path, "r")
      } catch {
        return null
      }
    }
    try {
      const read = readSync(this.fd, buffer, 0, length, 0)
      return read > 0 ? buffer.subarray(0, read) : null
    } catch {
      // The script can be reinstalled or the directory cleared underneath us;
      // dropping the handle means the next frame reopens rather than reading a
      // file nobody writes any more.
      this.close()
      return null
    }
  }

  size(): number {
    try {
      return statSync(this.path).size
    } catch {
      return 0
    }
  }

  close(): void {
    if (this.fd !== null) {
      try {
        closeSync(this.fd)
      } catch {
        // Already gone; there is nothing to recover.
      }
      this.fd = null
    }
  }
}

const state = new Channel(CHANNEL_STATE)
const notes = new Channel(CHANNEL_NOTES)

export function readState(): BridgeState | null {
  const bytes = state.read(stateBuffer, STATE_BYTES)
  return bytes && decodeState(bytes)
}

export function readSchedule(): BridgeSchedule | null {
  const size = notes.size()
  if (size === 0) {
    return null
  }
  const bytes = notes.read(Buffer.allocUnsafe(size), size)
  return bytes && decodeNotes(bytes)
}
