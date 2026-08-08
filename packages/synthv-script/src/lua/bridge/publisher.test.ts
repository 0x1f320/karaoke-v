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
    scroll: new RecordingChannel(),
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
    name === "state"
      ? channelState.state
      : name === "scroll"
        ? channelState.scroll
        : channelState.session,
  coldChannel: () => channelState.notes,
}))

vi.mock("./codec", () => ({
  LAYOUT: 5,
  encodeNotes: (_notesSeq: number, rev: string) => rev,
  encodeScroll: (value: unknown) => JSON.stringify(value),
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
    channelState.scroll.records.length = 0
    channelState.scroll.results = []
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

  it("publishes the initial scroll and suppresses identical values", async () => {
    const { createPublisher } = await import("./publisher")

    const publisher = createPublisher()
    publisher.publishState(defaultState)
    publisher.publishState(defaultState)

    expect(channelState.scroll.records.map(JSON.parse)).toEqual([
      {
        scrollSeq: 1,
        perBlick: 1,
        perSemitone: 2,
        viewLeft: 0,
        viewRight: 10,
        viewTop: 80,
        viewBottom: 40,
      },
    ])
    expect(channelState.state.records.map((record) => JSON.parse(record).scrollSeq)).toEqual([1, 1])
  })

  it("publishes a new scroll generation after any mapping value changes", async () => {
    const { createPublisher } = await import("./publisher")

    const publisher = createPublisher()
    publisher.publishState(defaultState)
    publisher.publishState({ ...defaultState, viewTop: 81 })

    expect(channelState.scroll.records.map((record) => JSON.parse(record).scrollSeq)).toEqual([
      1, 2,
    ])
    expect(channelState.state.records.map((record) => JSON.parse(record).scrollSeq)).toEqual([1, 2])
  })

  it("retries a failed scroll write without advancing the advertised generation", async () => {
    channelState.scroll.results = [false, true]
    const { createPublisher } = await import("./publisher")

    const publisher = createPublisher()
    publisher.publishState(defaultState)
    publisher.publishState(defaultState)

    expect(channelState.scroll.records).toHaveLength(2)
    expect(channelState.state.records.map((record) => JSON.parse(record).scrollSeq)).toEqual([0, 1])
    expect(publisher.describe()).toContain("scroll write failed")
  })

  it("announces the scroll channel in the session", async () => {
    const { createPublisher } = await import("./publisher")

    createPublisher()

    expect(JSON.parse(channelState.session.records[0]).channels).toContainEqual({
      name: "scroll",
      kind: "hot",
      encoding: "binary",
      width: 64,
    })
  })
})
