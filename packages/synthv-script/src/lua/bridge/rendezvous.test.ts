import { beforeEach, describe, expect, it } from "vitest"
import { endpointPaths } from "./paths"
import { decodeRendezvous, readRendezvous } from "./rendezvous"

const NOW = 1_786_171_600
const SESSION = "0123456789abcdef0123456789abcdef"
const PREFIX = `VPR1\n${NOW}\n${SESSION}\n`
const RECORD = `${PREFIX}24fef1d5\n${" ".repeat(70)}`

let closed = false

function record(heartbeat: string, checksum: string): string {
  const content = `VPR1\n${heartbeat}\n${SESSION}\n${checksum}\n`
  return `${content}${" ".repeat(128 - content.length)}`
}

beforeEach(() => {
  closed = false
  Object.assign(globalThis, {
    math: { floor: Math.floor },
    tonumber: (value: string) => {
      const number = Number(value)
      return Number.isNaN(number) ? undefined : number
    },
    string: {
      len: (value: string) => value.length,
      byte: (value: string, index: number) => value.charCodeAt(index - 1),
      find: (value: string, needle: string, start = 1, plain = false) => {
        if (plain) {
          const index = value.indexOf(needle, start - 1)
          return index < 0 ? [undefined, undefined] : [index + 1, index + needle.length]
        }
        const valid = needle === "^[0-9]+$" ? /^[0-9]+$/.test(value) : /^[0-9a-f]+$/.test(value)
        return valid ? [1, value.length] : [undefined, undefined]
      },
      format: (_format: string, value: number) => (value >>> 0).toString(16).padStart(8, "0"),
      lower: (value: string) => value.toLowerCase(),
      match: (value: string) => {
        const match = /^VPR1\n([^\n]*)\n([^\n]*)\n([^\n]*)\n( *)$/.exec(value)
        return match === null
          ? [undefined, undefined, undefined, undefined]
          : [match[1], match[2], match[3], match[4]]
      },
    },
    io: {
      open: () => [
        {
          read: () => RECORD,
          close: () => {
            closed = true
          },
        },
      ],
    },
    os: { time: () => NOW },
    SV: { getHostInfo: () => ({ osType: "macOS" }) },
  })
})

describe("decodeRendezvous", () => {
  it("decodes the app's canonical record", () => {
    expect(decodeRendezvous(RECORD, NOW)).toEqual({ heartbeatSeconds: NOW, session: SESSION })
  })

  it("rejects a bad checksum", () => {
    expect(decodeRendezvous(RECORD.replace("24fef1d5", "00000000"), NOW)).toBeUndefined()
  })

  it.each([
    ["+1786171600", "9e6f7200"],
    ["1.7861716e9", "2feefe37"],
    ["1786171600.0", "fad7ee43"],
    [" 1786171600 ", "378fe597"],
  ])("rejects the non-decimal heartbeat form %j", (heartbeat, checksum) => {
    expect(decodeRendezvous(record(heartbeat, checksum), NOW)).toBeUndefined()
  })

  it.each([0, 1, 2])("accepts a heartbeat %s seconds old", (age) => {
    expect(decodeRendezvous(RECORD, NOW + age)).toEqual({ heartbeatSeconds: NOW, session: SESSION })
  })

  it("rejects a stale or future heartbeat", () => {
    expect(decodeRendezvous(RECORD, NOW + 3)).toBeUndefined()
    expect(decodeRendezvous(RECORD, NOW - 1)).toBeUndefined()
  })
})

describe("endpointPaths", () => {
  it("derives macOS and Windows pipe paths", () => {
    expect(endpointPaths("macOS", "/bridge", SESSION).state).toBe(`/bridge/pipe-${SESSION}-state`)
    expect(endpointPaths("Windows", "C:\\bridge", SESSION).state).toBe(
      `\\\\.\\pipe\\voxpane-${SESSION}-state`,
    )
  })
})

describe("readRendezvous", () => {
  it("reads only the rendezvous file and closes it", () => {
    expect(readRendezvous("/bridge", NOW)).toEqual({
      session: SESSION,
      state: `/bridge/pipe-${SESSION}-state`,
      scroll: `/bridge/pipe-${SESSION}-scroll`,
      notes: `/bridge/pipe-${SESSION}-notes`,
    })
    expect(closed).toBe(true)
  })
})
