import { beforeEach, describe, expect, it, vi } from "vitest"

const runtime = vi.hoisted(() => ({
  calls: [] as string[],
  collectFailures: 0,
  prepareResults: [] as Array<"new-session" | "connected" | "disconnected">,
  scheduled: undefined as (() => void) | undefined,
}))

vi.mock("./bridge/model", () => ({
  collectNotes: () => {
    runtime.calls.push("collect-notes")
    if (runtime.collectFailures > 0) {
      runtime.collectFailures -= 1
      throw new Error("collection unavailable")
    }
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
      return runtime.prepareResults.shift() ?? "connected"
    },
    publishNotes: (rev: string, notes: unknown[]) => {
      runtime.calls.push(`notes:${rev}:${notes.length}`)
      return true
    },
    abortSnapshot: (message: string) => {
      runtime.calls.push(`abort:${message}`)
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
  runtime.collectFailures = 0
  runtime.prepareResults = ["new-session"]
  runtime.scheduled = undefined
  Object.assign(globalThis, {
    tostring: (value: unknown) => String(value),
    type: (value: unknown) => typeof value,
    SV: {
      create: () => ({ setValueChangeCallback: () => {} }),
      getPlayback: () => ({ getPlayhead: () => 1, getStatus: () => "playing" }),
      refreshSidePanel: () => {},
      setTimeout: (_milliseconds: number, callback: () => void) => {
        runtime.scheduled = callback
      },
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

  it("aborts a failed reconnect snapshot and retries without publishing state", async () => {
    runtime.collectFailures = 1
    runtime.prepareResults = [
      "new-session",
      ...Array<"disconnected">(14).fill("disconnected"),
      "new-session",
    ]
    await import("./smoke")

    expect(runtime.calls).toEqual([
      "prepare:0",
      "collect-notes",
      "abort:Error: collection unavailable",
    ])

    for (let tick = 0; tick < 14; tick += 1) {
      runtime.scheduled?.()
    }
    expect(runtime.calls.some((call) => call.startsWith("state:"))).toBe(false)

    runtime.scheduled?.()
    expect(runtime.calls.slice(-6)).toEqual([
      "prepare:240",
      "collect-notes",
      "revision",
      "notes:rev-1:1",
      "view",
      "state:rev-1",
    ])
  })

  it("lands its 16 ms logical cadence exactly on 240 ms", async () => {
    await import("./smoke")

    for (let tick = 0; tick < 15; tick += 1) {
      runtime.scheduled?.()
    }

    expect(runtime.calls.filter((call) => call.startsWith("prepare:")).at(-1)).toBe("prepare:240")
  })
})
