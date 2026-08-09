import { BRIDGE_HEADER_BYTES, BRIDGE_LAYOUT } from "../shared/bridgeChannels"

const BRIDGE_MAGIC = 0x31425056

export interface BridgeFramePolicy {
  allowedChannels: readonly number[]
  maximumPayloadBytes: Readonly<Record<number, number>>
}

interface NormalizedBridgeFramePolicy {
  allowedChannels: ReadonlySet<number>
  maximumPayloadBytes: ReadonlyMap<number, number>
}

export class BridgeFrameParser {
  private readonly header = new Uint8Array(BRIDGE_HEADER_BYTES)
  private readonly allowedChannels: ReadonlySet<number>
  private readonly maximumPayloadBytes: ReadonlyMap<number, number>
  private readonly policyMalformed: boolean
  private headerLength = 0
  private frame: Uint8Array | null = null
  private frameLength = 0
  private malformed = false

  constructor(policy: BridgeFramePolicy) {
    const normalized = normalizePolicy(policy)
    this.allowedChannels = normalized?.allowedChannels ?? new Set()
    this.maximumPayloadBytes = normalized?.maximumPayloadBytes ?? new Map()
    this.policyMalformed = normalized === null
    this.malformed = this.policyMalformed
  }

  push(chunk: Uint8Array): Uint8Array[] | null {
    if (this.malformed) {
      return null
    }

    if (!isUint8Array(chunk)) {
      return this.markMalformed()
    }

    try {
      return this.pushChunk(chunk)
    } catch {
      return this.markMalformed()
    }
  }

  reset(): void {
    this.header.fill(0)
    this.headerLength = 0
    this.frame = null
    this.frameLength = 0
    this.malformed = this.policyMalformed
  }

  private pushChunk(chunk: Uint8Array): Uint8Array[] | null {
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

  private readPayloadLength(): number | null {
    const view = new DataView(this.header.buffer, this.header.byteOffset, this.header.byteLength)
    if (view.getUint32(0, true) !== BRIDGE_MAGIC || view.getUint16(4, true) !== BRIDGE_LAYOUT) {
      return null
    }

    const channel = view.getUint16(6, true)
    if (!this.allowedChannels.has(channel) || !this.maximumPayloadBytes.has(channel)) {
      return null
    }

    const maximumPayloadBytes = this.maximumPayloadBytes.get(channel)
    const payloadLength = view.getUint32(8, true)
    if (maximumPayloadBytes === undefined || payloadLength > maximumPayloadBytes) {
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

function normalizePolicy(policy: BridgeFramePolicy): NormalizedBridgeFramePolicy | null {
  try {
    if (policy === null || typeof policy !== "object") {
      return null
    }

    const { allowedChannels, maximumPayloadBytes } = policy as {
      allowedChannels?: unknown
      maximumPayloadBytes?: unknown
    }
    if (!Array.isArray(allowedChannels) || maximumPayloadBytes === null) {
      return null
    }
    if (typeof maximumPayloadBytes !== "object" || Array.isArray(maximumPayloadBytes)) {
      return null
    }

    const channels = new Set<number>()
    for (const channel of allowedChannels) {
      if (!Number.isInteger(channel) || channel < 0 || channel > 0xffff) {
        return null
      }
      channels.add(channel)
    }

    const caps = new Map<number, number>()
    for (const channel of channels) {
      if (!Object.hasOwn(maximumPayloadBytes, channel)) {
        return null
      }
      const descriptor = Object.getOwnPropertyDescriptor(maximumPayloadBytes, channel)
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !Number.isSafeInteger(descriptor.value) ||
        descriptor.value < 0
      ) {
        return null
      }
      caps.set(channel, descriptor.value)
    }

    return { allowedChannels: channels, maximumPayloadBytes: caps }
  } catch {
    return null
  }
}

function isUint8Array(value: unknown): value is Uint8Array {
  try {
    return value instanceof Uint8Array
  } catch {
    return false
  }
}
