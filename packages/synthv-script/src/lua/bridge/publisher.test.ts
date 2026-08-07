import { beforeEach, describe, expect, it, vi } from "vitest"

const channelState = vi.hoisted(() => {
  class RecordingChannel {
    readonly records: string[] = []
    results: boolean[] = []

    publish(record: string): boolean {
      this.records.push(record)
      return this.results.shift() ?? true
    }

    close(): void {}
  }

  return {
    session: new RecordingChannel(),
    state: new RecordingChannel(),
    notes: new RecordingChannel(),
  }
})

vi.mock("../json", () => ({
  encodeJson: (value: unknown) => JSON.stringify(value),
}))

vi.mock("./paths", () => ({
  bridgeDirectory: () => "/bridge",
}))

vi.mock("./channels", () => ({
  hotChannel: (_directory: string, name: string) =>
    name === "state" ? channelState.state : channelState.session,
  coldChannel: () => channelState.notes,
}))

vi.mock("./codec", () => ({
  LAYOUT: 3,
  encodeNotes: (rev: string) => rev,
  encodeState: (value: unknown) => JSON.stringify(value),
}))

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

describe("createPublisher", () => {
  beforeEach(() => {
    channelState.session.records.length = 0
    channelState.session.results = []
    channelState.state.records.length = 0
    channelState.state.results = []
    channelState.notes.records.length = 0
    channelState.notes.results = []

    Object.assign(globalThis, {
      SV: {
        getHostInfo: () => ({
          osType: "macOS",
          hostName: "Synthesizer V Studio 2",
          hostVersion: "2.3.0",
          hostVersionNumber: 131330,
        }),
      },
      os: {
        time: () => 123,
      },
    })
  })

  it("does not advertise a new notes generation when the notes write fails", async () => {
    channelState.notes.results = [false]
    const { createPublisher } = await import("./publisher")

    const publisher = createPublisher()
    publisher.publishNotes("rev-failed", [])
    publisher.publishState(defaultState)

    expect(JSON.parse(channelState.state.records[0]).notesSeq).toBe(0)
    expect(publisher.describe()).toContain("notes write failed")
  })
})
