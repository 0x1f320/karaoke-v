import { posix } from "node:path"

export const RENDEZVOUS_BYTES = 128
export const RENDEZVOUS_FILE = "pipe-session"
export const PIPE_CHANNELS = ["state", "scroll", "notes"] as const

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const RECORD = /^VPR1\n([0-9]+)\n([0-9a-f]{32})\n([0-9a-f]{8})\n *$/

export type PipeChannel = (typeof PIPE_CHANNELS)[number]

export interface BridgeRendezvous {
  heartbeatSeconds: number
  session: string
}

function checksum(bytes: Uint8Array): string {
  let hash = FNV_OFFSET
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

export function encodeRendezvous(value: BridgeRendezvous): Uint8Array {
  const prefix = `VPR1\n${value.heartbeatSeconds}\n${value.session}\n`
  const record = `${prefix}${checksum(new TextEncoder().encode(prefix))}\n`
  const bytes = new Uint8Array(RENDEZVOUS_BYTES)
  bytes.fill(0x20)
  bytes.set(new TextEncoder().encode(record))
  return bytes
}

export function decodeRendezvous(bytes: Uint8Array, nowSeconds: number): BridgeRendezvous | null {
  if (bytes.length !== RENDEZVOUS_BYTES) {
    return null
  }

  const text = new TextDecoder().decode(bytes)
  const match = RECORD.exec(text)
  if (match === null) {
    return null
  }

  const [, heartbeatText, session, expectedChecksum] = match
  const heartbeatSeconds = Number(heartbeatText)
  if (!Number.isSafeInteger(heartbeatSeconds) || nowSeconds - heartbeatSeconds < 0) {
    return null
  }
  if (nowSeconds - heartbeatSeconds > 2) {
    return null
  }

  const prefix = `VPR1\n${heartbeatText}\n${session}\n`
  if (checksum(new TextEncoder().encode(prefix)) !== expectedChecksum) {
    return null
  }

  return { heartbeatSeconds, session }
}

export function pipeEndpoint(
  platform: NodeJS.Platform,
  directory: string,
  session: string,
  channel: PipeChannel,
): string {
  if (platform === "win32") {
    return `\\\\.\\pipe\\voxpane-${session}-${channel}`
  }
  return posix.join(directory, `pipe-${session}-${channel}`)
}
