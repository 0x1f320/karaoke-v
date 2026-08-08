import { channelPath, endpointPaths, type PipeEndpoints } from "./paths"

export type { PipeEndpoints } from "./paths"

const RENDEZVOUS_BYTES = 128
const FNV_OFFSET = 2166136261
const MASK32 = 0xffffffff

export interface BridgeRendezvous {
  heartbeatSeconds: number
  session: string
}

export interface ResolvedRendezvous extends PipeEndpoints {
  heartbeatSeconds: number
}

function isLowerHex(value: string): boolean {
  const [matched] = string.find(value, "^[0-9a-f]+$", 1)
  return matched !== undefined
}

function isDecimal(value: string): boolean {
  const [matched] = string.find(value, "^[0-9]+$", 1)
  return matched !== undefined
}

function multiplyFNV(hash: number): number {
  const lower = hash & 0xffff
  const upper = hash >>> 16
  const product = lower * 0x0193
  const high = ((product >>> 16) + lower * 0x0100 + upper * 0x0193) & 0xffff
  return ((product & 0xffff) | (high << 16)) >>> 0
}

function checksum(prefix: string): string {
  let hash = FNV_OFFSET
  for (let index = 1; index <= string.len(prefix); index++) {
    hash = multiplyFNV(hash ^ (string.byte(prefix, index) ?? 0)) & MASK32
  }
  return string.format("%08x", hash)
}

export function decodeRendezvous(
  record: string | undefined,
  nowSeconds: number,
): BridgeRendezvous | undefined {
  if (record === undefined || string.len(record) !== RENDEZVOUS_BYTES) {
    return undefined
  }

  const [heartbeatText, session, expectedChecksum, padding] = string.match(
    record,
    "^VPR1\n([^\n]*)\n([^\n]*)\n([^\n]*)\n( *)$",
  )
  if (
    heartbeatText === undefined ||
    session === undefined ||
    expectedChecksum === undefined ||
    padding === undefined ||
    !isDecimal(heartbeatText) ||
    string.len(session) !== 32 ||
    string.len(expectedChecksum) !== 8 ||
    !isLowerHex(session) ||
    !isLowerHex(expectedChecksum)
  ) {
    return undefined
  }

  const heartbeatSeconds = tonumber(heartbeatText)
  if (heartbeatSeconds === undefined || math.floor(heartbeatSeconds) !== heartbeatSeconds) {
    return undefined
  }
  const age = nowSeconds - heartbeatSeconds
  if (age < 0 || age > 2) {
    return undefined
  }

  const prefix = `VPR1\n${heartbeatText}\n${session}\n`
  if (checksum(prefix) !== expectedChecksum) {
    return undefined
  }

  return { heartbeatSeconds, session }
}

function decodeAndResolve(
  record: string | undefined,
  nowSeconds: number,
  osType: string,
  directory: string,
): ResolvedRendezvous | undefined {
  const rendezvous = decodeRendezvous(record, nowSeconds)
  if (rendezvous === undefined) {
    return undefined
  }
  return {
    ...endpointPaths(osType, directory, rendezvous.session),
    heartbeatSeconds: rendezvous.heartbeatSeconds,
  }
}

export function readRendezvous(
  directory: string,
  nowSeconds = os.time(),
): ResolvedRendezvous | undefined {
  const [handle] = io.open(channelPath(directory, "pipe-session"), "rb")
  if (handle === undefined) {
    return undefined
  }
  const [readSucceeded, recordOrError] = pcall(() => handle.read(RENDEZVOUS_BYTES))
  const [closeSucceeded, closeError] = pcall(() => handle.close())
  if (!readSucceeded) {
    error(recordOrError)
  }
  if (!closeSucceeded) {
    error(closeError)
  }
  return decodeAndResolve(recordOrError, nowSeconds, SV.getHostInfo().osType, directory)
}
