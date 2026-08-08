import { beforeEach, describe, expect, it, vi } from "vitest"
import { encodeRendezvous, pipeEndpoint } from "../shared/bridgeRendezvous"
import {
  BridgeQuitCoordinator,
  destroyBridgeReceiverOwner,
  quiesceBridgeReceiverOwner,
  requestBridgeReceiverStop,
  withdrawAdvertisedBridge,
} from "./bridgeShutdown"

const SESSION = "0123456789abcdef0123456789abcdef"

function quitEvent(): { prevented: boolean; preventDefault(): void } {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useRealTimers()
})

describe("BridgeQuitCoordinator", () => {
  it("prevents one quit, waits for receiver stop, then cleans up once on final quit", async () => {
    const stopped = deferred<boolean>()
    const events: string[] = []
    const coordinator = new BridgeQuitCoordinator({
      requestReceiverStop: () => stopped.promise,
      quiesceReceiverOwner: () => Promise.resolve(),
      withdrawAdvertisement: () => events.push("withdraw"),
      resumeQuit: () => events.push("resume"),
      cleanup: () => events.push("cleanup"),
      reportFailure: () => events.push("quiesce-error"),
      timeoutMs: 1_000,
    })
    const first = quitEvent()
    const repeated = quitEvent()

    coordinator.beforeQuit(first)
    coordinator.beforeQuit(repeated)
    expect(first.prevented).toBe(true)
    expect(repeated.prevented).toBe(true)
    expect(events).toEqual([])

    stopped.resolve(true)
    await vi.waitFor(() => expect(events).toEqual(["resume"]))

    const final = quitEvent()
    coordinator.beforeQuit(final)
    coordinator.beforeQuit(quitEvent())
    expect(final.prevented).toBe(false)
    expect(events).toEqual(["resume", "cleanup"])
  })

  it.each(["unavailable", "rejected"] as const)(
    "withdraws synchronously before resuming when receiver stop is %s",
    async (outcome) => {
      const events: string[] = []
      const coordinator = new BridgeQuitCoordinator({
        requestReceiverStop: () =>
          outcome === "unavailable" ? Promise.resolve(false) : Promise.reject(new Error("lost")),
        quiesceReceiverOwner: async () => {
          events.push("quiesce")
        },
        withdrawAdvertisement: () => events.push("withdraw"),
        resumeQuit: () => events.push("resume"),
        cleanup: () => events.push("cleanup"),
        reportFailure: () => events.push("quiesce-error"),
        timeoutMs: 1_000,
      })

      coordinator.beforeQuit(quitEvent())
      await vi.waitFor(() => expect(events).toEqual(["quiesce", "withdraw", "resume"]))
    },
  )

  it("bounds an unresponsive receiver before fallback and resumed quit", async () => {
    vi.useFakeTimers()
    const events: string[] = []
    const coordinator = new BridgeQuitCoordinator({
      requestReceiverStop: () => new Promise(() => {}),
      quiesceReceiverOwner: async () => {
        events.push("quiesce")
      },
      withdrawAdvertisement: () => events.push("withdraw"),
      resumeQuit: () => events.push("resume"),
      cleanup: () => events.push("cleanup"),
      reportFailure: () => events.push("quiesce-error"),
      timeoutMs: 50,
    })

    coordinator.beforeQuit(quitEvent())
    await vi.advanceTimersByTimeAsync(49)
    expect(events).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(events).toEqual(["quiesce", "withdraw", "resume"])
  })

  it("does not withdraw at any arbitrary time while owner quiescence is pending", async () => {
    vi.useFakeTimers()
    const quiesced = deferred<void>()
    const events: string[] = []
    const coordinator = new BridgeQuitCoordinator({
      requestReceiverStop: () => new Promise(() => {}),
      quiesceReceiverOwner: async () => {
        events.push("quiesce:start")
        await quiesced.promise
        events.push("quiesce:done")
      },
      withdrawAdvertisement: () => events.push("withdraw"),
      resumeQuit: () => events.push("resume"),
      cleanup: () => events.push("cleanup"),
      reportFailure: () => events.push("quiesce-error"),
      timeoutMs: 50,
    })

    coordinator.beforeQuit(quitEvent())
    await vi.advanceTimersByTimeAsync(50)
    expect(events).toEqual(["quiesce:start"])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(events).toEqual(["quiesce:start"])

    quiesced.resolve()
    await vi.waitFor(() =>
      expect(events).toEqual(["quiesce:start", "quiesce:done", "withdraw", "resume"]),
    )
  })

  it("surfaces rejected quiescence and remains in the prevented-quit state", async () => {
    const events: string[] = []
    const coordinator = new BridgeQuitCoordinator({
      requestReceiverStop: () => Promise.resolve(false),
      quiesceReceiverOwner: () => Promise.reject(new Error("destroy unconfirmed")),
      withdrawAdvertisement: () => events.push("withdraw"),
      resumeQuit: () => events.push("resume"),
      cleanup: () => events.push("cleanup"),
      reportFailure: (error) => events.push(`error:${String(error)}`),
      timeoutMs: 50,
    })

    const first = quitEvent()
    coordinator.beforeQuit(first)
    await vi.waitFor(() => expect(events).toEqual(["error:Error: destroy unconfirmed"]))

    const repeated = quitEvent()
    coordinator.beforeQuit(repeated)
    expect(first.prevented).toBe(true)
    expect(repeated.prevented).toBe(true)
    expect(events).toEqual(["error:Error: destroy unconfirmed"])
  })

  it("quiesces a recovering owner before the final withdrawal", async () => {
    vi.useFakeTimers()
    const gate = deferred<void>()
    const events: string[] = []
    let ownerAlive = true
    let advertised = true
    const recoveryHeartbeat = (): void => {
      if (ownerAlive) {
        advertised = true
        events.push("heartbeat")
      }
    }
    const coordinator = new BridgeQuitCoordinator({
      requestReceiverStop: () => new Promise(() => {}),
      quiesceReceiverOwner: async () => {
        events.push("quiesce:start")
        await gate.promise
        ownerAlive = false
        events.push("quiesce:done")
      },
      withdrawAdvertisement: () => {
        advertised = false
        events.push("withdraw")
      },
      resumeQuit: () => events.push("resume"),
      cleanup: () => {},
      reportFailure: () => events.push("quiesce-error"),
      timeoutMs: 50,
    })

    coordinator.beforeQuit(quitEvent())
    await vi.advanceTimersByTimeAsync(50)
    recoveryHeartbeat()
    expect(advertised).toBe(true)
    expect(events).toEqual(["quiesce:start", "heartbeat"])

    gate.resolve()
    await vi.waitFor(() => expect(events.at(-2)).toBe("withdraw"))
    recoveryHeartbeat()

    expect(advertised).toBe(false)
    expect(events).toEqual(["quiesce:start", "heartbeat", "quiesce:done", "withdraw", "resume"])
  })

  it("reports a thrown resume without unhandled rejection or premature cleanup", async () => {
    const events: string[] = []
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown): void => {
      unhandled.push(error)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      const coordinator = new BridgeQuitCoordinator({
        requestReceiverStop: () => Promise.resolve(false),
        quiesceReceiverOwner: async () => {
          events.push("quiesce")
        },
        withdrawAdvertisement: () => events.push("withdraw"),
        resumeQuit: () => {
          events.push("resume")
          throw new Error("resume failed")
        },
        cleanup: () => events.push("cleanup"),
        reportFailure: (error) => events.push(`error:${String(error)}`),
        timeoutMs: 50,
      })

      const first = quitEvent()
      coordinator.beforeQuit(first)
      await vi.waitFor(() =>
        expect(events).toEqual(["quiesce", "withdraw", "resume", "error:Error: resume failed"]),
      )
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(first.prevented).toBe(true)
      expect(unhandled).toEqual([])
      expect(events).not.toContain("cleanup")

      const later = quitEvent()
      coordinator.beforeQuit(later)
      expect(later.prevented).toBe(false)
      expect(events).toEqual([
        "quiesce",
        "withdraw",
        "resume",
        "error:Error: resume failed",
        "cleanup",
      ])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  it("contains a reporter throw after resume failure", async () => {
    const events: string[] = []
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown): void => {
      unhandled.push(error)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      const coordinator = new BridgeQuitCoordinator({
        requestReceiverStop: () => Promise.resolve(true),
        quiesceReceiverOwner: () => Promise.resolve(),
        withdrawAdvertisement: () => events.push("withdraw"),
        resumeQuit: () => {
          events.push("resume")
          throw new Error("resume failed")
        },
        cleanup: () => events.push("cleanup"),
        reportFailure: () => {
          events.push("report")
          throw new Error("report failed")
        },
        timeoutMs: 50,
      })

      coordinator.beforeQuit(quitEvent())
      await vi.waitFor(() => expect(events).toEqual(["resume", "report"]))
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(unhandled).toEqual([])
      expect(events).not.toContain("cleanup")
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })
})

class FakeIpcMain {
  readonly listeners = new Set<(event: { sender: unknown }, stopped: unknown) => void>()

  on(_channel: string, listener: (event: { sender: unknown }, stopped: unknown) => void): void {
    this.listeners.add(listener)
  }

  off(_channel: string, listener: (event: { sender: unknown }, stopped: unknown) => void): void {
    this.listeners.delete(listener)
  }

  emit(sender: unknown, stopped: unknown): void {
    for (const listener of [...this.listeners]) listener({ sender }, stopped)
  }
}

class FakeSender {
  readonly sent: string[] = []
  readonly destroyedListeners = new Set<() => void>()
  destroyed = false
  sendError: Error | null = null

  send(channel: string): void {
    if (this.sendError) throw this.sendError
    this.sent.push(channel)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  once(_event: "destroyed", listener: () => void): void {
    this.destroyedListeners.add(listener)
  }

  off(_event: "destroyed", listener: () => void): void {
    this.destroyedListeners.delete(listener)
  }

  destroy(): void {
    this.destroyed = true
    for (const listener of [...this.destroyedListeners]) listener()
  }
}

describe("requestBridgeReceiverStop", () => {
  it("ignores a wrong sender and accepts the matching acknowledgement", async () => {
    const ipc = new FakeIpcMain()
    const sender = new FakeSender()
    const stopping = requestBridgeReceiverStop(ipc, sender, "request", "complete", 100)

    ipc.emit(new FakeSender(), true)
    expect(ipc.listeners.size).toBe(1)
    ipc.emit(sender, true)

    await expect(stopping).resolves.toBe(true)
    expect(sender.sent).toEqual(["request"])
    expect(ipc.listeners.size).toBe(0)
    expect(sender.destroyedListeners.size).toBe(0)
  })

  it.each(["send throw", "sender destroyed", "timeout"] as const)(
    "resolves false and cleans listeners after %s",
    async (outcome) => {
      vi.useFakeTimers()
      const ipc = new FakeIpcMain()
      const sender = new FakeSender()
      if (outcome === "send throw") sender.sendError = new Error("send failed")
      const stopping = requestBridgeReceiverStop(ipc, sender, "request", "complete", 25)

      if (outcome === "sender destroyed") sender.destroy()
      if (outcome === "timeout") await vi.advanceTimersByTimeAsync(25)

      await expect(stopping).resolves.toBe(false)
      expect(ipc.listeners.size).toBe(0)
      expect(sender.destroyedListeners.size).toBe(0)
    },
  )

  it("ignores late and duplicate acknowledgements after settling", async () => {
    const ipc = new FakeIpcMain()
    const sender = new FakeSender()
    const stopping = requestBridgeReceiverStop(ipc, sender, "request", "complete", 100)
    ipc.emit(sender, true)
    ipc.emit(sender, false)

    await expect(stopping).resolves.toBe(true)
    ipc.emit(sender, false)
    expect(ipc.listeners.size).toBe(0)
  })
})

class FakeReceiverContents {
  readonly destroyedListeners = new Set<() => void>()
  readonly goneListeners = new Set<() => void>()
  destroyed = false
  rendererGone = false
  forceCrashCalls = 0
  forceCrashError: Error | null = null

  isDestroyed(): boolean {
    return this.destroyed
  }

  once(event: "destroyed" | "render-process-gone", listener: () => void): void {
    const listeners = event === "destroyed" ? this.destroyedListeners : this.goneListeners
    listeners.add(listener)
  }

  off(event: "destroyed" | "render-process-gone", listener: () => void): void {
    const listeners = event === "destroyed" ? this.destroyedListeners : this.goneListeners
    listeners.delete(listener)
  }

  forcefullyCrashRenderer(): void {
    this.forceCrashCalls += 1
    if (this.forceCrashError) throw this.forceCrashError
  }

  completeDestroy(): void {
    this.destroyed = true
    for (const listener of [...this.destroyedListeners]) listener()
  }

  completeRenderGone(): void {
    this.rendererGone = true
    for (const listener of [...this.goneListeners]) listener()
  }
}

class FakeReceiverOwner {
  readonly closedListeners = new Set<() => void>()
  readonly webContents = new FakeReceiverContents()
  destroyed = false
  destroyCalls = 0
  destroyErrors: Array<Error | null> = []

  isDestroyed(): boolean {
    return this.destroyed
  }

  once(_event: "closed", listener: () => void): void {
    this.closedListeners.add(listener)
  }

  off(_event: "closed", listener: () => void): void {
    this.closedListeners.delete(listener)
  }

  destroy(): void {
    this.destroyCalls += 1
    const error = this.destroyErrors[this.destroyCalls - 1]
    if (error) throw error
  }

  completeWindowClose(): void {
    this.destroyed = true
    for (const listener of [...this.closedListeners]) listener()
  }

  completeWebContentsDestroy(): void {
    this.webContents.completeDestroy()
  }
}

describe("destroyBridgeReceiverOwner", () => {
  const bounds = { normalTimeoutMs: 20, forceTimeoutMs: 20 }

  it("resolves after normal destroy confirmation and cleans listeners and timers", async () => {
    vi.useFakeTimers()
    const owner = new FakeReceiverOwner()
    let completed = false
    const quiescing = destroyBridgeReceiverOwner(owner, bounds).then(() => {
      completed = true
    })

    expect(owner.destroyCalls).toBe(1)
    expect(completed).toBe(false)
    expect(owner.closedListeners.size).toBe(1)
    expect(owner.webContents.destroyedListeners.size).toBe(1)

    owner.completeWebContentsDestroy()
    await quiescing

    expect(completed).toBe(true)
    expect(owner.closedListeners.size).toBe(0)
    expect(owner.webContents.destroyedListeners.size).toBe(0)
    expect(owner.webContents.goneListeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("force-crashes after destroy throws and resolves on render-process-gone", async () => {
    const owner = new FakeReceiverOwner()
    owner.destroyErrors = [new Error("destroy failed"), null]
    const quiescing = destroyBridgeReceiverOwner(owner, bounds).then(
      () => true,
      () => false,
    )

    expect(owner.destroyCalls).toBe(2)
    expect(owner.webContents.forceCrashCalls).toBe(1)
    owner.webContents.completeRenderGone()

    await expect(quiescing).resolves.toBe(true)
    expect(owner.closedListeners.size).toBe(0)
    expect(owner.webContents.destroyedListeners.size).toBe(0)
    expect(owner.webContents.goneListeners.size).toBe(0)
  })

  it("force-crashes after normal destroy does not confirm within its bound", async () => {
    vi.useFakeTimers()
    const owner = new FakeReceiverOwner()
    const quiescing = destroyBridgeReceiverOwner(owner, bounds)

    await vi.advanceTimersByTimeAsync(20)
    expect(owner.destroyCalls).toBe(2)
    expect(owner.webContents.forceCrashCalls).toBe(1)

    owner.webContents.completeRenderGone()
    await expect(quiescing).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("rejects when force crash does not confirm destruction and cleans every resource", async () => {
    vi.useFakeTimers()
    const owner = new FakeReceiverOwner()
    let result = "pending"
    void destroyBridgeReceiverOwner(owner, bounds).then(
      () => {
        result = "resolved"
      },
      () => {
        result = "rejected"
      },
    )

    await vi.advanceTimersByTimeAsync(40)

    expect(result).toBe("rejected")
    expect(owner.destroyCalls).toBe(2)
    expect(owner.webContents.forceCrashCalls).toBe(1)
    expect(owner.closedListeners.size).toBe(0)
    expect(owner.webContents.destroyedListeners.size).toBe(0)
    expect(owner.webContents.goneListeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not withdraw or resume when forced destruction remains unconfirmed", async () => {
    vi.useFakeTimers()
    const owner = new FakeReceiverOwner()
    const events: string[] = []
    const coordinator = new BridgeQuitCoordinator({
      requestReceiverStop: () => Promise.resolve(false),
      quiesceReceiverOwner: () => destroyBridgeReceiverOwner(owner, bounds),
      withdrawAdvertisement: () => events.push("withdraw"),
      resumeQuit: () => events.push("resume"),
      cleanup: () => events.push("cleanup"),
      reportFailure: (error) => events.push(`error:${String(error)}`),
      timeoutMs: 50,
    })

    coordinator.beforeQuit(quitEvent())
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(40)

    expect(events).toEqual(["error:Error: bridge receiver owner destruction was not confirmed"])
    expect(owner.webContents.forceCrashCalls).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("still destroys the owner when native unfollow throws", async () => {
    const owner = new FakeReceiverOwner()
    const errors: unknown[] = []
    const quiescing = quiesceBridgeReceiverOwner(
      owner,
      () => {
        throw new Error("native detach failed")
      },
      (error) => errors.push(error),
      bounds,
    )

    expect(owner.destroyCalls).toBe(1)
    owner.completeWindowClose()

    await expect(quiescing).resolves.toBeUndefined()
    expect(errors.map(String)).toEqual(["Error: native detach failed"])
  })

  it("prevents a poised heartbeat after forced destruction and before withdrawal", async () => {
    vi.useFakeTimers()
    const owner = new FakeReceiverOwner()
    const events: string[] = []
    let advertised = true
    const recoveryHeartbeat = (): void => {
      if (!owner.destroyed && !owner.webContents.destroyed && !owner.webContents.rendererGone) {
        advertised = true
        events.push("heartbeat")
      }
    }
    const coordinator = new BridgeQuitCoordinator({
      requestReceiverStop: () => Promise.resolve(false),
      quiesceReceiverOwner: () => destroyBridgeReceiverOwner(owner, bounds),
      withdrawAdvertisement: () => {
        recoveryHeartbeat()
        advertised = false
        events.push("withdraw")
      },
      resumeQuit: () => events.push("resume"),
      cleanup: () => {},
      reportFailure: () => events.push("quiesce-error"),
      timeoutMs: 50,
    })

    coordinator.beforeQuit(quitEvent())
    await vi.advanceTimersByTimeAsync(0)
    recoveryHeartbeat()
    expect(events).toEqual(["heartbeat"])

    await vi.advanceTimersByTimeAsync(20)
    expect(owner.webContents.forceCrashCalls).toBe(1)
    owner.webContents.completeRenderGone()
    await vi.advanceTimersByTimeAsync(0)

    expect(advertised).toBe(false)
    expect(events).toEqual(["heartbeat", "withdraw", "resume"])
  })
})

describe("withdrawAdvertisedBridge", () => {
  it("removes a checksum-valid rendezvous before only its FIFO endpoints", () => {
    const rendezvous = "/bridge/pipe-session"
    const state = pipeEndpoint("darwin", "/bridge", SESSION, "state")
    const scroll = pipeEndpoint("darwin", "/bridge", SESSION, "scroll")
    const notes = pipeEndpoint("darwin", "/bridge", SESSION, "notes")
    const entries = new Map([
      [rendezvous, { kind: "file", dev: 1, ino: 1 }],
      [state, { kind: "fifo", dev: 1, ino: 2 }],
      [scroll, { kind: "file", dev: 1, ino: 3 }],
      [notes, { kind: "symlink", dev: 1, ino: 4 }],
    ])
    const unlinked: string[] = []

    expect(
      withdrawAdvertisedBridge("/bridge", "darwin", {
        read: () => encodeRendezvous({ heartbeatSeconds: 1_786_176_000, session: SESSION }),
        lstat: (path) => {
          const entry = entries.get(path)
          if (!entry) throw Object.assign(new Error("missing"), { code: "ENOENT" })
          return {
            dev: entry.dev,
            ino: entry.ino,
            isFile: () => entry.kind === "file",
            isFIFO: () => entry.kind === "fifo",
            isSymbolicLink: () => entry.kind === "symlink",
          }
        },
        unlink: (path) => {
          unlinked.push(path)
          entries.delete(path)
        },
      }),
    ).toBe(true)

    expect(unlinked).toEqual([rendezvous, state])
    expect(entries.has(scroll)).toBe(true)
    expect(entries.has(notes)).toBe(true)
  })

  it("refuses malformed, symlinked, or identity-replaced rendezvous records", () => {
    const cases = ["malformed", "symlink", "replaced"] as const

    for (const kind of cases) {
      let stats = 0
      const unlinked: string[] = []
      expect(
        withdrawAdvertisedBridge("/bridge", "darwin", {
          read: () =>
            kind === "malformed"
              ? Uint8Array.of(1, 2, 3)
              : encodeRendezvous({ heartbeatSeconds: 1_786_176_000, session: SESSION }),
          lstat: () => {
            stats += 1
            return {
              dev: 1,
              ino: kind === "replaced" && stats > 1 ? 2 : 1,
              isFile: () => kind !== "symlink",
              isFIFO: () => false,
              isSymbolicLink: () => kind === "symlink",
            }
          },
          unlink: (path) => unlinked.push(path),
        }),
      ).toBe(false)
      expect(unlinked).toEqual([])
    }
  })
})
