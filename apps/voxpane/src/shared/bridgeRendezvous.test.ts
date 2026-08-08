import { describe, expect, it } from "vitest"
import {
  decodeRendezvous,
  encodeRendezvous,
  pipeEndpoint,
  RENDEZVOUS_BYTES,
} from "./bridgeRendezvous"

const HEARTBEAT = 1_786_171_600
const SESSION = "0123456789abcdef0123456789abcdef"

function record(prefix: string, checksum: string): Uint8Array {
  const bytes = new TextEncoder().encode(`${prefix}${checksum}\n`)
  const padded = new Uint8Array(RENDEZVOUS_BYTES)
  padded.fill(0x20)
  padded.set(bytes)
  return padded
}

describe("rendezvous record", () => {
  it("encodes the canonical fixed-width record", () => {
    const bytes = encodeRendezvous({ heartbeatSeconds: HEARTBEAT, session: SESSION })

    expect(bytes).toHaveLength(128)
    expect(new TextDecoder().decode(bytes)).toBe(
      `VPR1\n${HEARTBEAT}\n${SESSION}\n24fef1d5\n${" ".repeat(70)}`,
    )
  })

  it.each([0, 1, 2])("accepts a heartbeat %s seconds old", (age) => {
    const bytes = encodeRendezvous({ heartbeatSeconds: HEARTBEAT, session: SESSION })

    expect(decodeRendezvous(bytes, HEARTBEAT + age)).toEqual({
      heartbeatSeconds: HEARTBEAT,
      session: SESSION,
    })
  })

  it("rejects a corrupt checksum", () => {
    const bytes = encodeRendezvous({ heartbeatSeconds: HEARTBEAT, session: SESSION })
    bytes[49] = "0".charCodeAt(0)

    expect(decodeRendezvous(bytes, HEARTBEAT + 1)).toBeNull()
  })

  it("rejects a stale or future heartbeat", () => {
    const bytes = encodeRendezvous({ heartbeatSeconds: HEARTBEAT, session: SESSION })

    expect(decodeRendezvous(bytes, HEARTBEAT + 3)).toBeNull()
    expect(decodeRendezvous(bytes, HEARTBEAT - 1)).toBeNull()
  })

  it("rejects sessions that are not 32 lowercase hexadecimal characters", () => {
    expect(
      decodeRendezvous(
        record(`VPR1\n${HEARTBEAT}\n${SESSION.toUpperCase()}\n`, "9edb6795"),
        HEARTBEAT,
      ),
    ).toBeNull()
    expect(
      decodeRendezvous(
        record(`VPR1\n${HEARTBEAT}\n${SESSION.slice(0, -1)}\n`, "a9651f79"),
        HEARTBEAT,
      ),
    ).toBeNull()
  })

  it("rejects non-space trailing bytes", () => {
    const bytes = encodeRendezvous({ heartbeatSeconds: HEARTBEAT, session: SESSION })
    bytes[RENDEZVOUS_BYTES - 1] = "x".charCodeAt(0)

    expect(decodeRendezvous(bytes, HEARTBEAT)).toBeNull()
  })
})

describe("pipeEndpoint", () => {
  it("derives platform-specific state endpoint names", () => {
    expect(pipeEndpoint("darwin", "/bridge", SESSION, "state")).toBe(
      `/bridge/pipe-${SESSION}-state`,
    )
    expect(pipeEndpoint("win32", "C:\\bridge", SESSION, "state")).toBe(
      `\\\\.\\pipe\\voxpane-${SESSION}-state`,
    )
  })
})
