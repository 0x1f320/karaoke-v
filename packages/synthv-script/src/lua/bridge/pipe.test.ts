import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PipeEndpoints } from "./paths"

const rendezvous = vi.hoisted(() => ({
  calls: 0,
  result: undefined as PipeEndpoints | undefined,
}))

vi.mock("./rendezvous", () => ({
  readRendezvous: () => {
    rendezvous.calls += 1
    return rendezvous.result
  },
}))

import { createPipeClient } from "./pipe"

const APP_A = "0123456789abcdef0123456789abcdef"
const APP_B = "fedcba9876543210fedcba9876543210"

function endpoints(session = APP_A): PipeEndpoints {
  return {
    session,
    state: `/bridge/pipe-${session}-state`,
    scroll: `/bridge/pipe-${session}-scroll`,
    notes: `/bridge/pipe-${session}-notes`,
  }
}

class FakeHandle {
  closed = 0
  readonly bufferModes: string[] = []
  readonly writes: string[] = []
  writeResult: "success" | "undefined" | "throw" = "success"
  setvbufResult: "success" | "undefined" | "throw" = "success"

  close(): boolean {
    this.closed += 1
    return true
  }

  setvbuf(mode: string): [true] | [undefined, string] {
    this.bufferModes.push(mode)
    if (this.setvbufResult === "throw") {
      throw new Error("buffer mode exploded")
    }
    return this.setvbufResult === "undefined" ? [undefined, "buffer mode returned nil"] : [true]
  }

  write(frame: string): [FakeHandle] | [undefined, string] {
    this.writes.push(frame)
    if (this.writeResult === "throw") {
      throw new Error("write exploded")
    }
    return this.writeResult === "undefined" ? [undefined, "write returned nil"] : [this]
  }
}

let opened: Array<{ path: string; mode: string }> = []
let openResults: Array<FakeHandle | Error | undefined> = []

function queueHandles(...handles: Array<FakeHandle | Error | undefined>): void {
  openResults.push(...handles)
}

beforeEach(() => {
  rendezvous.calls = 0
  rendezvous.result = endpoints()
  opened = []
  openResults = []
  Object.assign(globalThis, {
    tostring: (value: unknown) => String(value),
    io: {
      open: (path: string, mode: string) => {
        opened.push({ path, mode })
        const result = openResults.shift()
        if (result instanceof Error) {
          throw result
        }
        return result === undefined ? [undefined, "endpoint missing"] : [result]
      },
    },
  })
})

