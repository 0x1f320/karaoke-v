import { BRIDGE_HEADER_BYTES, BRIDGE_LAYOUT } from "../shared/bridgeChannels"

const BRIDGE_MAGIC = 0x31425056

export interface BridgeFramePolicy {
  allowedChannels: readonly number[]
  maximumPayloadBytes: Readonly<Record<number, number>>
}

export class BridgeFrameParser {
  private readonly header = new Uint8Array(BRIDGE_HEADER_BYTES)
  private headerLength = 0
  private frame: Uint8Array | null = null
  private frameLength = 0
  private malformed = false

  constructor(private readonly policy: BridgeFramePolicy) {}

  push(chunk: Uint8Array): Uint8Array[] | null {
    if (this.malformed) {
      return null
    }

    const frames: Uint8Array[] = []
    let offset = 0

    while (offset < chunk.length) {
      if (this.frame === null) {
        const headerBytes = Math.min(BRIDGE_HEADER_BYTES - this.headerLength, chunk.length - offset)
        this.header.set(chunk.subarray(offset, offset + headerBytes), this.headerLength)
        this.headerLength += headerBytes
        offset += headerBytes

        if (this.headerLength < BRIDGE_HEADER_BYTES) {
          continue
        }

        const payloadLength = this.readPayloadLength()
        if (payloadLength === null) {
          return this.markMalformed()
        }

        const frameLength = BRIDGE_HEADER_BYTES + payloadLength
        if (!Number.isSafeInteger(frameLength)) {
          return this.markMalformed()
        }

        try {
          this.frame = new Uint8Array(frameLength)
        } catch {
          return this.markMalformed()
        }
        this.frame.set(this.header)
        this.header.fill(0)
        this.headerLength = 0
        this.frameLength = BRIDGE_HEADER_BYTES
      }

      const frame = this.frame
      if (frame === null) {
        return this.markMalformed()
      }

      const payloadBytes = Math.min(frame.length - this.frameLength, chunk.length - offset)
      if (payloadBytes > 0) {
        frame.set(chunk.subarray(offset, offset + payloadBytes), this.frameLength)
        this.frameLength += payloadBytes
        offset += payloadBytes
      }

      if (this.frameLength === frame.length) {
        frames.push(frame)
        this.frame = null
        this.frameLength = 0
      }
    }

    return frames
  }

  reset(): void {
    this.header.fill(0)
    this.headerLength = 0
    this.frame = null
    this.frameLength = 0
    this.malformed = false
  }

  private readPayloadLength(): number | null {
    const view = new DataView(this.header.buffer, this.header.byteOffset, this.header.byteLength)
    if (view.getUint32(0, true) !== BRIDGE_MAGIC || view.getUint16(4, true) !== BRIDGE_LAYOUT) {
      return null
    }

    const channel = view.getUint16(6, true)
    if (!this.policy.allowedChannels.includes(channel)) {
      return null
    }

    const maximumPayloadBytes = this.policy.maximumPayloadBytes[channel]
    const payloadLength = view.getUint32(8, true)
    if (
      !Number.isSafeInteger(maximumPayloadBytes) ||
      maximumPayloadBytes < 0 ||
      payloadLength > maximumPayloadBytes
    ) {
      return null
    }

    return payloadLength
  }

  private markMalformed(): null {
    this.header.fill(0)
    this.headerLength = 0
    this.frame = null
    this.frameLength = 0
    this.malformed = true
    return null
  }
}
