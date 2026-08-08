import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs"
import { join } from "node:path"
import type { BridgeFileDiagnostics, BridgeRecordRead } from "../shared/bridgeDiagnostics"
import { bridgeDirectory, CHANNEL_NOTES, CHANNEL_SCROLL, CHANNEL_STATE } from "../shared/bridgePath"

// Reads the bridge channels inside the Node-enabled Web Worker. The state read
// is a `pread` into a buffer allocated once; the renderer never waits for it.
//
// Scroll and schedule are read only when state says their generations changed,
// so unchanged channels are not touched on every state sample.
//
// Nothing here throws. The writer is SynthV, which may not be running, may have
// been restarted, or may be replacing a record at the moment of the read; all of
// those are "no data this sample".

class Channel {
  private readonly path: string
  private fd: number | null = null

  constructor(name: string) {
    this.path = join(bridgeDirectory(), name)
  }

  read(buffer: Uint8Array, length: number, diagnostics: boolean): BridgeRecordRead | null {
    if (this.fd === null) {
      try {
        this.fd = openSync(this.path, "r")
      } catch {
        return null
      }
    }
    try {
      const read = readSync(this.fd, buffer, 0, length, 0)
      if (read <= 0) {
        return null
      }
      return {
        bytes: buffer.subarray(0, read),
        diagnostics: diagnostics ? this.diagnostics() : null,
      }
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

  private diagnostics(): BridgeFileDiagnostics | null {
    if (this.fd === null) {
      return null
    }
    try {
      const stat = fstatSync(this.fd)
      return { modifiedAtMs: stat.mtimeMs, sizeBytes: stat.size }
    } catch {
      return null
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
const scroll = new Channel(CHANNEL_SCROLL)
const notes = new Channel(CHANNEL_NOTES)

export function readStateRecord(diagnostics = false): BridgeRecordRead | null {
  const size = state.size()
  return size === 0 ? null : state.read(Buffer.allocUnsafeSlow(size), size, diagnostics)
}

export function readScrollRecord(diagnostics = false): BridgeRecordRead | null {
  const size = scroll.size()
  return size === 0 ? null : scroll.read(Buffer.allocUnsafeSlow(size), size, diagnostics)
}

export function readScheduleRecord(diagnostics = false): BridgeRecordRead | null {
  const size = notes.size()
  if (size === 0) {
    return null
  }
  return notes.read(Buffer.allocUnsafeSlow(size), size, diagnostics)
}