describe("createPipeClient", () => {
  it("opens the complete handle set in deterministic wb order with buffering disabled", () => {
    const state = new FakeHandle()
    const scroll = new FakeHandle()
    const notes = new FakeHandle()
    queueHandles(state, scroll, notes)
    const client = createPipeClient("/bridge")

    expect(client.connect(0)).toEqual({ session: APP_A, serial: 1 })
    expect(opened).toEqual([
      { path: endpoints().state, mode: "wb" },
      { path: endpoints().scroll, mode: "wb" },
      { path: endpoints().notes, mode: "wb" },
    ])
    expect(state.bufferModes).toEqual(["no"])
    expect(scroll.bufferModes).toEqual(["no"])
    expect(notes.bufferModes).toEqual(["no"])
  })

  it.each(["stale", "future", "malformed"])("does not open endpoints for a %s rendezvous", () => {
    rendezvous.result = undefined
    const client = createPipeClient("/bridge")

    expect(client.connect(0)).toBeUndefined()
    expect(opened).toEqual([])
    expect(client.describe()).toContain("rendezvous")
  })

  it("closes every prior handle after a partial open failure", () => {
    const state = new FakeHandle()
    queueHandles(state, undefined)
    const client = createPipeClient("/bridge")

    expect(client.connect(0)).toBeUndefined()
    expect(state.closed).toBe(1)
    expect(opened).toHaveLength(2)
    expect(client.describe()).toContain("open scroll")
  })

  it.each(["undefined", "throw"] as const)(
    "closes the current and prior handles when setvbuf returns %s",
    (failure) => {
      const state = new FakeHandle()
      const scroll = new FakeHandle()
      scroll.setvbufResult = failure
      queueHandles(state, scroll)
      const client = createPipeClient("/bridge")

      expect(client.connect(0)).toBeUndefined()
      expect(state.closed).toBe(1)
      expect(scroll.closed).toBe(1)
      expect(client.describe()).toContain(
        failure === "throw" ? "buffer mode exploded" : "buffer mode returned nil",
      )
    },
  )

  it("backs off a failed disconnected attempt for 240 logical milliseconds", () => {
    const firstState = new FakeHandle()
    const state = new FakeHandle()
    const scroll = new FakeHandle()
    const notes = new FakeHandle()
    queueHandles(firstState, undefined, state, scroll, notes)
    const client = createPipeClient("/bridge")

    expect(client.connect(0)).toBeUndefined()
    expect(client.connect(239)).toBeUndefined()
    expect(opened).toHaveLength(2)
    expect(rendezvous.calls).toBe(1)
    expect(client.connect(240)).toEqual({ session: APP_A, serial: 1 })
    expect(opened).toHaveLength(5)
    expect(rendezvous.calls).toBe(2)
  })

  it("preserves handles and identity when connected validation sees the same session", () => {
    const handles = [new FakeHandle(), new FakeHandle(), new FakeHandle()] as const
    queueHandles(...handles)
    const client = createPipeClient("/bridge")

    const connection = client.connect(0)
    expect(client.connect(239)).toBe(connection)
    expect(client.connect(240)).toBe(connection)
    expect(opened).toHaveLength(3)
    expect(rendezvous.calls).toBe(2)
    expect(handles.every((handle) => handle.closed === 0)).toBe(true)
  })

  it("shares one rendezvous read budget between prepare and pre-write validation", () => {
    queueHandles(new FakeHandle(), new FakeHandle(), new FakeHandle())
    const client = createPipeClient("/bridge")

    expect(client.connect(0)).toEqual({ session: APP_A, serial: 1 })
    expect(client.validate(0, 1)).toBe(true)
    expect(client.validate(239, 1)).toBe(true)
    expect(rendezvous.calls).toBe(1)

    expect(client.validate(240, 1)).toBe(true)
    expect(rendezvous.calls).toBe(2)
    expect(opened).toHaveLength(3)
  })

  it.each(["missing", "stale", "malformed"])(
    "tears down connected handles by the 240 ms validation for a %s rendezvous",
    () => {
      const handles = [new FakeHandle(), new FakeHandle(), new FakeHandle()] as const
      queueHandles(...handles)
      const client = createPipeClient("/bridge")

      expect(client.connect(0)).toEqual({ session: APP_A, serial: 1 })
      rendezvous.result = undefined
      expect(client.connect(239)).toEqual({ session: APP_A, serial: 1 })
      expect(client.connect(240)).toBeUndefined()
      expect(handles.every((handle) => handle.closed === 1)).toBe(true)
      expect(opened).toHaveLength(3)
    },
  )

  it("replaces all handles in one controlled attempt when the app session changes", () => {
    const oldHandles = [new FakeHandle(), new FakeHandle(), new FakeHandle()] as const
    const newHandles = [new FakeHandle(), new FakeHandle(), new FakeHandle()] as const
    queueHandles(...oldHandles, ...newHandles)
    const client = createPipeClient("/bridge")

    expect(client.connect(0)).toEqual({ session: APP_A, serial: 1 })
    rendezvous.result = endpoints(APP_B)
    expect(client.connect(240)).toEqual({ session: APP_B, serial: 2 })
    expect(oldHandles.every((handle) => handle.closed === 1)).toBe(true)
    expect(newHandles.every((handle) => handle.closed === 0)).toBe(true)
    expect(opened).toHaveLength(6)
    expect(rendezvous.calls).toBe(2)
  })

  it("performs exactly one handle write for a channel frame", () => {
    const state = new FakeHandle()
    queueHandles(state, new FakeHandle(), new FakeHandle())
    const client = createPipeClient("/bridge")
    client.connect(0)

    expect(client.write("state", "whole-frame")).toBe(true)
    expect(state.writes).toEqual(["whole-frame"])
  })

  it.each(["undefined", "throw"] as const)(
    "closes all handles when a channel write returns %s",
    (failure) => {
      const state = new FakeHandle()
      const scroll = new FakeHandle()
      const notes = new FakeHandle()
      state.writeResult = failure
      queueHandles(state, scroll, notes)
      const client = createPipeClient("/bridge")
      client.connect(0)

      expect(client.write("state", "frame")).toBe(false)
      expect(state.writes).toEqual(["frame"])
      expect([state, scroll, notes].every((handle) => handle.closed === 1)).toBe(true)
      expect(client.describe()).toContain(
        failure === "throw" ? "write exploded" : "write returned nil",
      )
    },
  )

  it("backs off reconnect after a write failure without opening storms", () => {
    const failedState = new FakeHandle()
    failedState.writeResult = "undefined"
    const replacement = [new FakeHandle(), new FakeHandle(), new FakeHandle()] as const
    queueHandles(failedState, new FakeHandle(), new FakeHandle(), ...replacement)
    const client = createPipeClient("/bridge")
    client.connect(0)

    expect(client.write("state", "frame")).toBe(false)
    expect(client.connect(239)).toBeUndefined()
    expect(opened).toHaveLength(3)
    expect(client.connect(240)).toEqual({ session: APP_A, serial: 2 })
    expect(opened).toHaveLength(6)
  })

  it("backs off an explicitly invalidated incomplete snapshot", () => {
    const first = [new FakeHandle(), new FakeHandle(), new FakeHandle()] as const
    const second = [new FakeHandle(), new FakeHandle(), new FakeHandle()] as const
    queueHandles(...first, ...second)
    const client = createPipeClient("/bridge")

    expect(client.connect(0)).toEqual({ session: APP_A, serial: 1 })
    client.invalidate("snapshot failed")
    expect(client.connect(239)).toBeUndefined()
    expect(client.connect(240)).toEqual({ session: APP_A, serial: 2 })

    expect(first.every((handle) => handle.closed === 1)).toBe(true)
    expect(rendezvous.calls).toBe(2)
  })

  it("disconnects idempotently and reports connection state", () => {
    const handles = [new FakeHandle(), new FakeHandle(), new FakeHandle()] as const
    queueHandles(...handles)
    const client = createPipeClient("/bridge")
    client.connect(0)

    expect(client.describe()).toContain(`connected (app ${APP_A})`)
    client.disconnect()
    client.disconnect()

    expect(handles.every((handle) => handle.closed === 1)).toBe(true)
    expect(client.describe()).toContain("disconnected")
  })

  it("reconnects immediately after an explicit disconnect and advances identity", () => {
    const first = [new FakeHandle(), new FakeHandle(), new FakeHandle()] as const
    const second = [new FakeHandle(), new FakeHandle(), new FakeHandle()] as const
    queueHandles(...first, ...second)
    const client = createPipeClient("/bridge")

    expect(client.connect(0)).toEqual({ session: APP_A, serial: 1 })
    client.disconnect()
    expect(client.connect(4)).toEqual({ session: APP_A, serial: 2 })

    expect(rendezvous.calls).toBe(2)
    expect(first.every((handle) => handle.closed === 1)).toBe(true)
    expect(second.every((handle) => handle.closed === 0)).toBe(true)
  })

  it("retains the app session in diagnostics after write teardown", () => {
    const state = new FakeHandle()
    state.writeResult = "undefined"
    queueHandles(state, new FakeHandle(), new FakeHandle())
    const client = createPipeClient("/bridge")
    client.connect(0)

    client.write("state", "frame")

    expect(client.describe()).toContain(`disconnected (app ${APP_A})`)
  })
})
