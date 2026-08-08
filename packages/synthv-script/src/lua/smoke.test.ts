import { beforeEach, describe, expect, it, vi } from "vitest"

const runtime = vi.hoisted(() => ({
  calls: [] as string[],
}))

vi.mock("./bridge/model", () => ({
  collectNotes: () => {
    runtime.calls.push("collect-notes")
    return [{ pitch: 60 }]
  },
  currentRevision: () => {
    runtime.calls.push("revision")
    return "rev-1"
  },
  viewMapping: () => {
    runtime.calls.push("view")
    return {
      perBlick: 1,
      perSemitone: 2,
      viewLeft: 0,
      viewRight: 10,
      viewTop: 80,
      viewBottom: 40,
    }
  },
}))

vi.mock("./bridge/publisher", () => ({
  createPublisher: () => ({
    prepare: (elapsedMs: number) => {
      runtime.calls.push(`prepare:${elapsedMs}`)
      return "new-session"
    },
    publishNotes: (rev: string, notes: unknown[]) => {
      runtime.calls.push(`notes:${rev}:${notes.length}`)
    },
    publishState: (state: { rev: string }) => {
      runtime.calls.push(`state:${state.rev}`)
    },
    describe: () => "connected",
    close: () => {},
  }),
}))

beforeEach(() => {
  vi.resetModules()
  runtime.calls = []
  Object.assign(globalThis, {
    tostring: (value: unknown) => String(value),
    type: (value: unknown) => typeof value,
    SV: {
      create: () => ({ setValueChangeCallback: () => {} }),
      getPlayback: () => ({ getPlayhead: () => 1, getStatus: () => "playing" }),
      refreshSidePanel: () => {},
      setTimeout: () => {},
    },
  })
})

describe("Lua smoke", () => {
  it("uses prepare and publishes a current reconnect snapshot", async () => {
    await import("./smoke")

    expect(runtime.calls).toEqual([
      "prepare:0",
      "collect-notes",
      "revision",
      "notes:rev-1:1",
      "view",
      "state:rev-1",
    ])
  })
})
