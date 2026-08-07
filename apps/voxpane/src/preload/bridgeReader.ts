import { closeSync, openSync, readSync, statSync } from "node:fs"
import { join } from "node:path"
import { STATE_BYTES } from "../shared/bridgeChannels"
import { bridgeDirectory, CHANNEL_NOTES, CHANNEL_STATE } from "../shared/bridgePath"

// Reads the bridge channels inside the Node-enabled Web Worker. The state read
// is a `pread` into a buffer allocated once; the renderer never waits for it.
//
// The schedule is read only when the state record says its generation changed,
// so the expensive channel is touched a handful of times per session rather than
// on every state sample.
//
// Nothing here throws. The writer is SynthV, which may not be running, may have
// been restarted, or may be replacing a record at the moment of the read; all of
// those are "no data this sample".

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
      // dropping the handle means the next sample reopens rather than reading a
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

export function readStateRecord(): Uint8Array | null {
  return state.read(stateBuffer, STATE_BYTES)
}

export function readScheduleRecord(): Uint8Array | null {
  const size = notes.size()
  if (size === 0) {
    return null
  }
  return notes.read(Buffer.allocUnsafeSlow(size), size)
}
