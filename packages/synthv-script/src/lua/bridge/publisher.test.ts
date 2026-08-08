import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PipeChannel, PipeConnection } from "./pipe"

const pipe = vi.hoisted(() => ({
  connection: undefined as PipeConnection | undefined,
  directory: "/bridge" as string | undefined,
  disconnects: 0,
  writes: [] as Array<[PipeChannel, string]>,
  writeResults: [] as boolean[],
}))

vi.mock("../json", () => ({
  encodeJson: (value: unknown) => JSON.stringify(value),
}))

vi.mock("./paths", () => ({
  bridgeDirectory: () => pipe.directory,
}))

vi.mock("./pipe", () => ({
  createPipeClient: () => ({
    connect: () => pipe.connection,
    write: (channel: PipeChannel, frame: string) => {
      pipe.writes.push([channel, frame])
      const result = pipe.writeResults.shift() ?? true
      if (!result) {
        pipe.connection = undefined
      }
      return result
    },
    disconnect: () => {
      pipe.disconnects += 1
      pipe.connection = undefined
    },
    describe: () =>
      pipe.connection === undefined
        ? "disconnected, last error: none"
        : `connected (app ${pipe.connection.session}), last error: none`,
  }),
}))

vi.mock("./codec", () => ({
  LAYOUT: 5,
  encodeSession: (json: string) => `session:${json}`,
  encodeNotes: (notesSeq: number, rev: string) => `notes:${notesSeq}:${rev}`,
  encodeScroll: (value: { scrollSeq: number }) => `scroll:${value.scrollSeq}`,
  encodeState: (value: { seq: number; notesSeq: number; scrollSeq: number }) =>
    `state:${value.seq}:notes=${value.notesSeq}:scroll=${value.scrollSeq}`,
}))

import { createPublisher } from "./publisher"

const APP_A = "0123456789abcdef0123456789abcdef"
const APP_B = "fedcba9876543210fedcba9876543210"

const defaultState = {
  at: 0,
  status: "playing",
  loop: null,
  perBlick: 1,
  perSemitone: 2,
  viewLeft: 0,
  viewRight: 10,
  viewTop: 80,
  viewBottom: 40,
  rev: "rev-1",
}

function sessionPayload(index: number): Record<string, unknown> {
  const frame = pipe.writes[index][1]
  expect(frame.startsWith("session:")).toBe(true)
  return JSON.parse(frame.slice("session:".length))
}

beforeEach(() => {
  pipe.connection = { session: APP_A, serial: 1 }
  pipe.directory = "/bridge"
  pipe.disconnects = 0
  pipe.writes = []
  pipe.writeResults = []
  Object.assign(globalThis, {
    os: { time: () => 123 },
    SV: {
      getHostInfo: () => ({
        osType: "macOS",
        hostName: "Synthesizer V Studio 2",
        hostVersion: "2.3.0",
        hostVersionNumber: 131330,
      }),
    },
  })
})

describe("createPublisher", () => {
  it("publishes one layout-5 session frame before reporting a new connection", () => {
    const publisher = createPublisher()

    expect(publisher.prepare(0)).toBe("new-session")
    expect(pipe.writes).toHaveLength(1)
    expect(pipe.writes[0][0]).toBe("state")
    expect(sessionPayload(0)).toMatchObject({
      v: 1,
      layout: 5,
      appSession: APP_A,
      scriptSession: "123:1",
    })
    expect(publisher.prepare(4)).toBe("connected")
    expect(pipe.writes).toHaveLength(1)
  })

  it("uses connection serials to reset and republish even when appSession repeats", () => {
    const publisher = createPublisher()
    expect(publisher.prepare(0)).toBe("new-session")
    publisher.publishNotes("rev-1", [])
    publisher.publishState(defaultState)

    pipe.connection = { session: APP_A, serial: 2 }
    expect(publisher.prepare(250)).toBe("new-session")

    expect(sessionPayload(pipe.writes.length - 1)).toMatchObject({
      appSession: APP_A,
      scriptSession: "123:2",
    })
    expect(publisher.describe()).toContain("seq 0, scroll 0, notes 0")
  })

  it("creates a new script session when a different app session connects", () => {
    const publisher = createPublisher()
    expect(publisher.prepare(0)).toBe("new-session")

    pipe.connection = { session: APP_B, serial: 2 }
    expect(publisher.prepare(250)).toBe("new-session")

    expect(sessionPayload(1)).toMatchObject({ appSession: APP_B, scriptSession: "123:2" })
  })

  it("returns disconnected and tears down when the session frame write fails", () => {
    pipe.writeResults = [false]
    const publisher = createPublisher()

    expect(publisher.prepare(0)).toBe("disconnected")
    expect(pipe.disconnects).toBe(1)
    expect(publisher.describe()).toContain("session write failed")
  })

  it("publishes a complete reconnect snapshot in session, notes, scroll, state order", () => {
    const publisher = createPublisher()

    expect(publisher.prepare(0)).toBe("new-session")
    publisher.publishNotes("r1", [])
    publisher.publishState(defaultState)

    expect(
      pipe.writes.map(([channel, frame]) => [
        channel,
        frame.startsWith("session:") ? "session" : frame,
      ]),
    ).toEqual([
      ["state", "session"],
      ["notes", "notes:1:r1"],
      ["scroll", "scroll:1"],
      ["state", "state:1:notes=1:scroll=1"],
    ])
  })

  it("does not advertise or publish state after a failed notes write", () => {
    const publisher = createPublisher()
    publisher.prepare(0)
    pipe.writeResults = [false]

    publisher.publishNotes("rev-failed", [])
    publisher.publishState(defaultState)

    expect(pipe.writes.slice(1)).toEqual([["notes", "notes:1:rev-failed"]])
    expect(publisher.describe()).toContain("notes 0")
    expect(publisher.describe()).toContain("notes write failed")
  })

  it("does not proceed to state after a failed scroll write", () => {
    const publisher = createPublisher()
    publisher.prepare(0)
    pipe.writeResults = [false]

    publisher.publishState(defaultState)

    expect(pipe.writes.slice(1)).toEqual([["scroll", "scroll:1"]])
    expect(publisher.describe()).toContain("seq 0, scroll 0")
    expect(publisher.describe()).toContain("scroll write failed")
  })

  it("advances notes and scroll generations only after successful writes", () => {
    const publisher = createPublisher()
    publisher.prepare(0)

    publisher.publishNotes("rev-1", [])
    publisher.publishState(defaultState)
    publisher.publishState(defaultState)

    expect(pipe.writes.slice(1)).toEqual([
      ["notes", "notes:1:rev-1"],
      ["scroll", "scroll:1"],
      ["state", "state:1:notes=1:scroll=1"],
      ["state", "state:2:notes=1:scroll=1"],
    ])
  })

  it("reports unavailable without a bridge directory", () => {
    pipe.directory = undefined
    const publisher = createPublisher()

    expect(publisher.prepare(0)).toBe("disconnected")
    expect(publisher.describe()).toContain("no home directory")
    expect(pipe.writes).toEqual([])
  })

  it("closes the shared handle set through the pipe client", () => {
    const publisher = createPublisher()
    publisher.prepare(0)

    publisher.close()

    expect(pipe.disconnects).toBe(1)
  })
})
